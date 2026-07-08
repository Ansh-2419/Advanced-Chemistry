import { world } from "@minecraft/server";
import {
    Machine,
    EnergyStorage,
    FluidStorage,
} from "../../DoriosCore/index.js";
import { getFuelMixerRecipes } from "../../config/recipes/machinery/fuel_mixer.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
// (unchanged from original — kept for reference)
const FLUID_INPUT_SLOT_1   = 10;
const FLUID_INPUT_SLOT_2   = 11;
const FLUID_DISPLAY_SLOT_1 = 12;
const FLUID_DISPLAY_SLOT_2 = 13;
const FLUID_OUTPUT_SLOT    = 14;
const FLUID_DISPLAY_OUTPUT = 15;

const FLUID_CAP_DEFAULT = 128_000;

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("fuel_mixer", {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnEntity(e, settings, (entity) => {
            const machine = new Machine(e.block, { ...settings, ignoreTick: true });
            if (!machine?.entity) return;

            const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
            machine.setEnergyCost(settings.machine.energy_cost ?? 4800);
            machine.displayProgress();
            machine.displayEnergy();

            // Tanks: 0 = input1, 1 = input2, 2 = output
            const tank1   = FluidStorage.initializeSingle(entity);
            const tank2   = new FluidStorage(entity, 1);
            const tankOut = new FluidStorage(entity, 2);
            tank1.setCap(fluidCap);
            tank2.setCap(fluidCap);
            tankOut.setCap(fluidCap);
            tank1.display(FLUID_DISPLAY_SLOT_1);
            tank2.display(FLUID_DISPLAY_SLOT_2);
            tankOut.display(FLUID_DISPLAY_OUTPUT);

            machine.blockSlots([
                FLUID_INPUT_SLOT_1,
                FLUID_INPUT_SLOT_2,
                FLUID_OUTPUT_SLOT,
                FLUID_DISPLAY_SLOT_1,
                FLUID_DISPLAY_SLOT_2,
                FLUID_DISPLAY_OUTPUT,
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
        const tank1   = new FluidStorage(entity, 0);
        const tank2   = new FluidStorage(entity, 1);
        const tankOut = new FluidStorage(entity, 2);
        if (tank1.getCap()   <= 0) tank1.setCap(fluidCap);
        if (tank2.getCap()   <= 0) tank2.setCap(fluidCap);
        if (tankOut.getCap() <= 0) tankOut.setCap(fluidCap);

        // ── Fluid IO ──────────────────────────────────────────────────────
        // Both input tanks accept inbound fluid; output pushes out
        // processIO routes "input" mode faces to whichever tank has a matching
        // type or is empty. For a two-input machine we handle pull manually so
        // we can fill the correct tank based on recipe type.
        _pullInputFluids(entity, block, tank1, tank2);
        tankOut.transferFluids(block, tankOut.get());

        // ── Display ───────────────────────────────────────────────────────
        machine.blockSlots([
            FLUID_INPUT_SLOT_1,
            FLUID_INPUT_SLOT_2,
            FLUID_OUTPUT_SLOT,
        ]);
        tank1.display(FLUID_DISPLAY_SLOT_1);
        tank2.display(FLUID_DISPLAY_SLOT_2);
        tankOut.display(FLUID_DISPLAY_OUTPUT);

        const fail = msg => {
            machine.showWarning(msg);
            machine.off();
            tank1.display(FLUID_DISPLAY_SLOT_1);
            tank2.display(FLUID_DISPLAY_SLOT_2);
            tankOut.display(FLUID_DISPLAY_OUTPUT);
        };

        const recipes = getFuelMixerRecipes();
        if (!recipes.length) { fail("No Recipes"); return; }

        const type1 = tank1.getType();
        const type2 = tank2.getType();

        if (type1 === "empty" && type2 === "empty") { fail("Fill Both Tanks"); return; }

        const recipe = matchRecipe(recipes, type1, type2);
        if (!recipe) { fail("Fill Both Tanks"); return; }

        const outType = tankOut.getType();
        if (outType !== "empty" && outType !== recipe.output.type) { fail("Output Full"); return; }

        const energyCost = recipe.energyCost ?? settings.machine.energy_cost ?? 4800;
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0) { fail("No Energy"); return; }

        const in1Amt = Math.max(1, recipe.input1.amount ?? 1);
        const in2Amt = Math.max(1, recipe.input2.amount ?? 1);
        const outAmt = Math.max(1, recipe.output.amount ?? 1);

        const [srcTank1, srcTank2] =
            type1 === recipe.input1.type
                ? [tank1, tank2]
                : [tank2, tank1];

        const crafts = Math.min(
            Math.floor(srcTank1.get()        / in1Amt),
            Math.floor(srcTank2.get()        / in2Amt),
            Math.floor(tankOut.getFreeSpace() / outAmt),
        );

        if (crafts <= 0) { fail("Tank Full"); return; }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                srcTank1.consume(in1Amt * runs);
                srcTank2.consume(in2Amt * runs);
                if (tankOut.getType() === "empty") tankOut.setType(recipe.output.type);
                tankOut.add(outAmt * runs);
                machine.addProgress(-(runs * energyCost));
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

        _updateHud(machine, recipe, tank1, tank2, tankOut, crafts);
        tank1.display(FLUID_DISPLAY_SLOT_1);
        tank2.display(FLUID_DISPLAY_SLOT_2);
        tankOut.display(FLUID_DISPLAY_OUTPUT);
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
 * Pulls fluid from adjacent source blocks into tank1 or tank2, choosing
 * the target tank by matching fluid type (or first empty slot).
 */
function _pullInputFluids(entity, block, tank1, tank2) {
    const { x, y, z } = block.location;
    const dim = block.dimension;
    const offsets = [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ];

    for (const o of offsets) {
        const srcBlock = dim.getBlock({ x: x + o.x, y: y + o.y, z: z + o.z });
        if (!srcBlock?.hasTag?.("dorios:fluid")) continue;

        const srcEnt = dim.getEntitiesAtBlockLocation(srcBlock.location)[0];
        if (!srcEnt || srcEnt === entity) continue;

        let srcFluid;
        try { srcFluid = new FluidStorage(srcEnt, 0); } catch { continue; }
        if (!srcFluid || srcFluid.get() <= 0) continue;

        const incoming = srcFluid.getType();
        if (!incoming || incoming === "empty") continue;

        // Choose the correct input tank: match existing type, or first empty
        const target =
            [tank1, tank2].find(t => t.getType() === incoming && t.getFreeSpace() > 0) ??
            [tank1, tank2].find(t => t.getType() === "empty"   && t.getFreeSpace() > 0);
        if (!target) continue;

        const amount = Math.min(srcFluid.get(), target.getFreeSpace(), 1000);
        if (amount <= 0) continue;

        srcFluid.add(-amount);
        if (srcFluid.get() <= 0) srcFluid.setType("empty");
        if (target.getType() === "empty") target.setType(incoming);
        target.add(amount);
    }
}

function matchRecipe(recipes, type1, type2) {
    return recipes.find(r =>
        (r.input1.type === type1 && r.input2.type === type2) ||
        (r.input1.type === type2 && r.input2.type === type1)
    ) ?? null;
}

function _fmt(type) {
    if (!type || type === "empty") return "Empty";
    return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function _updateHud(machine, recipe, tank1, tank2, tankOut, maxCrafts) {
    machine.setLabel([
        "§6Fuel Mixer",
        `§bInput 1: §f${_fmt(recipe.input1.type)} §7(${FluidStorage.formatFluid(tank1.get())})`,
        `§bInput 2: §f${_fmt(recipe.input2.type)} §7(${FluidStorage.formatFluid(tank2.get())})`,
        `§aOutput:  §f${_fmt(recipe.output.type)}`,
        `§7Tank:    §f${FluidStorage.formatFluid(tankOut.get())} §7/ §f${FluidStorage.formatFluid(tankOut.getCap())}`,
        `§cCost:    §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued:  §f${maxCrafts}`,
    ]);
}

// ── Pipe-cache invalidation ───────────────────────────────────────────────────
function _invalidateFluidNeighbourCaches(block) {
    const { x, y, z } = block.location;
    const dim = block.dimension;
    for (const o of [
        { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
    ]) {
        const nb  = dim.getBlock({ x: x + o.x, y: y + o.y, z: z + o.z });
        const ent = nb && dim.getEntitiesAtBlockLocation(nb.location)?.[0];
        if (!ent) continue;
        try { ent.setDynamicProperty("dorios:fluid_nodes", undefined); } catch {}
    }
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateFluidNeighbourCaches(block);
});
world.afterEvents.playerBreakBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateFluidNeighbourCaches(block);
});
