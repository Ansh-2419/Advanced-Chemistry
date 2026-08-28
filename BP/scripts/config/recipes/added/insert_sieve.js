import * as DoriosLib from "DoriosLib/index.js";

const newDrops = {
    "minecraft:sand": [
        {
            item: "utilitycraft:thorium_concentrate",
            amount: 2,
            chance: 0.15,
            tier: 9
        }
    ],
    "utilitycraft:compressed_sand": [
        {
            item: "utilitycraft:thorium_concentrate",
            amount: 4,
            chance: 0.20,
            tier: 9
        }
    ]
};

DoriosLib.registry.registerSieveDrop(newDrops);
