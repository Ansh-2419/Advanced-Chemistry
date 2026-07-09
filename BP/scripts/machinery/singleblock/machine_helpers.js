import { ItemStack } from "@minecraft/server";
import { FluidStorage } from "../../DoriosCore/index.js";

export const EMPTY_FLUID = "empty";

export function getMachineFluidCap(settings, fallback = 128000) {
    return Math.max(1, Math.floor(settings?.machine?.fluid_cap ?? fallback));
}

export function getMachineEnergyCost(settings, recipe, fallback) {
    return Math.max(1, Math.floor(recipe?.energyCost ?? settings?.machine?.energy_cost ?? fallback));
}

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

export function chargeOrCraft(machine, energyCost, maxRuns, craft) {
    machine.setEnergyCost(energyCost);

    if (maxRuns <= 0) return 0;

    const progress = machine.getProgress();
    const completedRuns = Math.min(maxRuns, Math.floor(progress / energyCost));

    if (completedRuns > 0) {
        craft(completedRuns);
        machine.addProgress(-(completedRuns * energyCost));
        return completedRuns;
    }

    if (machine.energy.get() <= 0) return 0;

    const consumption = machine.boosts?.consumption ?? 1;
    const needed = energyCost - progress;
    const spendable = Math.min(machine.energy.get(), machine.rate, needed * consumption);

    if (spendable > 0) {
        machine.energy.consume(spendable);
        machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
    }

    return 0;
}

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

    const removed = Math.min(item.amount, amount);
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

export function formatFluidType(type) {
    if (!type || type === EMPTY_FLUID) return "Empty";
    return type
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
