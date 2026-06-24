import { system } from "@minecraft/server";

const DEFAULT_ENERGY_COST = 3600;
const DEFAULT_FLUID_AMOUNT = 250;
const DEFAULT_INPUT_AMOUNT = 1;
const TICKS_PER_SECOND = 20;
const DEFAULT_PROCESS_SECONDS = 6;

/**
 * Native Fermentation recipes with explicit per-recipe batching including fluidAmount.
 */
const nativeFermentationRecipes = [
    defineFermentationRecipe({
        id: "utilitycraft:plant_oil_from_wheat_seeds",
        input: { id: "minecraft:wheat_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 6,
        batch: {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: 64, seconds: 8, fluidAmount: 1200 }
        },
        description: "Presses wheat seeds into plant oil."
    }),
    defineFermentationRecipe({
        id: "utilitycraft:plant_oil_from_beetroot_seeds",
        input: { id: "minecraft:beetroot_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 6,
        batch: {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: 64, seconds: 8, fluidAmount: 1200 }
        },
        description: "Presses beetroot seeds into plant oil."
    }),
    defineFermentationRecipe({
        id: "utilitycraft:plant_oil_from_melon_seeds",
        input: { id: "minecraft:melon_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 6,
        batch: {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: 64, seconds: 8, fluidAmount: 1200 }
        },
        description: "Presses melon seeds into plant oil."
    }),
    defineFermentationRecipe({
        id: "utilitycraft:plant_oil_from_pumpkin_seeds",
        input: { id: "minecraft:pumpkin_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 6,
        batch: {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: 64, seconds: 8, fluidAmount: 1200 }
        },
        description: "Presses pumpkin seeds into plant oil."
    }),
    defineFermentationRecipe({
        id: "utilitycraft:ethanol_from_sugarcane",
        input: { id: "minecraft:sugar_cane", amount: 64 },
        fluid: { type: "ethanol", amount: 1200 },
        energyCost: 7800,
        seconds: 10,
        byproduct: {
            id: "minecraft:sugar",
            amount: 15,
            chance: 0.4
        },
        batch: {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: 64, seconds: 8, fluidAmount: 1200 }
        },
        description: "Ferments sugarcane into a full bucket of ethanol."
    }),
];

const fermentationRecipes = nativeFermentationRecipes.slice();

export function getFermentationRecipes() {
    return fermentationRecipes.slice();
}

/* Helpers */

function toFiniteInt(value, fallback, min = 1) {
    const n = Number(value);
    if (!Number.isFinite(n)) return Math.max(min, Math.floor(fallback));
    return Math.max(min, Math.floor(n));
}

function defineFermentationRecipe(recipe) {
    if (!recipe || typeof recipe !== "object") throw new TypeError("Invalid fermentation recipe payload");

    const input = normalizeStack(recipe.input, DEFAULT_INPUT_AMOUNT);
    const fluid = normalizeFluid(recipe.fluid, DEFAULT_FLUID_AMOUNT);
    const seconds = toFiniteInt(recipe.seconds ?? DEFAULT_PROCESS_SECONDS, DEFAULT_PROCESS_SECONDS, 1);
    const batches = normalizeBatches(recipe.batch, input.amount, fluid.amount);

    return {
        id: typeof recipe.id === "string" && recipe.id.length ? recipe.id : input.id,
        input,
        fluid,
        energyCost: toFiniteInt(recipe.energyCost ?? DEFAULT_ENERGY_COST, DEFAULT_ENERGY_COST, 1),
        ticks: Math.max(1, seconds * TICKS_PER_SECOND),
        seconds,
        byproduct: normalizeByproduct(recipe.byproduct),
        description: typeof recipe.description === "string" ? recipe.description : null,
        batches
    };
}

function normalizeStack(stack, fallbackAmount) {
    if (typeof stack === "string") {
        const id = stack;
        validateItemId(id);
        const amount = Math.max(1, Math.floor(fallbackAmount ?? DEFAULT_INPUT_AMOUNT));
        return { id, amount };
    }
    if (!stack || typeof stack !== "object") throw new TypeError("Fermentation recipe missing input definition");
    const id = typeof stack.id === "string" ? stack.id : null;
    if (!id) throw new TypeError("Fermentation stack requires an identifier");
    validateItemId(id);
    const amount = toFiniteInt(stack.amount ?? fallbackAmount ?? 1, fallbackAmount ?? 1, 1);
    return { id, amount };
}

function normalizeFluid(fluid, fallbackAmount) {
    if (!fluid || typeof fluid !== "object") throw new TypeError("Fermentation recipe missing fluid block");
    const type = typeof fluid.type === "string" ? fluid.type.toLowerCase() : null;
    if (!type) throw new TypeError("Fermentation fluid output requires a type");
    validateFluidType(type);
    const amount = toFiniteInt(fluid.amount ?? fallbackAmount ?? DEFAULT_FLUID_AMOUNT, fallbackAmount ?? DEFAULT_FLUID_AMOUNT, 1);
    return { type, amount };
}

function normalizeByproduct(byproduct) {
    if (!byproduct || typeof byproduct !== "object") return null;
    const id = typeof byproduct.id === "string" ? byproduct.id : null;
    if (!id) return null;
    validateItemId(id);
    const amount = toFiniteInt(byproduct.amount ?? 1, 1, 1);
    const chance = clampChance(byproduct.chance ?? byproduct.probability ?? 1);
    return { id, amount, chance };
}

function normalizeBatches(batch, inputAmount, canonicalFluidAmount) {
    // Defaults
    const DEFAULT_SMALL_SIZE = 8;
    const DEFAULT_SMALL_SECONDS = 6;
    const DEFAULT_SMALL_FLUID = 150;
    const DEFAULT_LARGE_SIZE = Math.max(1, Math.floor(inputAmount ?? 64));
    const DEFAULT_LARGE_SECONDS = 8;
    const DEFAULT_LARGE_FLUID = Math.max(1, Math.floor(canonicalFluidAmount ?? DEFAULT_FLUID_AMOUNT));

    const b = batch && typeof batch === 'object' ? batch : {};

    const small = (b.small && typeof b.small === 'object') ? b.small : {};
    const large = (b.large && typeof b.large === 'object') ? b.large : {};

    const smallSize = Math.max(1, Math.floor(small.size ?? DEFAULT_SMALL_SIZE));
    const smallSeconds = Math.max(1, Math.floor(small.seconds ?? DEFAULT_SMALL_SECONDS));
    const smallFluid = Number.isFinite(Number(small.fluidAmount ?? small.fluid ?? undefined))
        ? Math.max(0, Math.floor(Number(small.fluidAmount ?? small.fluid)))
        : DEFAULT_SMALL_FLUID;

    const largeSize = Math.max(1, Math.floor(large.size ?? DEFAULT_LARGE_SIZE));
    const largeSeconds = Math.max(1, Math.floor(large.seconds ?? DEFAULT_LARGE_SECONDS));
    const largeFluid = Number.isFinite(Number(large.fluidAmount ?? large.fluid ?? undefined))
        ? Math.max(0, Math.floor(Number(large.fluidAmount ?? large.fluid)))
        : DEFAULT_LARGE_FLUID;

    return {
        small: { size: smallSize, seconds: smallSeconds, fluidAmount: smallFluid },
        large: { size: largeSize, seconds: largeSeconds, fluidAmount: largeFluid }
    };
}

function validateItemId(id) {
    if (typeof id !== "string" || id.length === 0) throw new TypeError("Item id must be a non-empty string");
    if (!id.includes(":")) throw new TypeError(`Item id must be namespaced (e.g. 'minecraft:potato'): '${id}'`);
    if (!/^[a-z0-9_.\-:\/]+$/.test(id)) throw new TypeError(`Invalid characters in item id: '${id}'`);
}

function validateFluidType(type) {
    if (typeof type !== "string" || type.length === 0) throw new TypeError("Fluid type must be a non-empty string");
    if (!/^[a-z0-9_\-]+$/.test(type)) throw new TypeError(`Invalid fluid type: '${type}'`);
}

function clampChance(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(0, Math.min(1, parsed));
}

const FERMENTATION_EVENT_ID = "utilitycraft:register_fermentation_recipe";

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== FERMENTATION_EVENT_ID) return;

    try {
        if (typeof message !== "string" || message.length > 200000) {
            console.warn("[UtilityCraft] Fermentation recipe payload too large; ignoring.");
            return;
        }

        const payload = JSON.parse(message);
        if (!payload || typeof payload !== "object") return;

        const entries = Object.entries(payload);
        if (entries.length > 500) {
            console.warn(`[UtilityCraft] Fermentation recipe payload contains too many entries (${entries.length}); rejecting.`);
            return;
        }

        let added = 0;
        let replaced = 0;

        for (const [recipeId, definition] of entries) {
            if (!definition || typeof definition !== "object") {
                console.warn(`[UtilityCraft] Ignored invalid fermentation recipe '${recipeId}'.`);
                continue;
            }

            try {
                const status = upsertFermentationRecipe({ id: recipeId, ...definition });
                if (status === "replaced") replaced++; else added++;
            } catch (err) {
                console.warn(`[UtilityCraft] Failed to register fermentation recipe '${recipeId}':`, err);
            }
        }

        console.warn(`[UtilityCraft] Fermentation registered ${added} new and replaced ${replaced} recipes.`);
    } catch (err) {
        console.warn("[UtilityCraft] Failed to parse fermentation recipe payload:", err);
    }
});

function upsertFermentationRecipe(definition) {
    const recipe = defineFermentationRecipe(definition);
    const index = fermentationRecipes.findIndex(entry => entry.id === recipe.id);

    if (index >= 0) {
        console.warn(`[UtilityCraft] Replacing existing fermentation recipe with id '${recipe.id}'.`);
        fermentationRecipes[index] = recipe;
        return "replaced";
    }

    fermentationRecipes.push(recipe);
    return "added";
}