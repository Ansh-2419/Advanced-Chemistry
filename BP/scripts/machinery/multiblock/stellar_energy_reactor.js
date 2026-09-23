import {
    EnergyStorage,
    Multiblock,
    MultiblockGenerator,
} from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { ItemStack } from "@minecraft/server";

// ── Constants ─────────────────────────────────────────────────────────────────
const NETHER_STAR_ID   = "minecraft:nether_star";
const DEAD_STAR_ID     = "utilitycraft:dead_star";
const DEAD_STAR_CHANCE = 0.20;

const ENERGY_PER_CYCLE = 75_000;
const ENERGY_CAPACITY  = 50_000_000;
const BASE_CYCLE_TICKS = 200;
const THROTTLE_AT      = 0.95;

const PROGRESS_FRAMES  = 23;
const PROGRESS_ITEM    = "utilitycraft:progress_right_big_bar";

const ENERGY_SLOT      = 0;
const LABEL_SLOT       = 1;
const PROGRESS_SLOT    = 2;
const INPUT_SLOT       = 3;
const OUTPUT_SLOT      = 4;

const TICK_PROP        = "ac:ser_tick";

// ── Port requirements ─────────────────────────────────────────────────────────
const PORT_REQ = {
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:stellar_energy_reactor_multiblock",
        name:           "stellar_energy_reactor_multiblock",
        inventory_size: 5,
    },
    generator: {
        rate_speed_base: ENERGY_PER_CYCLE / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
    },
    requirements: {},
};

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:stellar_energy_reactor_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockGenerator.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) {
                    initStorage(entity);
                },

                onActivate({ entity, structure, player }) {
                    const { min, max } = structure.bounds;
                    const sX = max.x - min.x + 1;
                    const sY = max.y - min.y + 1;
                    const sZ = max.z - min.z + 1;

                    if (sX !== 3 || sY !== 3 || sZ !== 3) {
                        player.sendMessage(`§c[Stellar Energy Reactor] Must be 3×3×3. Found: ${sX}×${sY}×${sZ}.`);
                        return false;
                    }

                    const dim   = entity.dimension;
                    const found = { energy: 0 };
                    for (const tag of structure.inputBlocks) {
                        const loc   = DoriosLib.linkNode.parseLinkNodeTag(tag);
                        const block = loc && dim.getBlock(loc);
                        if (!block) continue;
                        if (block.typeId === PORT_REQ.energy.id) found.energy++;
                    }

                    for (const [key, req] of Object.entries(PORT_REQ)) {
                        if (found[key] < req.min) {
                            player.sendMessage(`§c[Stellar Energy Reactor] Need ${req.min}x §e${req.label}§c, found ${found[key]}.`);
                            return false;
                        }
                    }

                    initStorage(entity);
                },

                successMessages: [
                    "§a[Stellar Energy Reactor] Online — 3×3×3 confirmed.",
                    "§7Input: §fNether Star (place in slot)",
                    `§7Output: §e5 MDE §7per star consumed`,
                    "§720% chance of §bDead Star §7byproduct per cycle",
                ],
            }
        );
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const reactor = new MultiblockGenerator(block, CONFIG);
        if (!reactor.valid) return;
        if (reactor.entity.getDynamicProperty("dorios:state") !== "on") return;

        const energy = initStorage(reactor.entity);
        energy.transferToNetwork(reactor.rate);

        const inv = reactor.entity.getComponent("minecraft:inventory")?.container;
        if (!inv) return;

        const inputItem = inv.getItem(INPUT_SLOT);

        if (!inputItem || inputItem.typeId !== NETHER_STAR_ID) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, "§cNo Fuel");
            return;
        }

        if (energy.get() / Math.max(1, energy.getCap()) >= THROTTLE_AT) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, "§6Buffer Full");
            return;
        }

        const outputItem = inv.getItem(OUTPUT_SLOT);
        const outputFull = outputItem != null
            && !(outputItem.typeId === DEAD_STAR_ID && outputItem.amount < 64);

        if (outputFull) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, "§cOutput Full");
            return;
        }

        const tick = ((reactor.entity.getDynamicProperty(TICK_PROP) ?? 0) + 1);
        reactor.entity.setDynamicProperty(TICK_PROP, tick % BASE_CYCLE_TICKS);
        setProgress(reactor.entity, tick % BASE_CYCLE_TICKS, BASE_CYCLE_TICKS);

        if (tick % BASE_CYCLE_TICKS === 0) {
            const newAmount = inputItem.amount - 1;
            if (newAmount <= 0) {
                inv.setItem(INPUT_SLOT, undefined);
            } else {
                inv.setItem(INPUT_SLOT, new ItemStack(NETHER_STAR_ID, newAmount));
            }

            energy.add(ENERGY_PER_CYCLE);

            if (Math.random() < DEAD_STAR_CHANCE) {
                const existing = inv.getItem(OUTPUT_SLOT);
                if (existing && existing.typeId === DEAD_STAR_ID && existing.amount < 64) {
                    inv.setItem(OUTPUT_SLOT, new ItemStack(DEAD_STAR_ID, existing.amount + 1));
                } else if (!existing) {
                    inv.setItem(OUTPUT_SLOT, new ItemStack(DEAD_STAR_ID, 1));
                }
            }
        }

        display(reactor, energy, "§aConverting");
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function initStorage(entity) {
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return energy;
}

function setProgress(entity, tick, cycleTicks) {
    const inv = entity.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const frame    = Math.min(PROGRESS_FRAMES - 1, Math.floor((tick / cycleTicks) * PROGRESS_FRAMES));
    const frameStr = frame.toString().padStart(2, "0");
    const item     = new ItemStack(`${PROGRESS_ITEM}_${frameStr}`, 1);
    item.nameTag   = "§r";
    inv.setItem(PROGRESS_SLOT, item);
}

function display(reactor, energy, status) {
    energy.display(ENERGY_SLOT);
    reactor.setLabel([
        `§6Stellar Reactor §7| ${status}`,
        `§eFuel: §fNether Star`,
        `§eYield: §f50 KDE §7per star`,
        `§bByproduct: §fDead Star`,
        `§eBuffer: §f${EnergyStorage.formatEnergyToText(energy.get())} / ${EnergyStorage.formatEnergyToText(energy.getCap())}`,
    ], LABEL_SLOT);
}