import { ItemStack } from "@minecraft/server";
import { Machine, registerIOInterface } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { displayMachine, processMachine, stopMachine } from "./machine_helpers.js";
import {
    DIM,
    getDimFuel,
    rollRelicOutput,
} from "../../config/recipes/machinery/relic_synthesizer.js";

const PROGRESS_SLOT = 2;
const INPUT_SLOT    = 3;
const OUTPUT_SLOTS  = [4, 5, 6, 7, 8, 9, 10, 11, 12];
const IO_SLOTS      = [15, 20];

const MACHINE_ID     = "utilitycraft:relic_synthesizer";
const VISUAL_ID      = "aoc:relic_synthesizer_visual";
const DEFAULT_ENERGY = 25_000;

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

        const isOn = block.permutation.getState("utilitycraft:on");
        if (isOn && !getVisualEntity(block)) spawnVisualEntity(block);
        if (!isOn && getVisualEntity(block)) despawnVisualEntity(block);

        machine.processIO();

        const inputItem = machine.container.getItem(INPUT_SLOT);
        if (!inputItem) return stopMachine(machine, "No Input");

        const dimId   = block.dimension.id;
        const dimFuel = getDimFuel(dimId);

        if (!dimFuel) return stopMachine(machine, "Wrong Dimension");

        if (inputItem.typeId !== dimFuel.fuelId) {
            const needed = dimFuel.fuelId.split(":")[1].replace(/_/g, " ");
            return stopMachine(machine, `Need ${needed}`);
        }

        if (inputItem.amount < dimFuel.fuelAmount) {
            return stopMachine(machine, `Need x${dimFuel.fuelAmount}`);
        }

        if (!hasOutputSpace(machine.container)) {
            return stopMachine(machine, "Output Full");
        }

        const energyCost = dimFuel.energyCost ?? DEFAULT_ENERGY;
        const seconds    = dimFuel.seconds ?? 20;

        if (machine.energy.get() <= 0 && machine.getProgress() < energyCost) {
            return stopMachine(machine, "No Energy", { resetProgress: false });
        }

        processMachine(machine, {
            energyCost,
            seconds,
            maxRuns: 1,
            craft: () => {
                consumeItem(machine.container, INPUT_SLOT, dimFuel.fuelAmount);
                const outputId = rollRelicOutput(dimId);
                if (outputId) placeInOutputGrid(machine.container, outputId);
            },
        });

        if (machine.shouldUpdateUI) {
            machine.setLabel([
                `§r§dRelic Synthesizer`,
                `§r§bDimension: §f${dimFuel.dimLabel}`,
                `§r§eFuel: §f${inputItem.typeId.split(":")[1].replace(/_/g, " ")} x${dimFuel.fuelAmount}`,
                `§r§aOutput: §fRandom trim template`,
            ]);
        }

        displayMachine(machine);
        machine.on();
    },

    onPlayerBreak(event) {
        despawnVisualEntity(event.block);
        Machine.onDestroy(event);
    },
});

// ── Visual entity helpers ─────────────────────────────────────────────────────

function getVisualEntity(block) {
    const hits = block.dimension.getEntities({
        type: VISUAL_ID,
        location: { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 },
        maxDistance: 1.5,
    });
    return hits[0] ?? null;
}

function spawnVisualEntity(block) {
    block.dimension.spawnEntity(VISUAL_ID, {
        x: block.location.x + 0.5,
        y: block.location.y - 0.1,
        z: block.location.z + 0.5,
    });
}

function despawnVisualEntity(block) {
    const e = getVisualEntity(block);
    if (e?.isValid()) e.addTag("despawn");
}

// ── Container helpers ─────────────────────────────────────────────────────────

function hasOutputSpace(container) {
    for (const s of OUTPUT_SLOTS) {
        const item = container.getItem(s);
        if (!item) return true;
        if ((item.maxAmount ?? 64) - item.amount > 0) return true;
    }
    return false;
}

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
