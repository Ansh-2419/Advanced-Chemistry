import * as DoriosLib from "DoriosLib/index.js";

// Additional Infuser recipes to be registered.

const addedRecipes = {
    "utilitycraft:quartz_dust|utilitycraft:steel_ingot": {
        output: "utilitycraft:duranium_ingot",
        required: 4
    },
    "minecraft:brown_mushroom|minecraft:water_bucket": {
        output: "utilitycraft:water_bucket_custom",
        required: 4
    },
    "minecraft:red_mushroom|minecraft:water_bucket": {
        output: "utilitycraft:water_bucket_custom",
        required: 4
    },
    "utilitycraft:lithium_dust|utilitycraft:steel_ingot": {
        output: "utilitycraft:voltanium_ingot",
        required: 4
    },
    "utilitycraft:hdpe_sheet|utilitycraft:voltanium_ingot": {
        output: "utilitycraft:adamant_ingot",
        required: 4
    },
    "utilitycraft:adamant_ingot|utilitycraft:ultimate_chip": {
        output: "utilitycraft:industrial_chip",
        required: 4
    }
};

DoriosLib.registry.registerInfuserRecipe(addedRecipes);
