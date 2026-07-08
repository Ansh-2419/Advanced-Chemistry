import { ItemStack } from "@minecraft/server";
import {
    Machine,
    EnergyStorage,
    FluidStorage,
} from "../../DoriosCore/index.js";
import { getFermentationRecipes } from "../../config/recipes/machinery/fermenter.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
const INPUT_SLOTS        = [3, 7, 8, 9];
const FLUID_SLOT         = 10;
const FLUID_DISPLAY_SLOT = 11;
const RESIDUE_SLOT       = 19;

const DEFAULT_FLUID_TYPE = "ethanol";

/*
Slots (inventory_size: 20)
- [0]      Energy display (machine.displayEnergy).
- [1]      Label slot (machine.setLabel).
- [2]      Progress bar (machine.displayProgress).
- [3,7,8,9] Item inputs (INPUT_SLOTS) — 2×2 grid.
- [4,5,6]  Upgrade slots.
- [10]     Fluid slot (FLUID_SLOT) — wrench-pipe input.
- [11]     Fluid tank display (FLUID_DISPLAY_SLOT) — blocked for player.
- [19]     Residue output (RESIDUE_SLOT).
Hidden: [12–18]
*/

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("fermenter", {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnEntity(e, settings, (entity) => {
            const machine = new Machine(e.block, { ...settings, ignoreTick: true });
            if (!machine?.entity) return;

            machine.setEnergyCost(settings.machine.energy_cost ?? 2000);
            machine.displayProgress();
            machine.displayEnergy();
            machine.blockSlots([FLUID_DISPLAY_SLOT]);

            const tank = FluidStorage.initializeSingle(entity);
            tank.display(FLUID_DISPLAY_SLOT);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const entity = machine.entity;
        const tank   = FluidStorage.initializeSingle(entity);

        // ── Item output transfer ──────────────────────────────────────────
        machine.transferItems();

        // ── Fluid output via IO system ────────────────────────────────────
        machine.processIO({
            liquids: { output: tank },
        });

        // ── Feed fluid from the bucket slot into the internal tank ────────
        _feedFluidSlot(machine, tank, FLUID_SLOT);

        // ── Display ───────────────────────────────────────────────────────
        tank.display(FLUID_DISPLAY_SLOT);
        machine.displayEnergy();
        machine.displayProgress();

        // ── Recipe resolution ─────────────────────────────────────────────
        const fail = (msg, reset = true) => {
            machine.showWarning(msg, { resetProgress: reset });
            tank.display(FLUID_DISPLAY_SLOT);
        };

        const recipes = resolveRecipes(block, settings);
        if (!recipes.length) { fail("No Recipes"); return; }

        const { inputStack, inputSlot } = getActiveInputSlot(machine, recipes);
        if (!inputStack) { fail("Insert Item"); return; }

        const recipe = matchRecipe(recipes, inputStack);
        if (!recipe) { fail("Missing Items"); return; }

        // ── Batch selection ───────────────────────────────────────────────
        const batches = recipe.batches ?? recipe.batch ?? {
            small: { size: 8,                                   seconds: 6, fluidAmount: 150 },
            large: { size: Math.max(1, recipe.input?.amount ?? 64), seconds: 8 },
        };

        const smallSize   = Math.max(1, batches.small?.size    ?? 8);
        const smallSecs   = Math.max(1, batches.small?.seconds ?? 6);
        const smallFluid  = Number.isFinite(batches.small?.fluidAmount) ? Math.max(0, Math.floor(batches.small.fluidAmount)) : null;

        const largeSize   = Math.max(1, batches.large?.size    ?? (recipe.input?.amount ?? 64));
        const largeSecs   = Math.max(1, batches.large?.seconds ?? 40);
        const largeFluid  = Number.isFinite(batches.large?.fluidAmount) ? Math.max(0, Math.floor(batches.large.fluidAmount)) : null;

        const available = inputStack.amount ?? 0;
        let chosenSize, chosenSecs, chosenIsSmall;
        if (available >= largeSize) {
            chosenSize = largeSize; chosenSecs = largeSecs; chosenIsSmall = false;
        } else if (available >= smallSize) {
            chosenSize = smallSize; chosenSecs = smallSecs; chosenIsSmall = true;
        } else {
            fail("Missing Items"); return;
        }

        const baseline = Math.max(1, recipe.input?.amount ?? largeSize);
        const scale    = chosenSize / baseline;

        let effectiveFluid;
        if (chosenIsSmall) {
            effectiveFluid = smallFluid !== null ? smallFluid : 150;
        } else {
            effectiveFluid = largeFluid !== null ? largeFluid : Math.max(1, Math.floor((recipe.fluid?.amount ?? 1) * scale));
        }

        const effectiveRecipe = {
            ...recipe,
            input:      { ...recipe.input, amount: chosenSize },
            fluid:      { ...recipe.fluid, amount: effectiveFluid },
            energyCost: Math.max(1, Math.floor((recipe.energyCost ?? (settings.machine?.energy_cost ?? 2000)) * scale)),
            seconds:    chosenSecs,
        };

        // ── Tank type check ───────────────────────────────────────────────
        const fluidType = effectiveRecipe.fluid.type ?? DEFAULT_FLUID_TYPE;
        const tankType  = tank.getType();
        if (tankType !== "empty" && tankType !== fluidType) {
            fail(`Wrong Fluid\n§7Need ${_fmt(fluidType)}`);
            return;
        }

        const residueSlot = machine.container.getItem(RESIDUE_SLOT);
        if (effectiveRecipe.byproduct && residueSlot && residueSlot.typeId !== effectiveRecipe.byproduct.id) {
            fail("Residue Slot Busy"); return;
        }

        const crafts = _calculateCrafts(tank, effectiveRecipe, inputStack, residueSlot);
        if (crafts.max <= 0) { fail(crafts.reason ?? "Missing Items"); return; }

        const configuredCost = effectiveRecipe.energyCost ?? settings.machine.energy_cost ?? 2000;
        machine.setEnergyCost(configuredCost);

        if (machine.energy.get() <= 0) { fail("No Energy", false); return; }

        const energyCost = machine.getEnergyCost();
        const progress   = machine.getProgress();

        if (progress >= energyCost) {
            const craftRuns = Math.min(crafts.max, Math.floor(progress / energyCost));
            if (craftRuns > 0) {
                _processCraft(machine, effectiveRecipe, craftRuns, tank, inputSlot);
                machine.addProgress(-(craftRuns * energyCost));
            }
        } else {
            const consumption = machine.boosts?.consumption ?? 1;
            const needed    = energyCost - progress;
            const spendable = Math.min(machine.energy.get(), machine.rate, needed * consumption);
            if (spendable > 0) {
                machine.energy.consume(spendable);
                machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
            }
        }

        _updateHud(machine, effectiveRecipe, tank, crafts.max);
        tank.display(FLUID_DISPLAY_SLOT);
        machine.displayEnergy();
        machine.displayProgress();
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pours fluid from a bucket item in `slot` into `tank`.
 * Simplified replacement for the old `feedFluidSlot` helper.
 */
function _feedFluidSlot(machine, tank, slot) {
    const item = machine.container.getItem(slot);
    if (!item) return;
    // Delegate to DoriosAPI fluid item handling if available
    try {
        FluidStorage.handleFluidItemInteraction(null, machine.entity, item);
    } catch {}
}

function resolveRecipes(block, settings) {
    const component = block.getComponent("utilitycraft:machine_recipes")?.customComponentParameters?.params;
    if (component?.type === "liquifier" || component?.type === "fermenter") return getFermentationRecipes();
    if (Array.isArray(component)) return component;
    if (settings?.machine?.recipes && Array.isArray(settings.machine.recipes)) return settings.machine.recipes;
    return getFermentationRecipes();
}

function getActiveInputSlot(machine, recipes) {
    let firstOccupied = null;
    for (const slot of INPUT_SLOTS) {
        const stack = machine.container.getItem(slot);
        if (!stack) continue;
        if (!firstOccupied) firstOccupied = { inputStack: stack, inputSlot: slot };
        if (matchRecipe(recipes, stack)) return { inputStack: stack, inputSlot: slot };
    }
    return firstOccupied ?? { inputStack: null, inputSlot: INPUT_SLOTS[0] };
}

function matchRecipe(recipes, stack) {
    if (!stack) return null;
    const inputId    = stack.typeId;
    const candidates = recipes.filter(r => r.input?.id === inputId);
    if (!candidates.length) return null;
    const available = stack.amount ?? 0;
    let chosen = null, chosenAmount = -1;
    for (const r of candidates) {
        const required = Math.max(1, r.input?.amount ?? 1);
        if (available >= required && required > chosenAmount) { chosen = r; chosenAmount = required; }
    }
    return chosen;
}

function _calculateCrafts(tank, recipe, inputStack, residueSlot) {
    const inputAmount  = Math.max(1, recipe.input.amount ?? 1);
    const fluidPerCraft = Math.max(1, recipe.fluid.amount ?? 1);

    const availItems = Math.floor(inputStack.amount / inputAmount);
    const availFluid = Math.floor(tank.getFreeSpace() / fluidPerCraft);

    let residueCap = Number.MAX_SAFE_INTEGER;
    if (recipe.byproduct) {
        const amt = Math.max(1, recipe.byproduct.amount ?? 1);
        if (!residueSlot) {
            residueCap = Math.floor(64 / amt);
        } else {
            if (residueSlot.typeId !== recipe.byproduct.id) return { max: 0, reason: "Residue Slot Busy" };
            const free = (residueSlot.maxAmount ?? 64) - residueSlot.amount;
            residueCap = Math.floor(free / amt);
        }
    }

    const max = Math.min(availItems, availFluid, residueCap);
    if (max <= 0) {
        if (availItems <= 0) return { max: 0, reason: "Missing Items" };
        if (availFluid <= 0) return { max: 0, reason: "Tank Full" };
        if (residueCap <= 0) return { max: 0, reason: "Residue Full" };
    }
    return { max };
}

function _processCraft(machine, recipe, crafts, tank, inputSlot) {
    const inputPerCraft = Math.max(1, recipe.input.amount ?? 1);
    const totalInput    = inputPerCraft * crafts;

    // Remove items from the input slot
    const existing = machine.container.getItem(inputSlot);
    if (existing) {
        existing.amount -= totalInput;
        machine.container.setItem(inputSlot, existing.amount > 0 ? existing : undefined);
    }

    const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    if (tank.getType() === "empty") tank.setType(fluidType);
    tank.add(Math.floor(recipe.fluid.amount * crafts));

    if (recipe.byproduct) {
        const produced = Math.floor(recipe.byproduct.amount ?? 1) * crafts;
        if (produced > 0) _addToSlot(machine, RESIDUE_SLOT, recipe.byproduct.id, produced);
    }
}

function _addToSlot(machine, slot, typeId, count) {
    try {
        const existing = machine.container.getItem(slot);
        if (existing && existing.typeId === typeId && existing.amount < existing.maxAmount) {
            existing.amount = Math.min(existing.maxAmount, existing.amount + count);
            machine.container.setItem(slot, existing);
        } else if (!existing) {
            machine.container.setItem(slot, new ItemStack(typeId, count));
        }
    } catch {}
}

function _fmt(type) {
    if (!type || type === "empty") return "Empty";
    return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function _updateHud(machine, recipe, tank, maxCrafts) {
    const fluidType     = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    const fluidPerCraft = recipe.fluid.amount;
    const batchLine     = `§7Batch: §f${recipe.input?.amount ?? "—"} items §7/ §f${recipe.seconds ?? "—"}s`;

    machine.setLabel([
        "§6Fermenter",
        `§bInput:  §f${recipe.input.id?.split(":")[1] ?? recipe.input.id}`,
        `§dFerment: §f${_fmt(fluidType)}`,
        `§7Yield:  §f${FluidStorage.formatFluid(fluidPerCraft)} each`,
        `§7Tank:   §f${FluidStorage.formatFluid(tank.get())} §7/ §f${FluidStorage.formatFluid(tank.getCap())}`,
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${maxCrafts}`,
        batchLine,
    ]);
}
