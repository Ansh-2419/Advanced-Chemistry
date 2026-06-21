import { system } from "@minecraft/server";

/**
 * Fuel Mixer recipes — each recipe takes two fluid inputs
 * and produces one fluid output.
 * @type {FuelMixerRecipe[]}
 */
const nativeFuelMixerRecipes = [
    defineFuelMixerRecipe({
        id: "utilitycraft:biofuel_from_ethanol_plant_oil",
        input1: { type: "ethanol",   amount: 500 },
        input2: { type: "plant_oil", amount: 500 },
        output: { type: "biofuel",   amount: 800 },
        energyCost: 6400,
        seconds: 10,
        description: "Mixes ethanol and plant oil into biofuel."
    }),
];

export const fuelMixerRecipes = nativeFuelMixerRecipes;

export function getFuelMixerRecipes() {
    return fuelMixerRecipes;
}

function defineFuelMixerRecipe(recipe) {
    if (!recipe || typeof recipe !== "object") throw new TypeError("Invalid fuel mixer recipe");
    return {
        id: recipe.id ?? `${recipe.input1.type}_${recipe.input2.type}`,
        input1: { type: recipe.input1.type.toLowerCase(), amount: Math.max(1, recipe.input1.amount ?? 500) },
        input2: { type: recipe.input2.type.toLowerCase(), amount: Math.max(1, recipe.input2.amount ?? 500) },
        output: { type: recipe.output.type.toLowerCase(), amount: Math.max(1, recipe.output.amount ?? 800) },
        energyCost: Math.max(1, recipe.energyCost ?? 4800),
        seconds: Math.max(1, recipe.seconds ?? 8),
        description: recipe.description ?? null
    };
}

const FUEL_MIXER_EVENT_ID = "utilitycraft:register_fuel_mixer_recipe";

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== FUEL_MIXER_EVENT_ID) return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, definition] of Object.entries(payload)) {
            try {
                const recipe = defineFuelMixerRecipe({ id: recipeId, ...definition });
                const idx = fuelMixerRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { fuelMixerRecipes[idx] = recipe; replaced++; }
                else { fuelMixerRecipes.push(recipe); added++; }
            } catch (err) {
                console.warn(`[UtilityCraft] Failed to register fuel mixer recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[UtilityCraft] Fuel Mixer: registered ${added} new, replaced ${replaced} recipes.`);
    } catch (err) {
        console.warn("[UtilityCraft] Failed to parse fuel mixer recipe payload:", err);
    }
});
