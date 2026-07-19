import { system } from "@minecraft/server";

/**
 * Chemical Reactor recipes.
 * One fluid input → one fluid output + optional byproduct(s).
 *
 * Byproducts may be:
 *   - item only:  { item, count?, chance? }
 *   - fluid only: { fluid: { type, amount }, chance? }
 *   - both:       { item, count?, fluid: { type, amount }, chance? }
 *   - an array of any mix of the above, for multiple independent byproducts
 *
 * @typedef {{ type:string, amount:number }} FluidIO
 * @typedef {{ item?:string, count?:number, fluid?:FluidIO, chance?:number }} Byproduct
 * @typedef {{ id:string, input:FluidIO, output:FluidIO, energyCost:number, seconds:number, byproduct?:Byproduct|Byproduct[] }} CRRecipe
 */

/** @type {CRRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id: "utilitycraft:hydrocarbon_slurry_from_biofuel",
        input: { type: "biofuel", amount: 1000 },
        output: { type: "hydrocarbon_slurry", amount: 750 },
        energyCost: 9600,
        seconds: 12,
        description:
            "Chemically cracks biofuel into a thick hydrocarbon slurry."
        // No byproduct on base recipe — can be added via ScriptEvent
    }),
    defineRecipe({
        id: "utilitycraft:crude_oil_from_heavy_hydrocarbon",
        input: { type: "heavy_hydrocarbon", amount: 400 },
        output: { type: "crude_oil", amount: 250 },
        energyCost: 8400,
        seconds: 10,
        description: "Refines heavy hydrocarbon into crude oil."
    }),
    defineRecipe({
        id: "utilitycraft:naphtha_to_plastic_resin",
        input: { type: "naphtha", amount: 1000 },
        output: { type: "plastic_resin", amount: 750 },
        energyCost: 10_000,
        seconds: 12,
        description: "Polymerises naphtha into liquid plastic resin."
    })
];

export const chemicalReactorRecipes = nativeRecipes;
export function getChemicalReactorRecipes() {
    return chemicalReactorRecipes;
}

function defineRecipe(r) {
    if (!r || typeof r !== "object")
        throw new TypeError("Invalid chemical reactor recipe");
    return {
        id: r.id ?? `cr_${r.input.type}_to_${r.output.type}`,
        input: {
            type: r.input.type.toLowerCase(),
            amount: Math.max(1, r.input.amount ?? 1000)
        },
        output: {
            type: r.output.type.toLowerCase(),
            amount: Math.max(1, r.output.amount ?? 750)
        },
        energyCost: Math.max(1, r.energyCost ?? 9600),
        seconds: Math.max(1, r.seconds ?? 12),
        description: r.description ?? null,
        byproduct: normalizeByproducts(r.byproduct)
    };
}

function normalizeByproducts(raw) {
    if (!raw) return undefined;
    const list = Array.isArray(raw) ? raw : [raw];
    const normalized = list
        .filter(Boolean)
        .map(bp => normalizeByproduct(bp))
        .filter(Boolean);
    if (!normalized.length) return undefined;
    return normalized.length === 1 ? normalized[0] : normalized;
}

function normalizeByproduct(bp) {
    if (!bp || typeof bp !== "object") return null;

    const hasItem = typeof bp.item === "string" && bp.item.length > 0;
    const hasFluid =
        bp.fluid &&
        typeof bp.fluid.type === "string" &&
        bp.fluid.type.length > 0 &&
        (bp.fluid.amount ?? 0) > 0;

    if (!hasItem && !hasFluid) return null; // nothing valid to add

    const out = {
        chance: Math.min(1, Math.max(0, bp.chance ?? 1.0))
    };

    if (hasItem) {
        out.item = bp.item;
        out.count = Math.max(1, bp.count ?? 1);
    }

    if (hasFluid) {
        out.fluid = {
            type: bp.fluid.type.toLowerCase(),
            amount: Math.max(1, bp.fluid.amount)
        };
    }

    return out;
}

// ── ScriptEvent injection ─────────────────────────────────────────────────────
system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_chemical_reactor_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0,
            replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx = chemicalReactorRecipes.findIndex(
                    r => r.id === recipe.id
                );
                if (idx >= 0) {
                    chemicalReactorRecipes[idx] = recipe;
                    replaced++;
                } else {
                    chemicalReactorRecipes.push(recipe);
                    added++;
                }
            } catch (err) {
                console.warn(
                    `[AGE OF CHEMICAL] Bad chemical reactor recipe '${recipeId}':`,
                    err
                );
            }
        }
        console.warn(
            `[AGE OF CHEMICAL] Chemical Reactor: +${added} new, ~${replaced} replaced.`
        );
    } catch (err) {
        console.warn(
            "[AGE OF CHEMICAL] Failed to parse chemical reactor recipe payload:",
            err
        );
    }
});
