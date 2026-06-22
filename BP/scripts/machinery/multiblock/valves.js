/**
 * machinery/multiblock/valves.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Valve port helpers for Age of Chemical multiblock machines.
 *
 * Architecture overview
 * ─────────────────────
 * Each multiblock structure has casing-edge valve blocks placed by the player.
 * When a wrench activates the structure, DoriosCore's ActivationManager stamps
 * an "input:[x,y,z]" tag on the controller entity for every detected port block.
 *
 * This module provides:
 *   1. VALVE_IDS     — canonical block typeIds for all three valve types.
 *   2. getPortBlocks — resolve "input:[x,y,z]" tags → Block references.
 *   3. pushEnergyThroughOutputValves
 *                   — drain DE from the controller and deliver it to adjacent
 *                     energy-accepting machines via every energy output valve.
 *   4. checkValveRequirements
 *                   — validate that enough of each valve type was placed
 *                     (for structures that CAN use components count instead of
 *                     the manual tag-walk done in fuel_burner_monitor).
 *
 * Fluid import (pullBiofuelFromNetwork) lives in fuel_burner_monitor.js because
 * it needs the tank reference and a biofuel-type filter. The generic network
 * traversal (`collectFluidNetworkNodes`) is called from there.
 *
 * Energy output valve flow
 * ────────────────────────
 *   Controller entity
 *     └─ energy buffer (Energy scoreboard)
 *          │
 *          └─ pushEnergyThroughOutputValves()
 *               │  reads "input:[x,y,z]" tags → finds ENERGY_OUTPUT valve blocks
 *               │
 *               ▼
 *          common_energy_output_valve (block, tag: dorios:multiblock.case.*)
 *               │
 *               └─ scan all 6 adjacent blocks
 *                    │
 *                    └─ if block has dorios:fluid entity with Energy scoreboard
 *                         → transfer DE up to freeSpace
 *
 * Fluid input valve flow
 * ──────────────────────
 *   [Source machine e.g. Fermenter]
 *     └─ fluid stored at FluidManager(entity, 0)
 *          │
 *          └─ pipe network traversal (collectFluidNetworkNodes from valve block)
 *               │  discovers source machine positions
 *               ▼
 *          common_fluid_input_valve (block, tag: dorios:multiblock.port)
 *               │
 *               └─ controller entity pulls biofuel from each source entity
 *                    into its internal FluidManager tank
 */

import { Energy } from '../../DoriosCore/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Valve block typeIds
// ─────────────────────────────────────────────────────────────────────────────

export const VALVE_IDS = Object.freeze({
    /** Fluid pipe network connects here; controller pulls fluid inward. */
    FLUID_INPUT:    'utilitycraft:common_fluid_valve',

    /** Same valve used for fluid output — fluid storage uses input valves bidirectionally. */
    FLUID_OUTPUT:   'utilitycraft:common_fluid_valve',

    /** Energy network connects here; external machines push DE in. */
    ENERGY_INPUT:   'utilitycraft:common_energy_input_valve',

    /** Controller pushes buffered DE outward through this valve. */
    ENERGY_OUTPUT:  'utilitycraft:common_energy_output_valve',
});

// ─────────────────────────────────────────────────────────────────────────────
// Port resolution
// ─────────────────────────────────────────────────────────────────────────────

const INPUT_TAG_PREFIX = 'input:[';

/**
 * Read all "input:[x,y,z]" tags on the controller entity and return
 * the Block objects that match the requested valve typeId.
 *
 * Tags are stamped by ActivationManager during wrench-scan and survive
 * through world save/load as entity tags.
 *
 * @param {Entity}  entity   Controller (multiblock_machine) entity.
 * @param {string}  typeId   One of VALVE_IDS.*
 * @returns {Block[]}        All matching valve blocks (may be empty).
 */
export function getPortBlocks(entity, typeId) {
    const dim    = entity.dimension;
    const tags   = entity.getTags().filter(t => t.startsWith(INPUT_TAG_PREFIX));
    const result = [];

    for (const tag of tags) {
        // Tag format: "input:[x,y,z]"
        const inner  = tag.slice(INPUT_TAG_PREFIX.length, -1);   // "x,y,z"
        const coords = inner.split(',').map(Number);
        if (coords.length !== 3 || coords.some(isNaN)) continue;

        const [x, y, z] = coords;
        const block = dim.getBlock({ x, y, z });
        if (block?.typeId === typeId) result.push(block);
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Energy output push
// ─────────────────────────────────────────────────────────────────────────────

const FACE_OFFSETS = Object.freeze([
    { x:  1, y: 0, z:  0 },
    { x: -1, y: 0, z:  0 },
    { x:  0, y: 1, z:  0 },
    { x:  0, y:-1, z:  0 },
    { x:  0, y: 0, z:  1 },
    { x:  0, y: 0, z: -1 },
]);

/**
 * Drain DE from the controller's energy buffer and push it outward through
 * every common_energy_output_valve in the structure.
 *
 * For each output valve:
 *   • Scan all 6 face-adjacent blocks.
 *   • If a block has an entity with an Energy scoreboard (getCap > 0),
 *     transfer as much DE as the target can accept (up to `maxTransfer`).
 *   • Stop early when `maxTransfer` is exhausted.
 *
 * The target entity must be a dorios energy container — machines, batteries,
 * cables, or any entity with Energy scoreboards will accept energy this way.
 *
 * @param {Entity}  entity       Controller entity holding the energy source.
 * @param {Energy}  energyStore  Bound Energy instance for the controller.
 * @param {number}  maxTransfer  Maximum DE to push this call.
 * @param {typeof Energy} EnergyClass  The Energy class (passed to avoid circular import).
 */
export function pushEnergyThroughOutputValves(entity, energyStore, maxTransfer, EnergyClass) {
    const dim       = entity.dimension;
    const ports     = getPortBlocks(entity, VALVE_IDS.ENERGY_OUTPUT);
    let   remaining = Math.min(energyStore.get(), maxTransfer);

    for (const port of ports) {
        if (remaining <= 0) break;
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            if (remaining <= 0) break;

            const adj = dim.getBlock({ x: x + off.x, y: y + off.y, z: z + off.z });
            if (!adj) continue;

            // Skip blocks that are part of the multiblock structure itself.
            if (adj.hasTag?.('dorios:multiblock.case.fuel_burner')) continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt) continue;

            // Only push to entities that have an energy buffer.
            let tgt;
            try { tgt = new EnergyClass(adjEnt); } catch { continue; }

            const space = tgt.getFreeSpace?.() ?? (tgt.getCap() - tgt.get());
            if (space <= 0) continue;

            const toSend = Math.min(remaining, space);
            tgt.add(toSend);
            energyStore.add(-toSend);
            remaining -= toSend;
        }
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// Fluid output push
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push fluid from an array of tanks outward through every fluid valve port.
 *
 * For each fluid valve port:
 *   • Scan all 6 face-adjacent blocks.
 *   • If a block has a fluid-holding entity (getCap > 0) with free space
 *     and matching fluid type (or empty), transfer up to `maxPerPort` mB.
 *   • Each tank pushes its own fluid type — type mismatches are skipped.
 *
 * @param {Entity}        entity      Controller entity.
 * @param {FluidManager[]} tanks      Array of source tanks to push from.
 * @param {number}        maxPerPort  Max mB per valve per call.
 * @param {typeof FluidManager} FluidManagerClass
 */
export function pushFluidThroughValves(entity, tanks, maxPerPort, FluidManagerClass) {
    const dim   = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID_INPUT);

    for (const port of ports) {
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            const adj = dim.getBlock({ x: x + off.x, y: y + off.y, z: z + off.z });
            if (!adj?.hasTag?.('dorios:fluid')) continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt || adjEnt === entity) continue;

            for (const srcTank of tanks) {
                if (srcTank.get() <= 0) continue;
                const srcType = srcTank.getType();
                if (!srcType || srcType === 'empty') continue;

                let tgt;
                try { tgt = new FluidManagerClass(adjEnt, 0); } catch { continue; }
                if (tgt.getCap() <= 0) continue;
                if (tgt.getFreeSpace() <= 0) continue;

                const tgtType = tgt.getType();
                if (tgtType !== 'empty' && tgtType !== srcType) continue;

                const amount = Math.min(srcTank.get(), tgt.getFreeSpace(), maxPerPort);
                if (amount <= 0) continue;

                srcTank.add(-amount);
                if (srcTank.get() <= 0) srcTank.setType('empty');
                if (tgtType === 'empty') tgt.setType(srcType);
                tgt.add(amount);
                break; // one tank per adjacent entity per tick
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Valve requirement validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify that enough of each valve type was detected in the structure.
 *
 * NOTE: This only works if valves contribute to `structure.components`
 * (i.e. they are interior blocks with dorios:multiblock_component tag).
 * For valves that are edge/casing blocks, validate via the "input:[x,y,z]"
 * tag walk in onActivate instead (as done in fuel_burner_monitor.js).
 *
 * @param {Record<string,number>} components  Counts from structure detection.
 * @param {{ fluid?: number, energyIn?: number, energyOut?: number }} required
 * @returns {string|null}  A §c warning string on failure, null on success.
 */
export function checkValveRequirements(components, required = {}) {
    if (required.fluid != null) {
        const found = components['common_fluid_input_valve'] ?? 0;
        if (found < required.fluid)
            return `§c[Valve] Need ${required.fluid}× Fluid Input Valve (found ${found}).`;
    }
    if (required.energyIn != null) {
        const found = components['common_energy_input_valve'] ?? 0;
        if (found < required.energyIn)
            return `§c[Valve] Need ${required.energyIn}× Energy Input Valve (found ${found}).`;
    }
    if (required.energyOut != null) {
        const found = components['common_energy_output_valve'] ?? 0;
        if (found < required.energyOut)
            return `§c[Valve] Need ${required.energyOut}× Energy Output Valve (found ${found}).`;
    }
    return null;
}
