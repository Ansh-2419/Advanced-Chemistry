/**
 * machinery/multiblock/energy_valves.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Energy valve block component + energy transfer functions.
 *
 * Mirrors the fluid valve pattern exactly:
 *   refreshEnergyInputNetworks  — BFS-walks dorios:energy cable network from
 *                                 each INPUT valve and caches source positions
 *   pullEnergyFromValves        — reads cached positions, pulls each tick
 *   pushEnergyFromValves        — pushes from controller into adjacent cables
 */

import { Energy } from "../../DoriosCore/index.js";
import { ActionFormData } from "@minecraft/server-ui";
import {
    VALVE_IDS,
    MODE_INPUT,
    MODE_OUTPUT,
    FACE_OFFSETS,
    getPortBlocks
} from "./valve_shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Block component
// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("energy_valve", {
    onPlayerInteract({ block, player }) {
        if (!player?.isValid) return;

        const current = block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;

        new ActionFormData()
            .title("§eEnergy Valve")
            .body(`Current: §e${current === MODE_OUTPUT ? "Output ▶" : "◀ Input"}`)
            .button("§aSet Input §7(accept energy)")
            .button("§6Set Output §7(push energy out)")
            .show(player)
            .then(result => {
                if (result.canceled || result.selection == null) return;
                if (!block.isValid) return;
                const newMode = result.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
                block.setPermutation(block.permutation.withState("utilitycraft:mode", newMode));
                player.sendMessage(
                    newMode === MODE_INPUT
                        ? "§e[Energy Valve] §aInput mode"
                        : "§e[Energy Valve] §6Output mode"
                );
            })
            .catch(() => {});
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Energy network traversal — mirrors collectFluidNetworkNodes
// ─────────────────────────────────────────────────────────────────────────────

const MAX_VISITED = 2048;

function _posKey(pos) {
    return `${Math.floor(pos.x)}|${Math.floor(pos.y)}|${Math.floor(pos.z)}`;
}

function _floorPos(pos) {
    return { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) };
}

/**
 * BFS from startBlock through dorios:energy cable blocks.
 * Returns array of {x,y,z} positions of dorios:energy_container entities
 * found adjacent to cables in the network.
 *
 * @param {Block} startBlock  The energy input valve block.
 * @returns {{x:number,y:number,z:number}[]}
 */
function collectEnergyNetworkNodes(startBlock) {
    if (!startBlock?.dimension || !startBlock?.location) return [];

    const dim      = startBlock.dimension;
    const queue    = [];
    let   qi       = 0;
    const visited  = new Set();
    const nodes    = [];
    const nodeKeys = new Set();

    const addNode = (pos) => {
        const key = _posKey(pos);
        if (nodeKeys.has(key)) return;
        nodeKeys.add(key);
        nodes.push(_floorPos(pos));
    };

    // Seed: scan the 6 faces of the valve block for cables or direct sources
    for (const off of FACE_OFFSETS) {
        const npos = {
            x: startBlock.location.x + off.x,
            y: startBlock.location.y + off.y,
            z: startBlock.location.z + off.z
        };
        const nb = dim.getBlock(npos);
        if (!nb) continue;

        if (nb.hasTag("dorios:energy")) {
            // It's a cable — BFS from here
            queue.push(_floorPos(npos));
        } else {
            // Direct adjacent entity (generator placed right next to valve)
            const ent = dim.getEntitiesAtBlockLocation(nb.location)[0];
            if (!ent) continue;
            const tf = ent.getComponent?.("minecraft:type_family");
            if (tf?.hasTypeFamily?.("dorios:energy_container")) {
                addNode(nb.location);
            }
        }
    }

    // BFS through cable network
    while (qi < queue.length && visited.size < MAX_VISITED) {
        const pos = queue[qi++];
        const key = _posKey(pos);
        if (visited.has(key)) continue;
        visited.add(key);

        const block = dim.getBlock(pos);
        if (!block?.hasTag?.("dorios:energy")) continue;

        // Check each face of this cable for source entities or more cables
        for (const off of FACE_OFFSETS) {
            const npos = {
                x: pos.x + off.x,
                y: pos.y + off.y,
                z: pos.z + off.z
            };
            const nb = dim.getBlock(npos);
            if (!nb) continue;

            if (nb.hasTag("dorios:energy")) {
                // More cable — keep traversing
                const nkey = _posKey(npos);
                if (!visited.has(nkey)) queue.push(_floorPos(npos));
            } else {
                // Potential source entity
                const ent = dim.getEntitiesAtBlockLocation(nb.location)[0];
                if (!ent) continue;
                const tf = ent.getComponent?.("minecraft:type_family");
                if (tf?.hasTypeFamily?.("dorios:energy_source") ||
                    tf?.hasTypeFamily?.("dorios:energy_container")) {
                    addNode(nb.location);
                }
            }
        }
    }

    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network cache
// ─────────────────────────────────────────────────────────────────────────────

const ENERGY_NODES_PFX = "valve:enodes_";

/**
 * BFS-traverse the energy cable network from every INPUT energy valve and
 * cache source-entity positions on the controller entity.
 * Call once on activate and every ~200 ticks in onTick.
 *
 * @param {Entity} entity Controller entity.
 */
export function refreshEnergyInputNetworks(entity) {
    const ports = getPortBlocks(entity, VALVE_IDS.ENERGY, MODE_INPUT);
    for (let i = 0; i < ports.length; i++) {
        try {
            const nodes = collectEnergyNetworkNodes(ports[i]);
            entity.setDynamicProperty(ENERGY_NODES_PFX + i, JSON.stringify(nodes));
        } catch { /* chunk not loaded */ }
    }
    entity.setDynamicProperty(ENERGY_NODES_PFX + "count", ports.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Energy transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull energy each tick from cached source positions into the controller.
 *
 * @param {Entity} entity       Controller entity.
 * @param {Energy} energyStore  Controller's Energy instance.
 * @param {number} maxTransfer  Max DE per call.
 */
export function pullEnergyFromValves(entity, energyStore, maxTransfer) {
    const dim       = entity.dimension;
    const portCount = entity.getDynamicProperty(ENERGY_NODES_PFX + "count") ?? 0;
    let remaining   = Math.min(energyStore.getCap() - energyStore.get(), maxTransfer);
    if (remaining <= 0) return;

    for (let i = 0; i < portCount; i++) {
        if (remaining <= 0) break;
        let nodes = [];
        try {
            const raw = entity.getDynamicProperty(ENERGY_NODES_PFX + i);
            if (raw) nodes = JSON.parse(raw);
        } catch {}
        if (!nodes.length) continue;

        for (const node of nodes) {
            if (remaining <= 0) break;
            const srcEnt = dim.getEntitiesAtBlockLocation(node)[0];
            if (!srcEnt || srcEnt === entity) continue;

            let src;
            try { src = new Energy(srcEnt); } catch { continue; }
            if (src.get() <= 0) continue;

            const took = src.transferTo(energyStore, Math.min(src.get(), remaining));
            remaining -= took;
        }
    }
}

/**
 * Push energy each tick from the controller out through OUTPUT valve faces
 * into adjacent dorios:energy_container entities (cables).
 *
 * @param {Entity} entity       Controller entity.
 * @param {Energy} energyStore  Controller's Energy instance.
 * @param {number} maxTransfer  Max DE per call.
 */
export function pushEnergyFromValves(entity, energyStore, maxTransfer) {
    const dim   = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.ENERGY, MODE_OUTPUT);
    let remaining = Math.min(energyStore.get(), maxTransfer);
    if (remaining <= 0) return;

    for (const port of ports) {
        if (remaining <= 0) break;
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            if (remaining <= 0) break;
            const adj = dim.getBlock({ x: x + off.x, y: y + off.y, z: z + off.z });
            if (!adj?.hasTag?.("dorios:energy")) continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt || adjEnt === entity) continue;

            let tgt;
            try { tgt = new Energy(adjEnt); } catch { continue; }
            const cap   = tgt.getCap();
            const space = cap > 0 ? cap - tgt.get() : remaining;
            if (space <= 0) continue;

            const sent = energyStore.transferTo(tgt, Math.min(space, remaining));
            remaining -= sent;
        }
    }
}

