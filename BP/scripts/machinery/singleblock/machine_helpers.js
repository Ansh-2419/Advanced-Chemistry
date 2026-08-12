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
 * Compute the per-tick energy drain rate so a craft takes exactly `seconds`
 * real-world seconds (at 20 ticks/s).
 *
 * @param {number} energyCost  - total DE for one craft cycle
 * @param {number} seconds     - desired duration in seconds
 * @returns {number}           - DE per tick
 */
/**
 * Compute the base per-tick energy drain rate for a given craft duration.
 * The Machine constructor already applies boosts.speed and boosts.consumption
 * to machine.rate — so here we only compute the unmodified base rate.
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
 * Upgrade handling:
 *   - Speed upgrades   → machine.boosts.speed   → more rate per tick → faster craft
 *   - Energy upgrades  → machine.boosts.consumption → more DE per tick but same progress
 *   - Batch upgrades   → machine.boosts.process_batch → more outputs per completed cycle
 *
 * The Machine constructor sets machine.rate = baseRate * speed * consumption.
 * We must set baseRate (rate_speed_base equivalent) via setRate so the Machine's
 * own boost multiplication gives the correct final rate.
 * Therefore we pass energyCost / ticks as the BASE rate (pre-boost), then
 * re-apply boosts manually since setRate overwrites the boosted value.
 *
 * @param {object}   machine          - DoriosCore Machine instance
 * @param {object}   opts
 * @param {number}   opts.energyCost  - DE per one craft cycle (base cost)
 * @param {number}   opts.seconds     - seconds at base speed (no upgrades)
 * @param {number}   opts.maxRuns     - max crafts allowed this tick
 * @param {Function} opts.craft       - called with (runs: number) when craft fires
 * @returns {number} runs completed this tick
 */
export function processMachine(machine, { energyCost, seconds, maxRuns, craft }) {
    if (maxRuns <= 0) return 0;

    const processBatch = Math.max(1, Math.floor(machine.boosts?.process_batch ?? 1));
    const consumption  = machine.boosts?.consumption ?? 1;
    const speed        = machine.boosts?.speed ?? 1;

    // Apply boosted energy cost (energy upgrades affect how much DE per craft)
    const boostedEnergyCost = Math.max(1, Math.round(energyCost * consumption));
    machine.setEnergyCost(boostedEnergyCost);

    // Rate = DE per tick. Speed upgrades shorten the craft duration.
    // base ticks = seconds * 20, boosted ticks = base / speed
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

    const removed    = Math.min(item.amount, amount);
    const remaining  = item.amount - removed;
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

export function formatFluidType(type) {
    if (!type || type === EMPTY_FLUID) return "Empty";
    return type
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

// ── Legacy alias (keeps old callers working during migration) ─────────────────
/** @deprecated Use processMachine() instead */
export function chargeOrCraft(machine, energyCost, maxRuns, craft) {
    return processMachine(machine, {
        energyCost,
        seconds: energyCost / Math.max(1, machine.rate) / 20,
        maxRuns,
        craft,
    });
}
