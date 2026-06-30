import { world } from "@minecraft/server";
import {
    isFullFluidSourceBlock,
    canTransformHeldCapsule,
    transformHeldCapsule,
    safePlaySound,
    setBlockTypeSafe,
    getPlacementBlock,
    isValidPlacementTarget
} from "./capsule_world_interaction.js";

const EMPTY_BUCKET_ID = "utilitycraft:empty_water_bucket";
const WATER_BUCKET_ID = "utilitycraft:water_bucket_custom";

world.beforeEvents.itemUseOn.subscribe((event) => {
    const player = event.source;
    const itemId = event.itemStack?.typeId;
    if (itemId !== EMPTY_BUCKET_ID && itemId !== WATER_BUCKET_ID) return;

    const clickedBlock = event.block;
    if (!clickedBlock) return;

    // Pickup: empty bucket + water source -> water bucket
    if (itemId === EMPTY_BUCKET_ID) {
        if (clickedBlock.typeId !== "minecraft:water") return;
        if (!isFullFluidSourceBlock(clickedBlock)) return;
        if (!canTransformHeldCapsule(player, EMPTY_BUCKET_ID)) return;

        if (!setBlockTypeSafe(clickedBlock, "minecraft:air")) return;
        transformHeldCapsule(player, EMPTY_BUCKET_ID, WATER_BUCKET_ID);
        safePlaySound(player, "bucket.fill_water");
        event.cancel = true;
        return;
    }

    // Place: water bucket + target -> water source, becomes empty bucket
    if (itemId === WATER_BUCKET_ID) {
        const clickedFace = event.face ?? event.blockFace;
        const placementBlock = getPlacementBlock(clickedBlock, clickedFace, player);
        if (!isValidPlacementTarget(placementBlock)) return;
        if (!canTransformHeldCapsule(player, WATER_BUCKET_ID)) return;

        if (!setBlockTypeSafe(placementBlock, "minecraft:water")) return;
        transformHeldCapsule(player, WATER_BUCKET_ID, EMPTY_BUCKET_ID);
        safePlaySound(player, "bucket.empty_water");
        event.cancel = true;
    }
});