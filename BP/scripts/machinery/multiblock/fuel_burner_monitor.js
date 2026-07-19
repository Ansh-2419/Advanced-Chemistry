import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
} from "../../DoriosCore/index.js";

// ── Fuel registry ────────────────────────────────────────────────────────────
// energyPerMb : KDe per mB (1 bucket = 1000 mB)
// burnRate    : mB consumed per tick  (Fast = 20, Medium = 10)
const FUELS = {
    petrol:  { energyPerMb: 48, burnRate: 20 },   // 48,000 KDe/bucket, Fast
    diesel:  { energyPerMb: 72, burnRate: 10 },   // 72,000 KDe/bucket, Medium
    biofuel: { energyPerMb: 40, burnRate: 10 },   // 40,000 KDe/bucket, Medium
};
const FUEL_NAMES = Object.keys(FUELS);

// ── Constants ────────────────────────────────────────────────────────────────
const FLUID_CAPACITY_PER_AIR_BLOCK = 64_000;
const ENERGY_CAPACITY               = 2_000_000;
const THROTTLE_THRESHOLD            = 0.9;

const ENERGY_SLOT            = 0;
const LABEL_SLOT             = 1;
const FLUID_SLOT             = 2;
const FLUID_CAPACITY_PROPERTY = "ac:fuel_burner_fluid_capacity";
const LIFETIME_PROPERTY       = "ac:fuel_burner_lifetime";

// ── CONFIG ───────────────────────────────────────────────────────────────────
// rate_speed_base uses the fastest possible output for the generator budget;
// actual energy production is calculated per-tick in burnFuel().
const CONFIG = {
    required_case: "dorios:multiblock.case.fuel_burner",
    entity: {
        identifier: "utilitycraft:fuel_burner_multiblock",
        name: "fuel_burner_monitor",
        inventory_size: 3,
        fixed_fluid_types: false,          // multi-fuel: don't lock type
    },
    generator: {
        rate_speed_base: 20 * 72,          // worst-case ceiling (diesel fast)
        energy_cap: ENERGY_CAPACITY,
    },
    requirements: {},
};

// ── Block component ──────────────────────────────────────────────────────────
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
                    `\u00A77Fuel capacity: \u00A7b${FluidStorage.formatFluid(capacity)}`,
                    `\u00A77Accepts: \u00A7fPetrol \u00A77| \u00A7fDiesel \u00A77| \u00A7fBiofuel`,
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
        const { status, fuelCfg } = burnFuel(generator, tank, energy);

        energy.display(ENERGY_SLOT);
        tank.display(FLUID_SLOT);
        updateLabel(generator, tank, energy, status, fuelCfg);
    },
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function getStructureCapacity(structure) {
    return Math.max(1, structure.components?.air ?? 0) * FLUID_CAPACITY_PER_AIR_BLOCK;
}

function configureStorage(entity, fluidCapacity) {
    const tank = FluidStorage.initializeSingle(entity);
    // Do NOT lock type — let whatever fuel is present stay
    if (tank.getCap() !== fluidCapacity) tank.setCap(fluidCapacity);

    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);

    return { tank, energy };
}

/** Returns the FUELS entry for whatever fluid is in the tank, or null. */
function getFuelConfig(tank) {
    const type = tank.getType();
    return FUELS[type] ?? null;
}

function burnFuel(generator, tank, energy) {
    const fuelCfg = getFuelConfig(tank);

    if (!fuelCfg)        return { status: "\u00A7cNo Valid Fuel", fuelCfg: null };
    if (tank.get() <= 0) return { status: "\u00A7eNo Fuel",      fuelCfg };
    if (energy.getFreeSpace() <= 0) return { status: "\u00A76Energy Full", fuelCfg };

    const interval   = Math.max(1, generator.processingInterval ?? 1);
    const fillRatio  = energy.get() / Math.max(1, energy.getCap());
    const throttled  = fillRatio >= THROTTLE_THRESHOLD;
    const requested  = fuelCfg.burnRate * interval * (throttled ? 0.5 : 1);

    const amount = Math.min(
        tank.get(),
        Math.floor(energy.getFreeSpace() / fuelCfg.energyPerMb),
        Math.max(1, Math.floor(requested)),
    );

    if (amount <= 0) return { status: "\u00A77Idle", fuelCfg };

    tank.consume(amount);
    energy.add(amount * fuelCfg.energyPerMb);

    const lifetime = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;
    generator.entity.setDynamicProperty(LIFETIME_PROPERTY, lifetime + amount);

    return {
        status: throttled
            ? "\u00A7aBurning \u00A77(Throttled)"
            : "\u00A7aBurning",
        fuelCfg,
    };
}

function updateLabel(generator, tank, energy, status, fuelCfg) {
    const lifetime   = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;
    const fuelType   = tank.getType() ?? "none";
    const displayName = fuelType.charAt(0).toUpperCase() + fuelType.slice(1);
    const outputRate  = fuelCfg
        ? EnergyStorage.formatEnergyToText(fuelCfg.burnRate * fuelCfg.energyPerMb)
        : "—";

    generator.setLabel([
        `\u00A7r\u00A76Fuel Burner - ${status}`,
        `\u00A7r\u00A7bFuel: \u00A7f${displayName}  \u00A7f${FluidStorage.formatFluid(tank.get())} / ${FluidStorage.formatFluid(tank.getCap())}`,
        `\u00A7r\u00A7eEnergy: \u00A7f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `\u00A7r\u00A77Output: \u00A7f${outputRate}/t`,
        `\u00A7r\u00A77Lifetime: \u00A7f${FluidStorage.formatFluid(lifetime)}`,
    ], LABEL_SLOT);
}
