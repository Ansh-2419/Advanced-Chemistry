import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
} from "../../DoriosCore/index.js";

const BIOFUEL = "biofuel";
const FLUID_CAPACITY_PER_AIR_BLOCK = 64_000;
const ENERGY_PER_MB = 8_000;
const BURN_RATE_PER_TICK = 20;
const ENERGY_CAPACITY = 2_000_000;
const THROTTLE_THRESHOLD = 0.9;

const ENERGY_SLOT = 0;
const LABEL_SLOT = 1;
const FLUID_SLOT = 2;
const FLUID_CAPACITY_PROPERTY = "ac:fuel_burner_fluid_capacity";
const LIFETIME_PROPERTY = "ac:fuel_burner_lifetime";

const CONFIG = {
    required_case: "dorios:multiblock.case.fuel_burner",
    entity: {
        identifier: "utilitycraft:fuel_burner_multiblock",
        name: "fuel_burner_monitor",
        inventory_size: 3,
        fixed_fluid_types: true,
    },
    generator: {
        rate_speed_base: BURN_RATE_PER_TICK * ENERGY_PER_MB,
        energy_cap: ENERGY_CAPACITY,
    },
    requirements: {},
};

DoriosAPI.register.blockComponent("fuel_burner_monitor", {
    onPlayerInteract(event) {
        return MultiblockGenerator.handlePlayerInteract(event, CONFIG, {
            initializeEntity(entity) {
                configureStorage(entity, FLUID_CAPACITY_PER_AIR_BLOCK);
            },
            onActivate({ entity, structure }) {
                const capacity = getStructureCapacity(structure);
                configureStorage(entity, capacity);
                entity.setDynamicProperty(FLUID_CAPACITY_PROPERTY, capacity);
            },
            successMessages({ structure }) {
                const capacity = getStructureCapacity(structure);
                return [
                    "\u00A7a[Fuel Burner] Structure online.",
                    `\u00A77Biofuel capacity: \u00A7b${FluidStorage.formatFluid(capacity)}`,
                    `\u00A77Energy buffer: \u00A7e${EnergyStorage.formatEnergyToText(ENERGY_CAPACITY)}`,
                ];
            },
        });
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const generator = new MultiblockGenerator(block, CONFIG);
        if (!generator.valid) return;
        if (generator.entity.getDynamicProperty("dorios:state") !== "on") return;

        const capacity = generator.entity.getDynamicProperty(FLUID_CAPACITY_PROPERTY)
            ?? FLUID_CAPACITY_PER_AIR_BLOCK;
        const { tank, energy } = configureStorage(generator.entity, capacity);

        energy.transferToNetwork(generator.rate);
        const status = burnFuel(generator, tank, energy);

        energy.display(ENERGY_SLOT);
        tank.display(FLUID_SLOT);
        updateLabel(generator, tank, energy, status);
    },
});

function getStructureCapacity(structure) {
    return Math.max(1, structure.components?.air ?? 0) * FLUID_CAPACITY_PER_AIR_BLOCK;
}
function configureStorage(entity, fluidCapacity) {
    const tank = FluidStorage.initializeSingle(entity);
    if (tank.getType() !== BIOFUEL) tank.setType(BIOFUEL);
    if (tank.getCap() !== fluidCapacity) tank.setCap(fluidCapacity);

    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);

    return { tank, energy };
}

function burnFuel(generator, tank, energy) {
    if (tank.get() <= 0) return "\u00A7eNo Biofuel";
    if (energy.getFreeSpace() <= 0) return "\u00A76Energy Full";

    const interval = Math.max(1, generator.processingInterval ?? 1);
    const fillRatio = energy.get() / Math.max(1, energy.getCap());
    const requested = BURN_RATE_PER_TICK
        * interval
        * (fillRatio >= THROTTLE_THRESHOLD ? 0.5 : 1);
    const amount = Math.min(
        tank.get(),
        Math.floor(energy.getFreeSpace() / ENERGY_PER_MB),
        Math.max(1, Math.floor(requested)),
    );

    if (amount <= 0) return "\u00A77Idle";

    tank.consume(amount);
    energy.add(amount * ENERGY_PER_MB);

    const lifetime = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;
    generator.entity.setDynamicProperty(LIFETIME_PROPERTY, lifetime + amount);

    return fillRatio >= THROTTLE_THRESHOLD
        ? "\u00A7aBurning \u00A77(Throttled)"
        : "\u00A7aBurning";
}

function updateLabel(generator, tank, energy, status) {
    const lifetime = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;

    generator.setLabel([
        `\u00A7r\u00A76Fuel Burner - ${status}`,
        `\u00A7r\u00A7bBiofuel: \u00A7f${FluidStorage.formatFluid(tank.get())} / ${FluidStorage.formatFluid(tank.getCap())}`,
        `\u00A7r\u00A7eEnergy: \u00A7f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `\u00A7r\u00A77Output: \u00A7f${EnergyStorage.formatEnergyToText(BURN_RATE_PER_TICK * ENERGY_PER_MB)}/t`,
        `\u00A7r\u00A77Lifetime: \u00A7f${FluidStorage.formatFluid(lifetime)}`,
    ], LABEL_SLOT);
}
