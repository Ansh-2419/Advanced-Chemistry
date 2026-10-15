import { ItemStack, system, world } from "@minecraft/server";
import * as ButtonConstants from "./buttons/constants.js";
import { loadButtonItemStack } from "./buttons/index.js";
import { scriptEventHandler } from "./scriptEvents.js";
import * as Constants from "./constants.js";
import { EnergyStorage } from "./machinery/energyStorage.js";
import { FluidStorage } from "./machinery/fluidStorage.js";
import { GasStorage } from "./machinery/gasStorage.js";
import { addOpenUICount, removeOpenUICount } from "./utils/entity.js";

globalThis[Constants.GLOBAL_WORLD_LOADED_KEY] = false;
globalThis[Constants.GLOBAL_TICK_COUNT_KEY] = 0;
globalThis[Constants.GLOBAL_TICK_SPEED_KEY] = Constants.DEFAULT_TICK_SPEED;

system.runInterval(() => {
    globalThis[Constants.GLOBAL_TICK_COUNT_KEY] += 4;
    if (globalThis[Constants.GLOBAL_TICK_COUNT_KEY] === 1000) {
        globalThis[Constants.GLOBAL_TICK_COUNT_KEY] = 0;
    }
}, 4);

world.afterEvents.worldLoad.subscribe(() => {
    EnergyStorage.initializeObjectives();
    FluidStorage.initializeObjectives();
    GasStorage.initializeObjectives();

    if (world.getDimension("overworld").getEntities()[0]) {
        globalThis[Constants.GLOBAL_WORLD_LOADED_KEY] = true;
    }

    const configuredTickSpeed =
        world.getDynamicProperty(Constants.TICK_SPEED_PROPERTY_ID)
        ?? Constants.DEFAULT_TICK_SPEED;

    globalThis[Constants.GLOBAL_TICK_SPEED_KEY] = configuredTickSpeed;

    loadButtonItemStack(ButtonConstants.DEFAULT_BUTTON_ITEM_ID, ItemStack);
});

world.afterEvents.playerSpawn.subscribe(({ initialSpawn }) => {
    if (!initialSpawn) return;
    system.runTimeout(() => {
        globalThis[Constants.GLOBAL_WORLD_LOADED_KEY] = true;
    }, 50);
});

function hasMachineUIProperties(entity) {
    try {
        return (
            typeof entity?.getProperty?.("utilitycraft:players") === "number" &&
            typeof entity?.getProperty?.("utilitycraft:tick_group") === "number"
        );
    } catch {
        return false;
    }
}

world.afterEvents.entityContainerOpened?.subscribe?.((e) => {
    const entity = e?.entity;
    if (!hasMachineUIProperties(entity)) return;
    addOpenUICount(entity);
});

world.afterEvents.entityContainerClosed?.subscribe?.((e) => {
    const entity = e?.entity;
    if (!hasMachineUIProperties(entity)) return;
    removeOpenUICount(entity);
});

system.afterEvents.scriptEventReceive.subscribe((e) => {
    const event = scriptEventHandler[e.id];
    if (event) event(e);
});