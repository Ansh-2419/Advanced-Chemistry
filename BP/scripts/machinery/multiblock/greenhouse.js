import * as DoriosLib                        from "DoriosLib/index.js";
import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockMachine,
}                                            from "DoriosCore/index.js";
import { plantsData }                        from "../../config/recipes/added/plants.js";
import { formatFluidDisplayName }            from "./multiblock_helpers.js";

// ── Slot map ──────────────────────────────────────────────────────────────────
const ENERGY_SLOT        = 0;
const LABEL_SLOT         = 1;
const PROGRESS_SLOT      = 2;
const FERTILIZER_DISPLAY = 3;
const WATER_DISPLAY      = 4;
const SEED_SLOTS         = [5, 6, 7, 8];
const SOIL_SLOT          = 9;
const OUTPUT_SLOTS       = [10, 11, 12, 13, 14, 15, 16, 17, 18];
const INVENTORY_SIZE     = 19;

// ── Capacities ────────────────────────────────────────────────────────────────
const FLUID_CAPACITY      = 64_000;
const ENERGY_CAPACITY     = 200_000;
const FERTILIZER_PER_SEED = 500;
const WATER_PER_SEED      = 250;
const EMPTY_FLUID         = "empty";

// ── Soil registry ─────────────────────────────────────────────────────────────
const acceptedSoils = {
    "minecraft:dirt":           { cost: 2,    multi: 1 },
    "minecraft:grass_block":    { cost: 1.5,  multi: 1 },
    "utilitycraft:yellow_soil": { cost: 1,    multi: 1 },
    "utilitycraft:red_soil":    { cost: 0.75, multi: 2 },
    "utilitycraft:blue_soil":   { cost: 0.5,  multi: 3 },
    "utilitycraft:black_soil":  { cost: 0.25, multi: 4 },
};

// ── Valid fertilizer fluids ───────────────────────────────────────────────────
const FERTILIZER_TYPES = new Set([
    "fertilizer_org",
    "fertilizer_enriched",
    "fertilizer_industrial",
]);

// ── Config ────────────────────────────────────────────────────────────────────
// 5x5x5 solid — edge: case blocks, interior (3x3x3=27): dorios:multiblock_component blocks
const CONFIG = {
    required_case: "dorios:multiblock.case.greenhouse",
    entity: {
        identifier:     "utilitycraft:greenhouse_multiblock",
        name:           "greenhouse_controller",
        inventory_size: INVENTORY_SIZE,
    },
    machine: {
        rate_speed_base: 100,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     2,
    },
    requirements: {
        industrial_caseing: {
            amount:  1,
            warning: "§c[Greenhouse] Interior must be completely filled with industrial casing (5×5×5 solid).",
        },
    },
};

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:greenhouse_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockMachine.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) { configureStorage(entity); },
                onActivate({ entity })   { configureStorage(entity); },
                successMessages() {
                    return [
                        "§a[Greenhouse] Structure online.",
                        "§75×5×5 solid industrial casing (no hollow interior).",
                        `§7Fertilizer capacity: §b${FluidStorage.formatFluid(FLUID_CAPACITY)}`,
                        `§7Water capacity:      §b${FluidStorage.formatFluid(FLUID_CAPACITY)}`,
                        `§7Energy buffer:       §e${EnergyStorage.formatEnergyToText(ENERGY_CAPACITY)}`,
                    ];
                },
            }
        );
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const machine = new MultiblockMachine(block, CONFIG);
        if (!machine.valid) return;

        const { energy, fertTank, waterTank } = configureStorage(machine.entity);
        const inv = machine.container;

        // ── Validate soil ─────────────────────────────────────────────────────
        const soilItem = inv.getItem(SOIL_SLOT);
        const soil     = soilItem ? acceptedSoils[soilItem.typeId] : null;
        if (!soil) return displayMachine(machine, energy, fertTank, waterTank, "No Valid Soil");

        // ── Find seed + recipe ────────────────────────────────────────────────
        let seedSlot = -1, recipe = null;
        for (const slot of SEED_SLOTS) {
            const item = inv.getItem(slot);
            if (!item) continue;
            const r = plantsData[item.typeId];
            if (r) { seedSlot = slot; recipe = r; break; }
        }
        if (!recipe) return displayMachine(machine, energy, fertTank, waterTank, "No Seed");

        // ── Validate fertilizer ───────────────────────────────────────────────
        if (!FERTILIZER_TYPES.has(fertTank.getType()) || fertTank.get() < FERTILIZER_PER_SEED)
            return displayMachine(machine, energy, fertTank, waterTank, "No Fertilizer");

        // ── Validate water ────────────────────────────────────────────────────
        if (waterTank.getType() !== "water" && waterTank.getType() !== EMPTY_FLUID)
            return displayMachine(machine, energy, fertTank, waterTank, "Wrong Fluid (Water needed)");
        if (waterTank.get() < WATER_PER_SEED)
            return displayMachine(machine, energy, fertTank, waterTank, "No Water");

        // ── Energy ────────────────────────────────────────────────────────────
        if (energy.get() <= 0)
            return displayMachine(machine, energy, fertTank, waterTank, "No Energy");

        // ── Progress ──────────────────────────────────────────────────────────
        const energyCost = recipe.cost * soil.cost;
        machine.setEnergyCost(energyCost);
        let progress = machine.getProgress();

        if (progress >= energyCost) {
            recipe.drops.forEach(loot => {
                if (Math.random() > loot.chance) return;
                const qty = Array.isArray(loot.amount)
                    ? DoriosLib.math.randomInt(loot.amount[0], loot.amount[1])
                    : loot.amount;
                DoriosLib.entity.tryAddItem(machine.entity, {
                    item:   loot.item,
                    amount: Math.max(1, Math.round(qty * soil.multi)),
                });
            });

            machine.addProgress(-energyCost);

            fertTank.consume(FERTILIZER_PER_SEED);
            if (fertTank.get() <= 0) fertTank.setType(EMPTY_FLUID);

            waterTank.consume(WATER_PER_SEED);
            if (waterTank.get() <= 0) waterTank.setType(EMPTY_FLUID);

        } else {
            const spend = Math.min(energy.get(), machine.rate, energyCost - progress);
            if (spend > 0) {
                energy.consume(spend);
                machine.addProgress(spend);
            }
        }

        machine.on();
        machine.displayProgress({ maxValue: energyCost, slot: PROGRESS_SLOT });
        displayMachine(machine, energy, fertTank, waterTank, "Growing");
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function configureStorage(entity) {
    const [fertTank, waterTank] = FluidStorage.initializeMultiple(entity, 2);
    if (fertTank.getCap()  !== FLUID_CAPACITY) fertTank.setCap(FLUID_CAPACITY);
    if (waterTank.getCap() !== FLUID_CAPACITY) waterTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, fertTank, waterTank };
}

function displayMachine(machine, energy, fertTank, waterTank, status) {
    energy.display(ENERGY_SLOT);
    fertTank.display(FERTILIZER_DISPLAY);
    waterTank.display(WATER_DISPLAY);
    machine.setLabel([
        `§r§6Greenhouse §7- §f${status}`,
        `§r§eEnergy:     §f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `§r§aFertilizer: §f${formatFluidDisplayName(fertTank.getType())} ${FluidStorage.formatFluid(fertTank.get())}`,
        `§r§9Water:      §f${FluidStorage.formatFluid(waterTank.get())} / ${FluidStorage.formatFluid(waterTank.getCap())}`,
    ], LABEL_SLOT);
}
