import { system, world } from "@minecraft/server";

// Additional Infuser recipes to be registered.

world.afterEvents.worldLoad.subscribe(() => {
    const addedRecipes = {
        "minecraft:glowstone_dust|utilitycraft:crying_obsidian_dust": {
            output: "utilitycraft:stabilized_obsidian_dust",
            required: 4
        },
        "minecraft:blaze_powder|minecraft:obsidian": {
            output: "minecraft:crying_obsidian",
            required: 1
        },
        "minecraft:ender_eye|utilitycraft:chip": {
            output: "utilitycraft:way_chip",
            required: 1
        },

        // Duranium Ingot
        "utilitycraft:quartz_dust|minecraft:steel_ingot": {
            output: "utilitycraft:duranium_ingot",
            required: 4
        }
    };

    system.sendScriptEvent(
        "utilitycraft:register_infuser_recipe",
        JSON.stringify(addedRecipes)
    );
});