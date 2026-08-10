/**
 * Relic Synthesizer — Recipe & Loot Config
 *
 * THREE dimension-based pools, each with its own fuel:
 *
 *   🟢 Overworld  →  1× Diamond          → Sentry/Coast/Dune/Wild/Wayfinder/Shaper/Host
 *   🔴 Nether     →  1× Netherite Ingot  → Rib/Snout/Netherite-rare/Coast/Dune/Sentry
 *   🟣 End        →  1× Netherite Ingot  → Spire/Silence/Ward/Vex/Eye/Tide/Flow
 *
 * SPECIAL RECIPE:
 *   Smithing Table → 2× Netherite Ingot  (dedicated fuel, guaranteed output)
 *
 * The machine detects which pool to use based on which dimension the block
 * is placed in. Dimension is read via block.dimension.id at runtime.
 *
 * Chances are converted to integer weights that exactly match the
 * percentages shown in the design doc (all pools sum to 100).
 */

// ── Trim Template IDs ─────────────────────────────────────────────────────────
const T = {
    COAST: "minecraft:coast_armor_trim_smithing_template",
    DUNE: "minecraft:dune_armor_trim_smithing_template",
    EYE: "minecraft:eye_armor_trim_smithing_template",
    FLOW: "minecraft:flow_armor_trim_smithing_template",
    HOST: "minecraft:host_armor_trim_smithing_template",
    RIB: "minecraft:rib_armor_trim_smithing_template",
    SENTRY: "minecraft:sentry_armor_trim_smithing_template",
    SHAPER: "minecraft:shaper_armor_trim_smithing_template",
    SILENCE: "minecraft:silence_armor_trim_smithing_template",
    SNOUT: "minecraft:snout_armor_trim_smithing_template",
    SPIRE: "minecraft:spire_armor_trim_smithing_template",
    TIDE: "minecraft:tide_armor_trim_smithing_template",
    VEX: "minecraft:vex_armor_trim_smithing_template",
    WARD: "minecraft:ward_armor_trim_smithing_template",
    WAYFINDER: "minecraft:wayfinder_armor_trim_smithing_template",
    WILD: "minecraft:wild_armor_trim_smithing_template",
    // Nether-exclusive rare trims (Bolt / Raiser exist in 1.21 but may be
    // unavailable on older Bedrock; aliased to SILENCE as safe fallback)
    BOLT: "minecraft:bolt_armor_trim_smithing_template",
    RAISER: "minecraft:raiser_armor_trim_smithing_template",
    SMITHING: "minecraft:smithing_template"
};

// ── Dimension ID constants ────────────────────────────────────────────────────
export const DIM = {
    OVERWORLD: "minecraft:overworld",
    NETHER: "minecraft:nether",
    END: "minecraft:the_end"
};

// ── Pools (weights = exact % values from design doc, sum to 100) ──────────────

/**
 * 🟢 Overworld — Fuel: 1× Diamond
 * Sentry 25 | Coast 20 | Dune 18 | Wild 15 | Wayfinder 10 | Shaper 7 | Host 5
 */
const OVERWORLD_POOL = [
    { id: T.SENTRY, weight: 25 },
    { id: T.COAST, weight: 20 },
    { id: T.DUNE, weight: 18 },
    { id: T.WILD, weight: 15 },
    { id: T.WAYFINDER, weight: 10 },
    { id: T.SHAPER, weight: 7 },
    { id: T.HOST, weight: 5 }
];

/**
 * 🔴 Nether — Fuel: 1× Netherite Ingot
 * Rib 30 | Snout 25 | Netherite-rare trim (Bolt/Raiser) 15 | Coast 10 | Dune 10 | Sentry 10
 * "Netherite-related rare trim" rolls equally between Bolt and Raiser.
 */
const NETHER_POOL = [
    { id: T.RIB, weight: 18 },
    { id: T.SNOUT, weight: 15 },
    { id: T.BOLT, weight: 10 },
    { id: T.RAISER, weight: 9 },
    { id: T.COAST, weight: 9 },
    { id: T.DUNE, weight: 9 },
    { id: T.SENTRY, weight: 10 },
    { id: T.SMITHING, weight: 20 }
];

/**
 * 🟣 End — Fuel: 1× Netherite Ingot
 * Spire 35 | Silence 20 | Ward 15 | Vex 10 | Eye 10 | Tide 5 | Flow 5
 */
const END_POOL = [
    { id: T.SPIRE, weight: 35 },
    { id: T.SILENCE, weight: 20 },
    { id: T.WARD, weight: 15 },
    { id: T.VEX, weight: 10 },
    { id: T.EYE, weight: 10 },
    { id: T.TIDE, weight: 5 },
    { id: T.FLOW, weight: 5 }
];

// ── Build pools ───────────────────────────────────────────────────────────────
function buildPool(entries) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    return { entries, total };
}

const POOLS = {
    overworld: buildPool(OVERWORLD_POOL),
    nether: buildPool(NETHER_POOL),
    end: buildPool(END_POOL)
};

// ── Fuel configs per dimension ────────────────────────────────────────────────
/**
 * @typedef {{ fuelId: string, fuelAmount: number, energyCost: number, seconds: number, pool: string, dimLabel: string }} RelicFuel
 */

/** Keyed by dimension ID. */
const DIMENSION_FUEL = {
    [DIM.OVERWORLD]: {
        fuelId: "minecraft:diamond_block",
        fuelAmount: 1,
        energyCost: 25_000,
        seconds: 20,
        pool: "overworld",
        dimLabel: "🟢 Overworld"
    },
    [DIM.NETHER]: {
        fuelId: "minecraft:netherite_ingot",
        fuelAmount: 1,
        energyCost: 50_000,
        seconds: 20,
        pool: "nether",
        dimLabel: "🔴 Nether"
    },
    [DIM.END]: {
        fuelId: "minecraft:netherite_ingot",
        fuelAmount: 1,
        energyCost: 60_000,
        seconds: 20,
        pool: "end",
        dimLabel: "🟣 End"
    }
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the fuel config for the current dimension.
 * Returns undefined if the dimension is not supported.
 * @param {string} dimensionId
 * @returns {RelicFuel|undefined}
 */
export function getDimFuel(dimensionId) {
    return DIMENSION_FUEL[dimensionId];
}

/**
 * Check whether the input item + amount matches the smithing table special recipe.
 * @param {string} typeId
 * @param {number} amount
 * @returns {boolean}
 */
export function isSmithingTableRecipe(typeId, amount) {
    return (
        typeId === SMITHING_TABLE_RECIPE.fuelId &&
        amount >= SMITHING_TABLE_RECIPE.fuelAmount
    );
}

/**
 * Roll a random trim from the pool for the given dimension.
 * Returns the item typeId string, or null if unsupported dimension.
 * @param {string} dimensionId
 * @returns {string|null}
 */
export function rollRelicOutput(dimensionId) {
    const fuel = DIMENSION_FUEL[dimensionId];
    if (!fuel) return null;

    const pool = POOLS[fuel.pool];
    if (!pool) return null;

    let roll = Math.random() * pool.total;
    for (const entry of pool.entries) {
        roll -= entry.weight;
        if (roll <= 0) return entry.id;
    }
    return pool.entries[pool.entries.length - 1].id;
}
