/**
 * machinery/multiblock/valves.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Two unified valves for Age of Chemical multiblock machines.
 *
 * VALVE TYPES
 * ───────────
 *   utilitycraft:fluid_valve   — carries fluid, mode 0=input / 1=output
 *   utilitycraft:energy_valve  — carries energy, mode 0=input / 1=output
 *
 * MODE TOGGLE
 * ───────────
 * Player right-clicks (or interacts) with block → block component
 * `onPlayerInteract` opens UI form to toggle utilitycraft:mode state (0↔1).
 * Texture swaps automatically via block permutation.
 *
 * MULTIBLOCK INTEGRATION
 * ──────────────────────
 * On wrench-scan, ActivationManager stamps "input:[x,y,z]" tags on the
 * controller entity for every port block in the outer shell.
 * `getPortBlocks(entity, typeId)` resolves those tags back to Block refs.
 *
 * Both valves carry all required multiblock case tags so they are accepted
 * as valid casing for every multiblock structure in this addon.
 *
 * FLUID FLOW (per tick, called by each machine's onTick)
 * ──────────────────────────────────────────────────────
 *   INPUT valves  → machine pulls fluid FROM pipe-network sources
 *   OUTPUT valves → machine pushes fluid TO adjacent fluid containers
 *
 * ENERGY FLOW (per tick, called by fuel_burner_monitor onTick)
 * ─────────────────────────────────────────────────────────────
 *   INPUT valves  → external sources push energy INTO controller
 *   OUTPUT valves → controller pushes DE OUT to adjacent energy containers
 */

import { world } from "@minecraft/server";
import {
    Energy,
    FluidManager,
    collectFluidNetworkNodes
} from "../../DoriosCore/index.js";
import { ActionFormData } from "@minecraft/server-ui";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const VALVE_IDS = Object.freeze({
    FLUID: "utilitycraft:fluid_valve",
    ENERGY: "utilitycraft:energy_valve"
});

const MODE_INPUT = 0;
const MODE_OUTPUT = 1;
const INPUT_TAG_PREFIX = "input:[";

const FACE_OFFSETS = Object.freeze([
    { x: 1, y: 0, z: 0 },
    { x: -1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: -1, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: -1 }
]);

// ─────────────────────────────────────────────────────────────────────────────
// Block components — mode toggle via block interact
// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("fluid_valve", {
    onPlayerInteract(e) {
        const { block, player } = e;
        if (!player?.isValid) return;

        const current =
            block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;

        new ActionFormData()
            .title("§bFluid Valve")
            .body(
                `Current: §e${current === MODE_OUTPUT ? "Output ▶" : "◀ Input"}`
            )
            .button("§aSet Input §7(pull fluid in)")
            .button("§eSet Output §7(push fluid out)")
            .show(player)
            .then(result => {
                if (result.canceled || result.selection == null) return;
                if (!block.isValid) return;
                const newMode =
                    result.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
                block.setPermutation(
                    block.permutation.withState("utilitycraft:mode", newMode)
                );
                player.sendMessage(
                    newMode === MODE_INPUT
                        ? "§b[Fluid Valve] §aInput mode"
                        : "§b[Fluid Valve] §eOutput mode"
                );
            })
            .catch(() => {});
    }
});

DoriosAPI.register.blockComponent("energy_valve", {
    onPlayerInteract(e) {
        const { block, player } = e;
        if (!player?.isValid) return;

        const current =
            block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;

        new ActionFormData()
            .title("§eEnergy Valve")
            .body(
                `Current: §e${current === MODE_OUTPUT ? "Output ▶" : "◀ Input"}`
            )
            .button("§aSet Input §7(accept energy)")
            .button("§6Set Output §7(push energy out)")
            .show(player)
            .then(result => {
                if (result.canceled || result.selection == null) return;
                if (!block.isValid) return;
                const newMode =
                    result.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
                block.setPermutation(
                    block.permutation.withState("utilitycraft:mode", newMode)
                );
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
// Port resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve "input:[x,y,z]" tags on the controller entity into Block refs
 * filtered by typeId AND optionally by mode state.
 *
 * @param {Entity}  entity    Controller entity.
 * @param {string}  typeId    VALVE_IDS.FLUID or VALVE_IDS.ENERGY.
 * @param {number|null} mode  MODE_INPUT(0), MODE_OUTPUT(1), or null for both.
 * @returns {Block[]}
 */
export function getPortBlocks(entity, typeId, mode = null) {
    const dim = entity.dimension;
    const tags = entity.getTags().filter(t => t.startsWith(INPUT_TAG_PREFIX));
    const out = [];

    for (const tag of tags) {
        const inner = tag.slice(INPUT_TAG_PREFIX.length, -1);
        const coords = inner.split(",").map(Number);
        if (coords.length !== 3 || coords.some(isNaN)) continue;

        const [x, y, z] = coords;
        const block = dim.getBlock({ x, y, z });
        if (!block || block.typeId !== typeId) continue;

        if (mode !== null) {
            const blockMode =
                block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;
            if (blockMode !== mode) continue;
        }
        out.push(block);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fluid valve logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traverse the pipe network from every FLUID INPUT valve and cache
 * source-node positions on the entity. Call once on activation and
 * periodically (e.g. every 200 ticks).
 *
 * @param {Entity}  entity      Controller entity.
 * @param {string}  nodesPropPfx  Dynamic property prefix e.g. 'fs:nodes_'.
 */
export function refreshFluidInputNetworks(
    entity,
    nodesPropPfx = "valve:fnodes_"
) {
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_INPUT);
    for (let i = 0; i < ports.length; i++) {
        try {
            const nodes = collectFluidNetworkNodes(ports[i]);
            entity.setDynamicProperty(nodesPropPfx + i, JSON.stringify(nodes));
        } catch {
            /* chunk not loaded etc. */
        }
    }
    // Store count so callers know how many slots to read
    entity.setDynamicProperty(nodesPropPfx + "count", ports.length);
}

/**
 * Pull fluid from pipe-network sources through FLUID INPUT valves
 * into the provided array of destination tanks.
 *
 * Type routing: fluid is placed into the first tank that already holds
 * that type (with free space), or the first empty tank.
 * If validTypes is provided, only those fluid types are accepted.
 *
 * @param {Entity}        entity       Controller entity.
 * @param {FluidManager[]} tanks       Destination tanks (ordered by preference).
 * @param {Set<string>|null} validTypes  Whitelist of accepted fluid type IDs, or null for any.
 * @param {string}        nodesPropPfx Dynamic property prefix used in refreshFluidInputNetworks.
 * @param {number}        maxPerPort   Max mB pulled per input port per call.
 */
export function pullFluidThroughInputValves(
    entity,
    tanks,
    validTypes = null,
    nodesPropPfx = "valve:fnodes_",
    maxPerPort = 2000
) {
    const dim = entity.dimension;
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

            // Scan all tank indices on the source
            for (let idx = 0; idx < 4; idx++) {
                let src;
                try {
                    src = new FluidManager(srcEnt, idx);
                } catch {
                    break;
                }
                if (src.getCap() <= 0) break;
                if (src.get() <= 0) continue;

                const incoming = src.getType();
                if (!incoming || incoming === "empty") continue;
                if (validTypes !== null && !validTypes.has(incoming)) continue;

                // Find best destination tank
                const target =
                    tanks.find(
                        t => t.getType() === incoming && t.getFreeSpace() > 0
                    ) ??
                    tanks.find(
                        t => t.getType() === "empty" && t.getFreeSpace() > 0
                    );
                if (!target) continue;

                const amount = Math.min(
                    src.get(),
                    target.getFreeSpace(),
                    maxPerPort
                );
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
 * to any adjacent fluid-accepting entity.
 *
 * @param {Entity}        entity       Controller entity.
 * @param {FluidManager[]} tanks       Source tanks to drain.
 * @param {number}        maxPerValve  Max mB per output valve per call.
 */
export function pushFluidThroughOutputValves(
    entity,
    tanks,
    maxPerValve = 2000
) {
    const dim = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_OUTPUT);

    for (const port of ports) {
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            const adj = dim.getBlock({
                x: x + off.x,
                y: y + off.y,
                z: z + off.z
            });
            if (!adj?.hasTag?.("dorios:fluid")) continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt || adjEnt === entity) continue;

            for (const srcTank of tanks) {
                if (srcTank.get() <= 0) continue;
                const srcType = srcTank.getType();
                if (!srcType || srcType === "empty") continue;

                let tgt;
                try {
                    tgt = new FluidManager(adjEnt, 0);
                } catch {
                    continue;
                }
                if (tgt.getCap() <= 0) continue;
                if (tgt.getFreeSpace() <= 0) continue;

                const tgtType = tgt.getType();
                if (tgtType !== "empty" && tgtType !== srcType) continue;

                const amount = Math.min(
                    srcTank.get(),
                    tgt.getFreeSpace(),
                    maxPerValve
                );
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

// ─────────────────────────────────────────────────────────────────────────────
// Energy valve logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push DE from the controller's energy buffer outward through
 * every ENERGY OUTPUT valve to adjacent energy-accepting entities.
 *
 * @param {Entity}  entity       Controller entity.
 * @param {Energy}  energyStore  Bound Energy instance for the controller.
 * @param {number}  maxTransfer  Max DE to push this call.
 */
export function pushEnergyThroughOutputValves(
    entity,
    energyStore,
    maxTransfer
) {
    const dim = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.ENERGY, MODE_OUTPUT);
    let remaining = Math.min(energyStore.get(), maxTransfer);

    for (const port of ports) {
        if (remaining <= 0) break;
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            if (remaining <= 0) break;

            const adj = dim.getBlock({
                x: x + off.x,
                y: y + off.y,
                z: z + off.z
            });
            if (!adj) continue;
            // Skip own casing
            if (
                adj.hasTag?.("dorios:multiblock.case.fuel_burner") ||
                adj.hasTag?.("dorios:multiblock.case.fluid_storage")
            )
                continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt) continue;

            let tgt;
            try {
                tgt = new Energy(adjEnt);
            } catch {
                continue;
            }
            if (tgt.getCap() <= 0) continue;

            const space = tgt.getCap() - tgt.get();
            if (space <= 0) continue;

            const toSend = Math.min(remaining, space);
            tgt.add(toSend);
            energyStore.add(-toSend);
            remaining -= toSend;
        }
    }
}

/**
 * Accept DE from adjacent energy sources through ENERGY INPUT valves
 * into the controller's energy buffer. (For machines that receive energy
 * from the outside rather than consuming from their own storage.)
 *
 * @param {Entity}  entity       Controller entity.
 * @param {Energy}  energyStore  Bound Energy instance for the controller.
 * @param {number}  maxTransfer  Max DE to accept this call.
 */
export function pullEnergyThroughInputValves(entity, energyStore, maxTransfer) {
    const dim = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.ENERGY, MODE_INPUT);
    let remaining = Math.min(
        energyStore.getFreeSpace?.() ??
            energyStore.getCap() - energyStore.get(),
        maxTransfer
    );

    for (const port of ports) {
        if (remaining <= 0) break;
        const { x, y, z } = port.location;

        for (const off of FACE_OFFSETS) {
            if (remaining <= 0) break;

            const adj = dim.getBlock({
                x: x + off.x,
                y: y + off.y,
                z: z + off.z
            });
            if (!adj) continue;
            if (
                adj.hasTag?.("dorios:multiblock.case.fuel_burner") ||
                adj.hasTag?.("dorios:multiblock.case.fluid_storage")
            )
                continue;

            const adjEnt = dim.getEntitiesAtBlockLocation(adj.location)[0];
            if (!adjEnt) continue;

            let src;
            try {
                src = new Energy(adjEnt);
            } catch {
                continue;
            }
            if (src.get() <= 0) continue;

            const toTake = Math.min(src.get(), remaining);
            src.add(-toTake);
            energyStore.add(toTake);
            remaining -= toTake;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation validation helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count how many of each valve type+mode appear in a structure's inputBlocks
 * (the "input:[x,y,z]" tag list). Use this in onActivate to validate that
 * the player placed the right valves before the multiblock goes online.
 *
 * @param {Entity}   entity     Controller entity (already has input tags).
 * @param {object}   required   e.g. { fluidInput:1, energyOutput:1 }
 * @returns {string|null}       Warning message on failure, null on success.
 */
export function validateValves(entity, required = {}) {
    const fluidIn = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_INPUT).length;
    const fluidOut = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_OUTPUT).length;
    const energyIn = getPortBlocks(entity, VALVE_IDS.ENERGY, MODE_INPUT).length;
    const energyOut = getPortBlocks(
        entity,
        VALVE_IDS.ENERGY,
        MODE_OUTPUT
    ).length;

    if (required.fluidInput != null && fluidIn < required.fluidInput)
        return `§c[Valve] Need ${required.fluidInput}× Fluid Valve (Input mode). Found ${fluidIn}.`;
    if (required.fluidOutput != null && fluidOut < required.fluidOutput)
        return `§c[Valve] Need ${required.fluidOutput}× Fluid Valve (Output mode). Found ${fluidOut}.`;
    if (required.energyInput != null && energyIn < required.energyInput)
        return `§c[Valve] Need ${required.energyInput}× Energy Valve (Input mode). Found ${energyIn}.`;
    if (required.energyOutput != null && energyOut < required.energyOutput)
        return `§c[Valve] Need ${required.energyOutput}× Energy Valve (Output mode). Found ${energyOut}.`;

    return null;
}
