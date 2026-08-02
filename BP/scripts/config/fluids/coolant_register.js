import * as DoriosLib from "DoriosLib/index.js";

const coolantsRegister = {
    "ethanol": {
        efficiency: 1.75,
        tier: 2
    }
}

DoriosLib.registry.registerCoolant(coolantsRegister);
