/**
 * machinery/multiblock/fluid_valves.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Fluid valve block component + fluid transfer functions.
 *
 *   INPUT  valves → machine pulls fluid FROM pipe-network sources each tick
 *   OUTPUT valves → machine pushes fluid TO adjacent fluid containers each tick
 */

import { FluidStorage as FluidManager } from "../../DoriosCore/index.js";
import { ActionFormData } from "@minecraft/server-ui";
import {
    VALVE_IDS,
    MODE_INPUT,
    MODE_OUTPUT,
    FACE_OFFSETS,
    getPortBlocks
} from "./valve_shared.js";

const MAX_NETWORK_NODES = 128;

// ─────────────────────────────────────────────────────────────────────────────
// Block component
// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("fluid_valve", {
    onPlayerInteract({ block, player }) {
        if (!player?.isValid) return;

        const current = block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;

        new ActionFormData()
            .title("§bFluid Valve")
            .body(`Current: §e${current === MODE_OUTPUT ? "Output ▶" : "◀ Input"}`)
            .button("§aSet Input §7(pull fluid in)")
            .button("§eSet Output §7(push fluid out)")
            .show(player)
            .then(result => {
                if (result.canceled || result.selection == null) return;
                if (!block.isValid) return;
                const newMode = result.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
                block.setPermutation(block.permutation.withState("utilitycraft:mode", newMode));
                player.sendMessage(
                    newMode === MODE_INPUT
                        ? "§b[Fluid Valve] §aInput mode"
                        : "§b[Fluid Valve] §eOutput mode"
                );
            })
            .catch(() => {});
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Network cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traverse the pipe network from every FLUID INPUT valve and cache source-node
 * positions on the controller entity as dynamic properties.
 * Call once on activate and periodically (~200 ticks) in onTick.
 *
 * @param {Entity} entity       Controller entity.
 * @param {string} nodesPropPfx Dynamic property prefix, default "valve:fnodes_".
 */
export function refreshFluidInputNetworks(entity, nodesPropPfx = "valve:fnodes_") {
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_INPUT);
    for (let i = 0; i < ports.length; i++) {
        try {
            const nodes = collectFluidNetworkNodes(ports[i]);
            entity.setDynamicProperty(nodesPropPfx + i, JSON.stringify(nodes));
        } catch { /* chunk not loaded */ }
    }
    entity.setDynamicProperty(nodesPropPfx + "count", ports.length);
}

function collectFluidNetworkNodes(startBlock) {
    const dim = startBlock.dimension;
    const visited = new Set();
    const nodes = [];
    const queue = FACE_OFFSETS
        .map(off => ({
            x: startBlock.location.x + off.x,
            y: startBlock.location.y + off.y,
            z: startBlock.location.z + off.z,
        }));

    while (queue.length && nodes.length < MAX_NETWORK_NODES) {
        const loc = queue.shift();
        const key = `${loc.x},${loc.y},${loc.z}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const block = dim.getBlock(loc);
        if (!block?.hasTag?.("dorios:fluid")) continue;

        nodes.push({ x: loc.x, y: loc.y, z: loc.z });

        for (const off of FACE_OFFSETS) {
            queue.push({
                x: loc.x + off.x,
                y: loc.y + off.y,
                z: loc.z + off.z,
            });
        }
    }

    return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fluid transfer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pull fluid from pipe-network sources through FLUID INPUT valves
 * into the provided destination tanks.
 *
 * @param {Entity}         entity       Controller entity.
 * @param {FluidManager[]} tanks        Destination tanks.
 * @param {Set<string>|null} validTypes Accepted fluid type IDs, or null for any.
 * @param {string}         nodesPropPfx Dynamic property prefix.
 * @param {number}         maxPerPort   Max mB per port per call.
 */
export function pullFluidThroughInputValves(
    entity,
    tanks,
    validTypes    = null,
    nodesPropPfx  = "valve:fnodes_",
    maxPerPort    = 2000
) {
    const dim       = entity.dimension;
    const portCount = entity.getDynamicProperty(nodesPropPfx + "count") ?? 0;

    for (let i = 0; i < portCount; i++) {
        let nodes = [];
        try {
            const raw = entity.getDynamicProperty(nodesPropPfx + i);
            if (raw) nodes = JSON.parse(raw);
        } catch {}
        if (!nodes.length) continue;

        for (const node of nodes) {
            if (!Number.isFinite(node?.x)) continue;

            const srcBlock = dim.getBlock({ x: node.x, y: node.y, z: node.z });
            if (!srcBlock?.hasTag?.("dorios:fluid")) continue;

            const srcEnt = dim.getEntitiesAtBlockLocation(srcBlock.location)[0];
            if (!srcEnt || srcEnt === entity) continue;

            for (let idx = 0; idx < 4; idx++) {
                let src;
                try { src = new FluidManager(srcEnt, idx); } catch { break; }
                if (src.getCap() <= 0) break;
                if (src.get() <= 0) continue;

                const incoming = src.getType();
                if (!incoming || incoming === "empty") continue;
                if (validTypes !== null && !validTypes.has(incoming)) continue;

                const target =
                    tanks.find(t => t.getType() === incoming && t.getFreeSpace() > 0) ??
                    tanks.find(t => t.getType() === "empty"  && t.getFreeSpace() > 0);
                if (!target) continue;

                const amount = Math.min(src.get(), target.getFreeSpace(), maxPerPort);
                if (amount <= 0) continue;

                src.add(-amount);
                if (src.get() <= 0) src.setType("empty");
                if (target.getType() === "empty") target.setType(incoming);
                target.add(amount);
                break;
            }
        }
    }
}

/**
 * Push fluid from source tanks outward through FLUID OUTPUT valves
 * to adjacent fluid-accepting entities.
 *
 * @param {Entity}         entity      Controller entity.
 * @param {FluidManager[]} tanks       Source tanks to drain.
 * @param {number}         maxPerValve Max mB per output valve per call.
 */
export function pushFluidThroughOutputValves(entity, tanks, maxPerValve = 2000) {
    const dim   = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_OUTPUT);

    for (const port of ports) {
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            const adj = dim.getBlock({ x: x + off.x, y: y + off.y, z: z + off.z });
            if (!adj?.hasTag?.("dorios:fluid")) continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt || adjEnt === entity) continue;

            for (const srcTank of tanks) {
                if (srcTank.get() <= 0) continue;
                const srcType = srcTank.getType();
                if (!srcType || srcType === "empty") continue;

                let tgt;
                try { tgt = new FluidManager(adjEnt, 0); } catch { continue; }
                if (tgt.getCap() <= 0 || tgt.getFreeSpace() <= 0) continue;

                const tgtType = tgt.getType();
                if (tgtType !== "empty" && tgtType !== srcType) continue;

                const amount = Math.min(srcTank.get(), tgt.getFreeSpace(), maxPerValve);
                if (amount <= 0) continue;

                srcTank.add(-amount);
                if (srcTank.get() <= 0) srcTank.setType("empty");
                if (tgtType === "empty") tgt.setType(srcType);
                tgt.add(amount);
                break;
            }
        }
    }
}
