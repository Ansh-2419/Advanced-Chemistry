import { EnergyStorage, FluidStorage, Machine } from "../../DoriosCore/index.js";
import { getFuelMixerRecipes } from "../../config/recipes/machinery/fuel_mixer.js";
import {
    EMPTY_FLUID,
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

const FLUID_INPUT_SLOT_1 = 10;
const FLUID_INPUT_SLOT_2 = 11;
const FLUID_DISPLAY_SLOT_1 = 12;
const FLUID_DISPLAY_SLOT_2 = 13;
const FLUID_OUTPUT_SLOT = 14;
const FLUID_DISPLAY_OUTPUT = 15;

const DEFAULT_ENERGY_COST = 4800;
const DEFAULT_FLUID_CAP = 128000;
const MANUAL_TRANSFER_LIMIT = 1000;

DoriosAPI.register.blockComponent("fuel_mixer", {
    beforeOnPlayerPlace(event, { params: settings }) {
        Machine.spawnEntity(event, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            machine.blockSlots([
                FLUID_OUTPUT_SLOT,
                FLUID_DISPLAY_SLOT_1,
                FLUID_DISPLAY_SLOT_2,
                FLUID_DISPLAY_OUTPUT,
            ]);
            setupTanks(entity, fluidCap, [
                FLUID_DISPLAY_SLOT_1,
                FLUID_DISPLAY_SLOT_2,
                FLUID_DISPLAY_OUTPUT,
            ]);
            displayMachine(machine);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tank1 = getTank(machine.entity, 0, fluidCap);
        const tank2 = getTank(machine.entity, 1, fluidCap);
        const tankOut = getTank(machine.entity, 2, fluidCap);
        const displays = [
            { tank: tank1, slot: FLUID_DISPLAY_SLOT_1 },
            { tank: tank2, slot: FLUID_DISPLAY_SLOT_2 },
            { tank: tankOut, slot: FLUID_DISPLAY_OUTPUT },
        ];

        machine.blockSlots([FLUID_OUTPUT_SLOT, FLUID_DISPLAY_SLOT_1, FLUID_DISPLAY_SLOT_2, FLUID_DISPLAY_OUTPUT]);
        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_SLOT_1, machine.entity);
        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_SLOT_2, machine.entity);
        pullAdjacentFluidInputs(machine.entity, block, [tank1, tank2]);
        tankOut.transferFluids(block, tankOut.get());

        const recipes = getFuelMixerRecipes();
        if (recipes.length === 0) return fail(machine, displays, "No Recipes");

        const recipe = matchRecipe(recipes, tank1.getType(), tank2.getType());
        if (!recipe) return fail(machine, displays, "Fill Both Tanks");

        const outputType = tankOut.getType();
        if (outputType !== EMPTY_FLUID && outputType !== recipe.output.type) {
            return fail(machine, displays, "Output Full");
        }

        const [inputA, inputB] = tank1.getType() === recipe.input1.type
            ? [tank1, tank2]
            : [tank2, tank1];

        const craftLimit = getCraftLimit(inputA, inputB, tankOut, recipe);
        if (craftLimit.max <= 0) return fail(machine, displays, craftLimit.reason);

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, displays, "No Energy", { resetProgress: false });
        }

        chargeOrCraft(machine, energyCost, craftLimit.max, (runs) => {
            inputA.consume(recipe.input1.amount * runs);
            inputB.consume(recipe.input2.amount * runs);

            if (tankOut.getType() === EMPTY_FLUID) tankOut.setType(recipe.output.type);
            tankOut.add(recipe.output.amount * runs);
        });

        updateHud(machine, recipe, tank1, tank2, tankOut, craftLimit.max);
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

function matchRecipe(recipes, type1, type2) {
    if (type1 === EMPTY_FLUID || type2 === EMPTY_FLUID) return undefined;

    return recipes.find(recipe =>
        (recipe.input1.type === type1 && recipe.input2.type === type2) ||
        (recipe.input1.type === type2 && recipe.input2.type === type1)
    );
}

function getCraftLimit(inputA, inputB, tankOut, recipe) {
    const inputRuns = Math.floor(inputA.get() / recipe.input1.amount);
    const secondaryRuns = Math.floor(inputB.get() / recipe.input2.amount);
    const outputRuns = Math.floor(tankOut.getFreeSpace() / recipe.output.amount);
    const max = Math.min(inputRuns, secondaryRuns, outputRuns);

    if (max > 0) return { max };
    if (inputRuns <= 0 || secondaryRuns <= 0) return { max: 0, reason: "Not Enough Input" };
    return { max: 0, reason: "Output Full" };
}

function pullAdjacentFluidInputs(entity, block, tanks) {
    const dimension = block.dimension;
    const { x, y, z } = block.location;
    const offsets = [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 },
    ];

    for (const offset of offsets) {
        const sourceBlock = dimension.getBlock({
            x: x + offset.x,
            y: y + offset.y,
            z: z + offset.z,
        });
        if (!sourceBlock?.hasTag?.("dorios:fluid")) continue;

        const sourceEntity = dimension.getEntitiesAtBlockLocation(sourceBlock.location)[0];
        if (!sourceEntity || sourceEntity === entity) continue;

        const sourceTank = new FluidStorage(sourceEntity, 0);
        const sourceType = sourceTank.getType();
        if (sourceType === EMPTY_FLUID || sourceTank.get() <= 0) continue;

        const target = tanks.find(tank => tank.getType() === sourceType && tank.getFreeSpace() > 0)
            ?? tanks.find(tank => tank.getType() === EMPTY_FLUID && tank.getFreeSpace() > 0);

        if (!target) continue;

        const amount = Math.min(sourceTank.get(), target.getFreeSpace(), MANUAL_TRANSFER_LIMIT);
        if (amount <= 0) continue;

        if (target.getType() === EMPTY_FLUID) target.setType(sourceType);
        sourceTank.consume(amount);
        target.add(amount);
    }
}

function updateHud(machine, recipe, tank1, tank2, tankOut, queued) {
    machine.setLabel([
        "§6Fuel Mixer",
        `§bInput 1: §f${formatFluidType(recipe.input1.type)} §7(${FluidStorage.formatFluid(tank1.get())})`,
        `§bInput 2: §f${formatFluidType(recipe.input2.type)} §7(${FluidStorage.formatFluid(tank2.get())})`,
        `§aOutput:  §f${formatFluidType(recipe.output.type)}`,
        `§7Tank:    §f${FluidStorage.formatFluid(tankOut.get())} §7/ §f${FluidStorage.formatFluid(tankOut.getCap())}`,
        `§cCost:    §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued:  §f${queued}`,
    ]);
}
