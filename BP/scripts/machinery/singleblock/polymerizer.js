import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "../../DoriosCore/index.js";
import { getPolymerizerRecipes } from "../../config/recipes/machinery/polymerizer.js";
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
} from "./machine_helpers.js";

// ── Slot layout ───────────────────────────────────────────────────────────────
// 0   Energy display
// 1   Label display
// 2   Progress display    
// 3   Fluid display (in)     
// 4   Item output slot    
// 5–6  Upgrade slots
// 7–12  IO item slots
// 13–18 IO fluid slots
const FLUID_DISPLAY_IN = 3;
const OUTPUT_SLOT      = 4;
const IO_ITEM_SLOTS    = [7, 12];
const IO_FLUID_SLOTS   = [13, 18];

const DEFAULT_ENERGY_COST = 10_000;
const DEFAULT_FLUID_CAP   = 16_000;

registerIOInterface("utilitycraft:polymerizer", {
    liquids: {
        slots: IO_FLUID_SLOTS,
        modes: ["disabled", "input"],
    },
    items: {
        slots: IO_ITEM_SLOTS,
        modes: ["disabled", "output"],
    },
});

DoriosAPI.register.blockComponent("polymerizer", {
    beforeOnPlayerPlace(event, { params: settings }) {
        Machine.spawnEntity(event, settings, (entity) => {
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

        const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tankIn   = getTank(machine.entity, 0, fluidCap);
        const displays = [{ tank: tankIn, slot: FLUID_DISPLAY_IN }];

        const recipes = getPolymerizerRecipes();
        if (recipes.length === 0) return fail(machine, displays, "No Recipes");

        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return fail(machine, displays, "No Input Fluid");

        const recipe = recipes.find(r => r.input.type === inputType);
        if (!recipe) return fail(machine, displays, `Wrong Fluid: ${formatFluidType(inputType)}`);

        if (tankIn.get() < recipe.input.amount) return fail(machine, displays, "Not Enough Fluid");

        const outputSpace = getOutputItemSpace(machine, recipe.output.item);
        if (outputSpace <= 0) return fail(machine, displays, "Output Full");

        const craftLimit = Math.min(
            Math.floor(tankIn.get() / recipe.input.amount),
            outputSpace,
        );
        if (craftLimit <= 0) return fail(machine, displays, "Output Full");

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return fail(machine, displays, "No Energy", { resetProgress: false });
        }

        // Set rate so recipe.seconds controls processing time
        if ((recipe.seconds ?? 0) > 0) {
            machine.setRate(energyCost / recipe.seconds);
        }

        chargeOrCraft(machine, energyCost, craftLimit, (runs) => {
            tankIn.consume(recipe.input.amount * runs);
            if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);
            addItemToSlot(machine.container, OUTPUT_SLOT, recipe.output.item, recipe.output.count * runs);
        });

        updateHud(machine, recipe, tankIn, craftLimit);
        displayMachine(machine, displays);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fail(machine, displays, message, options) {
    stopMachine(machine, message, options);
    displayMachine(machine, displays);
}

function getOutputItemSpace(machine, typeId) {
    const slot = machine.container.getItem(OUTPUT_SLOT);
    if (!slot) return 64;
    if (slot.typeId !== typeId) return 0;
    return Math.max(0, (slot.maxAmount ?? 64) - slot.amount);
}

function updateHud(machine, recipe, tankIn, queued) {
    machine.setLabel([
        `§r§6Polymerizer`,
        `§r§bInput:  §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
        `§r§aOutput: §f${recipe.output.item.split(":")[1] ?? recipe.output.item} ×${recipe.output.count}`,
        `§r§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§r§7Queued: §f${queued}`,
    ]);
}
