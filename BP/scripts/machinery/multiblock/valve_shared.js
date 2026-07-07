/**
 * machinery/multiblock/valve_shared.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared constants and port-resolution utilities used by fluid_valves.js.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const VALVE_IDS = Object.freeze({
    FLUID:  "utilitycraft:fluid_valve",
    ENERGY: "utilitycraft:energy_valve"
});

export const MODE_INPUT  = 0;
export const MODE_OUTPUT = 1;

export const INPUT_TAG_PREFIX = "input:[";

export const MULTIBLOCK_CASE_TAGS = Object.freeze([
    "dorios:multiblock.case.fuel_burner",
    "dorios:multiblock.case.fluid_storage",
    "dorios:multiblock.case.refinery"
]);

export const FACE_OFFSETS = Object.freeze([
    { x:  1, y: 0, z:  0 },
    { x: -1, y: 0, z:  0 },
    { x:  0, y: 1, z:  0 },
    { x:  0, y:-1, z:  0 },
    { x:  0, y: 0, z:  1 },
    { x:  0, y: 0, z: -1 }
]);

// ─────────────────────────────────────────────────────────────────────────────
// Port resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve "input:[x,y,z]" tags on the controller entity into Block refs
 * filtered by typeId AND optionally by mode state.
 *
 * @param {Entity}      entity  Controller entity.
 * @param {string}      typeId  VALVE_IDS.FLUID or VALVE_IDS.ENERGY.
 * @param {number|null} mode    MODE_INPUT, MODE_OUTPUT, or null for both.
 * @returns {Block[]}
 */
export function getPortBlocks(entity, typeId, mode = null) {
    const dim  = entity.dimension;
    const tags = entity.getTags().filter(t => t.startsWith(INPUT_TAG_PREFIX));
    const out  = [];

    for (const tag of tags) {
        const inner  = tag.slice(INPUT_TAG_PREFIX.length, -1);
        const coords = inner.split(",").map(Number);
        if (coords.length !== 3 || coords.some(isNaN)) continue;

        const [x, y, z] = coords;
        const block = dim.getBlock({ x, y, z });
        if (!block || block.typeId !== typeId) continue;

        if (mode !== null) {
            const blockMode = block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;
            if (blockMode !== mode) continue;
        }
        out.push(block);
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a multiblock has the required fluid valve counts.
 * Energy valves are passive and validated by the block tag system, not here.
 *
 * @param {Entity} entity    Controller entity.
 * @param {object} required  e.g. { fluidInput: 1, fluidOutput: 1 }
 * @returns {string|null}    Error message or null on success.
 */
export function validateValves(entity, required = {}) {
    const fluidIn  = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_INPUT).length;
    const fluidOut = getPortBlocks(entity, VALVE_IDS.FLUID, MODE_OUTPUT).length;

    if (required.fluidInput  != null && fluidIn  < required.fluidInput)
        return `§c[Valve] Need ${required.fluidInput}× Fluid Valve (Input). Found ${fluidIn}.`;
    if (required.fluidOutput != null && fluidOut < required.fluidOutput)
        return `§c[Valve] Need ${required.fluidOutput}× Fluid Valve (Output). Found ${fluidOut}.`;

    return null;
}
