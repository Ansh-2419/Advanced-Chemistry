import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
    TemperatureStorage,
    registerLinkNodeIO,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";

const FUELS = {
    biofuel:          { energyPerBucket: 80_000,  label: "Biofuel",           tier: 1, peakTempK: 1_400 },
    ethanol:          { energyPerBucket: 60_000,  label: "Ethanol",           tier: 1, peakTempK: 1_200 },
    diesel:           { energyPerBucket: 120_000, label: "Diesel",            tier: 1, peakTempK: 1_600 },
    heavy_hydrocarbon:{ energyPerBucket: 150_000, label: "Heavy Hydrocarbon", tier: 2, peakTempK: 2_000 },
    fissile_fuel:     { energyPerBucket: 500_000, label: "Fissile Fuel",      tier: 2, peakTempK: 4_200 },
};
const VALID_FUELS = new Set(Object.keys(FUELS));

const COOLANTS = {
    water:          { speedMultiplier: 1.0, label: "Water",   coolingK: 220 },
    saline_coolant: { speedMultiplier: 1.4, label: "Saline",  coolingK: 320 },
    liquid_nitrogen:{ speedMultiplier: 2.0, label: "Liq. N2", coolingK: 520 },
};
const VALID_COOLANTS    = new Set(Object.keys(COOLANTS));
const COOLANT_PER_CYCLE = 2_000;
const NO_COOLANT_SPEED  = 0.4;

const EXHAUST_TYPE      = "reactive_fluid";
const EXHAUST_PER_CYCLE = 400;

const FUEL_PER_CYCLE   = 1_000;
const BASE_CYCLE_TICKS = 200;
const THROTTLE_AT      = 0.95;
const ENERGY_PENALTY   = 0.25;
const FLUID_CAPACITY   = 64_000;
const ENERGY_CAPACITY  = 10_000_000;
const EMPTY            = "empty";

const AMBIENT_TEMP  = 300;
const MAX_TEMP      = 5_000;
const HEAT_CAPACITY = 8_000;

const SLOT_ENERGY  = 0;
const SLOT_LABEL   = 1;
const SLOT_COOLANT = 2;
const SLOT_FUEL    = 3;
const SLOT_TEMP    = 4;
const SLOT_EXHAUST = 5;

const PROP_TICK = "ac:fr_tick";
const PROP_TEMP = "ac:fr_temp";
const LOCK_FUEL    = "ac:fr_tank0_locked";
const LOCK_COOLANT = "ac:fr_tank1_locked";
const LOCK_EXHAUST = "ac:fr_tank2_locked";

const PORT_REQ = {
    fluid:  { min: 2, id: "utilitycraft:ind_fluid_port",  label: "Industrial Fluid Port"  },
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
};

const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:fusion_reactor_multiblock",
        name:           "fusion_reactor_multiblock",
        inventory_size: 6,
    },
    generator: {
        rate_speed_base: FUELS.biofuel.energyPerBucket / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     3,
    },
    requirements: {},
};

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

                    entity.setDynamicProperty(PROP_TEMP, AMBIENT_TEMP);
                    initStorage(entity);
                    lockTanks(entity);
                },

                successMessages: [
                    "§a[Fusion Reactor] Online — structure validated.",
                    "§7Fuel: §ebiofuel / ethanol / diesel / heavy_hydrocarbon / fissile_fuel",
                    "§7Coolant: §bwater / saline_coolant / liquid_nitrogen",
                    "§7Exhaust: §creactive_fluid §7— pipe it away!",
                    "§eHigher-tier fuels run hotter and produce more energy per bucket.",
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

        energy.transferToNetwork(reactor.rate);

        const temperature  = initTemperature(reactor.entity);
        const currentTemp  = temperature.get();

        const fuelType = fuelTank.getType();
        const fuelCfg  = FUELS[fuelType] ?? null;

        if (!fuelCfg || fuelTank.get() < FUEL_PER_CYCLE) {
            const cooled = stepTemperature(currentTemp, AMBIENT_TEMP);
            temperature.set(cooled);
            reactor.entity.setDynamicProperty(PROP_TEMP, cooled);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, temperature,
                fuelTank.get() <= 0 ? "§cNo Fuel" : "§cInvalid Fuel", null, 0, 1.0);
            return;
        }

        if (energy.get() / Math.max(1, energy.getCap()) >= THROTTLE_AT) {
            const cooled = stepTemperature(currentTemp, AMBIENT_TEMP);
            temperature.set(cooled);
            reactor.entity.setDynamicProperty(PROP_TEMP, cooled);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, temperature,
                "§6Buffer Full", fuelCfg, 0, 1.0);
            return;
        }

        if (exhaustTank.getFreeSpace() < EXHAUST_PER_CYCLE) {
            const cooled = stepTemperature(currentTemp, AMBIENT_TEMP);
            temperature.set(cooled);
            reactor.entity.setDynamicProperty(PROP_TEMP, cooled);
            display(reactor, energy, fuelTank, coolantTank, exhaustTank, temperature,
                "§cExhaust Full", fuelCfg, 0, 1.0);
            return;
        }

        const coolantType = coolantTank.getType();
        const coolantCfg  = COOLANTS[coolantType] ?? null;

        const availBuckets   = coolantType === EMPTY ? 0
            : Math.min(2, Math.floor(coolantTank.get() / 1_000));
        const missingBuckets = 2 - availBuckets;

        const fullSpeed  = coolantCfg?.speedMultiplier ?? NO_COOLANT_SPEED;
        const speedMult  = availBuckets === 0
            ? NO_COOLANT_SPEED
            : NO_COOLANT_SPEED + (fullSpeed - NO_COOLANT_SPEED) * (availBuckets / 2);

        const energyMult = Math.max(0.25, 1 - missingBuckets * ENERGY_PENALTY);
        const energyOut  = Math.floor(fuelCfg.energyPerBucket * energyMult);
        const cycleTicks = Math.max(1, Math.floor(BASE_CYCLE_TICKS / speedMult));

        const coolingK   = coolantCfg ? coolantCfg.coolingK * (availBuckets / 2) : 0;
        const targetTemp = Math.max(AMBIENT_TEMP, fuelCfg.peakTempK - coolingK);
        const newTemp    = stepTemperature(currentTemp, targetTemp);
        temperature.set(newTemp);
        reactor.entity.setDynamicProperty(PROP_TEMP, newTemp);

        const tick = ((reactor.entity.getDynamicProperty(PROP_TICK) ?? 0) + 1);
        reactor.entity.setDynamicProperty(PROP_TICK, tick % cycleTicks);

        if (tick % cycleTicks === 0) {
            fuelTank.consume(FUEL_PER_CYCLE);
            if (fuelTank.get() <= 0) fuelTank.setType(fuelType);

            if (coolantCfg && availBuckets > 0) {
                coolantTank.consume(availBuckets * 1_000);
                if (coolantTank.get() <= 0) coolantTank.setType(EMPTY);
            }

            energy.add(energyOut);

            if (exhaustTank.getType() === EMPTY) exhaustTank.setType(EXHAUST_TYPE);
            exhaustTank.add(EXHAUST_PER_CYCLE);
        }

        let status;
        if (missingBuckets > 0 && availBuckets > 0) {
            status = `§eLow Coolant §7(-${missingBuckets * 25}% energy)`;
        } else if (availBuckets === 0) {
            status = `§cNo Coolant §7(×${NO_COOLANT_SPEED} speed, -75% energy)`;
        } else {
            status = "§aBurning";
        }

        display(reactor, energy, fuelTank, coolantTank, exhaustTank, temperature,
            status, fuelCfg, missingBuckets, energyMult);
    },
});

function initStorage(entity) {
    const [fuelTank, coolantTank, exhaustTank] = FluidStorage.initializeMultiple(entity, 3);
    if (fuelTank.getCap()    !== FLUID_CAPACITY) fuelTank.setCap(FLUID_CAPACITY);
    if (coolantTank.getCap() !== FLUID_CAPACITY) coolantTank.setCap(FLUID_CAPACITY);
    if (exhaustTank.getCap() !== FLUID_CAPACITY) exhaustTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, fuelTank, coolantTank, exhaustTank };
}

function initTemperature(entity) {
    const stored = Number(entity.getDynamicProperty(PROP_TEMP) ?? AMBIENT_TEMP);
    return new TemperatureStorage(entity, 0, {
        initialTemperature: stored,
        heatCapacity: HEAT_CAPACITY,
    });
}

function stepTemperature(current, target) {
    const step = (target - current) / HEAT_CAPACITY * 200;
    return Math.max(AMBIENT_TEMP, Math.min(MAX_TEMP, current + step));
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
    const ok = typeof allowed === "string"
        ? type === allowed
        : allowed.has(type);
    if (!ok) { tank.set(0); tank.setType(EMPTY); }
}

function display(reactor, energy, fuelTank, coolantTank, exhaustTank, temperature,
                 status, fuelCfg, missingBuckets, energyMult) {
    energy.display(SLOT_ENERGY);
    coolantTank.display(SLOT_COOLANT);
    fuelTank.display(SLOT_FUEL);
    temperature.display(SLOT_TEMP, { minimum: AMBIENT_TEMP, maximum: MAX_TEMP, force: true });
    exhaustTank.display(SLOT_EXHAUST);

    const FL = FluidStorage.formatFluid;
    const E  = EnergyStorage.formatEnergyToText;

    const coolantType = coolantTank.getType();
    const coolantCfg  = COOLANTS[coolantType] ?? null;
    const coolantLine = coolantCfg
        ? `§f${coolantCfg.label} x${coolantCfg.speedMultiplier.toFixed(1)}`
        : coolantType === EMPTY ? "§7Empty" : `§e${coolantType} §c?`;

    const fuelLine = fuelCfg
        ? `§f${fuelCfg.label} §7(${E(fuelCfg.energyPerBucket)}/bucket)`
        : "§cNone";

    const tempVal = temperature.get();
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
        `§aTemp:    §f${tempVal.toFixed(0)}K`,
    ], SLOT_LABEL);
}