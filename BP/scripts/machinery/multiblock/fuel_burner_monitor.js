import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
    registerLinkNodeIO,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { initFluidTank, initEnergy, guardTank, validateStructure, formatFluidDisplayName } from "../helper/helper.js";

// ── Structure requirements ────────────────────────────────────────────────────
const MIN_SIZE = { x: 3, y: 3, z: 3 };
const PORTS    = { energy: 1, fluid: 1 };

// ── Fuel registry ─────────────────────────────────────────────────────────────
// burnRate  — mB consumed per game tick at full speed
// energyPerMb — RF produced per mB of fuel
const FUELS = {
    petroleum: { label: "Petroleum", color: "§6", energyPerMb:  48, burnRate: 20 },
    diesel:    { label: "Diesel",    color: "§e", energyPerMb:  72, burnRate: 10 },
    biofuel:   { label: "Biofuel",   color: "§a", energyPerMb:  40, burnRate: 10 },
};
const VALID_FUELS = new Set(Object.keys(FUELS));

// ── Constants ─────────────────────────────────────────────────────────────────
const FLUID_CAPACITY     = 256_000;
const ENERGY_CAPACITY    = 2_000_000;
const THROTTLE_THRESHOLD = 0.90;
const THROTTLE_FACTOR    = 0.50;

// Petroleum has the highest output (20 mB/t × 48 RF/mB = 960 RF/t).
// rate_speed_base is multiplied by processingInterval inside MultiblockGenerator,
// so setting it to 960 keeps the effective transfer rate matched to peak output.
const MAX_OUTPUT_RATE = Math.max(
    ...Object.values(FUELS).map(f => f.burnRate * f.energyPerMb)
);

// ── Slots ─────────────────────────────────────────────────────────────────────
const ENERGY_SLOT       = 0;
const LABEL_SLOT        = 1;
const FLUID_SLOT        = 2;

// ── Dynamic properties ────────────────────────────────────────────────────────
const LIFETIME_PROPERTY = "ac:fuel_burner_lifetime";

const CONFIG = {
    required_case: "dorios:multiblock.case.chem",
    entity: {
        identifier:        "utilitycraft:fuel_burner_multiblock",
        name:              "fuel_burner_monitor",
        inventory_size:    3,
        fixed_fluid_types: true,
    },
    generator: {
        rate_speed_base: MAX_OUTPUT_RATE,
        energy_cap:      ENERGY_CAPACITY,
    },
    requirements: {},
};

registerLinkNodeIO("utilitycraft:fuel_burner_monitor", {
    liquids: {
        anyInputIndices:  [0],
        anyOutputIndices: [],
        inputs: [
            { id: "fuel", label: "Fuel In", color: "§9", indices: [0] },
        ],
        outputs: [],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:fuel_burner_monitor", {
    onPlayerInteract(event) {
        if (!event.player) return;
        const interactionEvent = /** @type {import("DoriosCore/index.js").InteractionEventLike} */ (event);
        return MultiblockGenerator.handlePlayerInteract(interactionEvent, CONFIG, {
            initializeEntity(entity) {
                configureStorage(entity);
            },

            onActivate({ entity, structure, player }) {
                if (validateStructure(entity, structure, player, {
                    name: "Fuel Burner", minSize: MIN_SIZE, ports: PORTS, portType: "normal", noAir: true,
                })) return false;
                configureStorage(entity);
            },

            successMessages() {
                const lines = [
                    "§a[Fuel Burner] Structure online.",
                    `§7Fuel capacity : §b${FluidStorage.formatFluid(FLUID_CAPACITY)}`,
                    `§7Energy buffer : §e${EnergyStorage.formatEnergyToText(ENERGY_CAPACITY)}`,
                    "§7Accepted fuels:",
                ];
                for (const [, cfg] of Object.entries(FUELS)) {
                    const output = EnergyStorage.formatEnergyToText(cfg.burnRate * cfg.energyPerMb);
                    lines.push(`  ${cfg.color}${cfg.label} §7— ${cfg.burnRate} mB/t → §f${output}§7/t`);
                }
                return lines;
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

        const { tank, energy } = configureStorage(generator.entity);

        // Clear any fluid that isn't a recognised fuel
        guardTank(tank, VALID_FUELS);

        energy.transferToNetwork(generator.rate);

        const result = burnFuel(generator, tank, energy);
        energy.display(ENERGY_SLOT);
        tank.display(FLUID_SLOT);
        updateLabel(generator, tank, energy, result);
    },
});

// ── Storage ───────────────────────────────────────────────────────────────────
function configureStorage(entity) {
    const tank   = initFluidTank(entity, FLUID_CAPACITY);
    const energy = initEnergy(entity, ENERGY_CAPACITY);
    return { tank, energy };
}

// ── Burn logic ────────────────────────────────────────────────────────────────
function burnFuel(generator, tank, energy) {
    const fuelCfg = FUELS[tank.getType()] ?? null;

    if (!fuelCfg || tank.get() <= 0) {
        return { status: "§cNo Fuel", fuelCfg: null, burned: 0, throttled: false };
    }
    if (energy.getFreeSpace() <= 0) {
        return { status: "§6Buffer Full", fuelCfg, burned: 0, throttled: false };
    }

    const interval  = Math.max(1, generator.processingInterval ?? 1);
    const fillRatio = energy.get() / Math.max(1, energy.getCap());
    const throttled = fillRatio >= THROTTLE_THRESHOLD;
    const rate      = fuelCfg.burnRate * (throttled ? THROTTLE_FACTOR : 1);

    const amount = Math.min(
        tank.get(),
        Math.floor(energy.getFreeSpace() / fuelCfg.energyPerMb),
        Math.floor(rate * interval),
    );

    if (amount <= 0) {
        return { status: "§7Idle", fuelCfg, burned: 0, throttled };
    }

    tank.consume(amount);
    if (tank.get() <= 0) tank.setType("empty");

    energy.add(amount * fuelCfg.energyPerMb);

    const lifetime = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;
    generator.entity.setDynamicProperty(LIFETIME_PROPERTY, lifetime + amount);

    return {
        status:   throttled ? "§aBurning §7(Throttled)" : "§aBurning",
        fuelCfg,
        burned:   amount,
        throttled,
    };
}

// ── Display ───────────────────────────────────────────────────────────────────
function updateLabel(generator, tank, energy, { status, fuelCfg, burned, throttled }) {
    const lifetime    = generator.entity.getDynamicProperty(LIFETIME_PROPERTY) ?? 0;
    const fuelName    = formatFluidDisplayName(tank.getType());
    const fuelColor   = fuelCfg?.color ?? "§7";

    const outputPerTick = fuelCfg
        ? EnergyStorage.formatEnergyToText(
            Math.floor(fuelCfg.burnRate * fuelCfg.energyPerMb * (throttled ? THROTTLE_FACTOR : 1))
          )
        : "—";

    const burnRateLine = fuelCfg
        ? `${Math.floor(fuelCfg.burnRate * (throttled ? THROTTLE_FACTOR : 1))} mB/t`
        : "—";

    const runtimeTicks = fuelCfg && burned > 0
        ? Math.floor(tank.get() / (burned / Math.max(1, generator.processingInterval ?? 1)))
        : null;
    const runtimeLine  = runtimeTicks !== null
        ? formatRuntime(runtimeTicks)
        : "—";

    generator.setLabel([
        `§r§6Fuel Burner §7| ${status}`,
        `§r§bFuel:    ${fuelColor}${fuelName} §f${FluidStorage.formatFluid(tank.get())} §7/ ${FluidStorage.formatFluid(tank.getCap())}`,
        `§r§eEnergy:  §f${EnergyStorage.formatEnergyToText(energy.get())} §7/ ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `§r§7Burn:    §f${burnRateLine} §7→ §f${outputPerTick}§7/t`,
        `§r§7Runtime: §f${runtimeLine}   §7Lifetime: §f${FluidStorage.formatFluid(lifetime)}`,
    ], LABEL_SLOT);
}

function formatRuntime(ticks) {
    const seconds = Math.floor(ticks / 20);
    if (seconds < 60)   return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}