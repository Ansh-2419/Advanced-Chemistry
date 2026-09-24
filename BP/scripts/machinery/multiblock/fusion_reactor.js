import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
    registerLinkNodeIO,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { ItemStack } from "@minecraft/server";

// ── Fuel registry — all fluids already present in Advance Chemistry ───────────
// Each entry: energy per 1000 mB consumed, display label, min structure tier
const FUELS = {
    biofuel:          { energyPerBucket: 80_000,  label: "Biofuel",          tier: 1 },
    ethanol:          { energyPerBucket: 60_000,  label: "Ethanol",          tier: 1 },
    diesel:           { energyPerBucket: 120_000, label: "Diesel",           tier: 1 },
    heavy_hydrocarbon:{ energyPerBucket: 150_000, label: "Heavy Hydrocarbon",tier: 2 },
    fissile_fuel:     { energyPerBucket: 500_000, label: "Fissile Fuel",     tier: 2 },
};
const VALID_FUELS = new Set(Object.keys(FUELS));

// ── Coolant registry ──────────────────────────────────────────────────────────
const COOLANTS = {
    water:          { speedMultiplier: 1.0, label: "Water"    },
    saline_coolant: { speedMultiplier: 1.4, label: "Saline"   },
    liquid_nitrogen:{ speedMultiplier: 2.0, label: "Liq. N₂" },
};
const VALID_COOLANTS    = new Set(Object.keys(COOLANTS));
const COOLANT_PER_CYCLE = 2_000; // mB per cycle
const NO_COOLANT_SPEED  = 0.4;   // 40% speed when running dry

// ── Exhaust output ────────────────────────────────────────────────────────────
const EXHAUST_TYPE      = "reactive_fluid"; // already in the mod (separator output)
const EXHAUST_PER_CYCLE = 400;             // mB exhaust per cycle

// ── Cycle config ──────────────────────────────────────────────────────────────
const FUEL_PER_CYCLE    = 1_000;   // mB per cycle (1 bucket)
const BASE_CYCLE_TICKS  = 200;     // ticks at ×1.0 coolant speed
const THROTTLE_AT       = 0.95;
const ENERGY_PENALTY    = 0.25;    // 25% energy penalty per missing coolant bucket
const FLUID_CAPACITY    = 64_000;
const ENERGY_CAPACITY   = 10_000_000;
const EMPTY             = "empty";

// ── Progress bar ──────────────────────────────────────────────────────────────
const PROGRESS_FRAMES = 23;
const PROGRESS_ITEM   = "utilitycraft:progress_right_big_bar";

// ── Slot map ──────────────────────────────────────────────────────────────────
const SLOT_ENERGY   = 0;
const SLOT_LABEL    = 1;
const SLOT_PROGRESS = 2;
const SLOT_FUEL     = 3;
const SLOT_COOLANT  = 4;
const SLOT_EXHAUST  = 5;

// ── Dynamic property keys ─────────────────────────────────────────────────────
const PROP_TICK = "ac:fr_tick";
const LOCK_FUEL    = "ac:fr_tank0_locked";
const LOCK_COOLANT = "ac:fr_tank1_locked";
const LOCK_EXHAUST = "ac:fr_tank2_locked";

// ── Port requirements ─────────────────────────────────────────────────────────
const PORT_REQ = {
    fluid:  { min: 2, id: "utilitycraft:ind_fluid_port",  label: "Industrial Fluid Port"  },
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
};

// ── Multiblock CONFIG ─────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:fusion_reactor_multiblock",
        name:           "fusion_reactor_multiblock",
        inventory_size: 6,
    },
    generator: {
        rate_speed_base: (FUELS.biofuel.energyPerBucket) / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     3,
    },
    requirements: {},
};

// ── Link-node IO (pipe / cable connections) ───────────────────────────────────
registerLinkNodeIO("utilitycraft:fusion_reactor_controller", {
    liquids: {
        inputs:  [{ storageIndex: 0, label: "Fuel In"     },
                  { storageIndex: 1, label: "Coolant In"  }],
        outputs: [{ storageIndex: 2, label: "Exhaust Out" }],
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
                },

                successMessages: [
                    "§a[Fusion Reactor] Online — structure validated.",
                    "§7Slot 0: §eFuel  §7(biofuel / ethanol / diesel / heavy_hydrocarbon / fissile_fuel)",
                    "§7Slot 1: §bCoolant §7(water / saline / liquid_nitrogen)",
                    "§7Slot 2: §cExhaust Out §7(reactive_fluid — pipe it away!)",
                    "§eHigher-tier fuels produce more energy per bucket.",
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

        // Always export buffered energy to the network
        energy.transferToNetwork(reactor.rate);

        // ── Fuel check ────────────────────────────────────────────────────────
        const fuelType = fuelTank.getType();
        const fuelCfg  = FUELS[fuelType] ?? null;

        if (!fuelCfg || fuelTank.get() < FUEL_PER_CYCLE) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank,
                fuelTank.get() <= 0 ? "§cNo Fuel" : "§cInvalid Fuel", null, 0, 1.0);
            return;
        }

        // ── Buffer / exhaust checks ───────────────────────────────────────────
        if (energy.get() / Math.max(1, energy.getCap()) >= THROTTLE_AT) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank,
                "§6Buffer Full", fuelCfg, 0, 1.0);
            return;
        }
        if (exhaustTank.getFreeSpace() < EXHAUST_PER_CYCLE) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank,
                "§cExhaust Full", fuelCfg, 0, 1.0);
            return;
        }

        // ── Coolant calculation ───────────────────────────────────────────────
        const coolantType = coolantTank.getType();
        const coolantCfg  = COOLANTS[coolantType] ?? null;

        const availBuckets  = coolantType === EMPTY ? 0
            : Math.min(2, Math.floor(coolantTank.get() / 1_000));
        const missingBuckets = 2 - availBuckets;

        const fullSpeed  = coolantCfg?.speedMultiplier ?? NO_COOLANT_SPEED;
        const speedMult  = availBuckets === 0
            ? NO_COOLANT_SPEED
            : NO_COOLANT_SPEED + (fullSpeed - NO_COOLANT_SPEED) * (availBuckets / 2);

        const energyMult = Math.max(0.25, 1 - missingBuckets * ENERGY_PENALTY);
        const energyOut  = Math.floor(fuelCfg.energyPerBucket * energyMult);
        const cycleTicks = Math.max(1, Math.floor(BASE_CYCLE_TICKS / speedMult));

        // ── Tick counter ──────────────────────────────────────────────────────
        const tick = ((reactor.entity.getDynamicProperty(PROP_TICK) ?? 0) + 1);
        reactor.entity.setDynamicProperty(PROP_TICK, tick % cycleTicks);
        setProgress(reactor.entity, tick % cycleTicks, cycleTicks);

        // ── Combustion pulse ──────────────────────────────────────────────────
        if (tick % cycleTicks === 0) {
            fuelTank.consume(FUEL_PER_CYCLE);
            if (fuelTank.get() <= 0) fuelTank.setType(fuelType);

            if (coolantCfg && availBuckets > 0) {
                const toConsume = availBuckets * 1_000;
                coolantTank.consume(toConsume);
                if (coolantTank.get() <= 0) coolantTank.setType(EMPTY);
            }

            energy.add(energyOut);

            if (exhaustTank.getType() === EMPTY) exhaustTank.setType(EXHAUST_TYPE);
            exhaustTank.add(EXHAUST_PER_CYCLE);
        }

        // ── Status string ─────────────────────────────────────────────────────
        let status;
        if (missingBuckets > 0 && availBuckets > 0) {
            status = `§eLow Coolant §7(-${missingBuckets * 25}% energy)`;
        } else if (availBuckets === 0) {
            status = `§cNo Coolant §7(×${NO_COOLANT_SPEED} speed, -75% energy)`;
        } else {
            status = "§aBurning";
        }

        display(reactor, energy, fuelTank, coolantTank, exhaustTank,
            status, fuelCfg, missingBuckets, energyMult);
    },
});

// ── Storage initialiser ───────────────────────────────────────────────────────

function initStorage(entity) {
    const [fuelTank, coolantTank, exhaustTank] = FluidStorage.initializeMultiple(entity, 3);
    if (fuelTank.getCap()    !== FLUID_CAPACITY) fuelTank.setCap(FLUID_CAPACITY);
    if (coolantTank.getCap() !== FLUID_CAPACITY) coolantTank.setCap(FLUID_CAPACITY);
    if (exhaustTank.getCap() !== FLUID_CAPACITY) exhaustTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, fuelTank, coolantTank, exhaustTank };
}

// ── Tank locks ────────────────────────────────────────────────────────────────

function lockTanks(entity) {
    if (!entity.hasTag(LOCK_FUEL))    entity.addTag(LOCK_FUEL);
    if (!entity.hasTag(LOCK_COOLANT)) entity.addTag(LOCK_COOLANT);
    if (!entity.hasTag(LOCK_EXHAUST)) {
        entity.addTag(LOCK_EXHAUST);
        if (!entity.getTags().find(t => t.startsWith("fluid2Type:")))
            entity.addTag(`fluid2Type:${EXHAUST_TYPE}`);
    }
}

// ── Guard (flush invalid fluid types) ────────────────────────────────────────

function guardTank(tank, allowed) {
    const type = tank.getType();
    if (type === EMPTY) return;
    const ok = typeof allowed === "string"
        ? type === allowed
        : allowed.has(type);
    if (!ok) { tank.set(0); tank.setType(EMPTY); }
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function setProgress(entity, tick, cycleTicks) {
    const inv = entity.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const frame    = Math.min(PROGRESS_FRAMES - 1,
        Math.floor((tick / cycleTicks) * PROGRESS_FRAMES));
    const frameStr = frame.toString().padStart(2, "0");
    const item     = new ItemStack(`${PROGRESS_ITEM}_${frameStr}`, 1);
    item.nameTag   = "§r";
    inv.setItem(SLOT_PROGRESS, item);
}

// ── Display ───────────────────────────────────────────────────────────────────

function display(reactor, energy, fuelTank, coolantTank, exhaustTank,
                 status, fuelCfg, missingBuckets, energyMult) {
    energy.display(SLOT_ENERGY);
    fuelTank.display(SLOT_FUEL);
    coolantTank.display(SLOT_COOLANT);
    exhaustTank.display(SLOT_EXHAUST);

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

    reactor.setLabel([
        `§6Fusion Reactor §7| ${status}`,
        `§eFuel:    ${fuelLine}`,
        `§eFuel Amt: §f${FL(fuelTank.get())}/${FL(fuelTank.getCap())}`,
        `§bCoolant: ${coolantLine} §f${FL(coolantTank.get())}/${FL(coolantTank.getCap())}`,
        `§cExhaust: §f${FL(exhaustTank.get())}/${FL(exhaustTank.getCap())}`,
        `§eBuffer:  §f${E(energy.get())}/${E(energy.getCap())} ${effLine}`,
    ], SLOT_LABEL);
}
