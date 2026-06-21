import { system } from "@minecraft/server";

/**
 * Chemical Reactor recipes.
 * One fluid input → one fluid output + optional item byproduct.
 *
 * @typedef {{ type:string, amount:number }} FluidIO
 * @typedef {{ item:string, count:number, chance:number }} Byproduct
 * @typedef {{ id:string, input:FluidIO, output:FluidIO, energyCost:number, seconds:number, byproduct?:Byproduct }} CRRecipe
 */

/** @type {CRRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id:          "utilitycraft:hydrocarbon_slurry_from_biofuel",
        input:       { type: "biofuel",            amount: 1000 },
        output:      { type: "hydrocarbon_slurry", amount: 750  },
        energyCost:  9600,
        seconds:     12,
        description: "Chemically cracks biofuel into a thick hydrocarbon slurry.",
        // No byproduct on base recipe — can be added via ScriptEvent
    }),
];

export const chemicalReactorRecipes = nativeRecipes;
export function getChemicalReactorRecipes() { return chemicalReactorRecipes; }

function defineRecipe(r) {
    if (!r || typeof r !== "object") throw new TypeError("Invalid chemical reactor recipe");
    return {
        id:          r.id ?? `cr_${r.input.type}_to_${r.output.type}`,
        input:       { type: r.input.type.toLowerCase(),  amount: Math.max(1, r.input.amount  ?? 1000) },
        output:      { type: r.output.type.toLowerCase(), amount: Math.max(1, r.output.amount ?? 750)  },
        energyCost:  Math.max(1, r.energyCost  ?? 9600),
        seconds:     Math.max(1, r.seconds     ?? 12),
        description: r.description ?? null,
        byproduct:   r.byproduct
            ? {
                item:   r.byproduct.item,
                count:  Math.max(1, r.byproduct.count  ?? 1),
                chance: Math.min(1, Math.max(0, r.byproduct.chance ?? 1.0)),
              }
            : undefined,
    };
}

// ── ScriptEvent injection ─────────────────────────────────────────────────────
system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_chemical_reactor_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx    = chemicalReactorRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { chemicalReactorRecipes[idx] = recipe; replaced++; }
                else          { chemicalReactorRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AGE OF CHEMICAL] Bad chemical reactor recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AGE OF CHEMICAL] Chemical Reactor: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn("[AGE OF CHEMICAL] Failed to parse chemical reactor recipe payload:", err);
    }
});
