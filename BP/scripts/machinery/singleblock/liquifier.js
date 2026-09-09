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
            { id: "input_1",  inputSlots:  INPUT_SLOTS },
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
        Machine.spawnEntity(/** @type {any} */ (event), settings, (entity) => {
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

        // ── Try multi-input recipes first (any length 2-4 via `inputs` array) ──
        const multiResult = findMultiInputRecipe(machine, recipes);

        let recipeData;

        if (multiResult?.partial) {
            // Player has started a multi-input recipe but is missing items
            const missingStr = multiResult.missingItems
                .map(m => `${m.id.split(":")[1]} ×${m.amount}`)
                .join(", ");
            return fail(machine, tank, `Need: ${missingStr}`);
        }

        if (multiResult) {
            recipeData = { recipe: multiResult.recipe, inputSlots: multiResult.inputSlots };
        } else {
            // ── Fall back to single / dual input ───────────────────────────────
            const active = getActiveInput(machine, recipes);
            if (!active.stack) return fail(machine, tank, "Insert Item");

            const recipe = pickRecipeForStack(recipes, active.stack);
            if (!recipe) return fail(machine, tank, "Missing Items");

            const secondary    = recipe.secondaryInput;
            const secSlotIndex = secondary
                ? findItemInSlots(machine, secondary.id, secondary.amount, active.slot)
                : -1;
            if (secondary && secSlotIndex === -1)
                return fail(machine, tank,
                    `Also need: ${secondary.id.split(":")[1]} ×${secondary.amount}`);

            recipeData = {
                recipe,
                inputSlots: [
                    { slot: active.slot, amount: recipe.input.amount },
                    ...(secondary && secSlotIndex !== -1
                        ? [{ slot: secSlotIndex, amount: secondary.amount }]
                        : []),
                ],
            };
        }

        const { recipe, inputSlots } = recipeData;
        const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
        const tankType  = tank.getType();

        if (tankType !== EMPTY_FLUID && tankType !== fluidType)
            return fail(machine, tank,
                `Wrong Fluid\n§7Need ${formatFluidType(fluidType)}`);

        const residueSlot = machine.container.getItem(RESIDUE_SLOT);
        const craftLimit  = getCraftLimit(machine.container, tank, recipe, inputSlots, residueSlot);
        if (craftLimit.max <= 0)
            return fail(machine, tank, craftLimit.reason ?? "Missing Items");

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost)
            return fail(machine, tank, "No Energy", { resetProgress: false });

        processMachine(machine, {
            energyCost,
            seconds:  recipe.seconds ?? 8,
            maxRuns:  craftLimit.max,
            craft: (runs) => {
                for (const input of inputSlots)
                    removeItemsFromSlot(machine.container, input.slot, input.amount * runs);

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

// ── Recipe resolution ─────────────────────────────────────────────────────────

function resolveRecipes(block, settings) {
    const params = block.getComponent("utilitycraft:machine_recipes")
        ?.customComponentParameters?.params;
    if (Array.isArray(params)) return params;
    if (Array.isArray(settings?.machine?.recipes)) return settings.machine.recipes;
    return getFermentationRecipes();
}

// ── Multi-input recipe matching (handles 2, 3, or 4 items via `inputs`) ───────
//
// Returns:
//   { recipe, inputSlots, partial: false }  — perfect match, ready to craft
//   { recipe, missingItems, partial: true } — some items present; shows what's missing
//   null                                    — no multi-input recipe relevant to current slots
//
// Partial-match rule: only triggered when at least ONE item from the `inputs`
// array is already present in an input slot. This prevents bone_meal (which is
// also used in the 2-item organic_fertilizer recipe) from triggering the
// 4-item growth-solution partial match when the player only has bone_meal alone
// AND the 2-item recipe is available.

function findMultiInputRecipe(machine, recipes) {
    for (const recipe of recipes) {
        if (!Array.isArray(recipe.inputs) || recipe.inputs.length < 2) continue;

        const inputSlots = [];
        const missingItems = [];
        const usedSlots = new Set();

        for (const required of recipe.inputs) {
            let found = false;
            for (const slot of INPUT_SLOTS) {
                if (usedSlots.has(slot)) continue;
                const stack = machine.container.getItem(slot);
                if (stack?.typeId === required.id && stack.amount >= required.amount) {
                    inputSlots.push({ slot, amount: required.amount });
                    usedSlots.add(slot);
                    found = true;
                    break;
                }
            }
            if (!found) missingItems.push(required);
        }

        if (missingItems.length === 0)
            return { recipe, inputSlots, partial: false };

        // Only surface a partial match if MORE than one input is already present,
        // or if none of the matched items are also a primary input for a single-input recipe.
        // This stops bone_meal-alone from stealing the 4-item recipe's message.
        const singleRecipeForMatched = inputSlots.some(({ slot }) => {
            const stack = machine.container.getItem(slot);
            return recipes.some(r => r.input?.id === stack?.typeId);
        });

        if (inputSlots.length >= 2 || (inputSlots.length === 1 && !singleRecipeForMatched))
            return { recipe, missingItems, partial: true };
    }
    return null;
}

// ── Single / dual input helpers ───────────────────────────────────────────────

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
        .filter(r => r.input?.id === stack.typeId)
        .sort((a, b) => (b.input?.amount ?? 1) - (a.input?.amount ?? 1))
        .find(r => stack.amount >= Math.max(1, r.input?.amount ?? 1));
}

function findItemInSlots(machine, itemId, minAmount, excludeSlot = -1) {
    for (const slot of INPUT_SLOTS) {
        if (slot === excludeSlot) continue;
        const stack = machine.container.getItem(slot);
        if (stack?.typeId === itemId && stack.amount >= minAmount) return slot;
    }
    return -1;
}

// ── Craft limit (fixed: reads actual container amounts) ───────────────────────

function getCraftLimit(container, tank, recipe, inputSlots, residueSlot) {
    const fluidAmount = Math.max(1, recipe.fluid?.amount ?? 1);

    // Calculate how many runs the input items allow
    let itemRuns = Number.MAX_SAFE_INTEGER;
    for (const input of inputSlots) {
        const stack = container.getItem(input.slot);
        if (!stack || stack.amount < input.amount) return { max: 0, reason: "Missing Items" };
        itemRuns = Math.min(itemRuns, Math.floor(stack.amount / input.amount));
    }
    if (itemRuns === Number.MAX_SAFE_INTEGER) itemRuns = 0;

    const fluidRuns   = Math.floor(tank.getFreeSpace() / fluidAmount);
    const residueRuns = getResidueLimit(recipe, residueSlot);
    const max = Math.min(itemRuns, fluidRuns, residueRuns);

    if (max > 0)        return { max };
    if (fluidRuns <= 0) return { max: 0, reason: "Tank Full" };
    if (itemRuns <= 0)  return { max: 0, reason: "Missing Items" };
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

// ── HUD ───────────────────────────────────────────────────────────────────────

function updateHud(machine, recipe, tank, inputSlots, queued) {
    const fluidType  = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    const inputLabel = Array.isArray(recipe.inputs)
        ? `${recipe.inputs.length}-ingredient recipe`
        : recipe.input?.id?.split(":")[1] ?? "Unknown";

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

function fail(machine, tank, message, options) {
    stopMachine(machine, message, options);
    displayMachine(machine, [{ tank, slot: FLUID_DISPLAY_SLOT }]);
}