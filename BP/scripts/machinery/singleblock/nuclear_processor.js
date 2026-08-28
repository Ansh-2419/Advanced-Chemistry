import { EnergyStorage, FluidStorage, Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { getNuclearProcessorRecipes } from "../../config/recipes/machinery/nuclear_processor.js";
import {
    EMPTY_FLUID,
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

// ── Slot layout ───────────────────────────────────────────────────────────────
//  0      Energy bar
//  1      HUD label
//  2      Progress arrow
//  3      Fluid input capsule slot
//  4      Fluid input display (tank 0)
//  5      Item input slot 1  ┐
//  6      Item input slot 2  │ 2×2 grid
//  7      Item input slot 3  │
//  8      Item input slot 4  ┘
//  9      Fluid output display (tank 1)
//  10–11  Upgrade slots
//  12–17  IO item button slots
//  18–23  IO fluid button slots

const FLUID_INPUT_CAPSULE = 3;
const FLUID_DISPLAY_IN    = 4;
const ITEM_SLOTS          = [5, 6, 7, 8];
const FLUID_DISPLAY_OUT   = 9;
const UPGRADE_1           = 10;
const UPGRADE_2           = 11;
const IO_ITEM_SLOTS       = [12, 17];
const IO_FLUID_SLOTS      = [18, 23];

const DEFAULT_ENERGY_COST = 50_000;
const DEFAULT_FLUID_CAP   = 128_000;
const MACHINE_ID          = "utilitycraft:nuclear_processor";

// ── IO Interface ──────────────────────────────────────────────────────────────
registerIOInterface(MACHINE_ID, {
    items: {
        buttonSlots: IO_ITEM_SLOTS,
        anyInputSlots:  ITEM_SLOTS,
        anyOutputSlots: [],
        modes: [
            { id: "disabled" },
            { id: "input_1", inputSlots: ITEM_SLOTS },
        ],
    },
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

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent(MACHINE_ID, {
    /** @param {import("@minecraft/server").BlockComponentPlayerPlaceBeforeEvent} event
     *  @param {{params: import("DoriosCore/index.js").MachineSettings}} context */
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        Machine.spawnEntity(event, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;

            const fluidCap = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY_COST);
            setupTanks(entity, fluidCap, [FLUID_DISPLAY_IN, FLUID_DISPLAY_OUT]);
            displayMachine(machine);
        });
    },

    /** @param {import("@minecraft/server").BlockComponentTickEvent} event
     *  @param {{params: import("DoriosCore/index.js").MachineSettings}} context */
    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        machine.processIO();

        const fluidCap  = getMachineFluidCap(settings, DEFAULT_FLUID_CAP);
        const tankIn    = getTank(machine.entity, 0, fluidCap);
        const tankOut   = getTank(machine.entity, 1, fluidCap);
        const displays  = [
            { tank: tankIn,  slot: FLUID_DISPLAY_IN  },
            { tank: tankOut, slot: FLUID_DISPLAY_OUT },
        ];

        tryUseFluidItemInSlot(machine.container, FLUID_INPUT_CAPSULE, machine.entity);

        // ── Validate fluid input ──────────────────────────────────────────────
        const inputType = tankIn.getType();
        if (inputType === EMPTY_FLUID) return fail(machine, displays, "No Input Fluid");

        // ── Find matching recipe ──────────────────────────────────────────────
        const recipes = getNuclearProcessorRecipes();
        const recipe  = recipes.find(r => r.input.type === inputType);
        if (!recipe) return fail(machine, displays, "Wrong Fluid");

        // ── Validate items ────────────────────────────────────────────────────
        const itemCheck = validateItems(machine.container, recipe.items);
        if (!itemCheck.ok) return fail(machine, displays, itemCheck.reason);

        // ── Validate output space ─────────────────────────────────────────────
        const outType = tankOut.getType();
        if (outType !== EMPTY_FLUID && outType !== recipe.output.type)
            return fail(machine, displays, "Output Tank Conflict");

        if (tankOut.getFreeSpace() < recipe.output.amount)
            return fail(machine, displays, "Output Tank Full");

        // ── Compute max runs ──────────────────────────────────────────────────
        const maxByFluid    = Math.floor(tankIn.get() / recipe.input.amount);
        const maxByOutSpace = Math.floor(tankOut.getFreeSpace() / recipe.output.amount);
        const maxByItems    = getMaxRunsByItems(machine.container, recipe.items);
        const maxRuns       = Math.min(maxByFluid, maxByOutSpace, maxByItems);

        if (maxRuns <= 0) return fail(machine, displays, "Not Enough Input");

        // ── Energy check ──────────────────────────────────────────────────────
        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY_COST);
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost)
            return fail(machine, displays, "No Energy", { resetProgress: false });

        // ── Process ───────────────────────────────────────────────────────────
        processMachine(machine, {
            energyCost,
            seconds: recipe.seconds ?? 20,
            maxRuns,
            craft: (runs) => {
                // Consume fluid input
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);

                // Consume items
                for (const req of recipe.items) {
                    const slot = findItemSlot(machine.container, req.id, req.amount);
                    if (slot !== -1)
                        removeItemsFromSlot(machine.container, slot, req.amount * runs);
                }

                // Fill output tank
                if (tankOut.getType() === EMPTY_FLUID) tankOut.setType(recipe.output.type);
                tankOut.add(recipe.output.amount * runs);
            },
        });

        updateHud(machine, recipe, tankIn, tankOut, maxRuns);
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

/**
 * Check that all required items are present in the 2×2 grid.
 * @param {import("@minecraft/server").Container} container
 * @param {{ id: string, amount: number }[]} requirements
 */
function validateItems(container, requirements) {
    for (const req of requirements) {
        const slot = findItemSlot(container, req.id, req.amount);
        if (slot === -1) {
            const name = req.id.split(":")[1]?.replace(/_/g, " ") ?? req.id;
            return { ok: false, reason: `Need ${name} ×${req.amount}` };
        }
    }
    return { ok: true };
}

/**
 * Find the first item slot in ITEM_SLOTS that matches typeId with enough amount.
 * @param {import("@minecraft/server").Container} container
 * @param {string} typeId
 * @param {number} minAmount
 * @returns {number} slot index or -1
 */
function findItemSlot(container, typeId, minAmount) {
    for (const slot of ITEM_SLOTS) {
        const item = container.getItem(slot);
        if (item?.typeId === typeId && item.amount >= minAmount) return slot;
    }
    return -1;
}

/**
 * How many full craft runs can the current items support?
 * @param {import("@minecraft/server").Container} container
 * @param {{ id: string, amount: number }[]} requirements
 */
function getMaxRunsByItems(container, requirements) {
    let min = Number.MAX_SAFE_INTEGER;
    for (const req of requirements) {
        const slot = findItemSlot(container, req.id, req.amount);
        if (slot === -1) return 0;
        const item = container.getItem(slot);
        min = Math.min(min, Math.floor((item?.amount ?? 0) / req.amount));
    }
    return Math.max(0, min === Number.MAX_SAFE_INTEGER ? 0 : min);
}

function updateHud(machine, recipe, tankIn, tankOut, queued) {
    const itemList = recipe.items
        .map(i => `§f${i.id.split(":")[1]?.replace(/_/g, " ")} §7×${i.amount}`)
        .join(", ");

    machine.setLabel([
        "§cNuclear Processor",
        `§bFluid In:  §f${formatFluidType(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
        `§eItems:     ${itemList}`,
        `§aFluid Out: §f${formatFluidType(recipe.output.type)} §7${FluidStorage.formatFluid(tankOut.get())} / ${FluidStorage.formatFluid(tankOut.getCap())}`,
        `§7Cost:      §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Time:      §f${recipe.seconds}s §7(base)`,
        `§7Queued:    §f${queued}`,
    ]);
}
