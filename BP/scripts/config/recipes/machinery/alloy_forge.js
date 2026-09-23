import { system } from "@minecraft/server";

// ── Slot layout reference ─────────────────────────────────────────────────────
//
//   [3] [4] [5]
//   [6] [7] [8]    → progress → output [12]
//   [9] [10][11]
//
// Recipes are UNORDERED — the machine scans all 9 input slots and checks that
// the total quantity of each required item is present across any combination
// of slots. You do not need to fill all 9 slots; unused slots stay empty.
//
// Slot colours (IO tab modes):
//   [3]  §c Red         Top-Left
//   [4]  §6 Orange      Top-Mid
//   [5]  §e Yellow      Top-Right
//   [6]  §a Green       Mid-Left
//   [7]  §b Aqua        Centre  (big slot)
//   [8]  §9 Blue        Mid-Right
//   [9]  §5 Purple      Bot-Left
//  [10]  §d Pink        Bot-Mid
//  [11]  §f White       Bot-Right
//
// energyCost  Total DE consumed over the full cycle (not per-tick).
// seconds     Processing time at base speed (Speed I upgrade halves this).

/**
 * @typedef {{ id: string, amount: number }} ItemReq
 * @typedef {{ id: string, count: number }} ItemOut
 * @typedef {{ id: string, inputs: ItemReq[], output: ItemOut, energyCost: number, seconds: number }} AlloyRecipe
 */

/** @type {AlloyRecipe[]} */
const nativeRecipes = [

    // ── Tier 1 — Voltanium Alloy Ingot ───────────────────────────────────────
    // Simple 4-type mix, unlocks mid-game alloy crafting.
    defineRecipe({
        id:         "aoc:voltanium_alloy_ingot",
        inputs: [
            { id: "utilitycraft:duranium_ingot",     amount: 2 },
            { id: "utilitycraft: steel_ingot",     amount: 2 },
            { id: "utilitycraft:lithium_dust", amount: 4 },
            { id: "minecraft:diamond",         amount: 1 },
        ],
        output:     { id: "utilitycraft:voltanium_ingot", count: 3 },
        energyCost: 150000,
        seconds:    20,
    }),

    // ── Tier 2 — Adamant Mesh ────────────────────────────────────────────────
    // Requires HDPE + plutonium, heavy processing cost.
    defineRecipe({
        id:         "aoc:adamant_mesh_alloy",
        inputs: [
            { id: "utilitycraft:hdpe_sheet",      amount: 2 },
            { id: "utilitycraft:voltanium_ingot", amount: 4 },
            { id: "minecraft:heart_of_the_sea",     amount: 1 },
            { id: "utilitycraft:industrial_chip",  amount: 2 }
        ],
        output:     { id: "utilitycraft:adamant_ingot", count: 3 },
        energyCost: 300000,
        seconds:    30,
    }),

];

export const alloyForgeRecipes = nativeRecipes;
export function getAlloyForgeRecipes() { return alloyForgeRecipes; }

// ── Recipe validator ──────────────────────────────────────────────────────────

/**
 * @param {object} r
 * @param {string} r.id
 * @param {ItemReq[]} r.inputs
 * @param {ItemOut} r.output
 * @param {number} r.energyCost
 * @param {number} r.seconds
 * @returns {AlloyRecipe}
 */
function defineRecipe(r) {
    if (!r?.id)
        throw new TypeError(`Alloy Forge recipe missing id`);
    if (!Array.isArray(r.inputs) || r.inputs.length < 1 || r.inputs.length > 9)
        throw new TypeError(`Alloy Forge '${r.id}': inputs must be 1–9 (one per slot)`);
    if (!r.output?.id)
        throw new TypeError(`Alloy Forge '${r.id}': missing output.id`);

    const seen = new Set();
    for (const input of r.inputs) {
        if (!input?.id) throw new TypeError(`Alloy Forge '${r.id}': input missing id`);
        if (seen.has(input.id))
            throw new TypeError(`Alloy Forge '${r.id}': duplicate input '${input.id}' — combine into one entry with a higher amount`);
        seen.add(input.id);
    }

    return {
        id:         r.id,
        inputs:     r.inputs.map(i => ({ id: i.id, amount: Math.max(1, i.amount ?? 1) })),
        output:     { id: r.output.id, count: Math.max(1, r.output.count ?? 1) },
        energyCost: Math.max(1, r.energyCost ?? 150000),
        seconds:    Math.max(1, r.seconds    ?? 20),
    };
}

// ── Runtime recipe injection ──────────────────────────────────────────────────
//
// Other addons can register recipes at runtime via scriptevent:
//
//   /scriptevent utilitycraft:register_alloy_forge_recipe {"mymod:my_alloy":{"inputs":[{"id":"minecraft:iron_ingot","amount":4}],"output":{"id":"mymod:my_alloy","count":1},"energyCost":150000,"seconds":20}}
//
// Sending an existing id replaces that recipe. Sending a new id appends it.

system.afterEvents.scriptEventReceive.subscribe(({ id, message }) => {
    if (id !== "utilitycraft:register_alloy_forge_recipe") return;
    try {
        const payload = JSON.parse(message);
        let added = 0, replaced = 0;
        for (const [recipeId, def] of Object.entries(payload)) {
            try {
                const recipe = defineRecipe({ id: recipeId, ...def });
                const idx    = alloyForgeRecipes.findIndex(r => r.id === recipe.id);
                if (idx >= 0) { alloyForgeRecipes[idx] = recipe; replaced++; }
                else          { alloyForgeRecipes.push(recipe);   added++;    }
            } catch (err) {
                console.warn(`[AoC] Bad alloy forge recipe '${recipeId}':`, err);
            }
        }
        console.warn(`[AoC] Alloy Forge: +${added} new, ~${replaced} replaced.`);
    } catch (err) {
        console.warn("[AoC] Failed to parse alloy forge recipe payload:", err);
    }
});