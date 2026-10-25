import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getPolymerizerRecipes } from "../../config/recipes/machinery/polymerizer.js";
import {
    EMPTY_FLUID,
    addItemToSlot,
    processMachine,
    displayMachine,
    failMachine,
    formatFluidType,
    getMachineEnergyCost,
    getMachineFluidCap,
    getTank,
    hasNoEnergy,
    setupTanks,
    consumeTank,
    formatItemId,
    getOutputSlotSpace,
} from "../helper/machine_helpers.js";

const FLUID_DISPLAY_IN = 3;
const OUTPUT_SLOT      = 4;
const IO_ITEM_SLOTS    = [7, 12];
const IO_FLUID_SLOTS   = [13, 18];

const DEFAULT_ENERGY_COST = 10_000;
const DEFAULT_FLUID_CAP   = 16_000;

registerIOInterface("utilitycraft:polymerizer", {
    liquids: {
        buttonSlots: IO_FLUID_SLOTS,
        anyInputIndices:  [0],
        anyOutputIndices: [],
        modes: [
            { id: "disabled" },
            { id: "input_1", inputIndices: [0] },
        ],
    },
    items: {
        buttonSlots: IO_ITEM_SLOTS,
        anyInputSlots:  [],
        anyOutputSlots: [OUTPUT_SLOT],
        modes: [
            { id: "disabled" },
            { id: "output_1", outputSlots: [OUTPUT_SLOT] },
        ],
    },
});

DoriosLib.registry.blockComponent("utilitycraft:polymerizer", {
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        Machine.spawnEntity(/** @type {any} */ (event), settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;
            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [FLUID_DISPLAY_IN]);
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
        const displays = [{ tank: tankIn, slot: FLUID_DISPLAY_IN }];

        const recipes = getPolymerizerRecipes();
        if (recipes.length === 0) return failMachine(machine, displays, "No Recipes");

        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return failMachine(machine, displays, "No Input Fluid");

        const recipe = recipes.find(r => r.input.type === inputType);
        if (!recipe) return failMachine(machine, displays, `Wrong Fluid: ${formatFluidType(inputType)}`);

        if (tankIn.get() < recipe.input.amount)
            return failMachine(machine, displays, "Not Enough Fluid");

        const outputSpace = getOutputSlotSpace(machine.container, [OUTPUT_SLOT], recipe.output.item);
        if (outputSpace <= 0) return failMachine(machine, displays, "Output Full");

        const craftLimit = Math.min(
            Math.floor(tankIn.get() / recipe.input.amount),
            outputSpace,
        );
        if (craftLimit <= 0) return failMachine(machine, displays, "Output Full");

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (hasNoEnergy(machine, energyCost))
            return failMachine(machine, displays, "No Energy", { resetProgress: false });

        processMachine(machine, {
            energyCost,
            seconds: recipe.seconds ?? 5,
            maxRuns: craftLimit,
            craft: (runs) => {
                consumeTank(tankIn, recipe.input.amount * runs);
                addItemToSlot(machine.container, OUTPUT_SLOT, recipe.output.item, recipe.output.count * runs);
            },
        });

        updateHud(machine, recipe, tankIn, craftLimit);
        displayMachine(machine, displays);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

function updateHud(machine, recipe, tankIn, queued) {
    machine.setLabel([
        `§r§6Polymerizer`,
        `§r§bInput:  §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
        `§r§aOutput: §f${formatItemId(recipe.output.item)} ×${recipe.output.count}`,
        `§r§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§r§7Queued: §f${queued}`,
    ]);
}