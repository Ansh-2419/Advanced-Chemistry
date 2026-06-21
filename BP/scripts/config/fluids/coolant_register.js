import { world, system } from "@minecraft/server";

const coolantsRegister = {
    "ethanol": {
        efficiency: 1.75,
        tier: 2
    }
}

world.afterEvents.worldLoad.subscribe(() => {
    system.sendScriptEvent(
        "utilitycraft:register_coolant",
        JSON.stringify(coolantsRegister)
    )
})