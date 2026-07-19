import { system } from "@minecraft/server";

/**
 * Polymerizer recipes.
 * Fluid input → item output.
 *
 * @typedef {{ type: string, amount: number }} FluidInput
 * @typedef {{ item: string, count: number }} ItemOutput
 * @typedef {{ id: string, input: FluidInput, output: ItemOutput, energyCost: number, seconds: number }} PolymerizerRecipe
 */

/** @type {PolymerizerRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id:          "ac:hdpe_pallet_from_plastic_resin",
        input:       { type: "plastic_resin", amount: 250 },
        output:      { item: "ac:hdpe_pallet", count: 1 },
        energyCost:  10_000,
        seconds:     5,          // 100t ÷ 20t/s
        description: "Polymerises plastic resin into an HDPE pallet.",
    }),
];

export const polymerizerRecipes = nativeRecipes;
export function getPolymerizerRecipes() {
    return polymerizerRecipes;
}

function defineRecipe(r) {
    if (!r || typeof r !== "object") throw new TypeError("Invalid polymerizer recipe");
    return {
        id:          r.id ?? `poly_${r.input.type}_to_${r.output.item}`,
        input: {
            type:   r.input.type.toLowerCase(),
            amount: Math.max(1, r.input.amount ?? 1000),
        },
        output: {
            item:  r.output.item,
            count: Math.max(1, r.output.count ?? 1),
        },
        energyCost:  Math.max(1, r.energyCost ?? 10_000),
        seconds:     Math.max(1, r.seconds ?? 5),
        description: r.description ?? null,
    };
}

// ── ScriptEvent injection ─────────────────────────────────────────────────────
system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "ac:register_polymerizer_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx = polymerizerRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { polymerizerRecipes[idx] = recipe; replaced++; }
                else          { polymerizerRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AOC] Bad polymerizer recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AOC] Polymerizer: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn("[AOC] Failed to parse polymerizer recipe payload:", err);
    }
});
