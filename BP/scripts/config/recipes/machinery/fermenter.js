/**
 * Fermenter recipes.
 *
 * Fields:
 *   input:          { id, amount }              — primary item consumed
 *   secondaryInput? { id, amount }              — optional second item consumed (from any other input slot)
 *   fluid:          { type, amount }             — fluid produced
 *   energyCost:     number                       — DE per large batch
 *   seconds:        number                       — processing time
 *   byproduct?:     { id, amount, chance }       — optional item output
 *   batches:        { small, large }             — { size, seconds, fluidAmount }
 */

const RECIPES = [
    {
        id: "utilitycraft:plant_oil_from_wheat_seeds",
        input:     { id: "minecraft:wheat_seeds", amount: 64 },
        fluid:     { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds:    8,
        batches: {
            small: { size: 8,  seconds: 6, fluidAmount: 150  },
            large: { size: 64, seconds: 8, fluidAmount: 1200 },
        },
    },
    {
        id: "utilitycraft:plant_oil_from_beetroot_seeds",
        input:     { id: "minecraft:beetroot_seeds", amount: 64 },
        fluid:     { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds:    8,
        batches: {
            small: { size: 8,  seconds: 6, fluidAmount: 150  },
            large: { size: 64, seconds: 8, fluidAmount: 1200 },
        },
    },
    {
        id: "utilitycraft:plant_oil_from_melon_seeds",
        input:     { id: "minecraft:melon_seeds", amount: 64 },
        fluid:     { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds:    8,
        batches: {
            small: { size: 8,  seconds: 6, fluidAmount: 150  },
            large: { size: 64, seconds: 8, fluidAmount: 1200 },
        },
    },
    {
        id: "utilitycraft:plant_oil_from_pumpkin_seeds",
        input:     { id: "minecraft:pumpkin_seeds", amount: 64 },
        fluid:     { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds:    8,
        batches: {
            small: { size: 8,  seconds: 6, fluidAmount: 150  },
            large: { size: 64, seconds: 8, fluidAmount: 1200 },
        },
    },
    {
        id: "utilitycraft:ethanol_from_sugarcane",
        input:     { id: "minecraft:sugar_cane", amount: 64 },
        fluid:     { type: "ethanol", amount: 1200 },
        energyCost: 7800,
        seconds:    10,
        byproduct:  { id: "minecraft:sugar", amount: 15, chance: 0.4 },
        batches: {
            small: { size: 8,  seconds: 6,  fluidAmount: 150  },
            large: { size: 64, seconds: 10, fluidAmount: 1200 },
        },
    },
    {
        id: "utilitycraft:organic_fertilizer",
        input:          { id: "minecraft:bone_meal", amount: 8 },
        secondaryInput: { id: "minecraft:oak_leaves", amount: 4 },
        fluid:          { type: "fertilizer_org", amount: 500 },
        energyCost:     3600,
        seconds:        6,
        batches: {
            small: { size: 4,  seconds: 4, fluidAmount: 250 },
            large: { size: 8,  seconds: 6, fluidAmount: 500 },
        },
    },
];

export function getFermentationRecipes() {
    return RECIPES;
}
