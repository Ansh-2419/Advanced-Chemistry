import { initFluidTanks, initEnergy, validateStructure, formatFluidDisplayName } from "../helper/helper.js";
import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockMachine,
    registerLinkNodeIO,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getRefineryRecipes } from "../../config/recipes/machinery/refinery.js";

// ── Structure requirements ────────────────────────────────────────────────────
const MIN_SIZE = { x: 3, y: 3, z: 3 };
const PORTS    = { energy: 1, fluid: 2 };

const ENERGY_SLOT = 0;
const LABEL_SLOT = 1;
const PROGRESS_SLOT = 2;
const INPUT_FLUID_SLOT = 3;
const OUTPUT_FLUID_SLOTS = [4, 5, 6];

const FLUID_CAPACITY = 256_000;
const ENERGY_CAPACITY = 400_000;
const BASE_RATE = 100;

const CONFIG = {
    required_case: "dorios:multiblock.case.chem",
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

registerLinkNodeIO("utilitycraft:refinery_monitor", {
    liquids: {
        anyInputIndices: [0],
        anyOutputIndices: [1, 2, 3],
        inputs: [
            { id: "feedstock", label: "Feedstock Tank", color: "§9", indices: [0] },
        ],
        outputs: [
            { id: "all_products", label: "Any Product Tank", color: "§c", indices: [1, 2, 3] },
            { id: "product_1", label: "Product Tank 1", color: "§c", indices: [1] },
            { id: "product_2", label: "Product Tank 2", color: "§c", indices: [2] },
            { id: "product_3", label: "Product Tank 3", color: "§c", indices: [3] },
        ],
    },
});

DoriosLib.registry.blockComponent("utilitycraft:refinery_monitor", {
    onPlayerInteract(event) {
        if (!event.player) return;
        const interactionEvent = /** @type {import("DoriosCore/index.js").InteractionEventLike} */ (event);
        return MultiblockMachine.handlePlayerInteract(interactionEvent, CONFIG, {
            initializeEntity(entity) {
                configureStorage(entity);
            },
            onActivate({ entity, structure, player }) {
                    if (validateStructure(entity, structure, player, {
                        name: "Refinery", minSize: MIN_SIZE, ports: PORTS, portType: "normal", noAir: true,
                    })) return false;
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
    const tanks = initFluidTanks(entity, 4, FLUID_CAPACITY);

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

    const energy = initEnergy(entity, ENERGY_CAPACITY);

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