/**
 * Industrial Compressor (Crusher mode) recipes.
 *
 * Each recipe has 3 stages selected by the button:
 *   stage 1 (1x button) → output_1
 *   stage 2 (2x button) → output_2
 *   stage 3 (3x button) → output_3
 *
 * energyCost / seconds apply per craft regardless of stage.
 */

const RECIPES = [
    {
        id:          "aoc:crush_cobblestone",
        input:       { id: "minecraft:cobblestone", amount: 1 },
        output_1:    { id: "minecraft:gravel", count: 1 },
        output_2:    { id: "minecraft:dirt",   count: 1 },
        output_3:    { id: "minecraft:sand",   count: 1 },
        energyCost:  2_000,
        seconds:     2,
    },
    // Add more crushable recipes here following the same pattern.
    // If a recipe has no further breakdown, set output_2/output_3 to the
    // same id as output_1 (or omit — the machine will fall back to output_1).
];

export function getCrusherRecipes() {
    return RECIPES;
}

/**
 * Get the output for a given recipe + stage (1, 2, or 3).
 * Falls back to output_1 if a stage isn't defined.
 */
export function getStageOutput(recipe, stage) {
    if (stage === 3 && recipe.output_3) return recipe.output_3;
    if (stage === 2 && recipe.output_2) return recipe.output_2;
    return recipe.output_1;
}
