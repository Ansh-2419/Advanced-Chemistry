import * as DoriosLib    from "DoriosLib/index.js";
import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockMachine,
    registerLinkNodeIO,
}                        from "DoriosCore/index.js";
import { greenhousePlantsData } from "../../config/greenhouse/plants.js";
import { getProductivity }      from "../../config/greenhouse/fluids.js";
import { formatFluidDisplayName } from "./multiblock_helpers.js";

// ── Slot map ──────────────────────────────────────────────────────────────────
const ENERGY_SLOT    = 0;
const LABEL_SLOT     = 1;
const PROGRESS_SLOT  = 2;
const FERT_DISPLAY   = 3;
const GROWTH_DISPLAY = 4;
const SEED_SLOTS     = [5, 6, 7, 8];
const SOIL_SLOT      = 9;
const OUTPUT_SLOTS   = [10, 11, 12, 13, 14, 15, 16, 17, 18];
const INVENTORY_SIZE = 19;

// ── Constants ─────────────────────────────────────────────────────────────────
const FLUID_CAPACITY  = 64_000;
const ENERGY_CAPACITY = 200_000;
const EMPTY           = "empty";

// ── Soil registry ─────────────────────────────────────────────────────────────
const SOILS = {
    "minecraft:dirt":           { cost: 2,    multi: 1 },
    "minecraft:grass_block":    { cost: 1.5,  multi: 1 },
    "utilitycraft:yellow_soil": { cost: 1,    multi: 1 },
    "utilitycraft:red_soil":    { cost: 0.75, multi: 2 },
    "utilitycraft:blue_soil":   { cost: 0.5,  multi: 3 },
    "utilitycraft:black_soil":  { cost: 0.25, multi: 4 },
};

// ── Port requirements ─────────────────────────────────────────────────────────
const PORT_REQ = {
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
    fluid:  { min: 2, id: "utilitycraft:ind_fluid_port",  label: "Industrial Fluid Port"  },
    item:   { min: 1, id: "utilitycraft:ind_item_port",   label: "Industrial Item Port"   },
};

// ── Multiblock config ─────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.greenhouse",
    entity: {
        identifier:     "utilitycraft:greenhouse_multiblock",
        name:           "greenhouse_controller",
        inventory_size: INVENTORY_SIZE,
    },
    machine: {
        rate_speed_base: 100,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     2,
    },
    requirements: {},
};

// ── Link node IO ──────────────────────────────────────────────────────────────
registerLinkNodeIO("utilitycraft:greenhouse_controller", {
    liquids: {
        anyInputIndices:  [0, 1],
        anyOutputIndices: [],
        inputs: [
            { id: "any",    label: "Any Fluid Tank",       color: "§9", indices: [0, 1] },
            { id: "fert",   label: "Fertilizer Tank",      color: "§a", indices: [0]    },
            { id: "growth", label: "Growth Solution Tank", color: "§b", indices: [1]    },
        ],
        outputs: [],
    },
    items: {
        anyInputSlots:  [],
        anyOutputSlots: OUTPUT_SLOTS,
        inputs:  [],
        outputs: [
            { id: "harvest", label: "Harvest Output", color: "§c", slots: OUTPUT_SLOTS },
        ],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:greenhouse_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockMachine.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) {
                    initStorage(entity);
                    initProgress(entity);
                },

                onActivate({ entity, structure, player }) {
                    const { min, max } = structure.bounds;
                    const [sX, sY, sZ] = [max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1];

                    if (sX !== 5 || sY !== 5 || sZ !== 5) {
                        player.sendMessage(`§c[Greenhouse] Must be 5×5×5. Detected: ${sX}×${sY}×${sZ}.`);
                        return false;
                    }

                    const dim   = entity.dimension;
                    const found = { energy: 0, fluid: 0, item: 0 };
                    for (const tag of structure.inputBlocks) {
                        const loc   = DoriosLib.linkNode.parseLinkNodeTag(tag);
                        const block = loc && dim.getBlock(loc);
                        if (!block) continue;
                        if (block.typeId === PORT_REQ.energy.id) found.energy++;
                        if (block.typeId === PORT_REQ.fluid.id)  found.fluid++;
                        if (block.typeId === PORT_REQ.item.id)   found.item++;
                    }

                    for (const [key, req] of Object.entries(PORT_REQ)) {
                        if (found[key] < req.min) {
                            player.sendMessage(
                                `§c[Greenhouse] Needs ${req.min}× §e${req.label}§c — found ${found[key]}.`
                            );
                            return false;
                        }
                    }

                    initStorage(entity);
                    initProgress(entity);
                },

                successMessages: [
                    "§a[Greenhouse] Online — 5×5×5 confirmed.",
                    "§7Ports: §e1 Energy  §92 Fluid  §a1 Item",
                    `§7Fertilizer / Growth solution: §b${FluidStorage.formatFluid(FLUID_CAPACITY)} each`,
                    `§7Energy buffer: §e${EnergyStorage.formatEnergyToText(ENERGY_CAPACITY)}`,
                ],
            }
        );
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const machine = new MultiblockMachine(block, CONFIG);
        if (!machine.valid) return;

        const { energy, fertTank, growthTank } = initStorage(machine.entity);
        const inv = machine.container;
        initProgress(machine.entity);

        // ── Soil ──────────────────────────────────────────────────────────────
        const soilItem = inv.getItem(SOIL_SLOT);
        const soil     = soilItem ? SOILS[soilItem.typeId] : null;
        if (!soil) return display(machine, energy, fertTank, growthTank, "No Valid Soil");

        // ── Seed ──────────────────────────────────────────────────────────────
        let recipe = null;
        for (const slot of SEED_SLOTS) {
            const item = inv.getItem(slot);
            if (!item) continue;
            recipe = greenhousePlantsData[item.typeId];
            if (recipe) break;
        }
        if (!recipe) return display(machine, energy, fertTank, growthTank, "No Seed");

        // ── Energy ────────────────────────────────────────────────────────────
        if (energy.get() <= 0)
            return display(machine, energy, fertTank, growthTank, "No Energy");

        // ── Productivity ──────────────────────────────────────────────────────
        const prod       = getProductivity(fertTank.getType(), growthTank.getType());
        const energyCost = Math.max(1, Math.floor((recipe.cost * soil.cost) / prod.growthMultiplier));

        machine.setEnergyCost(energyCost);
        const progress = machine.getProgress();

        if (progress >= energyCost) {
            for (const loot of recipe.drops) {
                if (Math.random() > loot.chance) continue;
                const base = Array.isArray(loot.amount)
                    ? DoriosLib.math.randomInt(loot.amount[0], loot.amount[1])
                    : loot.amount;
                const qty = loot.scaleWithYield === false
                    ? base
                    : Math.max(1, Math.round(base * soil.multi * prod.yieldMultiplier));
                DoriosLib.entity.tryAddItem(machine.entity, { item: loot.item, amount: qty });
            }

            machine.addProgress(-energyCost);

            if (prod.fertConsumption > 0) {
                fertTank.consume(prod.fertConsumption);
                if (fertTank.get() <= 0) fertTank.setType(EMPTY);
            }
            if (prod.growthConsumption > 0) {
                growthTank.consume(prod.growthConsumption);
                if (growthTank.get() <= 0) growthTank.setType(EMPTY);
            }
        } else {
            const spend = Math.min(energy.get(), machine.rate, energyCost - progress);
            if (spend > 0) { energy.consume(spend); machine.addProgress(spend); }
        }

        machine.on();
        machine.displayProgress({ maxValue: energyCost, slot: PROGRESS_SLOT });
        display(machine, energy, fertTank, growthTank, "Growing");
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function initStorage(entity) {
    const [fertTank, growthTank] = FluidStorage.initializeMultiple(entity, 2);
    if (fertTank.getCap()   !== FLUID_CAPACITY) fertTank.setCap(FLUID_CAPACITY);
    if (growthTank.getCap() !== FLUID_CAPACITY) growthTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, fertTank, growthTank };
}

function initProgress(entity) {
    const inv = DoriosLib.entity.getInventory(entity);
    if (!inv || inv.getItem(PROGRESS_SLOT)) return;
    DoriosLib.entity.setNewItem(entity, {
        slot:    PROGRESS_SLOT,
        typeId:  "utilitycraft:progress_right_big_bar_00",
        nameTag: "",
    });
}

function display(machine, energy, fertTank, growthTank, status) {
    energy.display(ENERGY_SLOT);
    fertTank.display(FERT_DISPLAY);
    growthTank.display(GROWTH_DISPLAY);
    machine.setLabel([
        `§r§6Greenhouse §7— §f${status}`,
        `§r§eEnergy:     §f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
        `§r§aFertilizer: §f${formatFluidDisplayName(fertTank.getType())}  ${FluidStorage.formatFluid(fertTank.get())}`,
        `§r§bGrowth:     §f${formatFluidDisplayName(growthTank.getType())}  ${FluidStorage.formatFluid(growthTank.get())}`,
    ], LABEL_SLOT);
}