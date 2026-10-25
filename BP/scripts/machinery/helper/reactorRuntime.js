/**
 * Reactor runtime utilities: power-state management, wall-clock uptime
 * formatting, and vent smoke visuals.
 *
 * None of these functions touch the Minecraft entity directly — they operate
 * on a plain data object that the caller reads from / writes to dynamic
 * properties, keeping the tick body clean and testable.
 */

// ── Power state ───────────────────────────────────────────────────────────────

/**
 * Switch a reactor on or off, recording the wall-clock start time so uptime
 * can be shown accurately even across session reloads.
 *
 * @param {Record<string, any>} data    Mutable reactor data object.
 * @param {boolean}             running Target state.
 * @param {number}              [now]   `Date.now()` override for testing.
 */
export function setReactorRunning(data, running, now = Date.now()) {
    delete data.time;                        // remove legacy field if present
    data.state       = running ? "on" : "off";
    data.startedAtMs = running ? now : 0;
}

/**
 * Repair the timestamp on a reactor that was running when the world last
 * closed, and clear stale timestamps when the reactor is off.
 *
 * Call once per tick before reading `startedAtMs`.
 *
 * @param {Record<string, any>} data
 * @param {number} [now]
 */
export function synchronizeReactorTimer(data, now = Date.now()) {
    delete data.time;

    if (data.state === "off") {
        data.startedAtMs = 0;
        return;
    }

    const startedAtMs = Number(data.startedAtMs);
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0 || startedAtMs > now) {
        data.startedAtMs = now;
    }
}

// ── Uptime display ────────────────────────────────────────────────────────────

/**
 * Format how long the reactor has been running as `hh:mm:ss`.
 * Returns `"00:00:00"` when the reactor is off or the timestamp is invalid.
 *
 * @param {Record<string, any>} data
 * @param {number} [now]
 * @returns {string}
 */
export function formatReactorOnTime(data, now = Date.now()) {
    if (data.state === "off") return "00:00:00";

    const startedAtMs = Number(data.startedAtMs);
    if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) return "00:00:00";

    const totalSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
    const hours   = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
        .map(v => String(v).padStart(2, "0"))
        .join(":");
}

// ── Vent smoke ────────────────────────────────────────────────────────────────

/**
 * Spawn tall smoke particles over a random sample of vent blocks recorded on
 * the multiblock entity.
 *
 * Vent positions are stored as a JSON array under the `"ventBlocks"` dynamic
 * property: `[{x, y, z}, ...]`. Fewer than 2 vents produces no effect.
 *
 * @param {import('@minecraft/server').Entity} entity
 * @param {number} [ratio=0.10]   Fraction of vents to activate per call.
 * @param {boolean} [center=true] Offset position to block centre when true.
 */
export function spawnReactorVentSmoke(entity, ratio = 0.10, center = true) {
    let vents = [];
    try {
        const raw = entity.getDynamicProperty("ventBlocks");
        vents = raw ? JSON.parse(raw) : [];
    } catch {
        vents = [];
    }

    const ventCount = vents.length;
    if (ventCount < 2) return;

    // Partial Fisher-Yates: shuffle the tail so each call picks a new sample.
    const sampleCount = Math.max(1, Math.floor(ventCount * ratio));
    for (let i = ventCount - 1; i > ventCount - 1 - sampleCount; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [vents[i], vents[j]] = [vents[j], vents[i]];
    }

    for (let i = ventCount - sampleCount; i < ventCount; i++) {
        const vent = vents[i];
        const pos  = center
            ? { x: vent.x + 0.5, y: vent.y + 0.5, z: vent.z + 0.5 }
            : vent;
        try {
            entity.dimension.spawnParticle("minecraft:campfire_tall_smoke_particle", pos);
        } catch { /* chunk may be unloaded; safe to skip */ }
    }
}
