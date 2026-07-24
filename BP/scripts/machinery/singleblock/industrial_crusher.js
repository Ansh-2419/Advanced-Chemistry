import { ItemStack } from "@minecraft/server";
import { ButtonManager, Machine, registerIOInterface } from "../../DoriosCore/index.js";
import {
    chargeOrCraft,
    displayMachine,
    getMachineEnergyCost,
    stopMachine,
} from "./machine_helpers.js";
import { getCrusherRecipes, getStageOutput } from "../../config/recipes/machinery/crusher.js";

// ── Slot layout ───────────────────────────────────────────────────────────────
// 0       Energy bar        ($collection_index: 0)
// 1       Label / HUD
// 2       Progress arrow
// 3–6     2×2 Input grid
// 7–15    3×3 Output grid   (uc.slot_grid_3x3)
// 16      Stage 1 button    (1x → gravel)
// 17      Stage 2 button    (2x → dirt)
// 18      Stage 3 button    (3x → sand)
// 19–20   Upgrade slots
// 21–26   IO item slots

const PROGRESS_SLOT = 2;
const INPUT_SLOTS   = [3, 4, 5, 6];    // 2×2 input grid
const OUTPUT_SLOTS  = [7, 8, 9, 10, 11, 12, 13, 14, 15];  // 3×3 output grid
const STAGE_SLOTS   = [16, 17, 18];
const IO_SLOTS      = [21, 26];

const MACHINE_KEY    = "industrial_crusher";
const MACHINE_ID     = "utilitycraft:industrial_crusher";
const STAGE_PROP     = "aoc:crusher_stage";
const DEFAULT_ENERGY = 2_000;
const STAGES         = [1, 2, 3];
const STAGE_LABELS   = ["§f1x §7(Gravel)", "§f2x §7(Dirt)", "§f3x §7(Sand)"];

// ── IO ────────────────────────────────────────────────────────────────────────
registerIOInterface(MACHINE_ID, {
    items: {
        slots: IO_SLOTS,
        modes: ["disabled", "input", "output"],
    },
});

// ── Stage buttons — ButtonManager is a static class, safe to call at module load
for (let i = 0; i < STAGE_SLOTS.length; i++) {
    const stage = STAGES[i];
    ButtonManager.registerMachineButton(MACHINE_KEY, STAGE_SLOTS[i], ({ entity }) => {
        entity.setDynamicProperty(STAGE_PROP, stage);
        return stageLabel(stage, true);
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getStage(entity) {
    const v = entity.getDynamicProperty(STAGE_PROP);
    const n = Number(v ?? 1);
    return (n === 1 || n === 2 || n === 3) ? n : 1;
}

function stageLabel(stage, active = false) {
    const label = STAGE_LABELS[stage - 1] ?? `§f${stage}x`;
    return active ? `§a${label} §8(active)` : label;
}

function syncButtons(machine) {
    if (!machine.shouldUpdateUI) return;
    const active = getStage(machine.entity);
    for (let i = 0; i < STAGE_SLOTS.length; i++) {
        machine.setLabel(stageLabel(STAGES[i], STAGES[i] === active), STAGE_SLOTS[i]);
    }
}

function getOutputSpace(container, typeId) {
    return OUTPUT_SLOTS.reduce((total, s) => {
        const item = container.getItem(s);
        if (!item) return total + 64;
        if (item.typeId === typeId)
            return total + Math.max(0, (item.maxAmount ?? 64) - item.amount);
        return total;
    }, 0);
}

function removeFromInputSlot(container, slot, amount) {
    const item = container.getItem(slot);
    if (!item) return;
    if (item.amount <= amount) {
        container.setItem(slot, undefined);
    } else {
        item.amount -= amount;
        container.setItem(slot, item);
    }
}

function addToOutputSlots(container, typeId, count) {
    let left = count;
    for (const s of OUTPUT_SLOTS) {
        if (left <= 0) break;
        const item = container.getItem(s);
        if (!item || item.typeId !== typeId) continue;
        const add = Math.min((item.maxAmount ?? 64) - item.amount, left);
        if (add <= 0) continue;
        item.amount += add;
        container.setItem(s, item);
        left -= add;
    }
    for (const s of OUTPUT_SLOTS) {
        if (left <= 0) break;
        if (container.getItem(s)) continue;
        container.setItem(s, new ItemStack(typeId, Math.min(64, left)));
        left -= Math.min(64, left);
    }
}

// ── Block component ───────────────────────────────────────────────────────────
DoriosAPI.register.blockComponent("industrial_crusher", {
    beforeOnPlayerPlace(event, { params: settings }) {
        Machine.spawnEntity(event, settings, (entity) => {
            const machine = new Machine(event.block, { ...settings, ignoreTick: true });
            if (!machine.valid) return;
            entity.setDynamicProperty(STAGE_PROP, 1);
            machine.setEnergyCost(settings.machine?.energy_cost ?? DEFAULT_ENERGY);
            machine.blockSlots([PROGRESS_SLOT]);
            displayMachine(machine);
            ButtonManager.ensureWatching(entity, MACHINE_KEY);
        });
    },

    onTick({ block }, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        ButtonManager.ensureWatching(machine.entity, MACHINE_KEY);
        syncButtons(machine);

        machine.processIO({ items: { input_1: INPUT_SLOTS, output_1: OUTPUT_SLOTS } });

        const recipes = getCrusherRecipes();
        if (!recipes.length) return stopMachine(machine, "No Recipes");

        // Find the first input slot that has a matching recipe
        let inputItem = null;
        let inputSlot = -1;
        for (const s of INPUT_SLOTS) {
            const item = machine.container.getItem(s);
            if (item) { inputItem = item; inputSlot = s; break; }
        }
        if (!inputItem) return stopMachine(machine, "No Input");

        const recipe = recipes.find(r => r.input.id === inputItem.typeId);
        if (!recipe) return stopMachine(machine, "No Recipe");

        if (inputItem.amount < recipe.input.amount)
            return stopMachine(machine, `Need ×${recipe.input.amount}`);

        const stage  = getStage(machine.entity);
        const output = getStageOutput(recipe, stage);

        if (getOutputSpace(machine.container, output.id) < output.count)
            return stopMachine(machine, "Output Full");

        const energyCost = getMachineEnergyCost(settings, recipe, DEFAULT_ENERGY);

        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost)
            return stopMachine(machine, "No Energy", { resetProgress: false });

        if ((recipe.seconds ?? 0) > 0)
            machine.setRate(energyCost / recipe.seconds);

        chargeOrCraft(machine, energyCost, 1, () => {
            removeFromInputSlot(machine.container, inputSlot, recipe.input.amount);
            addToOutputSlots(machine.container, output.id, output.count);
        });

        if (machine.shouldUpdateUI) {
            const fmt = id => id.split(":")[1] ?? id;
            machine.setLabel([
                `§r§6Industrial Crusher`,
                `§r§bInput:  §f${fmt(recipe.input.id)}`,
                `§r§aOutput: §f${fmt(output.id)}`,
                `§r§eStage:  §f${stage}`,
            ]);
        }

        displayMachine(machine);
        machine.on();
    },

    onPlayerBreak(event) {
        Machine.onDestroy(event);
    },
});
