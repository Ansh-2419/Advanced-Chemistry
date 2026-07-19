import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockMachine,
} from "../../DoriosCore/index.js";
import { getRefineryRecipes } from "../../config/recipes/machinery/refinery.js";
import { formatFluidDisplayName } from "./multiblock_helpers.js";

const ENERGY_SLOT = 0;
const LABEL_SLOT = 1;
const PROGRESS_SLOT = 2;
const INPUT_FLUID_SLOT = 3;
const OUTPUT_FLUID_SLOTS = [4, 5, 6];

const FLUID_CAPACITY = 256_000;
const ENERGY_CAPACITY = 400_000;
const BASE_RATE = 100;

const CONFIG = {
    required_case: "dorios:multiblock.case.refinery",
    entity: {
        identifier: "utilitycraft:refinery_multiblock",
        name: "refinery_monitor",
        inventory_size: 7,
        fixed_fluid_types: true,
    },
    machine: {
        rate_speed_base: BASE_RATE,
        energy_cap: ENERGY_CAPACITY,
    },
    requirements: {},
};

DoriosAPI.register.blockComponent("refinery_monitor", {
    onPlayerInteract(event) {
        return MultiblockMachine.handlePlayerInteract(event, CONFIG, {
            initializeEntity(entity) {
                configureStorage(entity);
            },
            onActivate({ entity }) {
                configureStorage(entity);
            },
            successMessages() {
                return [
                    "\u00A7a[Refinery] Structure online.",
                    `\u00A77Tank capacity: \u00A7b${FluidStorage.formatFluid(FLUID_CAPACITY)}`,
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

        const machine = new MultiblockMachine(block, CONFIG);
        if (!machine.valid) return;

        const { energy, input, outputs } = configureStorage(machine.entity);
        const recipe = getRefineryRecipes().find((entry) => entry.input.type === input.getType());

        if (!recipe) {
            displayMachine(machine, energy, input, outputs, "No Input Fluid");
            return;
        }

        const error = validateRecipe(recipe, input, outputs, energy);
        if (error) {
            displayMachine(machine, energy, input, outputs, error, recipe);
            return;
        }

        processRecipe(machine, energy, input, outputs, recipe);
        displayMachine(machine, energy, input, outputs, "Processing", recipe);
    },
});

function configureStorage(entity) {
    const tanks = FluidStorage.initializeMultiple(entity, 4);
    for (const tank of tanks) {
        if (tank.getCap() !== FLUID_CAPACITY) tank.setCap(FLUID_CAPACITY);
    }

    const recipe = getRefineryRecipes()[0];
    if (recipe) {
        const expectedTypes = [
            recipe.output1.type,
            recipe.output2.type,
            recipe.output3.type,
        ];
        expectedTypes.forEach((type, index) => {
            const tank = tanks[index + 1];
            if (tank.get() <= 0 && tank.getType() !== type) tank.setType(type);
        });
    }

    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);

    return {
        energy,
        input: tanks[0],
        outputs: tanks.slice(1),
    };
}
function validateRecipe(recipe, input, outputs, energy) {
    if (input.get() < recipe.input.amount) return "Not Enough Input";
    if (energy.get() <= 0) return "No Energy";

    const recipeOutputs = [recipe.output1, recipe.output2, recipe.output3];
    for (let index = 0; index < outputs.length; index++) {
        const tank = outputs[index];
        const expected = recipeOutputs[index];
        if (tank.getType() !== expected.type) return `Output ${index + 1} Blocked`;
        if (tank.getFreeSpace() < expected.amount) return `Output ${index + 1} Full`;
    }

    return null;
}

function processRecipe(machine, energy, input, outputs, recipe) {
    const energyCost = recipe.energyCost;
    const progress = machine.getProgress();

    if (progress >= energyCost) {
        input.consume(recipe.input.amount);
        if (input.get() <= 0) input.setType("empty");

        const recipeOutputs = [recipe.output1, recipe.output2, recipe.output3];
        recipeOutputs.forEach((output, index) => outputs[index].add(output.amount));

        machine.addProgress(-energyCost);
        return;
    }

    const spend = Math.min(
        energy.get(),
        machine.rate,
        energyCost - progress,
    );
    if (spend <= 0) return;

    energy.consume(spend);
    machine.addProgress(spend);
}

function displayMachine(machine, energy, input, outputs, status, recipe) {
    energy.display(ENERGY_SLOT);
    input.display(INPUT_FLUID_SLOT);
    outputs.forEach((tank, index) => tank.display(OUTPUT_FLUID_SLOTS[index]));

    const energyCost = recipe?.energyCost ?? getRefineryRecipes()[0]?.energyCost ?? 12_000;
    machine.displayProgress({
        maxValue: energyCost,
        slot: PROGRESS_SLOT,
    });

    machine.setLabel([
        `\u00A7r\u00A76Refinery - \u00A7f${status}`,
        `\u00A7r\u00A7eEnergy: \u00A7f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `\u00A7r\u00A7bInput: \u00A7f${formatFluidDisplayName(input.getType())} ${FluidStorage.formatFluid(input.get())}`,
        ...outputs.map((tank, index) =>
            `\u00A7r\u00A7aOutput ${index + 1}: \u00A7f${formatFluidDisplayName(tank.getType())} ${FluidStorage.formatFluid(tank.get())}`
        ),
    ], LABEL_SLOT);
}
