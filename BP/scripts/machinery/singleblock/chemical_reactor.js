import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getChemicalReactorRecipes } from "../../config/recipes/machinery/chemical_reactor.js";
import {
    EMPTY_FLUID,
    processMachine,
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
const FLUID_DISPLAY_IN    = 4;
const FLUID_DISPLAY_OUT   = 5;
const IO_FLUID_SLOTS       = [16, 21];

const DEFAULT_ENERGY_COST = 7200;
const DEFAULT_FLUID_CAP   = 128000;

registerIOInterface("utilitycraft:chemical_reactor", {
    liquids: {
        buttonSlots: IO_FLUID_SLOTS,
        anyInputIndices:  [0],
        anyOutputIndices: [1],
        modes: [
            { id: "disabled" },
            { id: "input_1",  inputIndices:  [0] },
            { id: "output_1", outputIndices: [1] },
        ],
    },
});

DoriosLib.registry.blockComponent("utilitycraft:chemical_reactor", {
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        const placementEvent = (event);
        Machine.spawnEntity(placementEvent, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [FLUID_DISPLAY_IN, FLUID_DISPLAY_OUT]);
            displayMachine(machine);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        machine.processIO();

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tankIn   = getTank(machine.entity, 0, fluidCap);
        const tankOut  = getTank(machine.entity, 1, fluidCap);
        const displays = [
            { tank: tankIn,  slot: FLUID_DISPLAY_IN  },
            { tank: tankOut, slot: FLUID_DISPLAY_OUT },
        ];

        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_CAPSULE, machine.entity);

        const recipes = getChemicalReactorRecipes();
        if (recipes.length === 0) return fail(machine, displays, "No Recipes");

        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return fail(machine, displays, "No Input Fluid");

        const recipe = recipes.find(entry => entry.input.type === inputType);
        if (!recipe) return fail(machine, displays, "Wrong Fluid");

        const validation = validateRecipe(tankIn, tankOut, recipe);
        if (!validation.ok) return fail(machine, displays, validation.reason);

        const craftLimit = getCraftLimit(tankIn, tankOut, recipe);
        if (craftLimit.max <= 0) return fail(machine, displays, craftLimit.reason);

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost)
            return fail(machine, displays, "No Energy", { resetProgress: false });

        processMachine(machine, {
            energyCost,
            seconds:  recipe.seconds ?? 12,
            maxRuns:  craftLimit.max,
            craft: (runs) => {
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);

                if (hasFluidOutput(recipe)) {
                    if (tankOut.getType() === EMPTY_FLUID) tankOut.setType(recipe.output.type);
                    tankOut.add(recipe.output.amount * runs);
                }
            },
        });

        updateHud(machine, recipe, tankIn, tankOut, craftLimit.max);
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

function hasFluidOutput(recipe) {
    return (recipe.output?.amount ?? 0) > 0;
}

function validateRecipe(tankIn, tankOut, recipe) {
    if (tankIn.get() < recipe.input.amount)
        return { ok: false, reason: "Not Enough Input" };

    if (hasFluidOutput(recipe)) {
        const outputType = tankOut.getType();
        if (outputType !== EMPTY_FLUID && outputType !== recipe.output.type)
            return { ok: false, reason: "Output Full" };
        if (tankOut.getFreeSpace() < recipe.output.amount)
            return { ok: false, reason: "Output Full" };
    }

    return { ok: true };
}

function getCraftLimit(tankIn, tankOut, recipe) {
    const limits = [Math.floor(tankIn.get() / recipe.input.amount)];

    if (hasFluidOutput(recipe))
        limits.push(Math.floor(tankOut.getFreeSpace() / recipe.output.amount));

    const max = Math.min(...limits);
    if (max > 0) return { max };
    if (limits[0] <= 0) return { max: 0, reason: "Not Enough Input" };
    return { max: 0, reason: "Tank Full" };
}

function updateHud(machine, recipe, tankIn, tankOut, queued) {
    const lines = [
        `§bInput:  §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
    ];

    if (hasFluidOutput(recipe))
        lines.push(`§aOutput: §f${formatFluidType(recipe.output.type)} §7${FluidStorage.formatFluid(tankOut.get())} / ${FluidStorage.formatFluid(tankOut.getCap())}`);

    lines.push(
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    );

    machine.setLabel(["§6Chemical Reactor", ...lines]);
}