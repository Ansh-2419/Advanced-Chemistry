import { ItemStack } from "@minecraft/server";
import { Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import {
    processMachine,
    displayMachine,
    getMachineEnergyCost,
    stopMachine,
} from "./machine_helpers.js";
import { getAlloyForgeRecipes } from "../../config/recipes/machinery/alloy_forge.js";

// ── Slot layout ───────────────────────────────────────────────────────────────
//
//   [3] [4] [5]
//   [6] [7] [8]    →  progress [2]  →  output [12]
//   [9] [10][11]
//
//   0        Energy bar
//   1        Label / HUD
//   2        Progress arrow
//   3–11     9 input slots (8 surrounding + 1 big centre)
//   12       Output (alloy)
//   13–14    Upgrade slots
//   15–20    IO buttons (top, left, front, right, bottom, back)

const LABEL_SLOT    = 1;
const PROGRESS_SLOT = 2;
const INPUT_SLOTS   = [3, 4, 5, 6, 7, 8, 9, 10, 11];
const OUTPUT_SLOT   = 12;
const IO_SLOTS      = [15, 20];

const MACHINE_ID     = "utilitycraft:alloy_forge";
const DEFAULT_ENERGY = 150000;

// ── IO — per-slot coloured modes ──────────────────────────────────────────────
//
// Each face in the IO tab cycles through these modes.
// The id string is shown on the IO button, § codes give each slot a colour.
//
//   Slot  Position    Colour
//   3     Top-Left    §c Red
//   4     Top-Mid     §6 Orange
//   5     Top-Right   §e Yellow
//   6     Mid-Left    §a Green
//   7     Centre      §b Aqua
//   8     Mid-Right   §9 Blue
//   9     Bot-Left    §5 Dark Purple
//   10    Bot-Mid     §d Light Purple
//   11    Bot-Right   §f White
//
registerIOInterface(MACHINE_ID, {
    items: {
        buttonSlots:    IO_SLOTS,
        anyInputSlots:  INPUT_SLOTS,
        anyOutputSlots: [OUTPUT_SLOT],
        modes: [
            { id: "disabled"                                                 },
            // ── Individual input slots ──────────────────────────────────────
            { id: "§c■§r Top-Left",    inputSlots: [3]                      },
            { id: "§6■§r Top-Mid",     inputSlots: [4]                      },
            { id: "§e■§r Top-Right",   inputSlots: [5]                      },
            { id: "§a■§r Mid-Left",    inputSlots: [6]                      },
            { id: "§b■§r Centre",      inputSlots: [7]                      },
            { id: "§9■§r Mid-Right",   inputSlots: [8]                      },
            { id: "§5■§r Bot-Left",    inputSlots: [9]                      },
            { id: "§d■§r Bot-Mid",     inputSlots: [10]                     },
            { id: "§f■§r Bot-Right",   inputSlots: [11]                     },
            // ── Group modes ─────────────────────────────────────────────────
            { id: "§7■§r Corners",     inputSlots: [3, 5, 9, 11]            },
            { id: "§7■§r Edges",       inputSlots: [4, 6, 8, 10]            },
            { id: "§7■§r All Input",   inputSlots: INPUT_SLOTS              },
            // ── Output ──────────────────────────────────────────────────────
            { id: "§4■§r Output",      outputSlots: [OUTPUT_SLOT]           },
        ],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent(MACHINE_ID, {

    beforeOnPlayerPlace(event, { params: settings }) {
        if (!event.player) return;
        const placementEvent = /** @type {import("DoriosCore/index.js").PlacementEventLike} */ (event);
        Machine.spawnEntity(placementEvent, settings, () => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY);
            machine.blockSlots([PROGRESS_SLOT]);
            displayMachine(machine);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        machine.processIO();

        const recipes = getAlloyForgeRecipes();
        if (recipes.length === 0) return stopMachine(machine, "No Recipes");

        const recipe = findMatchingRecipe(machine.container, recipes);
        if (!recipe) return stopMachine(machine, "No Match");

        const outItem = machine.container.getItem(OUTPUT_SLOT);
        if (outItem) {
            const sameType = outItem.typeId === recipe.output.id;
            const hasSpace = outItem.amount + recipe.output.count <= (outItem.maxAmount ?? 64);
            if (!sameType || !hasSpace) return stopMachine(machine, "Output Full");
        }

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY);

        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost)
            return stopMachine(machine, "No Energy", { resetProgress: false });

        processMachine(machine, {
            energyCost,
            seconds:  recipe.seconds,
            maxRuns:  1,
            craft: () => {
                consumeInputs(machine.container, recipe);
                const existing = machine.container.getItem(OUTPUT_SLOT);
                if (existing && existing.typeId === recipe.output.id) {
                    existing.amount += recipe.output.count;
                    machine.container.setItem(OUTPUT_SLOT, existing);
                } else {
                    machine.container.setItem(OUTPUT_SLOT, new ItemStack(recipe.output.id, recipe.output.count));
                }
            },
        });

        if (machine.shouldUpdateUI) {
            const outName = recipe.output.id.split(":")[1].replace(/_/g, " ");
            const inputs  = recipe.inputs
                .map(i => `§7${i.id.split(":")[1].replace(/_/g, " ")} ×${i.amount}`)
                .join("\n");
            machine.setLabel([
                `§6§lAlloy Forge`,
                `§r§aForging: §f${outName} ×${recipe.output.count}`,
                inputs,
                `§cCost: §f${(energyCost / 1000).toFixed(0)} KDE`,
            ], LABEL_SLOT);
        }

        displayMachine(machine);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSlotTotals(container) {
    const totals = new Map();
    for (const slot of INPUT_SLOTS) {
        const item = container.getItem(slot);
        if (!item) continue;
        totals.set(item.typeId, (totals.get(item.typeId) ?? 0) + item.amount);
    }
    return totals;
}

function findMatchingRecipe(container, recipes) {
    const totals = getSlotTotals(container);
    return recipes.find(r =>
        r.inputs.every(req => (totals.get(req.id) ?? 0) >= req.amount)
    ) ?? null;
}

function consumeInputs(container, recipe) {
    const need = new Map(recipe.inputs.map(i => [i.id, i.amount]));
    for (const slot of INPUT_SLOTS) {
        const item = container.getItem(slot);
        if (!item) continue;
        const required = need.get(item.typeId) ?? 0;
        if (required <= 0) continue;
        const take = Math.min(required, item.amount);
        need.set(item.typeId, required - take);
        const left = item.amount - take;
        if (left <= 0) {
            container.setItem(slot, undefined);
        } else {
            item.amount = left;
            container.setItem(slot, item);
        }
    }
}