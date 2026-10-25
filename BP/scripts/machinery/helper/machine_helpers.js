import { ItemStack } from "@minecraft/server";
import { FluidStorage } from "DoriosCore/index.js";

export const EMPTY_FLUID = "empty";

// ── Energy / rate helpers ─────────────────────────────────────────────────────

export function getMachineFluidCap(settings, fallback = 128000) {
    return Math.max(1, Math.floor(settings?.machine?.fluid_cap ?? fallback));
}

export function getMachineEnergyCost(settings, recipe, fallback) {
    return Math.max(1, Math.floor(recipe?.energyCost ?? settings?.machine?.energy_cost ?? fallback));
}

/**
 * Compute the base per-tick energy drain rate for a given craft duration.
 *
 * @param {number} energyCost  - total DE for one craft cycle (base, before upgrades)
 * @param {number} seconds     - desired duration in seconds at base speed (no upgrades)
 * @returns {number}           - base DE per tick
 */
export function getMachineRate(energyCost, seconds) {
    const ticks = Math.max(1, Math.round(seconds * 20));
    return energyCost / ticks;
}

// ── Core tick processor ───────────────────────────────────────────────────────

/**
 * Unified energy-drain + craft processor.
 * Call once per onTick after all validation has passed.
 *
 * @param {object}   machine
 * @param {object}   opts
 * @param {number}   opts.energyCost
 * @param {number}   opts.seconds
 * @param {number}   opts.maxRuns
 * @param {Function} opts.craft
 * @returns {number} runs completed this tick
 */
export function processMachine(machine, { energyCost, seconds, maxRuns, craft }) {
    if (maxRuns <= 0) return 0;

    const processBatch = Math.max(1, Math.floor(machine.boosts?.process_batch ?? 1));
    const consumption  = machine.boosts?.consumption ?? 1;
    const speed        = machine.boosts?.speed ?? 1;

    const boostedEnergyCost = Math.max(1, Math.round(energyCost * consumption));
    machine.setEnergyCost(boostedEnergyCost);

    const baseTicks    = Math.max(1, seconds * 20);
    const boostedTicks = Math.max(1, baseTicks / speed);
    const ratePerTick  = boostedEnergyCost / boostedTicks;
    machine.setRate(ratePerTick);

    const maxProgress      = Math.ceil(maxRuns / processBatch) * boostedEnergyCost;
    let   progress         = machine.getProgress();
    const progressCapacity = Math.max(0, maxProgress - progress);
    const energyToConsume  = Math.min(machine.energy.get(), ratePerTick, progressCapacity);

    if (energyToConsume > 0) {
        machine.energy.consume(energyToConsume);
        progress += energyToConsume;
        machine.setProgress(progress, { display: false });
    }

    const completedCycles = Math.floor(progress / boostedEnergyCost);
    const runs = Math.min(completedCycles * processBatch, maxRuns);

    if (runs > 0) {
        craft(runs);
        progress -= Math.ceil(runs / processBatch) * boostedEnergyCost;
        machine.setProgress(progress, { display: false });
    }

    return runs;
}

// ── Tank helpers ──────────────────────────────────────────────────────────────

export function getTank(entity, index, cap) {
    FluidStorage.initializeObjectives(index);

    const tank = index === 0
        ? FluidStorage.initializeSingle(entity)
        : new FluidStorage(entity, index);

    if (cap !== undefined && tank.getCap() <= 0) {
        tank.setCap(cap);
    }

    return tank;
}

export function setupTanks(entity, cap, slots) {
    FluidStorage.initializeMultiple(entity, slots.length);

    return slots.map((slot, index) => {
        const tank = getTank(entity, index, cap);
        tank.setCap(cap);
        tank.display(slot);
        return tank;
    });
}

/**
 * Drain a tank and reset its type to EMPTY_FLUID when it reaches zero.
 * Avoids the repeated inline `tankIn.consume(n); if (tankIn.get() <= 0) tankIn.setType(EMPTY_FLUID);`
 */
export function consumeTank(tank, amount) {
    tank.consume(amount);
    if (tank.get() <= 0) tank.setType(EMPTY_FLUID);
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function displayMachine(machine, tanks = []) {
    for (const entry of tanks) {
        entry.tank.display(entry.slot);
    }
    machine.displayEnergy();
    machine.displayProgress();
}

export function stopMachine(machine, message, options = {}) {
    machine.showWarning(message, options);
    machine.off();
}

/**
 * Shared fail helper for machines that have a displays array.
 * Equivalent to the local `fail` function repeated in every fluid machine.
 */
export function failMachine(machine, displays, message, options) {
    stopMachine(machine, message, options);
    displayMachine(machine, displays);
}

/**
 * Return true when the machine has no energy AND hasn't started progress yet.
 * When true the caller should stop with { resetProgress: false }.
 */
export function hasNoEnergy(machine, energyCost) {
    return machine.energy.get() <= 0 && machine.getProgress() < energyCost;
}

// ── Item helpers ──────────────────────────────────────────────────────────────

export function addItemToSlot(container, slot, typeId, amount) {
    if (!typeId || amount <= 0) return 0;

    const existing = container.getItem(slot);
    if (!existing) {
        const stack = new ItemStack(typeId, Math.min(64, amount));
        container.setItem(slot, stack);
        return stack.amount;
    }

    if (existing.typeId !== typeId) return 0;

    const space = (existing.maxAmount ?? 64) - existing.amount;
    const added = Math.max(0, Math.min(space, amount));
    if (added <= 0) return 0;

    existing.amount += added;
    container.setItem(slot, existing);
    return added;
}

export function removeItemsFromSlot(container, slot, amount) {
    if (amount <= 0) return 0;

    const item = container.getItem(slot);
    if (!item) return 0;

    const removed   = Math.min(item.amount, amount);
    const remaining = item.amount - removed;
    if (remaining <= 0) {
        container.setItem(slot, undefined);
    } else {
        item.amount = remaining;
        container.setItem(slot, item);
    }
    return removed;
}

export function tryUseFluidItemInSlot(container, slot, entity) {
    const item = container.getItem(slot);
    if (!item) return false;

    const containerData = FluidStorage.getContainerData(item.typeId);
    if (!containerData?.type) return false;

    const candidateTank = FluidStorage.findType(entity, containerData.type);
    if (!candidateTank) return false;

    const result = candidateTank.fluidItem(item.typeId);
    if (result === false) return false;

    const remaining = item.amount - 1;
    if (remaining <= 0) {
        container.setItem(slot, undefined);
    } else {
        item.amount = remaining;
        container.setItem(slot, item);
    }

    if (result) {
        const overflow = container.addItem(new ItemStack(result, 1));
        if (overflow) entity.dimension.spawnItem(overflow, entity.location);
    }

    return true;
}

// ── Formatting helpers ────────────────────────────────────────────────────────

export function formatFluidType(type) {
    if (!type || type === EMPTY_FLUID) return "Empty";
    return type
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

/**
 * Format an item identifier to a human-readable name.
 * `"utilitycraft:iron_dust"` → `"iron dust"`
 */
export function formatItemId(id) {
    return (id.split(":")[1] ?? id).replace(/_/g, " ");
}

/**
 * Count available space for `typeId` across a list of output slots.
 * Returns total empty slots * 64 plus remaining space in matching stacks.
 */
export function getOutputSlotSpace(container, slots, typeId) {
    return slots.reduce((total, s) => {
        const item = container.getItem(s);
        if (!item) return total + 64;
        if (item.typeId === typeId) return total + Math.max(0, (item.maxAmount ?? 64) - item.amount);
        return total;
    }, 0);
}

/**
 * Place `count` items of `typeId` into the first available slots in `slots`,
 * stacking into existing matching items first.
 */
export function addItemToSlots(container, slots, typeId, count) {
    let left = count;
    // Fill existing stacks first
    for (const s of slots) {
        if (left <= 0) break;
        const item = container.getItem(s);
        if (!item || item.typeId !== typeId) continue;
        const add = Math.min((item.maxAmount ?? 64) - item.amount, left);
        if (add <= 0) continue;
        item.amount += add;
        container.setItem(s, item);
        left -= add;
    }
    // Then fill empty slots
    for (const s of slots) {
        if (left <= 0) break;
        if (container.getItem(s)) continue;
        const add = Math.min(64, left);
        container.setItem(s, new ItemStack(typeId, add));
        left -= add;
    }
}

// ── Legacy alias ──────────────────────────────────────────────────────────────
/** @deprecated Use processMachine() instead */
export function chargeOrCraft(machine, energyCost, maxRuns, craft) {
    return processMachine(machine, {
        energyCost,
        seconds: energyCost / Math.max(1, machine.rate) / 20,
        maxRuns,
        craft,
    });
}