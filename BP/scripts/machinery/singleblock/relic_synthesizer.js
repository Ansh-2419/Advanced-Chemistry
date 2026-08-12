import { ItemStack } from "@minecraft/server";
import { Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { displayMachine, processMachine, stopMachine } from "./machine_helpers.js";
import {
    getDimFuel,
    rollRelicOutput,
} from "../../config/recipes/machinery/relic_synthesizer.js";

// ── Slot layout ────────────────────────────────────────────────────────────────
//  0      Energy bar         (collection_index: 0)
//  1      Label / HUD
//  2      Progress arrow
//  3      Input slot (1×1, 22×22 px)  ← diamond or netherite_ingot
//  4–12   Output grid 3×3             (uc.slot_grid_3x3, indices 1–9)
//  13–14  Upgrade slots               (speed / energy)
//  15–19  IO item interface slots     (top/left/front/right/bottom, back=19 shared)

const PROGRESS_SLOT = 2;
const INPUT_SLOT    = 3;
const OUTPUT_SLOTS  = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const IO_SLOTS      = [15, 20]; // inclusive range → slots 15,16,17,18,19,20 (6 faces)

const MACHINE_ID     = "utilitycraft:relic_synthesizer";
const DEFAULT_ENERGY = 25_000;

// ── IO Interface ──────────────────────────────────────────────────────────────
registerIOInterface(MACHINE_ID, {
    items: {
        buttonSlots: IO_SLOTS,
        anyInputSlots:  [INPUT_SLOT],
        anyOutputSlots: OUTPUT_SLOTS,
        modes: [
            { id: "disabled" },
            { id: "input_1",  inputSlots:  [INPUT_SLOT] },
            { id: "output_1", outputSlots: OUTPUT_SLOTS },
        ],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent(MACHINE_ID, {
    /** @param {import("@minecraft/server").BlockComponentPlayerPlaceBeforeEvent} event
     *  @param {{params: import("DoriosCore/index.js").MachineSettings}} context */
    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        const placementEvent = /** @type {import("DoriosCore/index.js").PlacementEventLike} */ (event);
        Machine.spawnEntity(placementEvent, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY);
            machine.blockSlots([PROGRESS_SLOT]);
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

        // ── Read input ──────────────────────────────────────────────────────
        const inputItem = machine.container.getItem(INPUT_SLOT);
        if (!inputItem) return machine.showWarning("No Input");

        const dimId     = block.dimension.id;
        const isSmith   = isSmithingTableRecipe(inputItem.typeId, inputItem.amount);
        const dimFuel   = getDimFuel(dimId);

        // Resolve which recipe applies
        let recipe;
        if (isSmith) {
            recipe = SMITHING_TABLE_RECIPE;
        } else if (dimFuel && inputItem.typeId === dimFuel.fuelId) {
            recipe = dimFuel;
        } else if (!dimFuel) {
            return machine.showWarning("Wrong Dimension");
        } else {
            return machine.showWarning(`Need ${dimFuel.fuelId.split(":")[1].replace(/_/g, " ")}`);
        }

        if (inputItem.amount < recipe.fuelAmount) {
            return machine.showWarning(`Need ×${recipe.fuelAmount}`);
        }

        // ── Check output space ──────────────────────────────────────────────
        if (!hasOutputSpace(machine.container)) {
            return machine.showWarning("Output Full");
        }

        // ── Energy cost ───────────────────────────────────────────────────────
        const energyCost = recipe.energyCost ?? DEFAULT_ENERGY;
        const seconds    = recipe.seconds ?? 20;

        // ── No energy check ──────────────────────────────────────────────────
        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return machine.showWarning("No Energy", { resetProgress: false });
        }

        // ── Gradual drain + craft via processMachine ─────────────────────────
        processMachine(machine, {
            energyCost,
            seconds,
            maxRuns: 1,
            craft: () => {
                consumeItem(machine.container, INPUT_SLOT, recipe.fuelAmount);
                const outputId = isSmith
                    ? SMITHING_TABLE_RECIPE.outputId
                    : rollRelicOutput(dimId);
                if (outputId) placeInOutputGrid(machine.container, outputId);
            },
        });

        // ── HUD ─────────────────────────────────────────────────────────────
        if (machine.shouldUpdateUI) {
            const dimLabel = isSmith
                ? "§fAny dimension"
                : (dimFuel?.dimLabel ?? dimId);

            const poolLabel = isSmith
                ? "§fSmithing Table §7(guaranteed)"
                : "§fRandom trim template";

            machine.setLabel([
                `§r§dRelic Synthesizer`,
                `§r§bDimension: §f${dimLabel}`,
                `§r§eFuel: §f${inputItem.typeId.split(":")[1].replace(/_/g, " ")} ×${recipe.fuelAmount}`,
                `§r§aOutput: ${poolLabel}`,
            ]);
        }

        displayMachine(machine);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if at least one output slot is empty or stackable.
 * @param {import("@minecraft/server").Container} container
 */
function hasOutputSpace(container) {
    for (const s of OUTPUT_SLOTS) {
        const item = container.getItem(s);
        if (!item) return true;
        if ((item.maxAmount ?? 64) - item.amount > 0) return true;
    }
    return false;
}

/**
 * Place one item into the output grid — stacks first, then empty slot.
 * @param {import("@minecraft/server").Container} container
 * @param {string} typeId
 */
function placeInOutputGrid(container, typeId) {
    for (const s of OUTPUT_SLOTS) {
        const existing = container.getItem(s);
        if (!existing || existing.typeId !== typeId) continue;
        const space = (existing.maxAmount ?? 64) - existing.amount;
        if (space > 0) {
            existing.amount += 1;
            container.setItem(s, existing);
            return;
        }
    }
    for (const s of OUTPUT_SLOTS) {
        if (!container.getItem(s)) {
            container.setItem(s, new ItemStack(typeId, 1));
            return;
        }
    }
}

/**
 * Remove `amount` items from the given slot.
 * @param {import("@minecraft/server").Container} container
 * @param {number} slot
 * @param {number} amount
 */
function consumeItem(container, slot, amount) {
    const item = container.getItem(slot);
    if (!item) return;
    const remaining = item.amount - amount;
    if (remaining <= 0) {
        container.setItem(slot, undefined);
    } else {
        item.amount = remaining;
        container.setItem(slot, item);
    }
}
