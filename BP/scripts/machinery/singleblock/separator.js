import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getSeparatorRecipes } from "../../config/recipes/machinery/separator.js";
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
const FLUID_DISPLAY_IN = 4;
const FLUID_DISPLAY_OUT1 = 5;
const FLUID_DISPLAY_OUT2 = 6;
const IO_FLUID_SLOTS = [9, 14];

const DEFAULT_ENERGY_COST = 6400;
const DEFAULT_FLUID_CAP = 128000;

registerIOInterface("utilitycraft:separator", {
    liquids: {
        buttonSlots: IO_FLUID_SLOTS,
        anyInputIndices: [0],
        anyOutputIndices: [1, 2],
        modes: [
            { id: "disabled" },
            { id: "input_1", inputIndices: [0] },
            { id: "output_1", outputIndices: [1] },
            { id: "output_2", outputIndices: [2] },
        ],
    },
});

DoriosLib.registry.blockComponent("utilitycraft:separator", {
    /** @param {import("@minecraft/server").BlockComponentPlayerPlaceBeforeEvent} event @param {{params: import("DoriosCore/index.js").MachineSettings}} context */
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        const placementEvent = /** @type {import("DoriosCore/index.js").PlacementEventLike} */ (event);
        Machine.spawnEntity(placementEvent, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [
                FLUID_DISPLAY_IN,
                FLUID_DISPLAY_OUT1,
                FLUID_DISPLAY_OUT2,
            ]);
            displayMachine(machine);
        });
    },

    /** @param {import("@minecraft/server").BlockComponentTickEvent} event @param {{params: import("DoriosCore/index.js").MachineSettings}} context */
    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        machine.processIO();

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tankIn = getTank(machine.entity, 0, fluidCap);
        const tankOut1 = getTank(machine.entity, 1, fluidCap);
        const tankOut2 = getTank(machine.entity, 2, fluidCap);
        const displays = [
            { tank: tankIn, slot: FLUID_DISPLAY_IN },
            { tank: tankOut1, slot: FLUID_DISPLAY_OUT1 },
            { tank: tankOut2, slot: FLUID_DISPLAY_OUT2 },
        ];

        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_CAPSULE, machine.entity);

        const recipes = getSeparatorRecipes();
        if (recipes.length === 0) return fail(machine, displays, "No Recipes");

        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return fail(machine, displays, "No Input Fluid");

        const recipe = recipes.find(entry => entry.input.type === inputType);
        if (!recipe) return fail(machine, displays, "Wrong Fluid");

        const validation = validateOutputs(tankIn, tankOut1, tankOut2, recipe);
        if (!validation.ok) return fail(machine, displays, validation.reason);

        const craftLimit = getCraftLimit(tankIn, tankOut1, tankOut2, recipe);
        if (craftLimit.max <= 0) return fail(machine, displays, craftLimit.reason);

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, displays, "No Energy", { resetProgress: false });
        }

        processMachine(machine, {
            energyCost,
            seconds: recipe.seconds ?? 8,
            maxRuns: craftLimit.max,
            craft: (runs) => {
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);

                if (tankOut1.getType() === EMPTY_FLUID) tankOut1.setType(recipe.output1.type);
                tankOut1.add(recipe.output1.amount * runs);

                if (tankOut2.getType() === EMPTY_FLUID) tankOut2.setType(recipe.output2.type);
                tankOut2.add(recipe.output2.amount * runs);
            },
        });

        updateHud(machine, recipe, tankIn, tankOut1, tankOut2, craftLimit.max);
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

function validateOutputs(tankIn, tankOut1, tankOut2, recipe) {
    if (tankIn.get() < recipe.input.amount) return { ok: false, reason: "Not Enough Input" };

    const out1Type = tankOut1.getType();
    const out2Type = tankOut2.getType();
    if (out1Type !== EMPTY_FLUID && out1Type !== recipe.output1.type) {
        return { ok: false, reason: "Out 1 Blocked" };
    }
    if (out2Type !== EMPTY_FLUID && out2Type !== recipe.output2.type) {
        return { ok: false, reason: "Out 2 Blocked" };
    }
    if (tankOut1.getFreeSpace() <= 0) return { ok: false, reason: "Heavy HC Full" };
    if (tankOut2.getFreeSpace() <= 0) return { ok: false, reason: "Reactive Full" };

    return { ok: true };
}

function getCraftLimit(tankIn, tankOut1, tankOut2, recipe) {
    const inputRuns = Math.floor(tankIn.get() / recipe.input.amount);
    const out1Runs = Math.floor(tankOut1.getFreeSpace() / recipe.output1.amount);
    const out2Runs = Math.floor(tankOut2.getFreeSpace() / recipe.output2.amount);
    const max = Math.min(inputRuns, out1Runs, out2Runs);

    if (max > 0) return { max };
    if (inputRuns <= 0) return { max: 0, reason: "Not Enough Input" };
    return { max: 0, reason: "Tanks Full" };
}

function updateHud(machine, recipe, tankIn, tankOut1, tankOut2, queued) {
    machine.setLabel([
        "§6Separator",
        `§bIn:   §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
        `§aOut1: §f${formatFluidType(recipe.output1.type)} §7${FluidStorage.formatFluid(tankOut1.get())} / ${FluidStorage.formatFluid(tankOut1.getCap())}`,
        `§aOut2: §f${formatFluidType(recipe.output2.type)} §7${FluidStorage.formatFluid(tankOut2.get())} / ${FluidStorage.formatFluid(tankOut2.getCap())}`,
        `§cCost: §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    ]);
}
