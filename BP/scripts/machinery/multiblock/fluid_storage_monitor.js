import {
    FluidStorage,
    Multiblock,
    MultiblockMachine,
} from "../../DoriosCore/index.js";
import { formatFluidDisplayName } from "./multiblock_helpers.js";

const TANK_COUNT = 7;
const CAPACITY_PER_AIR_BLOCK = 64_000;
const DISPLAY_SLOTS = [0, 1, 2, 3, 4, 5, 6];
const LABEL_SLOT = 7;
const CAPACITY_PROPERTY = "ac:fluid_storage_capacity";

const CONFIG = {
    required_case: "dorios:multiblock.case.fluid_storage",
    entity: {
        identifier: "utilitycraft:fluid_storage_multiblock",
        name: "fluid_storage_monitor",
        inventory_size: 8,
    },
    machine: {
        rate_speed_base: 0,
        energy_cap: 0,
    },
    requirements: {},
};

DoriosAPI.register.blockComponent("fluid_storage_monitor", {
    onPlayerInteract(event) {
        return MultiblockMachine.handlePlayerInteract(event, CONFIG, {
            initializeEntity(entity) {
                configureTanks(entity, CAPACITY_PER_AIR_BLOCK);
            },
            onActivate({ entity, structure }) {
                const capacity = getStructureCapacity(structure);
                configureTanks(entity, capacity);
                entity.setDynamicProperty(CAPACITY_PROPERTY, capacity);
            },
            successMessages({ structure }) {
                const capacity = getStructureCapacity(structure);
                return [
                    "\u00A7a[Fluid Storage] Structure online.",
                    `\u00A77Capacity per tank: \u00A7b${FluidStorage.formatFluid(capacity)}`,
                    `\u00A77Total capacity: \u00A7b${FluidStorage.formatFluid(capacity * TANK_COUNT)}`,
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

        const capacity = machine.entity.getDynamicProperty(CAPACITY_PROPERTY)
            ?? CAPACITY_PER_AIR_BLOCK;
        const tanks = configureTanks(machine.entity, capacity);

        tanks.forEach((tank, index) => tank.display(DISPLAY_SLOTS[index]));
        updateLabel(machine, tanks);
    },
});

function getStructureCapacity(structure) {
    return Math.max(1, structure.components?.air ?? 0) * CAPACITY_PER_AIR_BLOCK;
}
function configureTanks(entity, capacity) {
    const tanks = FluidStorage.initializeMultiple(entity, TANK_COUNT);
    for (const tank of tanks) {
        if (tank.getCap() !== capacity) tank.setCap(capacity);
    }
    return tanks;
}

function updateLabel(machine, tanks) {
    const stored = tanks.reduce((total, tank) => total + tank.get(), 0);
    const capacity = tanks.reduce((total, tank) => total + tank.getCap(), 0);
    const contents = tanks
        .filter((tank) => tank.get() > 0 && tank.getType() !== "empty")
        .map((tank) =>
            `\u00A7r\u00A7b${formatFluidDisplayName(tank.getType())} \u00A7f${FluidStorage.formatFluid(tank.get())}`
        );

    machine.setLabel([
        "\u00A7r\u00A76Fluid Storage \u00A7aOnline",
        `\u00A7r\u00A77Stored: \u00A7f${FluidStorage.formatFluid(stored)} / ${FluidStorage.formatFluid(capacity)}`,
        ...(contents.length > 0 ? contents : ["\u00A7r\u00A78All tanks empty"]),
    ], LABEL_SLOT);
}
