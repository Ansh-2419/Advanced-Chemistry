import { Machine, Energy, FluidManager, updatePipes, buildOverclockLoreLine, applyDynamicRecipeRate, tickGate, feedFluidSlot, rollByproduct, clampChance, addItemsToSlot, formatItemName, formatFluidDisplayName } from '../../DoriosCore/index.js';
import { getFermentationRecipes } from '../../config/recipes/machinery/fermenter.js';

const INPUT_SLOTS = [3, 7, 8, 9];
const FLUID_SLOT = 10;
const FLUID_DISPLAY_SLOT = 11;
const RESIDUE_SLOT = 19;
const DEFAULT_FLUID_TYPE = 'ethanol';

/*
Slots (inventory_size: 20)
- [0]  HUD de energia (machine.displayEnergy).
- [3,7,8,9] Input de item (INPUT_SLOTS) - 2x2 grid.
- [4,5,6]   Slots de upgrades.
- [10] Entrada de fluido (FLUID_SLOT).
- [11] Display do tanque (FLUID_DISPLAY_SLOT) — bloqueado para o jogador.
- [19] Saída de resíduo (RESIDUE_SLOT).
Slots escondidos: [12, 13, 14, 15, 16, 17, 18]
*/

DoriosAPI.register.blockComponent('fermenter', {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnMachineEntity(e, settings, () => {
            const machine = new Machine(e.block, settings, true);
            if (!machine?.entity) return;

            machine.setEnergyCost(settings.machine.energy_cost ?? 2000);
            machine.displayProgress();
            machine.displayEnergy();
            machine.blockSlots([FLUID_DISPLAY_SLOT]);

            const tank = FluidManager.initializeSingle(machine.entity);
            tank.display(FLUID_DISPLAY_SLOT);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        if (tickGate(machine.entity, 'liq:items_cd', 4)) {
            machine.transferItems();
        }

        const tank = FluidManager.initializeSingle(machine.entity);
        if (tickGate(machine.entity, 'liq:fluids_cd', 4)) {
            const available = tank.get();
            if (available > 0) {
                let nodes = [];
                try {
                    const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                    if (cached) nodes = JSON.parse(cached);
                } catch { /* ignore */ }

                if (!Array.isArray(nodes) || nodes.length === 0) {
                    updatePipes(block, 'fluid');
                    try {
                        const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                        if (cached) nodes = JSON.parse(cached);
                    } catch { /* ignore */ }
                }

                tank.transferFluids(block, available, { useFacing: true });

                if (Array.isArray(nodes) && nodes.length) {
                    tank.transferToNetwork(available, 'nearest', nodes);
                }
            }
        }
        feedFluidSlot(machine, tank, FLUID_SLOT);

        const fail = (message, reset = true) => {
            machine.showWarning(message, reset);
            tank.display(FLUID_DISPLAY_SLOT);
        };

        const recipes = resolveRecipes(block, settings);
        if (!recipes.length) {
            fail('No Recipes');
            return;
        }

        // Find first occupied input slot with a matching recipe (single-pass)
        const { inputStack, inputSlot } = getActiveInputSlot(machine, recipes);
        if (!inputStack) {
            fail('Insert Item');
            return;
        }

        const recipe = matchRecipe(recipes, inputStack);
        if (!recipe) {
            // When there are items but none meet the recipe's required amount
            fail('Missing Items');
            return;
        }

        // Determine per-recipe batch defaults (batches normalized in recipes)
        const batches = recipe.batches ?? recipe.batch ?? {
            small: { size: 8, seconds: 6, fluidAmount: 150 },
            large: { size: Math.max(1, recipe.input?.amount ?? 64), seconds: 8 }
        };

        const smallSize = Math.max(1, batches.small?.size ?? 8);
        const smallSeconds = Math.max(1, batches.small?.seconds ?? 6);
        const smallFluidAmountOverride = (Number.isFinite(batches.small?.fluidAmount) ? Math.max(0, Math.floor(batches.small.fluidAmount)) : null);

        const largeSize = Math.max(1, batches.large?.size ?? (recipe.input?.amount ?? 64));
        const largeSeconds = Math.max(1, batches.large?.seconds ?? 8);
        const largeFluidAmountOverride = (Number.isFinite(batches.large?.fluidAmount) ? Math.max(0, Math.floor(batches.large.fluidAmount)) : null);

        // Choose batch based on available items
        const availableStackAmount = inputStack.amount ?? 0;
        let chosenBatchSize = null;
        let chosenBatchSeconds = null;
        let chosenIsSmall = false;
        if (availableStackAmount >= largeSize) {
            chosenBatchSize = largeSize;
            chosenBatchSeconds = largeSeconds;
        } else if (availableStackAmount >= smallSize) {
            chosenBatchSize = smallSize;
            chosenBatchSeconds = smallSeconds;
            chosenIsSmall = true;
        } else {
            fail('Missing Items');
            return;
        }

        // Scale effective recipe to the chosen batch size.
        // Baseline is the canonical recipe.input.amount (large canonical).
        const baseline = Math.max(1, recipe.input?.amount ?? largeSize);
        const scale = chosenBatchSize / baseline;

        // Determine fluid amount:
        // - If chosen is small and recipe provides small.fluidAmount, use it.
        // - Else, if chosen is small and no override, default small production = 150 mB.
        // - For large (or fallback), use either large override or scaled recipe.fluid.amount.
        let effectiveFluidAmount;
        if (chosenIsSmall) {
            if (smallFluidAmountOverride !== null) {
                effectiveFluidAmount = smallFluidAmountOverride;
            } else {
                effectiveFluidAmount = 150; // default small-batch fluid amount per your request
            }
        } else {
            if (largeFluidAmountOverride !== null) {
                effectiveFluidAmount = largeFluidAmountOverride;
            } else {
                effectiveFluidAmount = Math.max(1, Math.floor((recipe.fluid?.amount ?? 1) * scale));
            }
        }

        const effectiveRecipe = {
            ...recipe,
            input: { ...recipe.input, amount: chosenBatchSize },
            fluid: {
                ...recipe.fluid,
                amount: effectiveFluidAmount
            },
            energyCost: Math.max(1, Math.floor((recipe.energyCost ?? (settings.machine?.energy_cost ?? 2000)) * scale)),
            seconds: chosenBatchSeconds
        };

        const fluidType = effectiveRecipe.fluid.type ?? DEFAULT_FLUID_TYPE;
        const tankType = tank.getType();

        if (tankType !== 'empty' && tankType !== fluidType) {
            fail(`Wrong Fluid\n§7Need ${formatFluidDisplayName(fluidType)}`);
            return;
        }

        const byproductSlot = machine.inv.getItem(RESIDUE_SLOT);
        if (effectiveRecipe.byproduct && byproductSlot && byproductSlot.typeId !== effectiveRecipe.byproduct.id) {
            fail('Residue Slot Busy');
            return;
        }

        const crafts = calculateCrafts(machine, tank, effectiveRecipe, inputStack, byproductSlot, machine.boosts.overclockYield ?? 1);
        if (crafts.max <= 0) {
            fail(crafts.reason ?? 'Missing Items');
            return;
        }

        const configuredCost = effectiveRecipe.energyCost ?? settings.machine.energy_cost ?? 2000;
        machine.setEnergyCost(configuredCost);
        if (settings?.machine?.dynamic_rate === true) {
            applyDynamicRecipeRate(machine, effectiveRecipe, { energyCost: configuredCost });
        }
        const energyAvailable = machine.energy.get();
        if (energyAvailable <= 0) {
            fail('No Energy', false);
            return;
        }

        const energyCost = machine.getEnergyCost();
        const progress = machine.getProgress();

        if (progress >= energyCost) {
            const craftRuns = Math.min(crafts.max, Math.floor(progress / energyCost));
            if (craftRuns > 0) {
                processCraft(machine, effectiveRecipe, craftRuns, tank, inputSlot);
                machine.addProgress(-(craftRuns * energyCost));
            }
        } else {
            const consumption = machine.boosts.consumption;
            const needed = energyCost - progress;
            const spendable = Math.min(machine.energy.get(), machine.rate, needed * consumption);
            if (spendable > 0) {
                machine.energy.consume(spendable);
                machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
            }
        }

        updateHud(machine, effectiveRecipe, tank, crafts.max);
        tank.display(FLUID_DISPLAY_SLOT);
        machine.displayEnergy();
        machine.displayProgress();
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    }
});

/* Helpers */

function resolveRecipes(block, settings) {
    const component = block.getComponent('utilitycraft:machine_recipes')?.customComponentParameters?.params;
    // Accept both "liquifier" and "fermenter" as component.type to be robust to JSON variations.
    if (component?.type === 'liquifier' || component?.type === 'fermenter') return getFermentationRecipes();
    if (Array.isArray(component)) return component;
    if (settings?.machine?.recipes && Array.isArray(settings.machine.recipes)) {
        return settings.machine.recipes;
    }
    return getFermentationRecipes();
}

function getActiveInputSlot(machine, recipes) {
    // Single pass: remember first occupied for fallback, and return first slot
    // whose stack matches a recipe (matchRecipe ensures amount is respected).
    let firstOccupied = null;

    for (const slot of INPUT_SLOTS) {
        const stack = machine.inv.getItem(slot);
        if (!stack) continue;

        if (!firstOccupied) firstOccupied = { inputStack: stack, inputSlot: slot };

        const r = matchRecipe(recipes, stack);
        if (r) return { inputStack: stack, inputSlot: slot };
    }

    return firstOccupied ?? { inputStack: null, inputSlot: INPUT_SLOTS[0] };
}

function matchRecipe(recipes, stack) {
    if (!stack) return null;

    const inputId = stack.typeId;
    const candidates = recipes.filter(r => r.input?.id === inputId);
    if (!candidates.length) return null;

    // Prefer the candidate with largest required input.amount that is <= stack.amount.
    const available = stack.amount ?? 0;
    let chosen = null;
    let chosenAmount = -1;

    for (const r of candidates) {
        const required = Math.max(1, r.input?.amount ?? 1);
        if (available >= required && required > chosenAmount) {
            chosen = r;
            chosenAmount = required;
        }
    }

    // If nothing fits (stack smaller than all recipe.required amounts) return null
    return chosen;
}

function calculateCrafts(machine, tank, recipe, inputStack, byproductSlot, yieldBoost = 1) {
    const inputAmount = Math.max(1, recipe.input.amount ?? 1);
    const fluidPerCraft = Math.max(1, recipe.fluid.amount ?? 1);

    const availableItems = Math.floor(inputStack.amount / inputAmount);
    const availableFluid = Math.floor(tank.getFreeSpace() / (fluidPerCraft * yieldBoost));

    let residueCapacity = Number.MAX_SAFE_INTEGER;
    if (recipe.byproduct) {
        const residueAmount = Math.max(1, recipe.byproduct.amount ?? 1);
        if (!byproductSlot) {
            residueCapacity = Math.floor((64) / (residueAmount * yieldBoost));
        } else {
            if (byproductSlot.typeId !== recipe.byproduct.id) {
                return { max: 0, reason: 'Residue Slot Busy' };
            }
            const free = (byproductSlot.maxAmount ?? 64) - byproductSlot.amount;
            residueCapacity = Math.floor(free / (residueAmount * yieldBoost));
        }
    }

    const max = Math.min(availableItems, availableFluid, residueCapacity);

    if (max <= 0) {
        if (availableItems <= 0) return { max: 0, reason: 'Missing Items' };
        if (availableFluid <= 0) return { max: 0, reason: 'Tank Full' };
        if (residueCapacity <= 0) return { max: 0, reason: 'Residue Full' };
    }

    return { max };
}

function processCraft(machine, recipe, crafts, tank, inputSlot) {
    const inputPerCraft = Math.max(1, recipe.input.amount ?? 1);
    const totalInput = inputPerCraft * crafts;
    machine.entity.changeItemAmount(inputSlot, -totalInput);

    const yieldBoost = machine.boosts.overclockYield ?? 1;
    const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    if (tank.getType() === 'empty') tank.setType(fluidType);

    const fluidAmount = recipe.fluid.amount * crafts * yieldBoost;
    tank.add(Math.floor(fluidAmount));

    if (recipe.byproduct) {
        const produced = rollByproduct(recipe.byproduct, crafts);
        if (produced > 0) {
            const byproductRaw = produced * yieldBoost;
            const byproductFinal = machine.addFractionalItem(recipe.byproduct.id, byproductRaw);
            if (byproductFinal > 0) {
                addItemsToSlot(machine, RESIDUE_SLOT, recipe.byproduct.id, byproductFinal);
            }
        }
    }
}

function updateHud(machine, recipe, tank, maxCrafts) {
    const fluidType = recipe.fluid.type ?? DEFAULT_FLUID_TYPE;
    const fluidPerCraft = recipe.fluid.amount;
    const tankAmount = FluidManager.formatFluid(tank.get());
    const tankCap = FluidManager.formatFluid(tank.getCap());

    const batchLine = (() => {
        const batchSize = recipe.input?.amount ?? '—';
        const seconds = recipe.seconds ?? '—';
        return `§7Batch: §f${batchSize} items §7/ §f${seconds}s`;
    })();

    const lore = [
        `§bInput: §f${formatItemName(recipe.input.id)}`,
        `§dFerment: §f${formatFluidDisplayName(fluidType)}`,
        `§7Yield: §f${FluidManager.formatFluid(fluidPerCraft)} each`,
        `§7Tank: §f${tankAmount} §7/ §f${tankCap}`,
        `§cCost: §f${Energy.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued Crafts: §f${maxCrafts}`,
        batchLine
    ];

    const overclockLine = buildOverclockLoreLine(machine);
    if (overclockLine) lore.push(overclockLine);

    machine.setLabel({
        title: '§6Fermenter',
        lore,
        rawText: undefined
    });
}