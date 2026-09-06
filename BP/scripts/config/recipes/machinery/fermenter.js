/**
 * Fermenter recipes.
 *
 * Fields for single/dual input recipes:
 *   input:          { id, amount }              — primary item consumed
 *   secondaryInput? { id, amount }              — optional second item consumed
 *   fluid:          { type, amount }            — fluid produced
 *   energyCost:     number                      — DE cost
 *   seconds:        number                      — processing time
 *   byproduct?:     { id, amount, chance }      — optional item output
 *   batches:        { small, large }            — { size, seconds, fluidAmount }
 *
 * Fields for 4-item recipes:
 *   inputs:         [{ id, amount }, ...]       — all 4 items consumed
 *   fluid:          { type, amount }            — fluid produced
 *   energyCost:     number                      — DE cost
 *   seconds:        number                      — processing time
 */

const RECIPES = [
    {
        id: "utilitycraft:plant_oil_from_wheat_seeds",
        input: { id: "minecraft:wheat_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 8,
        byproduct: { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
        batches: {
            small: { size: 8, seconds: 3, fluidAmount: 150 },
            large: { size: 64, seconds: 6, fluidAmount: 1200 }
        }
    },
    {
        id: "utilitycraft:plant_oil_from_beetroot_seeds",
        input: { id: "minecraft:beetroot_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 8,
        byproduct: { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
        batches: {
            small: { size: 8, seconds: 3, fluidAmount: 150 },
            large: { size: 64, seconds: 6, fluidAmount: 1200 }
        }
    },
    {
        id: "utilitycraft:plant_oil_from_melon_seeds",
        input: { id: "minecraft:melon_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 8,
        byproduct: { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
        batches: {
            small: { size: 8, seconds: 3, fluidAmount: 150 },
            large: { size: 64, seconds: 6, fluidAmount: 1200 }
        }
    },
    {
        id: "utilitycraft:plant_oil_from_pumpkin_seeds",
        input: { id: "minecraft:pumpkin_seeds", amount: 64 },
        fluid: { type: "plant_oil", amount: 1200 },
        energyCost: 6400,
        seconds: 8,
        byproduct: { id: "utilitycraft:compost", amount: 2, chance: 0.7 },
        batches: {
            small: { size: 8, seconds: 3, fluidAmount: 150 },
            large: { size: 64, seconds: 6, fluidAmount: 1200 }
        }
    },
    {
        id: "utilitycraft:ethanol_from_sugarcane",
        input: { id: "minecraft:sugar_cane", amount: 64 },
        fluid: { type: "ethanol", amount: 1200 },
        energyCost: 7800,
        seconds: 6,
        byproduct: { id: "minecraft:sugar", amount: 15, chance: 0.4 },
        batches: {
            small: { size: 8, seconds: 3, fluidAmount: 150 },
            large: { size: 64, seconds: 6, fluidAmount: 1200 }
        }
    },
    {
        id: "utilitycraft:organic_fertilizer",
        input: { id: "minecraft:bone_meal", amount: 8 },
        secondaryInput: { id: "minecraft:oak_leaves", amount: 4 },
        fluid: { type: "fertilizer_org", amount: 500 },
        energyCost: 3600,
        seconds: 6,
        batches: {
            small: { size: 4, seconds: 4, fluidAmount: 250 },
            large: { size: 8, seconds: 6, fluidAmount: 500 }
        }
    },
    {
        id: "utilitycraft:lava_from_lava_ball",
        input: { id: "utilitycraft:lava_ball", amount: 64 },
        fluid: { type: "lava", amount: 1000 },
        energyCost: 6400,
        seconds: 4,
        batches: {
            small: { size: 8, seconds: 2, fluidAmount: 125 },
            large: { size: 64, seconds: 4, fluidAmount: 1000 }
        }
    },
    {
        id: "utilitycraft:water_from_water_ball",
        input: { id: "utilitycraft:water_ball", amount: 64 },
        fluid: { type: "water", amount: 1000 },
        energyCost: 6400,
        seconds: 4,
        batches: {
            small: { size: 8, seconds: 2, fluidAmount: 125 },
            large: { size: 64, seconds: 4, fluidAmount: 1000 }
        }
    },
    {
        id: "utilitycraft:organic_growth_solution",
        inputs: [
            { id: "minecraft:bone_meal", amount: 12 },
            { id: "utilitycraft:water_ball", amount: 1 },
            { id: "utilitycraft:compost", amount: 12 },
            { id: "minecraft:oak_sapling", amount: 4 }
        ],
        fluid: { type: "bio_growth_solution", amount: 1000 },
        energyCost: 9800,
        seconds: 4
    }
];

export function getFermentationRecipes() {
    return RECIPES;
}