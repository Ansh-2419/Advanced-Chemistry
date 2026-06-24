// ════════════════════════════════════════════════════════════════════════════
// Age of Chemical — Fluid Storage Monitor (9-Tank Multiblock)
// ════════════════════════════════════════════════════════════════════════════
//
// Structure layout:
//   [fluid_storage_casing]  — outer shell blocks
//   [common_fluid_input_valve] — bidirectional fluid port (in AND out)
//   [fluid_storage_monitor] — controller block
//
// Architecture:
//   • 9 independent FluidManager tanks (indices 0-8), each displayed in slots 0-8
//   • Slot 9 = HUD label
//   • Fluid IN:  active pull from pipe network sources via valve ports
//   • Fluid OUT: push to adjacent fluid-accepting entities via valve ports
//   • No energy involved
//
// ════════════════════════════════════════════════════════════════════════════

import {
    FluidManager,
    Multiblock,
    MultiblockMachine,
    tickGate,
    formatFluidDisplayName,
} from '../../DoriosCore/index.js';
import {
    pushFluidThroughOutputValves,
    pullFluidThroughInputValves,
    refreshFluidInputNetworks,
    validateValves,
    VALVE_IDS,
} from './valves.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const TANK_COUNT           = 9;
const CAPACITY_PER_AIR     = 64_000;
const DISPLAY_SLOTS        = [0,1,2,3,4,5,6,7,8];
const LABEL_SLOT           = 9;
const MAX_PULL_PER_PORT    = 2_000;   // mB pulled per valve per tick window
const MAX_PUSH_PER_VALVE   = 2_000;   // mB pushed per valve per tick window
const PROP_CAP             = 'fs:cap';

// ── Multiblock config ─────────────────────────────────────────────────────────

const MULTIBLOCK_CONFIG = {
    required_case:  'dorios:multiblock.case.fluid_storage',
    entity: {
        type:           'simple_container',
        inventory_size: 10,   // slots 0-8 = tanks, slot 9 = label
        identifier:     'utilitycraft:multiblock_machine',
    },
    machine: { rate_speed_base: 0, energy_cap: 0 },
    requirements: {},  // valves are casing-edge; validated manually in onActivate
};

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent('fluid_storage_monitor', {

    onPlayerInteract(e) {
        return MultiblockMachine.handlePlayerInteract(e, MULTIBLOCK_CONFIG, {

            initializeEntity(entity) {
                _initTanks(entity, CAPACITY_PER_AIR);
            },

            onActivate({ entity, structure, player, block }) {
                const valveError = validateValves(entity, { fluidInput: 1 });
                if (valveError) { player.sendMessage(valveError); return false; }

                const cap = (structure.components?.air ?? 1) * CAPACITY_PER_AIR;
                _initTanks(entity, cap);
                entity.setDynamicProperty(PROP_CAP, cap);

                // Cache pipe network nodes from each valve
                refreshFluidInputNetworks(entity);
            },

            successMessages({ structure }) {
                const cap = (structure.components?.air ?? 1) * CAPACITY_PER_AIR;
                return [
                    '§a[Fluid Storage] Structure validated!',
                    `§79 tanks × §b${FluidManager.formatFluid(cap)} §7= §b${FluidManager.formatFluid(cap * TANK_COUNT)} §7total`,
                    '§7Connect pipes to the Fluid Valves to import/export fluid.',
                ];
            },
        });
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const monitor = new MultiblockMachine(block, MULTIBLOCK_CONFIG);
        if (!monitor.valid) return;

        const entity = monitor.entity;
        const tanks  = _getTanks(entity);

        // ── Pull fluid IN from pipe network through valves ────────────────
        if (tickGate(entity, 'fs:in', 2)) {
            pullFluidThroughInputValves(entity, tanks, null);
        }

        // ── Push fluid OUT to adjacent machines through valves ────────────
        if (tickGate(entity, 'fs:out', 4)) {
            pushFluidThroughOutputValves(entity, tanks, MAX_PUSH_PER_VALVE);
        }

        // ── Refresh network cache periodically ────────────────────────────
        if (tickGate(entity, 'fs:net_refresh', 200)) {
            refreshFluidInputNetworks(entity);
        }

        // ── Display all tank bars ─────────────────────────────────────────
        tanks.forEach((t, i) => t.display(DISPLAY_SLOTS[i]));

        // ── HUD label ─────────────────────────────────────────────────────
        _updateHud(monitor, tanks);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _initTanks(entity, cap) {
    const tanks = FluidManager.initializeMultiple(entity, TANK_COUNT);
    tanks.forEach((t, i) => {
        t.setCap(cap);
        t.display(DISPLAY_SLOTS[i]);
    });
}

function _getTanks(entity) {
    const savedCap = entity.getDynamicProperty(PROP_CAP);
    const defaultCap = (typeof savedCap === 'number' && savedCap > 0)
        ? savedCap
        : CAPACITY_PER_AIR;

    const tanks = FluidManager.initializeMultiple(entity, TANK_COUNT);
    tanks.forEach(t => { if (t.getCap() <= 0) t.setCap(defaultCap); });
    return tanks;
}

/**
 * Update the HUD label (slot 9) with current tank contents and totals.
 */
function _updateHud(monitor, tanks) {
    let totalStored = 0;
    let totalCap    = 0;
    const lines     = [];

    for (const t of tanks) {
        totalStored += t.get();
        totalCap    += t.getCap();
        if (t.get() > 0 && t.getType() !== 'empty') {
            lines.push(`§r§b${formatFluidDisplayName(t.getType())} §f${FluidManager.formatFluid(t.get())} §7/ §f${FluidManager.formatFluid(t.getCap())}`);
        }
    }

    const pct = totalCap > 0 ? ((totalStored / totalCap) * 100).toFixed(1) : '0.0';

    monitor.setLabel([
        `§r§6⬛ Fluid Storage §7(${TANK_COUNT} Tanks) §a— Active`,
        `§r§7Total: §f${FluidManager.formatFluid(totalStored)} §7/ §f${FluidManager.formatFluid(totalCap)} §8(${pct}%)`,
        ...(lines.length ? lines.slice(0, 7) : ['§r§8All tanks empty']),
    ], LABEL_SLOT);
}
