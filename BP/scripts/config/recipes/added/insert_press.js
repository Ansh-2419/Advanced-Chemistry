import * as DoriosLib from "DoriosLib/index.js";

const newRecipes = {
    "utilitycraft:hdpe_pellet" : { output: "utilitycraft:hdpe_sheet", required: 2 }
};

DoriosLib.registry.registerPressRecipe(newRecipes);
