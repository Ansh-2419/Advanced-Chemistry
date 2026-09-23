import * as DoriosLib from "DoriosLib/index.js";

const newRecipes = {
    "utilitycraft:hdpe_pellet": {
        output: "utilitycraft:hdpe_sheet",
        required: 2
    },
    "utilitycraftthorium_concentrate":{
      output: "thorium_chunk",
      required: 4
    }
};

DoriosLib.registry.registerPressRecipe(newRecipes);
