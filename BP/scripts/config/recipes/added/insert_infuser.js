import { system, world } from "@minecraft/server";

// Additional Infuser recipes to be registered.

world.afterEvents.worldLoad.subscribe(() => {
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
            output: "utilitycraft:electrum_ingot",
            required: 4
        }
    };

    system.sendScriptEvent(
        "utilitycraft:register_infuser_recipe",
        JSON.stringify(addedRecipes)
    );
});
