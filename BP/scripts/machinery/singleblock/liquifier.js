import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "../../DoriosCore/index.js";
import { getFermentationRecipes } from "../../config/recipes/machinery/fermenter.js";
import {
    EMPTY_FLUID,
    addItemToSlot,
    chargeOrCraft,
    displayMachine,
    formatFluidType,
    getMachineEnergyCost,
    getMachineFluidCap,
    getTank,
    removeItemsFromSlot,
    setupTanks,
    stopMachine,
    tryUseFluidItemInSlot,
} from "./machine_helpers.js";

const INPUT_SLOTS = [3, 4, 5, 6];
const FLUID_SLOT = 9;
const FLUID_DISPLAY_SLOT = 10;
const RESIDUE_SLOT = 11;
const IO_ITEM_SLOTS = [12, 17];
const IO_FLUID_SLOTS = [18, 23];

const DEFAULT_ENERGY_COST = 2000;
const DEFAULT_FLUID_CAP = 128000;
const DEFAULT_FLUID_TYPE = "ethanol";

registerIOInterface("utilitycraft:fermenter", {
    items: {
        slots: IO_ITEM_SLOTS,
        modes: ["disabled", "input", "output"],
    },
    liquids: {
        slots: IO_FLUID_SLOTS,
        modes: ["disabled", "input", "output"],
    },
});

DoriosAPI.register.blockComponent("fermenter", {
    beforeOnPlayerPlace(event, { params: settings }) {
        Machine.spawnEntity(event, settings, (entity) => {
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

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tank = getTank(machine.entity, 0, fluidCap);

        tryUseFluidItemInSlot(machine.container, FLUID_SLOT, machine.entity);

        const recipes = resolveRecipes(block, settings);
        if (recipes.length === 0) return fail(machine, tank, "No Recipes");

        const active = getActiveInput(machine, recipes);
        if (!active.stack) return fail(machine, tank, "Insert Item");

        const recipe = pickRecipeForStack(recipes, active.stack);
        if (!recipe) return fail(machine, tank, "Missing Items");

        const batch = pickBatch(recipe, active.stack.amount);
        if (!batch) return fail(machine, tank, "Missing Items");

        const runtimeRecipe = applyBatch(recipe, batch, settings);
        const fluidType = runtimeRecipe.fluid.type ?? DEFAULT_FLUID_TYPE;
        const tankType = tank.getType();

        if (tankType !== EMPTY_FLUID && tankType !== fluidType) {
            return fail(machine, tank, `Wrong Fluid\n§7Need ${formatFluidType(fluidType)}`);
        }

        const residueSlot = machine.container.getItem(RESIDUE_SLOT);
        const craftLimit = getCraftLimit(tank, runtimeRecipe, active.stack, residueSlot);
        if (craftLimit.max <= 0) return fail(machine, tank, craftLimit.reason ?? "Missing Items");

        const energyCost = getMachineEnergyCost(settings, runtimeRecipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, tank, "No Energy", { resetProgress: false });
        }

        chargeOrCraft(machine, energyCost, craftLimit.max, (runs) => {
            removeItemsFromSlot(machine.container, active.slot, runtimeRecipe.input.amount * runs);

            if (tank.getType() === EMPTY_FLUID) tank.setType(fluidType);
            tank.add(runtimeRecipe.fluid.amount * runs);

            processByproduct(machine, runtimeRecipe.byproduct, runs);
        });

        updateHud(machine, runtimeRecipe, tank, craftLimit.max);
        displayMachine(machine, [{ tank, slot: FLUID_DISPLAY_SLOT }]);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

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

function pickBatch(recipe, availableItems) {
    const batches = recipe.batches ?? recipe.batch;
    const small = normalizeBatch(batches?.small, 8, 6, 150);
    const large = normalizeBatch(
        batches?.large,
        Math.max(1, recipe.input?.amount ?? 64),
        recipe.seconds ?? 8,
        recipe.fluid?.amount ?? 1,
    );

    if (availableItems >= large.size) return large;
    if (availableItems >= small.size) return small;
    return undefined;
}

function normalizeBatch(batch, fallbackSize, fallbackSeconds, fallbackFluid) {
    return {
        size: Math.max(1, Math.floor(batch?.size ?? fallbackSize)),
        seconds: Math.max(1, Math.floor(batch?.seconds ?? fallbackSeconds)),
        fluidAmount: Math.max(0, Math.floor(batch?.fluidAmount ?? batch?.fluid ?? fallbackFluid)),
    };
}

function applyBatch(recipe, batch, settings) {
    const baseInput = Math.max(1, recipe.input?.amount ?? batch.size);
    const scale = batch.size / baseInput;
    const baseCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);

    return {
        ...recipe,
        input: { ...recipe.input, amount: batch.size },
        fluid: { ...recipe.fluid, amount: batch.fluidAmount },
        energyCost: Math.max(1, Math.floor(baseCost * scale)),
        seconds: batch.seconds,
    };
}

function getCraftLimit(tank, recipe, inputStack, residueSlot) {
    const inputAmount = Math.max(1, recipe.input?.amount ?? 1);
    const fluidAmount = Math.max(1, recipe.fluid?.amount ?? 1);
    const itemRuns = Math.floor(inputStack.amount / inputAmount);
    const fluidRuns = Math.floor(tank.getFreeSpace() / fluidAmount);
    const residueRuns = getResidueLimit(recipe, residueSlot);
    const max = Math.min(itemRuns, fluidRuns, residueRuns);

    if (max > 0) return { max };
    if (itemRuns <= 0) return { max: 0, reason: "Missing Items" };
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

function updateHud(machine, recipe, tank, queued) {
    const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;

    machine.setLabel([
        "§6Fermenter",
        `§bInput:  §f${recipe.input.id?.split(":")[1] ?? recipe.input.id}`,
        `§dFluid:  §f${formatFluidType(fluidType)}`,
        `§7Yield:  §f${FluidStorage.formatFluid(recipe.fluid.amount)} each`,
        `§7Tank:   §f${FluidStorage.formatFluid(tank.get())} §7/ §f${FluidStorage.formatFluid(tank.getCap())}`,
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
        `§7Batch:  §f${recipe.input.amount} items §7/ §f${recipe.seconds ?? "-"}s`,
    ]);
}
