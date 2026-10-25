import { EnergyStorage, FluidStorage } from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";

// ── Port type IDs ─────────────────────────────────────────────────────────────
// Normal ports — used by standard machines (Fuel Burner, Fluid Storage, Refinery)
export const ENERGY_PORT_ID        = "utilitycraft:energy_valve";
export const FLUID_PORT_ID         = "utilitycraft:fluid_valve";
// Industrial ports — used by advanced machines (Nuclear Reactor, Fusion Reactor)
export const IND_ENERGY_PORT_ID    = "utilitycraft:ind_energy_port";
export const IND_FLUID_PORT_ID     = "utilitycraft:ind_fluid_port";
export const IND_ITEM_PORT_ID      = "utilitycraft:ind_item_port";

// ── Tank initialisation ───────────────────────────────────────────────────────

/**
 * Initialise N fluid tanks on an entity and ensure every tank's capacity
 * matches `capacity`.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {number} count
 * @param {number} capacity
 * @returns {import("DoriosCore/index.js").FluidStorage[]}
 */
export function initFluidTanks(entity, count, capacity) {
    const tanks = FluidStorage.initializeMultiple(entity, count);
    for (const tank of tanks) {
        if (tank.getCap() !== capacity) tank.setCap(capacity);
    }
    return tanks;
}

/**
 * Initialise a single fluid tank and ensure its capacity matches `capacity`.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {number} capacity
 * @returns {import("DoriosCore/index.js").FluidStorage}
 */
export function initFluidTank(entity, capacity) {
    const tank = FluidStorage.initializeSingle(entity);
    if (tank.getCap() !== capacity) tank.setCap(capacity);
    return tank;
}

/**
 * Initialise energy storage on an entity and ensure its capacity matches
 * `capacity`.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {number} capacity
 * @returns {import("DoriosCore/index.js").EnergyStorage}
 */
export function initEnergy(entity, capacity) {
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== capacity) energy.setCap(capacity);
    return energy;
}

// ── Tank locking ──────────────────────────────────────────────────────────────

/**
 * Lock one fluid tank slot so the DoriosCore pipe system never auto-reassigns
 * it. If `fluidType` is given the slot is also pinned to that specific fluid.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {string} lockTag
 * @param {number} slotIndex
 * @param {string|null} [fluidType]
 */
export function lockTankSlot(entity, lockTag, slotIndex, fluidType = null) {
    if (!entity.hasTag(lockTag)) {
        entity.addTag(lockTag);
        if (fluidType !== null) {
            const prefix = `fluid${slotIndex}Type:`;
            if (!entity.getTags().find(t => t.startsWith(prefix))) {
                entity.addTag(`${prefix}${fluidType}`);
            }
        }
    }
}

// ── Tank guard ────────────────────────────────────────────────────────────────

/**
 * Evict any fluid from `tank` that is not in `allowed`.
 * Pass a `string` for a single-type whitelist or a `Set<string>` for multiple.
 *
 * @param {import("DoriosCore/index.js").FluidStorage} tank
 * @param {string | Set<string>} allowed
 */
export function guardTank(tank, allowed) {
    const type = tank.getType();
    if (type === "empty") return;
    const ok = typeof allowed === "string" ? type === allowed : allowed.has(type);
    if (!ok) { tank.set(0); tank.setType("empty"); }
}

// ── Structure validation ──────────────────────────────────────────────────────

const PORT_DEFS = {
    normal: {
        energy: { id: ENERGY_PORT_ID,     label: "Energy Valve" },
        fluid:  { id: FLUID_PORT_ID,      label: "Fluid Valve"  },
    },
    industrial: {
        energy: { id: IND_ENERGY_PORT_ID, label: "Industrial Energy Port" },
        fluid:  { id: IND_FLUID_PORT_ID,  label: "Industrial Fluid Port"  },
        item:   { id: IND_ITEM_PORT_ID,   label: "Industrial Item Port"   },
    },
};

/**
 * Validate a multiblock structure's size and required ports.
 *
 * Usage in onActivate:
 *
 *   const err = validateStructure(entity, structure, player, {
 *       name:     "Fuel Burner",
 *       minSize:  { x: 3, y: 3, z: 3 },
 *       ports:    { energy: 1, fluid: 1 },
 *       portType: "normal",      // "normal" | "industrial" (default: "industrial")
 *   });
 *   if (err) return false;
 *
 * @param {import("@minecraft/server").Entity}  entity
 * @param {object}  structure
 * @param {import("@minecraft/server").Player}  player
 * @param {{
 *   name:      string,
 *   size?:     { x: number, y: number, z: number },
 *   minSize?:  { x: number, y: number, z: number },
 *   ports?:    { energy?: number, fluid?: number, item?: number },
 *   portType?: "normal" | "industrial",
 *   noAir?:   boolean,
 * }} opts
 * @returns {null | false}
 */
export function validateStructure(entity, structure, player, opts) {
    const { min, max } = structure.bounds;
    const sX = max.x - min.x + 1;
    const sY = max.y - min.y + 1;
    const sZ = max.z - min.z + 1;
    const tag = `§c[${opts.name}] `;

    if (opts.size) {
        const { x, y, z } = opts.size;
        const rotated = sX === z && sY === y && sZ === x;
        const exact   = sX === x && sY === y && sZ === z;
        if (!exact && !rotated) {
            player.sendMessage(`${tag}Must be ${x}×${y}×${z}. Found: ${sX}×${sY}×${sZ}.`);
            return true;
        }
    } else if (opts.minSize) {
        const { x, y, z } = opts.minSize;
        const fitsNormal  = sX >= x && sY >= y && sZ >= z;
        const fitsRotated = sX >= z && sY >= y && sZ >= x;
        if (!fitsNormal && !fitsRotated) {
            player.sendMessage(`${tag}Minimum size ${x}×${y}×${z}. Found: ${sX}×${sY}×${sZ}.`);
            return true;
        }
    }

    if (opts.noAir) {
        const airCount = structure.components?.air ?? 0;
        if (airCount > 0) {
            player.sendMessage(`${tag}Structure must be fully solid — ${airCount} air block(s) found inside.`);
            return true;
        }
    }

    if (opts.ports) {
        const defs  = PORT_DEFS[opts.portType ?? "industrial"];
        const found = Object.fromEntries(Object.keys(defs).map(k => [k, 0]));
        const dim   = entity.dimension;

        for (const portTag of structure.inputBlocks) {
            const loc   = DoriosLib.linkNode.parseLinkNodeTag(portTag);
            const block = loc && dim.getBlock(loc);
            if (!block) continue;
            for (const [key, def] of Object.entries(defs)) {
                if (block.typeId === def.id) found[key]++;
            }
        }

        for (const [key, required] of Object.entries(opts.ports)) {
            if (!required) continue;
            const def = defs[key];
            if (!def) continue;
            if (found[key] < required) {
                player.sendMessage(
                    `${tag}Need ${required}× §e${def.label}§c — found ${found[key]}.`
                );
                return true;
            }
        }
    }

    return null;
}

// ── Display helpers (moved from multiblock_helpers.js) ────────────────────────

/**
 * Rate-limit a per-entity recurring task. Returns true only on the tick that
 * completes one full interval, false on every other tick.
 *
 * @param {import("@minecraft/server").Entity} entity
 * @param {string} key
 * @param {number} interval
 * @returns {boolean}
 */
export function tickGate(entity, key, interval) {
    const safeInterval = Math.max(1, Math.floor(interval ?? 1));
    const prop = `ac:tick_gate:${key}`;
    const next = ((entity.getDynamicProperty(prop) ?? 0) + 1) % safeInterval;
    entity.setDynamicProperty(prop, next);
    return next === 0;
}

/**
 * Convert a snake_case fluid type ID into a human-readable display name.
 * Strips any namespace prefix before formatting.
 *
 * @param {string} type
 * @returns {string}
 */
export function formatFluidDisplayName(type) {
    if (!type || type === "empty") return "Empty";
    const local = type.includes(":") ? type.split(":")[1] : type;
    return local
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}