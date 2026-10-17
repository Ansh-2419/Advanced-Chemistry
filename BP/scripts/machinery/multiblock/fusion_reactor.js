import {
    EnergyStorage,
    FluidStorage,
    TemperatureStorage,
    Multiblock,
    MultiblockGenerator,
    InterfaceManager,
    registerLinkNodeIO,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { NUCLEAR_THERMAL, getNuclearHeatCapacity, getNuclearEfficiency, simulateNuclearReactor } from "./nuclearSimulation.js";
import {
    formatReactorOnTime,
    setReactorRunning,
    spawnReactorVentSmoke,
    synchronizeReactorTimer,
} from "./reactorRuntime.js";

// ── Fuel registry ─────────────────────────────────────────────────────────────
const FUELS = {
    biofuel:           { energyPerBucket: 80_000,  label: "Biofuel",           tier: 1, peakTempK: 1_400 },
    ethanol:           { energyPerBucket: 60_000,  label: "Ethanol",           tier: 1, peakTempK: 1_200 },
    diesel:            { energyPerBucket: 120_000, label: "Diesel",            tier: 1, peakTempK: 1_600 },
    heavy_hydrocarbon: { energyPerBucket: 150_000, label: "Heavy Hydrocarbon", tier: 2, peakTempK: 2_000 },
    fissile_fuel:      { energyPerBucket: 500_000, label: "Fissile Fuel",      tier: 2, peakTempK: 4_200 },
};
const VALID_FUELS = new Set(Object.keys(FUELS));

// ── Coolant registry ──────────────────────────────────────────────────────────
const COOLANTS = {
    water:           { speedMultiplier: 1.0, label: "Water",   coolingK: 220, efficiency: 0.6 },
    saline_coolant:  { speedMultiplier: 1.4, label: "Saline",  coolingK: 320, efficiency: 0.8 },
    liquid_nitrogen: { speedMultiplier: 2.0, label: "Liq. N2", coolingK: 520, efficiency: 1.0 },
};
const VALID_COOLANTS = new Set(Object.keys(COOLANTS));

// ── Thermal config ────────────────────────────────────────────────────────────
/**
 * All temperature-related tuning lives here so it can be read by both the
 * nuclearSimulation loop (efficiency curve) and the display helpers (ranges).
 */
const THERMAL_CONFIG = {
    ambientTemperatureK:      300,
    maximumTemperatureK:      5_000,
    overheatWarningK:         4_200,
    meltdownTemperatureK:     5_000,

    minimumEfficiency:        0.10,
    maximumEfficiency:        0.95,
    idealTemperatureFraction: 0.50,
    efficiencyGamma:          5,
    coldEfficiencyAlpha:      1.6,
    hotEfficiencyAlpha:       1.2,

    // Fuel consumption: 1 000 mB per cycle at base speed.
    fuelPerCycle:             1_000,
    // Energy per mB of fuel (at 100 % efficiency).
    // The per-bucket values in FUELS are used for the display only;
    // the simulation treats all fuels identically here and scales with
    // the bucket energy via energyPerFuelMb derived below per-tick.
};

// ── Cycle constants ───────────────────────────────────────────────────────────
const EXHAUST_TYPE      = "reactive_fluid";
const EXHAUST_PER_CYCLE = 400;           // mB
const BASE_CYCLE_TICKS  = 200;
const THROTTLE_AT       = 0.95;
const ENERGY_PENALTY    = 0.25;          // per missing coolant bucket
const FLUID_CAPACITY    = 64_000;
const ENERGY_CAPACITY   = 10_000_000;
const EMPTY             = "empty";

// Coolant: 2 buckets required per cycle.
const COOLANT_BUCKETS_REQUIRED = 2;

// ── Slot map ──────────────────────────────────────────────────────────────────
const SLOT_ENERGY  = 0;
const SLOT_LABEL   = 1;
const SLOT_COOLANT = 2;
const SLOT_FUEL    = 3;
const SLOT_TEMP    = 4;
const SLOT_EXHAUST = 5;
// Power button lives at the dedicated slot the UI sends — separate from display slots.
// HM uses slot 5 for the power button; we keep it the same so the UI $index matches.
const SLOT_POWER   = 5;

// ── Dynamic-property keys ─────────────────────────────────────────────────────
const PROP_TICK       = "ac:fr_tick";
const PROP_DATA       = "ac:fr_data";
const LOCK_FUEL       = "ac:fr_tank0_locked";
const LOCK_COOLANT    = "ac:fr_tank1_locked";
const LOCK_EXHAUST    = "ac:fr_tank2_locked";

// ── Keypad / control panel slots ──────────────────────────────────────────────
// These mirror the $index values in fusion_reactor.json's control_page exactly.
const SLOT_RATE_INPUT  = 6;   // display item that shows the typed number
const SLOT_RATE_ACCEPT = 18;  // ✓ enter
const SLOT_RATE_CANCEL = 19;  // ✗ cancel / reset
const SLOT_RATE_DELETE = 20;  // ← backspace
const RATE_KEYPAD_BY_SLOT = {
    7: "7", 8: "8", 9: "9",
    10: "4", 11: "5", 12: "6",
    13: "1", 14: "2", 15: "3",
    16: ".", 17: "0",
};
const RATE_INPUT_ITEM  = "utilitycraft:arrow_right_0";

// ── Keypad helpers ────────────────────────────────────────────────────────────

function getRateInputText(entity) {
    const label = entity?.getComponent("inventory")?.container
        ?.getItem(SLOT_RATE_INPUT)?.nameTag ?? "";
    return label.replace(/§./g, "").match(/([\d.]+)\s*mB\/t/)?.[1] ?? "0";
}

function setRateInputText(entity, text = "0") {
    DoriosLib.entity.setNewItem(entity, {
        slot:    SLOT_RATE_INPUT,
        typeId:  RATE_INPUT_ITEM,
        nameTag: `§r§f${text || "0"} mB/t`,
    });
}

function appendRateInput(slot, entity) {
    const ch = RATE_KEYPAD_BY_SLOT[slot];
    if (ch === undefined) return;
    const current = getRateInputText(entity);
    if (ch === "." && current.includes(".")) return;
    const next = current === "0" && ch !== "." ? ch : `${current}${ch}`;
    setRateInputText(entity, next || "0");
}

function deleteRateInput(entity) {
    const t = getRateInputText(entity);
    setRateInputText(entity, t.length > 1 ? t.slice(0, -1) : "0");
}

function applyBurnRate(entity) {
    const parsed = Number.parseFloat(getRateInputText(entity));
    const rate   = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    const data   = getReactorData(entity);
    data.rate    = rate;
    saveReactorData(entity, data);
    setRateInputText(entity, String(rate));
    // Update the "current rate" display item (slot 23 — same index as HM).
    DoriosLib.entity.setNewItem(entity, {
        slot:    23,
        typeId:  "utilitycraft:arrow_indicator_90",
        nameTag: `§r§7Fuel Rate: §f${rate} mB/t`,
    });
}

// ── InterfaceManager registration ─────────────────────────────────────────────

const FR_INTERFACE_ID = "ac:fusion_reactor_controls";

const fusionReactorButtons = {
    power: {
        slot: SLOT_POWER,
        onPress({ entity }) {
            if (!entity) return;
            const data = getReactorData(entity);
            setReactorRunning(data, data.state === "off");
            saveReactorData(entity, data);
        },
    },
    accept: {
        slot: SLOT_RATE_ACCEPT,
        onPress({ entity }) { applyBurnRate(entity); },
    },
    cancel: {
        slot: SLOT_RATE_CANCEL,
        onPress({ entity }) { setRateInputText(entity, "0"); },
    },
    delete: {
        slot: SLOT_RATE_DELETE,
        onPress({ entity }) { deleteRateInput(entity); },
    },
};

// Register a handler for every keypad digit.
for (const slot of Object.keys(RATE_KEYPAD_BY_SLOT).map(Number)) {
    fusionReactorButtons[`keypad_${slot}`] = {
        slot,
        onPress({ entity }) { appendRateInput(slot, entity); },
    };
}

InterfaceManager.registerInterface(FR_INTERFACE_ID, { buttons: fusionReactorButtons });
InterfaceManager.linkBlockInterface("utilitycraft:fusion_reactor_controller", FR_INTERFACE_ID);
InterfaceManager.linkEntityInterface("utilitycraft:fusion_reactor_multiblock", FR_INTERFACE_ID);

// ── Port requirements ─────────────────────────────────────────────────────────
const PORT_REQ = {
    fluid:  { min: 2, id: "utilitycraft:ind_fluid_port",  label: "Industrial Fluid Port"  },
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
};

// ── Runtime data defaults ─────────────────────────────────────────────────────
const INITIAL_DATA = {
    state:       "off",
    startedAtMs: 0,
    temperature: THERMAL_CONFIG.ambientTemperatureK,
    warning:     "§eStopped",
};

// ── Generator CONFIG ──────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:fusion_reactor_multiblock",
        name:           "fusion_reactor_multiblock",
        inventory_size: 26,
    },
    generator: {
        rate_speed_base: FUELS.biofuel.energyPerBucket / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     3,
    },
    requirements: {},
};

// ── Link node IO ──────────────────────────────────────────────────────────────
registerLinkNodeIO("utilitycraft:fusion_reactor_controller", {
    liquids: {
        inputs:  [
            { storageIndex: 0, label: "Fuel In"     },
            { storageIndex: 1, label: "Coolant In"  },
        ],
        outputs: [
            { storageIndex: 2, label: "Exhaust Out" },
        ],
    },
    energy: {
        outputs: [{ label: "Energy Out" }],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:fusion_reactor_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockGenerator.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) {
                    initStorage(entity);
                    initReactorData(entity);
                    setRateInputText(entity, "0");
                    InterfaceManager.ensureEntityInterfaces(entity);
                },

                onActivate({ entity, structure, player }) {
                    const { min, max } = structure.bounds;
                    const sX = max.x - min.x + 1;
                    const sY = max.y - min.y + 1;
                    const sZ = max.z - min.z + 1;

                    if (sX < 3 || sY < 3 || sZ < 3) {
                        player.sendMessage(
                            `§c[Fusion Reactor] Minimum size 3×3×3. Found: ${sX}×${sY}×${sZ}.`
                        );
                        return false;
                    }

                    const dim   = entity.dimension;
                    const found = { fluid: 0, energy: 0 };
                    for (const tag of structure.inputBlocks) {
                        const loc   = DoriosLib.linkNode.parseLinkNodeTag(tag);
                        const block = loc && dim.getBlock(loc);
                        if (!block) continue;
                        if (block.typeId === PORT_REQ.fluid.id)  found.fluid++;
                        if (block.typeId === PORT_REQ.energy.id) found.energy++;
                    }

                    for (const [key, req] of Object.entries(PORT_REQ)) {
                        if (found[key] < req.min) {
                            player.sendMessage(
                                `§c[Fusion Reactor] Need ${req.min}x §e${req.label}§c, found ${found[key]}.`
                            );
                            return false;
                        }
                    }

                    initStorage(entity);
                    lockTanks(entity);
                    setRateInputText(entity, "0");
                    InterfaceManager.ensureEntityInterfaces(entity);

                    // Persist structure heat capacity so the simulation can use
                    // the correct thermal mass after a world reload.
                    const heatCapacity = getNuclearHeatCapacity(structure.bounds);
                    const data = getReactorData(entity);
                    data.heatCapacity = heatCapacity;
                    setReactorRunning(data, false);
                    saveReactorData(entity, data);
                },

                successMessages: [
                    "§a[Fusion Reactor] Online — structure validated.",
                    "§7Fuel: §ebiofuel / ethanol / diesel / heavy_hydrocarbon / fissile_fuel",
                    "§7Coolant: §bwater / saline_coolant / liquid_nitrogen §7(2 buckets/cycle)",
                    "§7Exhaust: §creactive_fluid §7— pipe it away!",
                    "§eHigher-tier fuels run hotter and produce more energy per bucket.",
                    `§7Temperature simulation active — efficiency peaks near ${
                        Math.round((THERMAL_CONFIG.maximumTemperatureK - THERMAL_CONFIG.ambientTemperatureK)
                        * THERMAL_CONFIG.idealTemperatureFraction + THERMAL_CONFIG.ambientTemperatureK)
                    } K.`,
                ],
            }
        );
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const reactor = new MultiblockGenerator(block, CONFIG);
        if (!reactor.valid) return;
        if (reactor.entity.getDynamicProperty("dorios:state") !== "on") return;

        const { energy, fuelTank, coolantTank, exhaustTank } = initStorage(reactor.entity);
        lockTanks(reactor.entity);
        guardTank(fuelTank,    VALID_FUELS);
        guardTank(coolantTank, VALID_COOLANTS);
        guardTank(exhaustTank, EXHAUST_TYPE);

        // Transfer buffered energy to network.
        energy.transferToNetwork(reactor.rate);

        // Load reactor state (persisted between ticks).
        const data = getReactorData(reactor.entity);
        synchronizeReactorTimer(data);

        // ── Temperature storage ──────────────────────────────────────────────
        const heatCapacity = data.heatCapacity ?? NUCLEAR_THERMAL.baseHeatCapacity;
        const tempStore = new TemperatureStorage(reactor.entity, 0, {
            initialTemperature: THERMAL_CONFIG.ambientTemperatureK,
            heatCapacity,
        });
        if (tempStore.getHeatCapacity() !== heatCapacity) tempStore.setHeatCapacity(heatCapacity);
        let currentTemp = tempStore.get();

        // ── Throttle check ───────────────────────────────────────────────────
        if (energy.get() / Math.max(1, energy.getCap()) >= THROTTLE_AT) {
            // Cool passively when throttled.
            tempStore.transfer(THERMAL_CONFIG.ambientTemperatureK, 1, 0.025);
            currentTemp = tempStore.get();
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, currentTemp,
                "§6Buffer Full", null, 0, 1.0, tempStore);
            saveReactorData(reactor.entity, data);
            return;
        }

        // ── Fuel check ───────────────────────────────────────────────────────
        const fuelType = fuelTank.getType();
        const fuelCfg  = FUELS[fuelType] ?? null;

        if (!fuelCfg || fuelTank.get() < THERMAL_CONFIG.fuelPerCycle) {
            tempStore.transfer(THERMAL_CONFIG.ambientTemperatureK, 1, 0.025);
            currentTemp = tempStore.get();
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, currentTemp,
                fuelTank.get() <= 0 ? "§cNo Fuel" : "§cInvalid Fuel", null, 0, 1.0, tempStore);
            saveReactorData(reactor.entity, data);
            return;
        }

        // ── Exhaust check ────────────────────────────────────────────────────
        if (exhaustTank.getFreeSpace() < EXHAUST_PER_CYCLE) {
            tempStore.transfer(THERMAL_CONFIG.ambientTemperatureK, 1, 0.025);
            currentTemp = tempStore.get();
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, currentTemp,
                "§cExhaust Full", fuelCfg, 0, 1.0, tempStore);
            saveReactorData(reactor.entity, data);
            return;
        }

        // ── Coolant ──────────────────────────────────────────────────────────
        const coolantType = coolantTank.getType();
        const coolantCfg  = COOLANTS[coolantType] ?? null;
        const availBuckets = coolantType === EMPTY ? 0
            : Math.min(COOLANT_BUCKETS_REQUIRED, Math.floor(coolantTank.get() / 1_000));
        const missingBuckets = COOLANT_BUCKETS_REQUIRED - availBuckets;

        const fullSpeed  = coolantCfg?.speedMultiplier ?? 0.4;
        const speedMult  = availBuckets === 0
            ? 0.4
            : 0.4 + (fullSpeed - 0.4) * (availBuckets / COOLANT_BUCKETS_REQUIRED);
        const energyMult = Math.max(0.25, 1 - missingBuckets * ENERGY_PENALTY);
        const energyPerFuelMb = (fuelCfg.energyPerBucket / 1_000) * energyMult;

        // Coolant heat budget: how much heat the coolant absorbs this tick.
        const coolantEfficiency = coolantCfg?.efficiency ?? 0;
        const coolantBudgetHU   = availBuckets > 0
            ? availBuckets * 1_000 * NUCLEAR_THERMAL.coolantHeatPerMb * coolantEfficiency
            : 0;

        // Active coolant conductance from the available buckets.
        const conductance = availBuckets > 0
            ? availBuckets * NUCLEAR_THERMAL.coolantConductance
            : 0;

        // ── Physics simulation ───────────────────────────────────────────────
        const simResult = simulateNuclearReactor(
            {
                temperature:       currentTemp,
                heatCapacity,
                ticks:             1,
                running:           true,
                fuel:              fuelTank.get(),
                energySpace:       energy.getFreeSpace(),
                coolantHeatBudget: coolantBudgetHU,
                conductance,
            },
            {
                ...THERMAL_CONFIG,
                energyPerFuelMb,
                fuelPerCycle: THERMAL_CONFIG.fuelPerCycle,
            }
        );

        // ── Apply results ────────────────────────────────────────────────────
        const cycleTicks = Math.max(1, Math.floor(BASE_CYCLE_TICKS / speedMult));
        const tick = ((reactor.entity.getDynamicProperty(PROP_TICK) ?? 0) + 1);
        reactor.entity.setDynamicProperty(PROP_TICK, tick % cycleTicks);

        if (tick % cycleTicks === 0) {
            fuelTank.consume(THERMAL_CONFIG.fuelPerCycle);
            if (fuelTank.get() <= 0) fuelTank.setType(fuelType);

            if (coolantCfg && availBuckets > 0) {
                coolantTank.consume(availBuckets * 1_000);
                if (coolantTank.get() <= 0) coolantTank.setType(EMPTY);
            }

            energy.add(Math.floor(fuelCfg.energyPerBucket * energyMult));

            if (exhaustTank.getType() === EMPTY) exhaustTank.setType(EXHAUST_TYPE);
            exhaustTank.add(EXHAUST_PER_CYCLE);

            // Emit vent smoke while running and coolant is present.
            if (availBuckets > 0) spawnReactorVentSmoke(reactor.entity);
        }

        // Apply the simulated temperature (uses the physics result directly).
        tempStore.set(simResult.temperature);
        currentTemp = simResult.temperature;

        // ── Overheat / meltdown ──────────────────────────────────────────────
        if (simResult.meltdown) {
            data.warning = "§cCore meltdown!";
            setReactorRunning(data, false);
            saveReactorData(reactor.entity, data);
            Multiblock.DeactivationManager.deactivateMultiblock(block);
            DoriosLib.time.runAfterSeconds(4, () => {
                if (!reactor.entity.isValid) return;
                reactor.entity.dimension.createExplosion(
                    reactor.entity.location,
                    Math.max(4, heatCapacity ** (1 / 3) * 0.3),
                    { causesFire: true, breaksBlocks: true },
                );
            });
            return;
        }

        // ── Status label ─────────────────────────────────────────────────────
        let status;
        if (currentTemp >= THERMAL_CONFIG.overheatWarningK) {
            status = "§4Overheating!";
        } else if (missingBuckets > 0 && availBuckets > 0) {
            status = `§eLow Coolant §7(-${missingBuckets * 25}% energy)`;
        } else if (availBuckets === 0) {
            status = `§cNo Coolant §7(×0.4 speed, -75% energy)`;
        } else {
            const eff = getNuclearEfficiency(currentTemp, THERMAL_CONFIG);
            status = eff >= 0.80
                ? `§aBurning §7(eff: ${Math.round(eff * 100)}%)`
                : `§eBurning §7(eff: ${Math.round(eff * 100)}%)`;
        }

        // Persist runtime state.
        data.temperature = currentTemp;
        data.onTime = formatReactorOnTime(data);
        saveReactorData(reactor.entity, data);

        display(reactor, energy, fuelTank, coolantTank, exhaustTank, currentTemp,
            status, fuelCfg, missingBuckets, energyMult, tempStore);
    },
});

// ── Storage helpers ───────────────────────────────────────────────────────────

function initStorage(entity) {
    const [fuelTank, coolantTank, exhaustTank] = FluidStorage.initializeMultiple(entity, 3);
    if (fuelTank.getCap()    !== FLUID_CAPACITY) fuelTank.setCap(FLUID_CAPACITY);
    if (coolantTank.getCap() !== FLUID_CAPACITY) coolantTank.setCap(FLUID_CAPACITY);
    if (exhaustTank.getCap() !== FLUID_CAPACITY) exhaustTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, fuelTank, coolantTank, exhaustTank };
}

function lockTanks(entity) {
    if (!entity.hasTag(LOCK_FUEL))    entity.addTag(LOCK_FUEL);
    if (!entity.hasTag(LOCK_COOLANT)) entity.addTag(LOCK_COOLANT);
    if (!entity.hasTag(LOCK_EXHAUST)) {
        entity.addTag(LOCK_EXHAUST);
        if (!entity.getTags().find(t => t.startsWith("fluid2Type:")))
            entity.addTag(`fluid2Type:${EXHAUST_TYPE}`);
    }
}

function guardTank(tank, allowed) {
    const type = tank.getType();
    if (type === EMPTY) return;
    const ok = typeof allowed === "string" ? type === allowed : allowed.has(type);
    if (!ok) { tank.set(0); tank.setType(EMPTY); }
}

// ── Reactor data persistence ──────────────────────────────────────────────────

function initReactorData(entity) {
    const existing = entity.getDynamicProperty(PROP_DATA);
    if (!existing) saveReactorData(entity, { ...INITIAL_DATA });
}

function getReactorData(entity) {
    try {
        const raw = entity.getDynamicProperty(PROP_DATA);
        if (raw) return { ...INITIAL_DATA, ...JSON.parse(raw) };
    } catch { /* fall through */ }
    return { ...INITIAL_DATA };
}

function saveReactorData(entity, data) {
    const serialized = JSON.stringify(data);
    if (entity.getDynamicProperty(PROP_DATA) !== serialized) {
        entity.setDynamicProperty(PROP_DATA, serialized);
    }
}

// ── Display ───────────────────────────────────────────────────────────────────

function display(reactor, energy, fuelTank, coolantTank, exhaustTank, temp,
                 status, fuelCfg, missingBuckets, energyMult, tempStore) {
    energy.display(SLOT_ENERGY);
    coolantTank.display(SLOT_COOLANT);
    fuelTank.display(SLOT_FUEL);
    exhaustTank.display(SLOT_EXHAUST);
    if (tempStore) {
        tempStore.display(SLOT_TEMP, {
            minimum: THERMAL_CONFIG.ambientTemperatureK,
            maximum: THERMAL_CONFIG.maximumTemperatureK,
            force:   true,
        });
    }

    const FL = FluidStorage.formatFluid;
    const E  = EnergyStorage.formatEnergyToText;

    const coolantType = coolantTank.getType();
    const coolantCfg  = COOLANTS[coolantType] ?? null;
    const coolantLine = coolantCfg
        ? `§f${coolantCfg.label} ×${coolantCfg.speedMultiplier.toFixed(1)}`
        : coolantType === EMPTY ? "§7Empty" : `§e${coolantType} §c?`;

    const fuelLine = fuelCfg
        ? `§f${fuelCfg.label} §7(${E(fuelCfg.energyPerBucket)}/bucket)`
        : "§cNone";

    const effLine = energyMult < 1
        ? `§cEff: ${Math.round(energyMult * 100)}%`
        : `§aEff: 100%`;

    const eff = getNuclearEfficiency(temp, THERMAL_CONFIG);
    const thermalLine = `§7Thermal eff: §f${Math.round(eff * 100)}%`;

    reactor.setLabel([
        `§6Fusion Reactor §7| ${status}`,
        `§eFuel:     ${fuelLine}`,
        `§eFuel Amt: §f${FL(fuelTank.get())}/${FL(fuelTank.getCap())}`,
        `§bCoolant:  ${coolantLine} §f${FL(coolantTank.get())}/${FL(coolantTank.getCap())}`,
        `§cExhaust:  §f${FL(exhaustTank.get())}/${FL(exhaustTank.getCap())}`,
        `§eBuffer:   §f${E(energy.get())}/${E(energy.getCap())} ${effLine}`,
        `§aTemp:     §f${temp.toFixed(0)} K  ${thermalLine}`,
    ], SLOT_LABEL);
}
