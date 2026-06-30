import { system, world } from "@minecraft/server";

const RegisterContainer = "utilitycraft:register_fluid_container";
const RegisterOutput = "utilitycraft:register_fluid_output";
const RegisterLegacyContainer = "utilitycraft:register_fluid_item";
const RegisterLegacyHolder = "utilitycraft:register_fluid_holder";

const INFINITE_CAPSULE_FALLBACK_MB = 512000;

const ATInfiniteCapsules = [
    { id: "utilitycraft:ethanol_liquid_capsule_infinite",  amount: 512000, type: "ethanol",   output: "utilitycraft:ethanol_liquid_capsule_infinite"  },
    { id: "utilitycraft:water_capsule_infinite",           amount: INFINITE_CAPSULE_FALLBACK_MB, type: "water",     output: "utilitycraft:water_capsule_infinite"           },
    { id: "utilitycraft:lava_capsule_infinite",            amount: INFINITE_CAPSULE_FALLBACK_MB, type: "lava",      output: "utilitycraft:lava_capsule_infinite"            },
    { id: "utilitycraft:milk_capsule_infinite",            amount: INFINITE_CAPSULE_FALLBACK_MB, type: "milk",      output: "utilitycraft:milk_capsule_infinite"            },
    { id: "utilitycraft:xp_capsule_infinite",              amount: INFINITE_CAPSULE_FALLBACK_MB, type: "xp",        output: "utilitycraft:xp_capsule_infinite"              },
];

const ATNewCapsules = [
    // Ethanol capsules
    { id: "utilitycraft:ethanol_liquid_capsule_1", amount: 1000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_2", amount: 2000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_3", amount: 3000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_4", amount: 4000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_5", amount: 5000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_6", amount: 6000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_7", amount: 7000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:ethanol_liquid_capsule_8", amount: 8000, type: "ethanol",   output: "utilitycraft:empty_liquid_capsule" },
    // Plant oil capsules
    { id: "utilitycraft:plant_oil_liquid_capsule_1", amount: 1000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_2", amount: 2000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_3", amount: 3000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_4", amount: 4000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_5", amount: 5000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_6", amount: 6000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_7", amount: 7000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:plant_oil_liquid_capsule_8", amount: 8000, type: "plant_oil", output: "utilitycraft:empty_liquid_capsule" },
    // Biofuel capsules
    { id: "utilitycraft:biofuel_liquid_capsule_1", amount: 1000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_2", amount: 2000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_3", amount: 3000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_4", amount: 4000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_5", amount: 5000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_6", amount: 6000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_7", amount: 7000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:biofuel_liquid_capsule_8", amount: 8000, type: "biofuel", output: "utilitycraft:empty_liquid_capsule" },
    // Water capsules
    { id: "utilitycraft:water_capsule_1", amount: 1000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_2", amount: 2000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_3", amount: 3000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_4", amount: 4000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_5", amount: 5000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_6", amount: 6000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_7", amount: 7000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:water_capsule_8", amount: 8000, type: "water", output: "utilitycraft:empty_liquid_capsule" },
    // Lava capsules
    { id: "utilitycraft:lava_capsule_1", amount: 1000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_2", amount: 2000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_3", amount: 3000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_4", amount: 4000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_5", amount: 5000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_6", amount: 6000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_7", amount: 7000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:lava_capsule_8", amount: 8000, type: "lava", output: "utilitycraft:empty_liquid_capsule" },
    // XP capsules
    { id: "utilitycraft:xp_capsule_1", amount: 1000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_2", amount: 2000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_3", amount: 3000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_4", amount: 4000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_5", amount: 5000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_6", amount: 6000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_7", amount: 7000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:xp_capsule_8", amount: 8000, type: "xp", output: "utilitycraft:empty_liquid_capsule" },
    // Steam capsules
    { id: "utilitycraft:steam_capsule_1", amount: 1000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_2", amount: 2000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_3", amount: 3000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_4", amount: 4000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_5", amount: 5000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_6", amount: 6000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_7", amount: 7000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    { id: "utilitycraft:steam_capsule_8", amount: 8000, type: "steam", output: "utilitycraft:empty_liquid_capsule" },
    ...ATInfiniteCapsules,
];

const ATNewContainers = [
    {
        id: "utilitycraft:empty_liquid_capsule",
        amount: { min: 1000, max: 8000 },
        fills: {
            ethanol:   "utilitycraft:ethanol_liquid_capsule_8",
            plant_oil: "utilitycraft:plant_oil_liquid_capsule_8",
            biofuel:   "utilitycraft:biofuel_liquid_capsule_8",
            water:     "utilitycraft:water_capsule_8",
            lava:      "utilitycraft:lava_capsule_8",
            xp:        "utilitycraft:xp_capsule_8",
            steam:     "utilitycraft:steam_capsule_8",
        }
    }
];

const ATLegacyCapsules = Object.fromEntries(
    ATNewCapsules.map(({ id, amount, type, output }) => [id, { amount, type, output }])
);

function resolveLegacyRequired(value) {
    if (typeof value === "number") return value;
    if (Array.isArray(value)) return Math.max(...value.map(Number).filter(Number.isFinite));
    if (value && typeof value === "object") {
        const max = Number(value.max ?? value.maximum ?? value[1] ?? value.min ?? value.minimum ?? value[0]);
        return Number.isFinite(max) ? max : 0;
    }
    return 0;
}

const ATLegacyHolders = Object.fromEntries(
    ATNewContainers
        .filter(entry => entry && entry.id && entry.fills)
        .map(entry => {
            const required = resolveLegacyRequired(entry.amount);
            return [entry.id, { types: { ...entry.fills }, required }];
        })
);

function sendRegistration(eventId, payload) {
    if (!payload || payload.length === 0) return;
    
    // Check if system is available and has sendScriptEvent method
    if (!system || typeof system.sendScriptEvent !== "function") {
        console.warn(`[Advanced Chemistry] system.sendScriptEvent not available; skipping event '${eventId}'.`);
        return;
    }
    
    try {
        system.sendScriptEvent(eventId, JSON.stringify(payload));
    } catch (error) {
        console.warn(`[Advanced Chemistry] Failed to send script event '${eventId}':`, error);
    }
}

// Use world.afterEvents.worldLoad to ensure world is initialized
if (world?.afterEvents?.worldLoad) {
    world.afterEvents.worldLoad.subscribe(() => {
        // Use system.run to defer execution and ensure system is ready
        if (system?.run) {
            system.run(() => {
                sendRegistration(RegisterContainer, ATNewCapsules);
                sendRegistration(RegisterOutput, ATNewContainers);
                sendRegistration(RegisterLegacyContainer, ATLegacyCapsules);
                sendRegistration(RegisterLegacyHolder, ATLegacyHolders);
            });
        } else if (system?.runTimeout) {
            system.runTimeout(() => {
                sendRegistration(RegisterContainer, ATNewCapsules);
                sendRegistration(RegisterOutput, ATNewContainers);
                sendRegistration(RegisterLegacyContainer, ATLegacyCapsules);
                sendRegistration(RegisterLegacyHolder, ATLegacyHolders);
            }, 0);
        } else {
            console.warn("[Advanced Chemistry] system.run/runTimeout not available; fluid registration may fail.");
        }
    });
} else {
    console.warn("[Advanced Chemistry] world.afterEvents.worldLoad not available; fluid registration disabled.");
}