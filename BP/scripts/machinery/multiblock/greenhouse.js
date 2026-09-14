import { ItemStack }    from "@minecraft/server";
import * as DoriosLib   from "DoriosLib/index.js";
import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockMachine,
    registerLinkNodeIO,
}                       from "DoriosCore/index.js";
import { greenhousePlantsData }               from "../../config/greenhouse/plants.js";
import { getProductivity, VALID_FERTILIZERS,
         VALID_GROWTH_FLUIDS }                from "../../config/greenhouse/fluids.js";
import { formatFluidDisplayName }             from "./multiblock_helpers.js";

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
    "minecraft:dirt":           { cost: 2,    multi: 1, label: "Dirt"        },
    "minecraft:grass_block":    { cost: 1.5,  multi: 1, label: "Grass Block" },
    "utilitycraft:yellow_soil": { cost: 1,    multi: 1, label: "Yellow Soil" },
    "utilitycraft:red_soil":    { cost: 0.75, multi: 2, label: "Red Soil"    },
    "utilitycraft:blue_soil":   { cost: 0.5,  multi: 3, label: "Blue Soil"   },
    "utilitycraft:black_soil":  { cost: 0.25, multi: 4, label: "Black Soil"  },
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

        const { energy, tank0, tank1 } = initStorage(machine.entity);
        const { fertTank, growthTank }  = resolveTanks(tank0, tank1);
        const inv = machine.container;
        initProgress(machine.entity);

        // ── Soil ──────────────────────────────────────────────────────────────
        const soilItem = inv.getItem(SOIL_SLOT);
        const soil     = soilItem ? SOILS[soilItem.typeId] : null;

        if (!soil) {
            display(machine, energy, fertTank, growthTank, inv, null, [], "No Soil");
            return;
        }

        // ── Seeds ─────────────────────────────────────────────────────────────
        const activeSeeds = [];
        for (const slot of SEED_SLOTS) {
            const item = inv.getItem(slot);
            if (!item) continue;
            const recipe = greenhousePlantsData[item.typeId];
            if (recipe) activeSeeds.push(recipe);
        }

        if (activeSeeds.length === 0) {
            display(machine, energy, fertTank, growthTank, inv, soil, [], "No Seeds");
            return;
        }

        // ── Output full ───────────────────────────────────────────────────────
        if (isOutputFull(inv)) {
            display(machine, energy, fertTank, growthTank, inv, soil, activeSeeds, "Output Full");
            return;
        }

        // ── Energy ────────────────────────────────────────────────────────────
        if (energy.get() <= 0) {
            display(machine, energy, fertTank, growthTank, inv, soil, activeSeeds, "No Energy");
            return;
        }

        // ── Productivity ──────────────────────────────────────────────────────
        const prod = getProductivity(fertTank.getType(), growthTank.getType());

        const totalEnergyCost = activeSeeds.reduce((sum, recipe) =>
            sum + Math.max(1, Math.floor((recipe.cost * soil.cost) / prod.growthMultiplier)), 0
        );

        machine.setEnergyCost(totalEnergyCost);
        const progress = machine.getProgress();

        if (progress >= totalEnergyCost) {
            for (const recipe of activeSeeds) {
                for (const loot of recipe.drops) {
                    if (Math.random() > loot.chance) continue;
                    const base = Array.isArray(loot.amount)
                        ? DoriosLib.math.randomInt(loot.amount[0], loot.amount[1])
                        : loot.amount;
                    const qty = loot.scaleWithYield === false
                        ? base
                        : Math.max(1, Math.round(base * soil.multi * prod.yieldMultiplier));
                    addToOutputSlots(inv, loot.item, qty);
                }
            }

            machine.addProgress(-totalEnergyCost);

            const seedCount = activeSeeds.length;
            if (prod.fertConsumption > 0) {
                fertTank.consume(prod.fertConsumption * seedCount);
                if (fertTank.get() <= 0) fertTank.setType(EMPTY);
            }
            if (prod.growthConsumption > 0) {
                growthTank.consume(prod.growthConsumption * seedCount);
                if (growthTank.get() <= 0) growthTank.setType(EMPTY);
            }
        } else {
            const spend = Math.min(energy.get(), machine.rate, totalEnergyCost - progress);
            if (spend > 0) { energy.consume(spend); machine.addProgress(spend); }
        }

        machine.on();
        machine.displayProgress({ maxValue: totalEnergyCost, slot: PROGRESS_SLOT });
        display(machine, energy, fertTank, growthTank, inv, soil, activeSeeds,
            `Active ×${activeSeeds.length}`);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function initStorage(entity) {
    const [tank0, tank1] = FluidStorage.initializeMultiple(entity, 2);
    if (tank0.getCap() !== FLUID_CAPACITY) tank0.setCap(FLUID_CAPACITY);
    if (tank1.getCap() !== FLUID_CAPACITY) tank1.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, tank0, tank1 };
}

/**
 * Detects which physical tank holds fertilizer and which holds growth solution,
 * regardless of how the player configured the fluid ports.
 */
function resolveTanks(a, b) {
    const aType = a.getType();
    const bType = b.getType();
    if (VALID_FERTILIZERS.has(aType) || VALID_GROWTH_FLUIDS.has(bType))
        return { fertTank: a, growthTank: b };
    if (VALID_GROWTH_FLUIDS.has(aType) || VALID_FERTILIZERS.has(bType))
        return { fertTank: b, growthTank: a };
    return { fertTank: a, growthTank: b };
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

function isOutputFull(container) {
    for (const slot of OUTPUT_SLOTS) {
        const item = container.getItem(slot);
        if (!item || item.amount < item.maxAmount) return false;
    }
    return true;
}

function addToOutputSlots(container, typeId, qty) {
    let remaining = qty;
    for (const slot of OUTPUT_SLOTS) {
        if (remaining <= 0) break;
        const existing = container.getItem(slot);
        if (!existing || existing.typeId !== typeId) continue;
        const space = existing.maxAmount - existing.amount;
        if (space <= 0) continue;
        const add = Math.min(space, remaining);
        existing.amount += add;
        container.setItem(slot, existing);
        remaining -= add;
    }
    for (const slot of OUTPUT_SLOTS) {
        if (remaining <= 0) break;
        if (container.getItem(slot)) continue;
        const stack = new ItemStack(typeId, Math.min(remaining, 64));
        container.setItem(slot, stack);
        remaining -= stack.amount;
    }
}

/** "utilitycraft:coal_seeds" → "Coal Seeds", "minecraft:oak_sapling" → "Oak Sapling" */
function formatItemName(typeId) {
    const local = typeId.split(":")[1] ?? typeId;
    return local.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** Count how many output slots still have space. */
function outputSlotsAvailable(container) {
    let free = 0;
    for (const slot of OUTPUT_SLOTS) {
        const item = container.getItem(slot);
        if (!item || item.amount < item.maxAmount) free++;
    }
    return free;
}

function display(machine, energy, fertTank, growthTank, inv, soil, activeSeeds, status) {
    energy.display(ENERGY_SLOT);
    fertTank.display(FERT_DISPLAY);
    growthTank.display(GROWTH_DISPLAY);

    const E  = EnergyStorage.formatEnergyToText;
    const FL = FluidStorage.formatFluid;

    // ── Seed rows (always show all 4 slots) ───────────────────────────────────
    const seedLines = SEED_SLOTS.map((slot, i) => {
        const item = inv?.getItem(slot);
        const recipe = item ? greenhousePlantsData[item.typeId] : null;
        if (recipe) return `§a▶ §fSlot ${i + 1}: §e${formatItemName(item.typeId)}`;
        return          `§7▷ §8Slot ${i + 1}: Empty`;
    });

    // ── Output usage ──────────────────────────────────────────────────────────
    const freeSlots = inv ? outputSlotsAvailable(inv) : 9;
    const outputLine = freeSlots === 0
        ? `§cOutput: FULL §7(9/9 used)`
        : `§7Output: §f${9 - freeSlots}§7/9 used  §a${freeSlots} free`;

    // ── Fluid lines ───────────────────────────────────────────────────────────
    const fertType   = fertTank.getType();
    const growthType = growthTank.getType();
    const fertLabel   = fertType === EMPTY   ? "§8Empty"  : `§f${formatFluidDisplayName(fertType)}`;
    const growthLabel = growthType === EMPTY ? "§8Empty" : `§f${formatFluidDisplayName(growthType)}`;

    // ── Soil line ─────────────────────────────────────────────────────────────
    const soilLine = soil
        ? `§7Soil: §f${soil.label} §7(×${soil.multi} yield, ×${soil.cost} cost)`
        : `§7Soil: §cNone`;

    machine.setLabel([
        // nameTag — kept ≤ 18 visible chars to avoid panel truncation
        `§6Greenhouse §7| §f${status}`,

        // lore lines
        `§r§eEnergy: §f${E(energy.get())} §7/ §f${E(energy.getCap())}`,
        `§r§aFert:   ${fertLabel} §7${FL(fertTank.get())}`,
        `§r§bGrowth: ${growthLabel} §7${FL(growthTank.get())}`,
        `§r${soilLine}`,
        `§r${outputLine}`,
        `§r§7─────────────────`,
        `§r§7Seeds:`,
        ...seedLines.map(l => `§r${l}`),
    ], LABEL_SLOT);
}