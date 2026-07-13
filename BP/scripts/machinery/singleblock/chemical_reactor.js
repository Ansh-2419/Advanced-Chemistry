import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "../../DoriosCore/index.js";
import { getChemicalReactorRecipes } from "../../config/recipes/machinery/chemical_reactor.js";
import {
    EMPTY_FLUID,
    addItemToSlot,
    chargeOrCraft,
    displayMachine,
    formatFluidType,
    getMachineEnergyCost,
    getMachineFluidCap,
    getTank,
    setupTanks,
    stopMachine,
    tryUseFluidItemInSlot,
} from "./machine_helpers.js";

const FLUID_INPUT_CAPSULE = 3;
const FLUID_DISPLAY_IN = 4;
const FLUID_DISPLAY_OUT = 5;
const FLUID_DISPLAY_BYPRODUCT = 6;
const BYPRODUCT_SLOT = 7;
const IO_ITEM_SLOTS = [10, 15];
const IO_FLUID_SLOTS = [16, 21];

const DEFAULT_ENERGY_COST = 7200;
const DEFAULT_FLUID_CAP = 128000;

registerIOInterface("utilitycraft:chemical_reactor", {
    items: {
        slots: IO_ITEM_SLOTS,
        modes: ["disabled", "output"],
    },
    liquids: {
        slots: IO_FLUID_SLOTS,
        modes: ["disabled", "input", "output"],
    },
});

DoriosAPI.register.blockComponent("chemical_reactor", {
    beforeOnPlayerPlace(event, { params: settings }) {
        Machine.spawnEntity(event, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [
                FLUID_DISPLAY_IN,
                FLUID_DISPLAY_OUT,
                FLUID_DISPLAY_BYPRODUCT,
            ]);
            displayMachine(machine);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tankIn = getTank(machine.entity, 0, fluidCap);
        const tankOut = getTank(machine.entity, 1, fluidCap);
        const tankByproduct = getTank(machine.entity, 2, fluidCap);
        const displays = [
            { tank: tankIn, slot: FLUID_DISPLAY_IN },
            { tank: tankOut, slot: FLUID_DISPLAY_OUT },
            { tank: tankByproduct, slot: FLUID_DISPLAY_BYPRODUCT },
        ];

        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_CAPSULE, machine.entity);

        const recipes = getChemicalReactorRecipes();
        if (recipes.length === 0) return fail(machine, displays, "No Recipes");

        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return fail(machine, displays, "No Input Fluid");

        const recipe = recipes.find(entry => entry.input.type === inputType);
        if (!recipe) return fail(machine, displays, "Wrong Fluid");

        const byproducts = getByproducts(recipe);
        const validation = validateRecipe(machine, tankIn, tankOut, tankByproduct, recipe, byproducts);
        if (!validation.ok) return fail(machine, displays, validation.reason);

        const craftLimit = getCraftLimit(machine, tankIn, tankOut, tankByproduct, recipe, byproducts);
        if (craftLimit.max <= 0) return fail(machine, displays, craftLimit.reason);

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, displays, "No Energy", { resetProgress: false });
        }

        chargeOrCraft(machine, energyCost, craftLimit.max, (runs) => {
            tankIn.consume(recipe.input.amount * runs);
            if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);

            if (hasFluidOutput(recipe)) {
                if (tankOut.getType() === EMPTY_FLUID) tankOut.setType(recipe.output.type);
                tankOut.add(recipe.output.amount * runs);
            }

            processByproducts(machine, tankByproduct, byproducts, runs);
        });

        updateHud(machine, recipe, tankIn, tankOut, tankByproduct, byproducts, craftLimit.max);
        displayMachine(machine, displays);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

function fail(machine, displays, message, options) {
    stopMachine(machine, message, options);
    displayMachine(machine, displays);
}

function getByproducts(recipe) {
    const list = [].concat(recipe.byproduct ?? []).filter(Boolean);
    return {
        items: list.filter(byproduct => byproduct.item),
        fluids: list.filter(byproduct => byproduct.fluid?.type && byproduct.fluid?.amount > 0),
    };
}

function hasFluidOutput(recipe) {
    return (recipe.output?.amount ?? 0) > 0;
}

function validateRecipe(machine, tankIn, tankOut, tankByproduct, recipe, byproducts) {
    if (tankIn.get() < recipe.input.amount) return { ok: false, reason: "Not Enough Input" };

    if (hasFluidOutput(recipe)) {
        const outputType = tankOut.getType();
        if (outputType !== EMPTY_FLUID && outputType !== recipe.output.type) {
            return { ok: false, reason: "Output Full" };
        }
        if (tankOut.getFreeSpace() < recipe.output.amount) {
            return { ok: false, reason: "Output Full" };
        }
    }

    const fluidByproductType = getSingleFluidByproductType(byproducts.fluids);
    if (fluidByproductType === false) return { ok: false, reason: "Byproduct Conflict" };
    if (fluidByproductType) {
        const tankType = tankByproduct.getType();
        if (tankType !== EMPTY_FLUID && tankType !== fluidByproductType) {
            return { ok: false, reason: "Byproduct Tank Full" };
        }
    }

    const itemValidation = validateItemByproductSlot(machine, byproducts.items);
    if (!itemValidation.ok) return itemValidation;

    return { ok: true };
}

function getCraftLimit(machine, tankIn, tankOut, tankByproduct, recipe, byproducts) {
    const limits = [Math.floor(tankIn.get() / recipe.input.amount)];

    if (hasFluidOutput(recipe)) {
        limits.push(Math.floor(tankOut.getFreeSpace() / recipe.output.amount));
    }

    const fluidByproductAmount = byproducts.fluids.reduce((total, byproduct) => {
        return total + Math.max(1, byproduct.fluid.amount);
    }, 0);
    if (fluidByproductAmount > 0) {
        limits.push(Math.floor(tankByproduct.getFreeSpace() / fluidByproductAmount));
    }

    const possibleItemAmount = byproducts.items.reduce((total, byproduct) => {
        return total + Math.max(1, byproduct.count ?? 1);
    }, 0);
    if (possibleItemAmount > 0) {
        limits.push(Math.floor(getByproductItemSpace(machine) / possibleItemAmount));
    }

    const max = Math.min(...limits);
    if (max > 0) return { max };
    if (limits[0] <= 0) return { max: 0, reason: "Not Enough Input" };
    return { max: 0, reason: "Tank Full" };
}

function getSingleFluidByproductType(fluidByproducts) {
    if (fluidByproducts.length === 0) return undefined;

    const types = new Set(fluidByproducts.map(byproduct => byproduct.fluid.type));
    if (types.size > 1) return false;

    return [...types][0];
}

function validateItemByproductSlot(machine, itemByproducts) {
    if (itemByproducts.length === 0) return { ok: true };

    const types = new Set(itemByproducts.map(byproduct => byproduct.item));
    if (types.size > 1) return { ok: false, reason: "Byproduct Conflict" };

    const itemType = [...types][0];
    const slot = machine.container.getItem(BYPRODUCT_SLOT);
    if (slot && slot.typeId !== itemType) return { ok: false, reason: "Byproduct Slot Busy" };

    return { ok: true };
}

function getByproductItemSpace(machine) {
    const slot = machine.container.getItem(BYPRODUCT_SLOT);
    if (!slot) return 64;
    return Math.max(0, (slot.maxAmount ?? 64) - slot.amount);
}

function processByproducts(machine, tankByproduct, byproducts, runs) {
    for (let i = 0; i < runs; i++) {
        for (const byproduct of byproducts.items) {
            if (Math.random() <= (byproduct.chance ?? 1)) {
                addItemToSlot(machine.container, BYPRODUCT_SLOT, byproduct.item, byproduct.count ?? 1);
            }
        }

        for (const byproduct of byproducts.fluids) {
            if (Math.random() > (byproduct.chance ?? 1)) continue;

            if (tankByproduct.getType() === EMPTY_FLUID) tankByproduct.setType(byproduct.fluid.type);
            if (tankByproduct.getType() === byproduct.fluid.type) {
                tankByproduct.add(byproduct.fluid.amount);
            }
        }
    }
}

function updateHud(machine, recipe, tankIn, tankOut, tankByproduct, byproducts, queued) {
    const lines = [
        `§bInput:  §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
    ];

    if (hasFluidOutput(recipe)) {
        lines.push(`§aOutput: §f${formatFluidType(recipe.output.type)} §7${FluidStorage.formatFluid(tankOut.get())} / ${FluidStorage.formatFluid(tankOut.getCap())}`);
    }

    lines.push(
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    );

    for (const byproduct of byproducts.items) {
        lines.push(`§dByproduct: §f${byproduct.item} §7(${Math.round((byproduct.chance ?? 1) * 100)}%)`);
    }

    for (const byproduct of byproducts.fluids) {
        lines.push(`§dByproduct: §f${formatFluidType(byproduct.fluid.type)} §7${FluidStorage.formatFluid(tankByproduct.get())} / ${FluidStorage.formatFluid(tankByproduct.getCap())} §7(${Math.round((byproduct.chance ?? 1) * 100)}%)`);
    }

    machine.setLabel(["§6Chemical Reactor", ...lines]);
}
