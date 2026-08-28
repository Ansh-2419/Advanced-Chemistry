import { system } from "@minecraft/server";

/**
 * Chemical Reactor recipes.
 * One fluid input → one fluid output.
 *
 * @typedef {{ type:string, amount:number }} FluidIO
 * @typedef {{ id:string, input:FluidIO, output:FluidIO, energyCost:number, seconds:number }} CRRecipe
 */

/** @type {CRRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id:         "utilitycraft:hydrocarbon_slurry_from_biofuel",
        input:      { type: "biofuel",            amount: 1000 },
        output:     { type: "hydrocarbon_slurry", amount: 750  },
        energyCost: 12_600,
        seconds:    6,
    }),
    defineRecipe({
        id:         "utilitycraft:crude_oil_from_heavy_hydrocarbon",
        input:      { type: "heavy_hydrocarbon", amount: 400 },
        output:     { type: "crude_oil",         amount: 250 },
        energyCost: 9_400,
        seconds:    8,
    }),
    defineRecipe({
        id:         "utilitycraft:naphtha_to_plastic_resin",
        input:      { type: "naphtha",       amount: 1000 },
        output:     { type: "plastic_resin", amount: 750  },
        energyCost: 10_000,
        seconds:    10,
    }),
];

export const chemicalReactorRecipes = nativeRecipes;
export function getChemicalReactorRecipes() {
    return chemicalReactorRecipes;
}

function defineRecipe(r) {
    if (!r || typeof r !== "object")
        throw new TypeError("Invalid chemical reactor recipe");
    return {
        id:         r.id ?? `cr_${r.input.type}_to_${r.output.type}`,
        input:      { type: r.input.type.toLowerCase(),  amount: Math.max(1, r.input.amount  ?? 1000) },
        output:     { type: r.output.type.toLowerCase(), amount: Math.max(1, r.output.amount ?? 750)  },
        energyCost: Math.max(1, r.energyCost ?? 9600),
        seconds:    Math.max(1, r.seconds    ?? 12),
    };
}

// ── ScriptEvent injection (other addons can add recipes at runtime) ────────────
// scriptevent utilitycraft:register_chemical_reactor_recipe <json>
//
// JSON: { "recipe_id": { input, output, energyCost, seconds } }
// Example:
//   { "myaddon:my_recipe": { "input": { "type": "ethanol", "amount": 500 },
//                            "output": { "type": "biofuel",  "amount": 400 },
//                            "energyCost": 8000, "seconds": 8 } }

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_chemical_reactor_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx = chemicalReactorRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { chemicalReactorRecipes[idx] = recipe; replaced++; }
                else          { chemicalReactorRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AoC] Bad chemical reactor recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AoC] Chemical Reactor: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn("[AoC] Failed to parse chemical reactor recipe payload:", err);
    }
});
