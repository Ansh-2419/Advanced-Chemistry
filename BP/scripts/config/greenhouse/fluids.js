import { system, world } from "@minecraft/server";

/**
 * Fertilizer tiers (fluid type short-id → stats).
 * yieldMultiplier — scales final drop quantity.
 * consumption     — mB consumed per harvest cycle.
 */
const FERTILIZER_TIERS = {
    fertilizer_org:        { yieldMultiplier: 1.10, consumption: 100 },
    fertilizer_enriched:   { yieldMultiplier: 1.25, consumption:  80 },
    fertilizer_industrial: { yieldMultiplier: 1.50, consumption:  60 },
};

/**
 * Growth-solution tiers (fluid type short-id → stats).
 * growthMultiplier — divides energy cost, speeding up cycles.
 * consumption      — mB consumed per harvest cycle.
 */
const GROWTH_TIERS = {
    bio_growth_solution:      { growthMultiplier: 1.20, consumption: 100 },
    nutrient_growth_solution: { growthMultiplier: 1.40, consumption:  80 },
    advanced_growth_catalyst: { growthMultiplier: 1.70, consumption:  60 },
};

export const VALID_FERTILIZERS   = new Set(Object.keys(FERTILIZER_TIERS));
export const VALID_GROWTH_FLUIDS = new Set(Object.keys(GROWTH_TIERS));

/**
 * Returns raw productivity stats for the given fluid types.
 * Falls back to neutral values (multiplier 1, consumption 0) when a tank is
 * empty or holds an unrecognised fluid — the machine still runs, just at base rates.
 *
 * @param {string} fertilizer   Short fluid-type id from FluidStorage.getType()
 * @param {string} growthFluid  Short fluid-type id from FluidStorage.getType()
 */
export function getProductivity(fertilizer, growthFluid) {
    const f = FERTILIZER_TIERS[fertilizer];
    const g = GROWTH_TIERS[growthFluid];
    return {
        yieldMultiplier:  f ? f.yieldMultiplier  : 1,
        growthMultiplier: g ? g.growthMultiplier : 1,
        fertConsumption:  f ? f.consumption      : 0,
        growthConsumption: g ? g.consumption     : 0,
    };
}

// ── ScriptEvent registration API ──────────────────────────────────────────────
//
// Other addons can register custom fluids at runtime via /scriptevent:
//
//  Fertilizer:
//    scriptevent utilitycraft:register_fertilizer <json>
//    { "my_fluid_id": { "yieldMultiplier": 1.30, "consumption": 90 } }
//
//  Growth solution:
//    scriptevent utilitycraft:register_growth_fluid <json>
//    { "my_fluid_id": { "growthMultiplier": 1.50, "consumption": 70 } }
//
//  IDs are short (no namespace). Namespaced IDs like "mymod:my_fluid" are
//  accepted and automatically stripped to "my_fluid".
//
//  Required fields:
//    fertilizer   → yieldMultiplier ≥ 1.0, consumption > 0
//    growth fluid → growthMultiplier ≥ 1.0, consumption > 0

system.afterEvents.scriptEventReceive.subscribe(ev => {
    if (ev.id === "utilitycraft:register_fertilizer") {
        _register(ev.message, FERTILIZER_TIERS, VALID_FERTILIZERS, {
            requiredKeys: ["yieldMultiplier", "consumption"],
            type: "fertilizer",
            validate: d => d.yieldMultiplier >= 1.0 && d.consumption > 0,
        });
    } else if (ev.id === "utilitycraft:register_growth_fluid") {
        _register(ev.message, GROWTH_TIERS, VALID_GROWTH_FLUIDS, {
            requiredKeys: ["growthMultiplier", "consumption"],
            type: "growth_fluid",
            validate: d => d.growthMultiplier >= 1.0 && d.consumption > 0,
        });
    }
}, { namespaces: ["utilitycraft"] });

function _register(message, registry, validSet, { requiredKeys, type, validate }) {
    let payload;
    try { payload = JSON.parse(message); }
    catch { console.warn(`[AoC Greenhouse] Bad JSON for ${type} registration.`); return; }

    const added = [], replaced = [];

    for (const [rawId, def] of Object.entries(payload)) {
        const id = rawId.includes(":") ? rawId.split(":").pop() : rawId;

        if (!requiredKeys.every(k => k in def)) {
            console.warn(`[AoC Greenhouse] Skipping '${id}' — missing: ${requiredKeys.join(", ")}`);
            continue;
        }
        if (!validate(def)) {
            console.warn(`[AoC Greenhouse] Skipping '${id}' — invalid values.`);
            continue;
        }

        (id in registry ? replaced : added).push(id);
        registry[id] = def;
        validSet.add(id);
    }

    if (added.length || replaced.length)
        console.warn(`[AoC Greenhouse] ${type}: +${added.length} registered, ~${replaced.length} replaced.`);

    try {
        world.getDimension("overworld").runCommand(
            `scriptevent utilitycraft:productivity_response ${JSON.stringify({ type, added, replaced })}`
        );
    } catch { }
}
