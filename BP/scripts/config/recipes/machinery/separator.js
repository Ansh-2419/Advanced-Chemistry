import { system } from "@minecraft/server";

/**
 * Separator recipes — one fluid in → two fluids out.
 *
 * @typedef {{ type:string, amount:number }} FluidIO
 * @typedef {{ id:string, input:FluidIO, output1:FluidIO, output2:FluidIO, energyCost:number }} SepRecipe
 */

/** @type {SepRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id:          "aoc:separate_hydrocarbon_slurry",
        input:       { type: "hydrocarbon_slurry",  amount: 1000 },
        output1:     { type: "heavy_hydrocarbon",   amount: 400  },
        output2:     { type: "reactive_fluid",      amount: 250  },
        energyCost:  8000,
    }),
];

export const separatorRecipes = nativeRecipes;
export function getSeparatorRecipes() { return separatorRecipes; }

function defineRecipe(r) {
    return {
        id:         r.id,
        input:      { type: r.input.type.toLowerCase(),   amount: Math.max(1, r.input.amount)   },
        output1:    { type: r.output1.type.toLowerCase(), amount: Math.max(1, r.output1.amount)  },
        output2:    { type: r.output2.type.toLowerCase(), amount: Math.max(1, r.output2.amount)  },
        energyCost: Math.max(1, r.energyCost ?? 8000),
    };
}

// ── ScriptEvent injection ────────────────────────────────────────────────────
system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_separator_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx = separatorRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { separatorRecipes[idx] = recipe; replaced++; }
                else          { separatorRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AGE OF CHEMICAL] Bad separator recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AGE OF CHEMICAL] Separator: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn("[AGE OF CHEMICAL] Failed to parse separator recipe payload:", err);
    }
});
