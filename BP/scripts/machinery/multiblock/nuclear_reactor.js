import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
    registerLinkNodeIO,
}from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";
import { ItemStack }  from "@minecraft/server";
import { initFluidTanks, initEnergy, lockTankSlot, guardTank, validateStructure } from "../helper/helper.js";

// ── Coolant registry ──────────────────────────────────────────────────────────
// Each coolant provides a speed multiplier.
// All coolants require 3 buckets (3000 mB) per cycle.
// If coolant is insufficient, process slows and energy output drops 20% per missing bucket.
const COOLANTS = {
    water:          { speedMultiplier: 1.0, label: "Water"   },
    saline_coolant: { speedMultiplier: 1.5, label: "Saline"  },
    liquid_nitrogen:{ speedMultiplier: 2.0, label: "Liq. N2" },
};

const VALID_COOLANTS       = new Set(Object.keys(COOLANTS));
const COOLANT_PER_CYCLE    = 3_000;  // 3 buckets
const ENERGY_PENALTY_RATE  = 0.20;   // 20% less energy per missing bucket

// ── Reaction constants ────────────────────────────────────────────────────────
// 100 kDE per 1 bucket of thorium → 100 DE/mB
// Cycle processes 50 mB thorium → 5000 DE per cycle (base)
const THORIUM_TYPE       = "liquified_thorium";
const WASTE_TYPE         = "nuclear_waste";
const THORIUM_PER_CYCLE  = 1000;           // mB per cycle
const ENERGY_PER_CYCLE   = 1_00_000;        // DE per cycle (100 kDE / 1000 mB * 50 mB)
const WASTE_PER_CYCLE    = 500;           // mB waste per cycle
const BASE_CYCLE_TICKS   = 400;          // ticks at ×1.0 coolant
const NO_COOLANT_SPEED   = 0.3;          // 30% speed penalty with no coolant
const FLUID_CAPACITY     = 64_000;
const ENERGY_CAPACITY    = 5_000_000;
const THROTTLE_AT        = 0.95;
const EMPTY              = "empty";
const TICK_PROP          = "ac:nr_tick";
const THORIUM_LOCK_TAG   = "ac:nr_tank0_locked";
const COOLANT_LOCK_TAG   = "ac:nr_tank1_locked";

// ── Progress bar ──────────────────────────────────────────────────────────────
const PROGRESS_FRAMES = 23;   // _00 to _22
const PROGRESS_ITEM   = "utilitycraft:progress_right_big_bar";

// ── Slot map ──────────────────────────────────────────────────────────────────
const ENERGY_SLOT   = 0;
const LABEL_SLOT    = 1;
const PROGRESS_SLOT = 2;
const COOLANT_SLOT  = 3;
const THORIUM_SLOT  = 4;
const WASTE_SLOT    = 5;

// ── Structure requirements ────────────────────────────────────────────────────
const SIZE         = { x: 3, y: 3, z: 3 };
const PORTS        = { energy: 1, fluid: 2 };

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:nuclear_reactor_multiblock",
        name:           "nuclear_reactor_multiblock",
        inventory_size: 6,
    },
    generator: {
        rate_speed_base: ENERGY_PER_CYCLE / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     3,
    },
    requirements: {},
};

// ── Link node IO ──────────────────────────────────────────────────────────────
registerLinkNodeIO("utilitycraft:nuclear_reactor_controller", {
    liquids: {
        anyInputIndices:  [0, 1],
        anyOutputIndices: [2],
        inputs: [
            { id: "thorium", label: "Thorium (slot 0)", color: "§e", indices: [0]    },
            { id: "coolant", label: "Coolant (slot 1)", color: "§b", indices: [1]    },
            { id: "any_in",  label: "Any Input",        color: "§9", indices: [0, 1] },
        ],
        outputs: [
            { id: "waste",   label: "Waste Output",     color: "§2", indices: [2]    },
        ],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:nuclear_reactor_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockGenerator.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) {
                    initStorage(entity);
                    lockTanks(entity);
                },

                onActivate({ entity, structure, player }) {
                    if (validateStructure(entity, structure, player, {
                        name: "Nuclear Reactor", size: SIZE, ports: PORTS, noAir: true,
                    })) return false;

                    initStorage(entity);
                    lockTanks(entity);
                },

                successMessages: [
                    "§a[Nuclear Reactor] Online — 3×3×3 confirmed.",
                    "§7Slot 0: §eLiquified Thorium  §7Slot 1: §bCoolant",
                    "§7Output: §e100 kDE/bucket thorium",
                    "§7Coolant: §b3 buckets/cycle §7— short supply = §cslower + less energy",
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

        const { energy, thoriumTank, coolantTank, wasteTank } = initStorage(reactor.entity);
        lockTanks(reactor.entity);
        guardTank(thoriumTank, THORIUM_TYPE);
        guardTank(coolantTank, VALID_COOLANTS);

        // ── Transfer buffered energy to network ───────────────────────────────
        energy.transferToNetwork(reactor.rate);

        // ── Thorium check ─────────────────────────────────────────────────────
        const thoriumAmt = thoriumTank.get();
        if (thoriumTank.getType() !== THORIUM_TYPE || thoriumAmt < THORIUM_PER_CYCLE) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, thoriumTank, coolantTank, wasteTank,
                thoriumAmt <= 0 ? "§cNo Fuel" : "§cLow Fuel", null, 0, 1.0);
            return;
        }

        // ── Buffer / waste checks ─────────────────────────────────────────────
        if (energy.get() / Math.max(1, energy.getCap()) >= THROTTLE_AT) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, thoriumTank, coolantTank, wasteTank,
                "§6Buffer Full", null, 0, 1.0);
            return;
        }
        if (wasteTank.getFreeSpace() < WASTE_PER_CYCLE) {
            setProgress(reactor.entity, 0, 1);
            display(reactor, energy, thoriumTank, coolantTank, wasteTank,
                "§cWaste Full", null, 0, 1.0);
            return;
        }

        // ── Coolant calculation ───────────────────────────────────────────────
        const coolantType = coolantTank.getType();
        const coolantCfg  = COOLANTS[coolantType] ?? null;

        // How many full buckets of coolant are available (capped at 3)
        const availableBuckets   = coolantType === EMPTY ? 0 :
            Math.min(3, Math.floor(coolantTank.get() / 1_000));
        const missingBuckets     = 3 - availableBuckets;

        // Speed: full coolant = coolant's speedMultiplier, no coolant = NO_COOLANT_SPEED
        // Partial: interpolate between penalty and full speed
        const fullSpeed   = coolantCfg?.speedMultiplier ?? NO_COOLANT_SPEED;
        const speedMult   = availableBuckets === 0
            ? NO_COOLANT_SPEED
            : NO_COOLANT_SPEED + (fullSpeed - NO_COOLANT_SPEED) * (availableBuckets / 3);

        // Energy output: 20% penalty per missing bucket
        const energyMult  = Math.max(0.2, 1 - missingBuckets * ENERGY_PENALTY_RATE);
        const energyOut   = Math.floor(ENERGY_PER_CYCLE * energyMult);

        // Cycle duration
        const cycleTicks  = Math.max(1, Math.floor(BASE_CYCLE_TICKS / speedMult));

        // ── Tick counter ──────────────────────────────────────────────────────
        const tick = ((reactor.entity.getDynamicProperty(TICK_PROP) ?? 0) + 1);
        reactor.entity.setDynamicProperty(TICK_PROP, tick % cycleTicks);
        setProgress(reactor.entity, tick % cycleTicks, cycleTicks);

        if (tick % cycleTicks === 0) {
            // ── Reaction fires ────────────────────────────────────────────────
            thoriumTank.consume(THORIUM_PER_CYCLE);
            if (thoriumTank.get() <= 0) thoriumTank.setType(THORIUM_TYPE);

            // Consume however much coolant is available (up to 3 buckets)
            if (coolantCfg && availableBuckets > 0) {
                const toConsume = availableBuckets * 1_000;
                coolantTank.consume(toConsume);
                if (coolantTank.get() <= 0) coolantTank.setType(EMPTY);
            }

            energy.add(energyOut);

            if (wasteTank.getType() === EMPTY) wasteTank.setType(WASTE_TYPE);
            wasteTank.add(WASTE_PER_CYCLE);
        }

        // ── Status string ─────────────────────────────────────────────────────
        let status;
        if (missingBuckets > 0 && availableBuckets > 0) {
            status = `§eLow Coolant §7(-${(missingBuckets * 20)}% energy)`;
        } else if (availableBuckets === 0) {
            status = `§cNo Coolant §7(×${NO_COOLANT_SPEED} speed, -60% energy)`;
        } else {
            status = "§aReacting";
        }

        display(reactor, energy, thoriumTank, coolantTank, wasteTank,
            status, coolantCfg, missingBuckets, energyMult);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function initStorage(entity) {
    const [thoriumTank, coolantTank, wasteTank] = initFluidTanks(entity, 3, FLUID_CAPACITY);
    const energy = initEnergy(entity, ENERGY_CAPACITY);
    return { energy, thoriumTank, coolantTank, wasteTank };
}

function lockTanks(entity) {
    lockTankSlot(entity, THORIUM_LOCK_TAG, 0, THORIUM_TYPE);
    lockTankSlot(entity, COOLANT_LOCK_TAG, 1, null);
}

function setProgress(entity, tick, cycleTicks) {
    const inv = entity.getComponent("minecraft:inventory")?.container;
    if (!inv) return;
    const frame = Math.min(PROGRESS_FRAMES - 1,
        Math.floor((tick / cycleTicks) * PROGRESS_FRAMES));
    const frameStr = frame.toString().padStart(2, "0");
    const item = new ItemStack(`${PROGRESS_ITEM}_${frameStr}`, 1);
    item.nameTag = "§r";
    inv.setItem(PROGRESS_SLOT, item);
}

function display(reactor, energy, thoriumTank, coolantTank, wasteTank,
                 status, coolantCfg, missingBuckets, energyMult) {
    energy.display(ENERGY_SLOT);
    thoriumTank.display(THORIUM_SLOT);
    coolantTank.display(COOLANT_SLOT);
    wasteTank.display(WASTE_SLOT);

    const FL = FluidStorage.formatFluid;
    const E  = EnergyStorage.formatEnergyToText;

    const coolantType = coolantTank.getType();
    const coolantLine = coolantCfg
        ? `§f${coolantCfg.label} x${coolantCfg.speedMultiplier.toFixed(1)}`
        : coolantType === EMPTY ? `§7Empty` : `§e${coolantType} §c?`;

    const effLine = energyMult < 1
        ? `§cEff: ${Math.round(energyMult * 100)}%`
        : `§aEff: 100%`;

    reactor.setLabel([
        `§6Reactor §7| ${status}`,
        `§eFuel: §f${FL(thoriumTank.get())}/${FL(thoriumTank.getCap())}`,
        `§bCoolant: ${coolantLine}`,
        `§bAmt: §f${FL(coolantTank.get())}/${FL(coolantTank.getCap())}`,
        `§2Waste: §f${FL(wasteTank.get())}/${FL(wasteTank.getCap())}`,
        `§eEnergy: §f${E(energy.get())}/${E(energy.getCap())} ${effLine}`,
    ], LABEL_SLOT);
}