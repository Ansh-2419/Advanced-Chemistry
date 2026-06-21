// ════════════════════════════════════════════════════════════════════════════
// Age of Chemical — Fluid Storage (9-Tank Multiblock)
// ════════════════════════════════════════════════════════════════════════════

import {
    FluidManager, Multiblock, MultiblockMachine, tickGate, pullFluidsFromNeighbors,
} from '../../DoriosCore/index.js';
import { getPortBlocks, VALVE_IDS } from './valves.js';

const TANK_COUNT        = 9;
const CAPACITY_PER_AIR  = 64_000;
const DISPLAY_SLOTS     = [0,1,2,3,4,5,6,7,8];

const MULTIBLOCK_CONFIG = {
    required_case: 'dorios:multiblock.case.fluid_storage',
    entity: {
        type: 'simple_container',
        inventory_size: 10,
        identifier: 'utilitycraft:multiblock_machine',
    },
    machine: { rate_speed_base: 0, energy_cap: 0 },
    requirements: {
        common_fluid_input_valve: {
            amount: 1,
            warning: '§c[Fluid Storage] Missing Fluid Input Valve.',
        },
        common_energy_output_valve: {
            amount: 1,
            warning: '§c[Fluid Storage] Missing Fluid Output Valve.',
        },
    },
};

DoriosAPI.register.blockComponent('fluid_storage_monitor', {

    onPlayerInteract(e) {
        return MultiblockMachine.handlePlayerInteract(e, MULTIBLOCK_CONFIG, {
            initializeEntity(entity) { initTanks(entity, CAPACITY_PER_AIR); },
            onActivate({ entity, structure }) {
                const cap = (structure.components?.air ?? 1) * CAPACITY_PER_AIR;
                initTanks(entity, cap);
            },
            successMessages({ structure }) {
                const cap = (structure.components?.air ?? 1) * CAPACITY_PER_AIR;
                return [
                    '§a[Fluid Storage] Structure validated!',
                    `§79 tanks × §b${FluidManager.formatFluid(cap)} §7= §b${FluidManager.formatFluid(cap * TANK_COUNT)} §7total`,
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
        const { entity } = monitor;
        const tanks = getTanks(entity, CAPACITY_PER_AIR);

        // Pull fluid from input valves
        if (tickGate(entity, 'fs:in', 2)) {
            const inPorts = getPortBlocks(entity, VALVE_IDS.FLUID_INPUT);
            pullFluidsFromNeighbors(inPorts, tanks, { selfEntity: entity, breakAfterFirst: true });
        }

        // Push fluid through output valves
        if (tickGate(entity, 'fs:out', 4)) {
            const outPorts = getPortBlocks(entity, VALVE_IDS.ENERGY_OUTPUT);
            for (const port of outPorts) {
                for (const tank of tanks) {
                    if (tank.get() > 0) tank.transferFluids(port, tank.get(), { useFacing: true });
                }
            }
        }

        tanks.forEach((t, i) => t.display(DISPLAY_SLOTS[i]));

        // HUD
        let totalStored = 0, totalCap = 0;
        const lines = [];
        for (const t of tanks) {
            totalStored += t.get();
            totalCap    += t.getCap();
            if (t.getType() !== 'empty' && t.get() > 0)
                lines.push(`§r§b${DoriosAPI.utils.formatIdToText(t.getType())} §f${FluidManager.formatFluid(t.get())}`);
        }
        const pct = totalCap > 0 ? ((totalStored / totalCap) * 100).toFixed(1) : '0.0';
        monitor.setLabel([
            `§r§bFluid Storage §7(9 Tanks) §7— §aActive`,
            `§r§7Total: §f${FluidManager.formatFluid(totalStored)} §7/ §f${FluidManager.formatFluid(totalCap)} §8(${pct}%)`,
            ...lines.slice(0, 7),
        ]);
    },
});

function initTanks(entity, cap) {
    const tanks = FluidManager.initializeMultiple(entity, TANK_COUNT);
    tanks.forEach((t, i) => { t.setCap(cap); t.display(DISPLAY_SLOTS[i]); });
}

function getTanks(entity, defaultCap) {
    const tanks = FluidManager.initializeMultiple(entity, TANK_COUNT);
    tanks.forEach(t => { if (t.getCap() <= 0) t.setCap(defaultCap); });
    return tanks;
}

