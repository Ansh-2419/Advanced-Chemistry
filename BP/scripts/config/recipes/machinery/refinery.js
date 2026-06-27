import { system } from '@minecraft/server';

/** @type {RefRecipe[]} */
const nativeRecipes = [
    defineRecipe({
        id:        'aoc:refine_crude_oil',
        input:     { type: 'crude_oil', amount: 1000 },
        output1:   { type: 'diesel',    amount: 350  },
        output2:   { type: 'petrol',    amount: 300  },
        output3:   { type: 'naphtha',   amount: 200  },
        energyCost: 12_000,
    }),
];

export const refineryRecipes = nativeRecipes;
export function getRefineryRecipes() { return refineryRecipes; }

function defineRecipe(r) {
    return {
        id:        r.id,
        input:     { type: r.input.type.toLowerCase(),   amount: Math.max(1, r.input.amount)   },
        output1:   { type: r.output1.type.toLowerCase(), amount: Math.max(1, r.output1.amount)  },
        output2:   { type: r.output2.type.toLowerCase(), amount: Math.max(1, r.output2.amount)  },
        output3:   { type: r.output3.type.toLowerCase(), amount: Math.max(1, r.output3.amount)  },
        energyCost: Math.max(1, r.energyCost ?? 12_000),
    };
}

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== 'utilitycraft:register_refinery_recipe') return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx = refineryRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { refineryRecipes[idx] = recipe; replaced++; }
                else          { refineryRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AGE OF CHEMICAL] Bad refinery recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AGE OF CHEMICAL] Refinery: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn('[AGE OF CHEMICAL] Failed to parse refinery recipe payload:', err);
    }
});