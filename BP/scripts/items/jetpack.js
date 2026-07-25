import { world, system } from "@minecraft/server";

// ── Constants ─────────────────────────────────────────────────────────────────
const JETPACK_ID       = "utilitycraft:jetpack";
const ENERGY_PROP      = "ac:jetpack_energy";
const MAX_ENERGY       = 5_000;
const ENERGY_PER_TICK  = 1;           // KDe drained per tick while flying
const FLY_SPEED        = 0.5;         // upward velocity while holding jump
const HOVER_GRAVITY    = 0.01;        // tiny downward pull when not climbing
const DESCEND_SPEED    = -0.3;        // downward velocity while sneaking
const CHARGE_SLOT      = "Chest";     // EquipmentSlot

// ── Helpers ───────────────────────────────────────────────────────────────────
function getEnergy(player) {
    return player.getDynamicProperty(ENERGY_PROP) ?? 0;
}

function setEnergy(player, value) {
    const clamped = Math.max(0, Math.min(MAX_ENERGY, value));
    player.setDynamicProperty(ENERGY_PROP, clamped);
    return clamped;
}

function hasJetpack(player) {
    const chest = player.getEquipment(CHARGE_SLOT);
    return chest?.typeId === JETPACK_ID;
}

function isJetpackActive(player) {
    if (!hasJetpack(player)) return false;
    return getEnergy(player) > 0;
}

/** Prevent vanilla durability damage — jetpack never breaks */
function lockDurability(player) {
    const chest = player.getEquipment(CHARGE_SLOT);
    if (!chest || chest.typeId !== JETPACK_ID) return;
    // Keep durability at max so it appears full and never breaks
    if (chest.getDurability?.() !== undefined) {
        const maxDur = chest.maxDurability ?? MAX_ENERGY;
        // Use dynamic property as true energy store — durability bar is visual only
        const energy   = getEnergy(player);
        const durLeft  = Math.round((energy / MAX_ENERGY) * maxDur);
        const damage   = maxDur - durLeft;
        if (chest.getDurability() !== damage) {
            chest.setDurability?.(damage);
            player.getComponent("minecraft:equippable")
                ?.setEquipment(CHARGE_SLOT, chest);
        }
    }
}

// ── Flight logic ──────────────────────────────────────────────────────────────
function tickJetpack(player) {
    if (!hasJetpack(player)) return;

    const energy = getEnergy(player);

    // Show action bar charge %
    const pct = Math.round((energy / MAX_ENERGY) * 100);
    const bar = pct > 60 ? "§a" : pct > 25 ? "§e" : "§c";
    player.onScreenDisplay.setActionBar(`§7Jetpack: ${bar}${pct}%§r §8(${energy}§7/§8${MAX_ENERGY} KDe)`);

    if (energy <= 0) {
        player.onScreenDisplay.setActionBar("§cJetpack: §4EMPTY — needs recharging");
        return;
    }

    const input   = player.inputInfo;
    const jumping = input?.isJumping ?? false;
    const sneaking = player.isSneaking;
    const vel = player.getVelocity();

    if (jumping && !player.isOnGround) {
        // Fly upward
        player.applyKnockback(0, 0, 0, FLY_SPEED);
        setEnergy(player, energy - ENERGY_PER_TICK);
    } else if (sneaking && !player.isOnGround) {
        // Controlled descent
        player.applyKnockback(0, 0, 0, DESCEND_SPEED);
    } else if (!player.isOnGround && vel.y < 0) {
        // Hovering — reduce fall speed slightly
        player.applyKnockback(0, 0, 0, Math.max(vel.y + HOVER_GRAVITY, -0.1));
    }

    lockDurability(player);
}

// ── Main tick ─────────────────────────────────────────────────────────────────
system.runInterval(() => {
    if (!globalThis.worldLoaded) return;
    for (const player of world.getAllPlayers()) {
        try {
            tickJetpack(player);
        } catch {}
    }
}, 1);

// ── Energy charging via KDe network ──────────────────────────────────────────
// Other machines/cables call this to charge the jetpack when worn
export function chargeJetpack(player, amount) {
    if (!hasJetpack(player)) return 0;
    const energy  = getEnergy(player);
    const canTake = Math.min(amount, MAX_ENERGY - energy);
    if (canTake <= 0) return 0;
    setEnergy(player, energy + canTake);
    return canTake;
}

export function getJetpackEnergy(player) {
    return getEnergy(player);
}

export function getJetpackMaxEnergy() {
    return MAX_ENERGY;
}

// ── Register dynamic property ─────────────────────────────────────────────────
world.afterEvents.worldLoad.subscribe(() => {
    // Ensure all online players have the property initialized
    for (const player of world.getAllPlayers()) {
        if (player.getDynamicProperty(ENERGY_PROP) === undefined) {
            player.setDynamicProperty(ENERGY_PROP, 0);
        }
    }
});

world.afterEvents.playerSpawn.subscribe(({ player, initialSpawn }) => {
    if (player.getDynamicProperty(ENERGY_PROP) === undefined) {
        player.setDynamicProperty(ENERGY_PROP, 0);
    }
});
