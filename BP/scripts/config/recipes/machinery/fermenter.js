import { system, world } from "@minecraft/server";

// ── Recipe definitions ────────────────────────────────────────────────────────
//
// defineRecipe accepts these input formats:
//   1-item:  { input: { id, amount } }
//   2-item:  { input: { id, amount }, secondaryInput: { id, amount } }
//   3-item:  { inputs: [{ id, amount }, ...] }   (length 3)
//   4-item:  { inputs: [{ id, amount }, ...] }   (length 4)

const nativeRecipes = [
    // ── 1-input recipes ───────────────────────────────────────────────────────
    defineRecipe({
        id: "utilitycraft:plant_oil_from_wheat_seeds",
        input:      { id: "minecraft:wheat_seeds", amount: 64 },
        fluid:      { type: "plant_oil", amount: 1200 },
        energyCost: 6400, seconds: 8,
        byproduct:  { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
    }),
    defineRecipe({
        id: "utilitycraft:plant_oil_from_beetroot_seeds",
        input:      { id: "minecraft:beetroot_seeds", amount: 64 },
        fluid:      { type: "plant_oil", amount: 1200 },
        energyCost: 6400, seconds: 8,
        byproduct:  { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
    }),
    defineRecipe({
        id: "utilitycraft:plant_oil_from_melon_seeds",
        input:      { id: "minecraft:melon_seeds", amount: 64 },
        fluid:      { type: "plant_oil", amount: 1200 },
        energyCost: 6400, seconds: 8,
        byproduct:  { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
    }),
    defineRecipe({
        id: "utilitycraft:plant_oil_from_pumpkin_seeds",
        input:      { id: "minecraft:pumpkin_seeds", amount: 64 },
        fluid:      { type: "plant_oil", amount: 1200 },
        energyCost: 6400, seconds: 8,
        byproduct:  { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
    }),
    defineRecipe({
        id: "utilitycraft:ethanol_from_sugarcane",
        input:      { id: "minecraft:sugar_cane", amount: 64 },
        fluid:      { type: "ethanol", amount: 1200 },
        energyCost: 7800, seconds: 6,
        byproduct:  { id: "minecraft:sugar", amount: 15, chance: 0.4 },
    }),
    defineRecipe({
        id: "utilitycraft:lava_from_lava_ball",
        input:      { id: "utilitycraft:lava_ball", amount: 64 },
        fluid:      { type: "lava", amount: 1000 },
        energyCost: 6400, seconds: 4,
    }),
    defineRecipe({
        id: "utilitycraft:water_from_water_ball",
        input:      { id: "utilitycraft:water_ball", amount: 64 },
        fluid:      { type: "water", amount: 1000 },
        energyCost: 6400, seconds: 4,
    }),

    // ── 2-input recipe ────────────────────────────────────────────────────────
    defineRecipe({
        id: "utilitycraft:organic_fertilizer",
        input:          { id: "minecraft:bone_meal",  amount: 8 },
        secondaryInput: { id: "minecraft:oak_leaves", amount: 4 },
        fluid:          { type: "fertilizer_org", amount: 500 },
        energyCost:     3600, seconds: 6,
    }),

    // ── 4-input recipe ────────────────────────────────────────────────────────
    defineRecipe({
        id: "utilitycraft:organic_growth_solution",
        inputs: [
            { id: "minecraft:bone_meal",       amount: 12 },
            { id: "utilitycraft:water_ball",   amount: 1  },
            { id: "utilitycraft:compost",      amount: 12 },
            { id: "minecraft:oak_sapling",     amount: 4  },
        ],
        fluid:      { type: "bio_growth_solution", amount: 1000 },
        energyCost: 9800, seconds: 4,
    }),
];

export const fermentationRecipes = nativeRecipes;
export function getFermentationRecipes() {
    return fermentationRecipes;
}

// ── defineRecipe normalizer ───────────────────────────────────────────────────

function defineRecipe(r) {
    if (!r || typeof r !== "object") throw new TypeError("Invalid fermenter recipe");

    const hasMulti  = Array.isArray(r.inputs) && r.inputs.length >= 2;
    const hasSingle = !hasMulti && r.input?.id;

    if (!hasMulti && !hasSingle) throw new TypeError(`Recipe '${r.id}' needs input or inputs`);
    if (!r.fluid?.type)          throw new TypeError(`Recipe '${r.id}' needs fluid.type`);

    return {
        id:             r.id ?? `fermenter_${r.fluid.type}`,
        ...(hasSingle ? {
            input:          { id: r.input.id, amount: Math.max(1, r.input.amount ?? 1) },
            ...(r.secondaryInput ? {
                secondaryInput: { id: r.secondaryInput.id, amount: Math.max(1, r.secondaryInput.amount ?? 1) }
            } : {}),
        } : {}),
        ...(hasMulti ? {
            inputs: r.inputs.map(i => ({ id: i.id, amount: Math.max(1, i.amount ?? 1) })),
        } : {}),
        fluid:      { type: r.fluid.type, amount: Math.max(1, r.fluid.amount ?? 1000) },
        energyCost: Math.max(1, r.energyCost ?? 6400),
        seconds:    Math.max(1, r.seconds ?? 8),
        ...(r.byproduct ? {
            byproduct: {
                id:     r.byproduct.id,
                amount: Math.max(1, r.byproduct.amount ?? 1),
                chance: Math.min(1, Math.max(0, r.byproduct.chance ?? 1)),
            }
        } : {}),
    };
}

// ── ScriptEvent API ───────────────────────────────────────────────────────────
//
// Other addons can register custom fermenter recipes at runtime:
//
//   1-item:   scriptevent utilitycraft:register_fermenter_recipe
//             { "mymod:my_recipe": { "input": { "id": "...", "amount": 1 },
//                                    "fluid": { "type": "...", "amount": 500 },
//                                    "energyCost": 3000, "seconds": 6 } }
//
//   2-item:   add "secondaryInput": { "id": "...", "amount": 1 }
//
//   3-4 item: use "inputs": [{ "id": "...", "amount": 1 }, ...] (2-4 entries)
//
// Response: scriptevent utilitycraft:fermenter_recipe_response
//           { "added": [...], "replaced": [...] }

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_fermenter_recipe") return;

    let payload;
    try { payload = JSON.parse(message); }
    catch {
        console.warn("[AoC Fermenter] Invalid JSON in recipe registration.");
        return;
    }

    const added = [], replaced = [];

    for (const [recipeId, def] of Object.entries(payload)) {
        try {
            const recipe = defineRecipe({ id: recipeId, ...def });
            const idx    = fermentationRecipes.findIndex(r => r.id === recipe.id);
            if (idx >= 0) { fermentationRecipes[idx] = recipe; replaced.push(recipeId); }
            else          { fermentationRecipes.push(recipe);   added.push(recipeId);    }
        } catch (err) {
            console.warn(`[AoC Fermenter] Skipping '${recipeId}': ${err}`);
        }
    }

    console.warn(`[AoC Fermenter] +${added.length} new, ~${replaced.length} replaced.`);
    try {
        world.getDimension("overworld").runCommand(
            `scriptevent utilitycraft:fermenter_recipe_response ${JSON.stringify({ added, replaced })}`
        );
    } catch { }

}, { namespaces: ["utilitycraft"] });