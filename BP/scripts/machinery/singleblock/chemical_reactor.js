import { world, ItemStack } from "@minecraft/server";
import {
    Machine,
    EnergyStorage,
    FluidStorage,
} from "../../DoriosCore/index.js";
import { getChemicalReactorRecipes } from "../../config/recipes/machinery/chemical_reactor.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
const ENERGY_DISPLAY_SLOT     = 0;
const LABEL_SLOT              = 1;
const PROGRESS_SLOT           = 2;
const FLUID_INPUT_CAPSULE     = 3;  // blocked — IO system only
const FLUID_DISPLAY_IN        = 4;
const FLUID_DISPLAY_OUT       = 5;
const FLUID_DISPLAY_BYPRODUCT = 6;  // fluid byproduct tank display
const BYPRODUCT_SLOT          = 7;  // item byproduct — player collects
const UPGRADE_SLOT_1          = 8;
const UPGRADE_SLOT_2          = 9;
const UPGRADE_SLOT_3          = 10;

const FLUID_CAP_DEFAULT = 128_000;

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("chemical_reactor", {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnEntity(e, settings, (entity) => {
            // ignoreTick: true so the placement-time Machine doesn't bail on scheduler
            const machine = new Machine(e.block, { ...settings, ignoreTick: true });
            if (!machine?.entity) return;

            const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
            machine.setEnergyCost(settings.machine.energy_cost ?? 7200);
            machine.displayProgress();
            machine.displayEnergy();

            // Three independent tanks: 0 = input, 1 = output, 2 = fluid byproduct
            const tankIn        = FluidStorage.initializeSingle(entity);
            const tankOut       = new FluidStorage(entity, 1);
            const tankByproduct = new FluidStorage(entity, 2);
            tankIn.setCap(fluidCap);
            tankOut.setCap(fluidCap);
            tankByproduct.setCap(fluidCap);
            tankIn.display(FLUID_DISPLAY_IN);
            tankOut.display(FLUID_DISPLAY_OUT);
            tankByproduct.display(FLUID_DISPLAY_BYPRODUCT);

            machine.blockSlots([
                FLUID_INPUT_CAPSULE,
                FLUID_DISPLAY_IN,
                FLUID_DISPLAY_OUT,
                FLUID_DISPLAY_BYPRODUCT,
            ]);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
        const entity   = machine.entity;

        // Ensure caps survive world reload
        const tankIn        = new FluidStorage(entity, 0);
        const tankOut       = new FluidStorage(entity, 1);
        const tankByproduct = new FluidStorage(entity, 2);
        if (tankIn.getCap()        <= 0) tankIn.setCap(fluidCap);
        if (tankOut.getCap()       <= 0) tankOut.setCap(fluidCap);
        if (tankByproduct.getCap() <= 0) tankByproduct.setCap(fluidCap);

        // ── Fluid IO (IO Interface system) ────────────────────────────────
        // input face → tankIn; output faces → tankOut and tankByproduct
        machine.processIO({
            liquids: {
                input:  tankIn,
                output: tankOut,
            },
        });
        // Push byproduct fluid via facing direction (output only)
        tankByproduct.transferFluids(block, tankByproduct.get());

        // ── Display ───────────────────────────────────────────────────────
        machine.blockSlots([
            FLUID_INPUT_CAPSULE,
            FLUID_DISPLAY_IN,
            FLUID_DISPLAY_OUT,
            FLUID_DISPLAY_BYPRODUCT,
        ]);
        tankIn.display(FLUID_DISPLAY_IN);
        tankOut.display(FLUID_DISPLAY_OUT);
        tankByproduct.display(FLUID_DISPLAY_BYPRODUCT);
        machine.displayEnergy();
        machine.displayProgress();

        // ── Recipe matching ───────────────────────────────────────────────
        const fail = msg => {
            machine.showWarning(msg);
            machine.off();
        };

        const recipes = getChemicalReactorRecipes();
        if (!recipes.length) { fail("No Recipes"); return; }

        const inType = tankIn.getType();
        if (!inType || inType === "empty") { fail("No Input Fluid"); return; }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) { fail("Wrong Fluid"); return; }

        const hasFluidOutput = recipe.output.amount > 0;

        const byproducts      = [].concat(recipe.byproduct ?? []).filter(Boolean);
        const itemByproducts  = byproducts.filter(bp => bp.item);
        const fluidByproducts = byproducts.filter(bp => bp.fluid?.type && bp.fluid?.amount > 0);
        const hasFluidByproduct = fluidByproducts.length > 0;

        if (hasFluidOutput) {
            const outType = tankOut.getType();
            if (outType !== "empty" && outType !== recipe.output.type) { fail("Output Full"); return; }
            if (tankOut.getFreeSpace() <= 0) { fail("Output Full"); return; }
        }

        if (hasFluidByproduct) {
            for (const bp of fluidByproducts) {
                const bpType = tankByproduct.getType();
                if (bpType !== "empty" && bpType !== bp.fluid.type) { fail("Byproduct Tank Full"); return; }
                if (tankByproduct.getFreeSpace() < bp.fluid.amount)  { fail("Byproduct Tank Full"); return; }
            }
        }

        if (tankIn.get() < recipe.input.amount) { fail("Not Enough Input"); return; }

        const energyCost = recipe.energyCost ?? settings.machine.energy_cost ?? 7200;
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0) { fail("No Energy"); return; }

        // ── Process ───────────────────────────────────────────────────────
        const inputLimited = Math.floor(tankIn.get() / recipe.input.amount);

        const outputLimited = hasFluidOutput
            ? Math.floor(tankOut.getFreeSpace() / Math.ceil(recipe.output.amount))
            : Infinity;

        const byproductLimited = hasFluidByproduct
            ? Math.min(...fluidByproducts.map(bp =>
                Math.floor(tankByproduct.getFreeSpace() / Math.ceil(bp.fluid.amount))
            ))
            : Infinity;

        const crafts = Math.min(inputLimited, outputLimited, byproductLimited);
        if (crafts <= 0) {
            fail(hasFluidOutput ? "Tank Full" : hasFluidByproduct ? "Byproduct Tank Full" : "Not Enough Input");
            return;
        }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);

                if (hasFluidOutput) {
                    if (tankOut.getType() === "empty") tankOut.setType(recipe.output.type);
                    tankOut.add(Math.floor(recipe.output.amount * runs));
                }

                for (let i = 0; i < runs; i++) {
                    for (const bp of itemByproducts) {
                        if (Math.random() < (bp.chance ?? 1.0)) {
                            _addByproduct(entity, BYPRODUCT_SLOT, bp.item, bp.count ?? 1);
                        }
                    }
                    for (const bp of fluidByproducts) {
                        if (Math.random() < (bp.chance ?? 1.0)) {
                            if (tankByproduct.getType() === "empty") tankByproduct.setType(bp.fluid.type);
                            tankByproduct.add(Math.floor(bp.fluid.amount));
                        }
                    }
                }

                machine.addProgress(-(runs * energyCost));
            }
        } else {
            const consumption = machine.boosts?.consumption ?? 1;
            const needed   = energyCost - progress;
            const spendable = Math.min(machine.energy.get(), machine.rate, needed * consumption);
            if (spendable > 0) {
                machine.energy.consume(spendable);
                machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
            }
        }

        _updateHud(machine, recipe, tankIn, tankOut, tankByproduct, crafts);
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _addByproduct(entity, slot, itemId, count) {
    try {
        const container = entity.getComponent("inventory")?.container;
        if (!container) return;
        const existing = container.getItem(slot);
        if (existing && existing.typeId === itemId && existing.amount < existing.maxAmount) {
            existing.amount = Math.min(existing.maxAmount, existing.amount + count);
            container.setItem(slot, existing);
        } else if (!existing) {
            container.setItem(slot, new ItemStack(itemId, count));
        }
    } catch {}
}

function _fmt(type) {
    if (!type || type === "empty") return "Empty";
    return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function _updateHud(machine, recipe, tankIn, tankOut, tankByproduct, queued) {
    const hasFluidOutput = recipe.output.amount > 0;
    const byproducts     = [].concat(recipe.byproduct ?? []).filter(Boolean);
    const itemBP         = byproducts.filter(bp => bp.item);
    const fluidBP        = byproducts.filter(bp => bp.fluid?.type && bp.fluid?.amount > 0);

    const lore = [
        `§bInput:  §f${_fmt(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
    ];
    if (hasFluidOutput) {
        lore.push(`§aOutput: §f${_fmt(recipe.output.type)} §7${FluidStorage.formatFluid(tankOut.get())} / ${FluidStorage.formatFluid(tankOut.getCap())}`);
    }
    lore.push(
        `§cCost:   §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    );
    for (const bp of itemBP) {
        lore.push(`§dByproduct: §f${bp.item} §7(${Math.round((bp.chance ?? 1) * 100)}%)`);
    }
    for (const bp of fluidBP) {
        lore.push(`§dByproduct: §f${_fmt(bp.fluid.type)} §7${FluidStorage.formatFluid(tankByproduct.get())} / ${FluidStorage.formatFluid(tankByproduct.getCap())} §7(${Math.round((bp.chance ?? 1) * 100)}%)`);
    }

    machine.setLabel(["§6Chemical Reactor", ...lore]);
}

// ── Pipe-cache invalidation ───────────────────────────────────────────────────
function _invalidateNeighbourCaches(block) {
    const { x, y, z } = block.location;
    const dim = block.dimension;
    for (const o of [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ]) {
        const nb  = dim.getBlock({ x: x + o.x, y: y + o.y, z: z + o.z });
        const ent = nb && dim.getEntitiesAtBlockLocation(nb.location)?.[0];
        if (ent) try { ent.setDynamicProperty("dorios:fluid_nodes", undefined); } catch {}
    }
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateNeighbourCaches(block);
});
world.afterEvents.playerBreakBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateNeighbourCaches(block);
});
