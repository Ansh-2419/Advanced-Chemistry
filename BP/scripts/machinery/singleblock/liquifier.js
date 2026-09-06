import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getFermentationRecipes } from "../../config/recipes/machinery/fermenter.js";
import {
    EMPTY_FLUID,
    addItemToSlot,
    displayMachine,
    formatFluidType,
    getMachineEnergyCost,
    getMachineFluidCap,
    getTank,
    processMachine,
    removeItemsFromSlot,
    setupTanks,
    stopMachine,
    tryUseFluidItemInSlot,
} from "./machine_helpers.js";

const INPUT_SLOTS        = [3, 4, 5, 6];
const FLUID_SLOT         = 9;
const FLUID_DISPLAY_SLOT = 10;
const RESIDUE_SLOT       = 11;
const IO_ITEM_SLOTS      = [12, 17];
const IO_FLUID_SLOTS     = [18, 23];

const DEFAULT_ENERGY_COST = 2000;
const DEFAULT_FLUID_CAP   = 128000;
const DEFAULT_FLUID_TYPE  = "ethanol";

registerIOInterface("utilitycraft:fermenter", {
    items: {
        buttonSlots: IO_ITEM_SLOTS,
        anyInputSlots: INPUT_SLOTS,
        anyOutputSlots: [RESIDUE_SLOT],
        modes: [
            { id: "disabled" },
            { id: "input_1", inputSlots: INPUT_SLOTS },
            { id: "output_1", outputSlots: [RESIDUE_SLOT] },
        ],
    },
    liquids: {
        buttonSlots: IO_FLUID_SLOTS,
        anyInputIndices: [],
        anyOutputIndices: [0],
        modes: [
            { id: "disabled" },
            { id: "output_1", outputIndices: [0] },
        ],
    },
});

DoriosLib.registry.blockComponent("utilitycraft:fermenter", {
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        const placementEvent = event;
        Machine.spawnEntity(placementEvent, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [FLUID_DISPLAY_SLOT]);
            displayMachine(machine);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        machine.processIO();

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tank     = getTank(machine.entity, 0, fluidCap);

        tryUseFluidItemInSlot(machine.container, FLUID_SLOT, machine.entity);

        const recipes = resolveRecipes(block, settings);
        if (recipes.length === 0) return fail(machine, tank, "No Recipes");

        // Try to match a multi-input recipe first (4 items)
        let recipeData = findMultiInputRecipe(machine, recipes);

        // Fall back to single/dual input recipes if no multi-input found
        if (!recipeData) {
            const active = getActiveInput(machine, recipes);
            if (!active.stack) return fail(machine, tank, "Insert Item");

            const recipe = pickRecipeForStack(recipes, active.stack);
            if (!recipe) return fail(machine, tank, "Missing Items");

            const secondary    = recipe.secondaryInput;
            const secSlotIndex = secondary
                ? findSecondarySlot(machine, active.slot, secondary.id, secondary.amount)
                : -1;
            if (secondary && secSlotIndex === -1)
                return fail(machine, tank, `Also need: ${secondary.id.split(":")[1]} x${secondary.amount}`);

            recipeData = {
                recipe,
                inputSlots: [
                    { slot: active.slot, amount: recipe.input.amount },
                    secondary && secSlotIndex !== -1 ? { slot: secSlotIndex, amount: secondary.amount } : null
                ].filter(Boolean)
            };
        }

        const { recipe, inputSlots } = recipeData;
        const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
        const tankType  = tank.getType();

        if (tankType !== EMPTY_FLUID && tankType !== fluidType)
            return fail(machine, tank, `Wrong Fluid\n§7Need ${formatFluidType(fluidType)}`);

        const residueSlot = machine.container.getItem(RESIDUE_SLOT);
        const craftLimit = getCraftLimit(tank, recipe, inputSlots, residueSlot);
        if (craftLimit.max <= 0) return fail(machine, tank, craftLimit.reason ?? "Missing Items");

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, tank, "No Energy", { resetProgress: false });
        }

        const seconds = recipe.seconds ?? 8;

        processMachine(machine, {
            energyCost,
            seconds,
            maxRuns: craftLimit.max,
            craft: (runs) => {
                inputSlots.forEach(input => {
                    removeItemsFromSlot(machine.container, input.slot, input.amount * runs);
                });

                if (tank.getType() === EMPTY_FLUID) tank.setType(fluidType);
                tank.add(recipe.fluid.amount * runs);

                processByproduct(machine, recipe.byproduct, runs);
            },
        });

        updateHud(machine, recipe, tank, inputSlots, craftLimit.max);
        displayMachine(machine, [{ tank, slot: FLUID_DISPLAY_SLOT }]);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────

function fail(machine, tank, message, options) {
    stopMachine(machine, message, options);
    displayMachine(machine, [{ tank, slot: FLUID_DISPLAY_SLOT }]);
}

function resolveRecipes(block, settings) {
    const params = block.getComponent("utilitycraft:machine_recipes")?.customComponentParameters?.params;
    if (Array.isArray(params)) return params;
    if (Array.isArray(settings?.machine?.recipes)) return settings.machine.recipes;
    return getFermentationRecipes();
}

/**
 * Find a recipe that requires all 4 input slots with different items
 */
function findMultiInputRecipe(machine, recipes) {
    for (const recipe of recipes) {
        if (!recipe.inputs || !Array.isArray(recipe.inputs) || recipe.inputs.length !== 4) continue;

        const inputSlots = [];

        for (const required of recipe.inputs) {
            const slot = findItemInSlots(machine, required.id, required.amount);
            if (slot === -1) break; // This item not found, try next recipe

            inputSlots.push({ slot, amount: required.amount });
        }

        if (inputSlots.length === 4) {
            return { recipe, inputSlots };
        }
    }

    return null;
}

/**
 * Find a slot with a specific item
 */
function findItemInSlots(machine, itemId, minAmount) {
    for (const slot of INPUT_SLOTS) {
        const stack = machine.container.getItem(slot);
        if (stack?.typeId === itemId && stack.amount >= minAmount) return slot;
    }
    return -1;
}

function getActiveInput(machine, recipes) {
    let firstOccupied = null;

    for (const slot of INPUT_SLOTS) {
        const stack = machine.container.getItem(slot);
        if (!stack) continue;

        firstOccupied ??= { stack, slot };
        if (pickRecipeForStack(recipes, stack)) return { stack, slot };
    }

    return firstOccupied ?? { stack: undefined, slot: INPUT_SLOTS[0] };
}

function pickRecipeForStack(recipes, stack) {
    if (!stack) return undefined;

    return recipes
        .filter(recipe => recipe.input?.id === stack.typeId)
        .sort((left, right) => (right.input?.amount ?? 1) - (left.input?.amount ?? 1))
        .find(recipe => stack.amount >= Math.max(1, recipe.input?.amount ?? 1));
}

function getCraftLimit(tank, recipe, inputSlots, residueSlot) {
    const fluidAmount = Math.max(1, recipe.fluid?.amount ?? 1);
    
    // Calculate item runs from all input slots
    let itemRuns = Number.MAX_SAFE_INTEGER;
    for (const input of inputSlots) {
        const stack = /* get stack from slot */ { amount: 0 };
        // This will be calculated from the inputSlots amounts passed in
        itemRuns = Math.min(itemRuns, 1); // Default to 1 run for multi-input
    }
    
    const fluidRuns = Math.floor(tank.getFreeSpace() / fluidAmount);
    const residueRuns = getResidueLimit(recipe, residueSlot);
    const max = Math.min(itemRuns, fluidRuns, residueRuns);

    if (max > 0) return { max };
    if (fluidRuns <= 0) return { max: 0, reason: "Tank Full" };
    return { max: 0, reason: "Residue Full" };
}

function getResidueLimit(recipe, residueSlot) {
    if (!recipe.byproduct) return Number.MAX_SAFE_INTEGER;

    const amount = Math.max(1, recipe.byproduct.amount ?? 1);
    if (!residueSlot) return Math.floor(64 / amount);
    if (residueSlot.typeId !== recipe.byproduct.id) return 0;

    return Math.floor(((residueSlot.maxAmount ?? 64) - residueSlot.amount) / amount);
}

function processByproduct(machine, byproduct, runs) {
    if (!byproduct) return;

    const amount = Math.max(1, byproduct.amount ?? 1);
    const chance = byproduct.chance ?? 1;

    for (let i = 0; i < runs; i++) {
        if (Math.random() > chance) continue;
        addItemToSlot(machine.container, RESIDUE_SLOT, byproduct.id, amount);
    }
}

function findSecondarySlot(machine, primarySlot, itemId, minAmount) {
    for (const slot of INPUT_SLOTS) {
        if (slot === primarySlot) continue;
        const stack = machine.container.getItem(slot);
        if (stack?.typeId === itemId && stack.amount >= minAmount) return slot;
    }
    return -1;
}

function updateHud(machine, recipe, tank, inputSlots, queued) {
    const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    const inputLabel = recipe.input?.id?.split(":")[1] ?? 
                       (recipe.inputs ? `${recipe.inputs.length} Items` : "Unknown");

    machine.setLabel([
        "§6Fermenter",
        `§bInput:  §f${inputLabel}`,
        `§dFluid:  §f${formatFluidType(fluidType)}`,
        `§7Yield:  §f${FluidStorage.formatFluid(recipe.fluid.amount)}`,
        `§7Tank:   §f${FluidStorage.formatFluid(tank.get())} §7/ §f${FluidStorage.formatFluid(tank.getCap())}`,
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
        `§7Time:   §f${recipe.seconds ?? "-"}s`,
    ]);
}
