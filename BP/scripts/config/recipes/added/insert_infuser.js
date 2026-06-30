import { system, world } from "@minecraft/server";

// Additional Infuser recipes to be registered.

world.afterEvents.worldLoad.subscribe(() => {
    const addedRecipes = {
        "utilitycraft:quartz_dust|utilitycraft:steel_ingot": {
            output: "utilitycraft:duranium_ingot",
            required: 4
        },
        "minecraft:water_bucket|minecraft:brown_mushroom": {
            output: "utilitycraft:water_bucket_custom",
            required: 4
        },
        "minecraft:water_bucket|minecraft:red_mushroom": {
            output: "utilitycraft:water_bucket_custom",
            required: 4
        }
    };

    system.sendScriptEvent(
        "utilitycraft:register_infuser_recipe",
        JSON.stringify(addedRecipes)
    );
});
