import * as DoriosLib from "DoriosLib/index.js";

const newDrops = {
    "minecraft:sand": [
        {
            item: "utilitycraft:thorium_concentrate",
            amount: 1,
            chance: 0.25,
            tier: 9
        }
    ],
    "utilitycraft:compressed_sand": [
        {
            item: "utilitycraft:thorium_concentrate",
            amount: 9,
            chance: 0.40,
            tier: 9
        }
    ]
};

DoriosLib.registry.registerSieveDrop(newDrops);
