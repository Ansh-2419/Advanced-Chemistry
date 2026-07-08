import { world, ItemStack } from "@minecraft/server";
import {
    Machine,
    EnergyStorage,
    FluidStorage,
} from "../../DoriosCore/index.js";
import { getSeparatorRecipes } from "../../config/recipes/machinery/separator.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
const ENERGY_DISPLAY_SLOT = 0;
const LABEL_SLOT          = 1;
const PROGRESS_SLOT       = 2;
const FLUID_INPUT_CAPSULE = 3;  // blocked
const FLUID_DISPLAY_IN    = 4;  // hydrocarbon slurry bar
const FLUID_DISPLAY_OUT1  = 5;  // heavy hydrocarbon bar
const FLUID_DISPLAY_OUT2  = 6;  // reactive fluid bar
const UPGRADE_SLOT_1      = 7;
const UPGRADE_SLOT_2      = 8;
const UPGRADE_SLOT_3      = 9;

const FLUID_CAP = 128_000;

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("separator", {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnEntity(e, settings, (entity) => {
            const machine = new Machine(e.block, { ...settings, ignoreTick: true });
            if (!machine?.entity) return;

            const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP;
            machine.setEnergyCost(settings.machine.energy_cost ?? 6400);
            machine.displayProgress();
            machine.displayEnergy();

            // Index 0 = input, 1 = output1, 2 = output2
            const tankIn   = FluidStorage.initializeSingle(entity);
            const tankOut1 = new FluidStorage(entity, 1);
            const tankOut2 = new FluidStorage(entity, 2);
            [tankIn, tankOut1, tankOut2].forEach(t => t.setCap(fluidCap));
            tankIn.display(FLUID_DISPLAY_IN);
            tankOut1.display(FLUID_DISPLAY_OUT1);
            tankOut2.display(FLUID_DISPLAY_OUT2);

            machine.blockSlots([FLUID_INPUT_CAPSULE]);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP;
        const entity   = machine.entity;

        const tankIn   = new FluidStorage(entity, 0);
        const tankOut1 = new FluidStorage(entity, 1);
        const tankOut2 = new FluidStorage(entity, 2);

        // Restore caps after world reload
        if (tankIn.getCap()   <= 0) tankIn.setCap(fluidCap);
        if (tankOut1.getCap() <= 0) tankOut1.setCap(fluidCap);
        if (tankOut2.getCap() <= 0) tankOut2.setCap(fluidCap);

        // ── Fluid IO ──────────────────────────────────────────────────────
        machine.processIO({
            liquids: {
                input:  tankIn,
                output: tankOut1,
            },
        });
        // Push second output via direct adjacency
        tankOut2.transferFluids(block, tankOut2.get());

        // ── Display ───────────────────────────────────────────────────────
        tankIn.display(FLUID_DISPLAY_IN);
        tankOut1.display(FLUID_DISPLAY_OUT1);
        tankOut2.display(FLUID_DISPLAY_OUT2);
        machine.displayEnergy();
        machine.displayProgress();
        machine.blockSlots([FLUID_INPUT_CAPSULE]);

        // ── Recipe match ──────────────────────────────────────────────────
        const fail = msg => { machine.showWarning(msg); machine.off(); };

        const recipes = getSeparatorRecipes();
        if (!recipes.length) { fail("No Recipes"); return; }

        const inType = tankIn.getType();
        if (!inType || inType === "empty") { fail("No Input Fluid"); return; }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) { fail("Wrong Fluid"); return; }

        const out1Type = tankOut1.getType();
        const out2Type = tankOut2.getType();
        if (out1Type !== "empty" && out1Type !== recipe.output1.type) { fail("Out 1 Blocked"); return; }
        if (out2Type !== "empty" && out2Type !== recipe.output2.type) { fail("Out 2 Blocked"); return; }
        if (tankOut1.getFreeSpace() <= 0) { fail("Heavy HC Full"); return; }
        if (tankOut2.getFreeSpace() <= 0) { fail("Reactive Full"); return; }
        if (tankIn.get() < recipe.input.amount) { fail("Not Enough Input"); return; }

        const energyCost = recipe.energyCost ?? settings.machine.energy_cost ?? 6400;
        machine.setEnergyCost(energyCost);
        if (machine.energy.get() <= 0) { fail("No Energy"); return; }

        // ── Process ───────────────────────────────────────────────────────
        const crafts = Math.min(
            Math.floor(tankIn.get()            / recipe.input.amount),
            Math.floor(tankOut1.getFreeSpace() / Math.ceil(recipe.output1.amount)),
            Math.floor(tankOut2.getFreeSpace() / Math.ceil(recipe.output2.amount)),
        );
        if (crafts <= 0) { fail("Tanks Full"); return; }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType("empty");

                if (tankOut1.getType() === "empty") tankOut1.setType(recipe.output1.type);
                tankOut1.add(Math.floor(recipe.output1.amount * runs));

                if (tankOut2.getType() === "empty") tankOut2.setType(recipe.output2.type);
                tankOut2.add(Math.floor(recipe.output2.amount * runs));

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

        _updateHud(machine, recipe, tankIn, tankOut1, tankOut2, crafts);
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _fmt(type) {
    if (!type || type === "empty") return "Empty";
    return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function _updateHud(machine, recipe, tankIn, tankOut1, tankOut2, queued) {
    machine.setLabel([
        "§6Separator",
        `§bIn:   §f${_fmt(recipe.input.type)} §7${FluidStorage.formatFluid(tankIn.get())} / ${FluidStorage.formatFluid(tankIn.getCap())}`,
        `§aOut1: §f${_fmt(recipe.output1.type)} §7${FluidStorage.formatFluid(tankOut1.get())} / ${FluidStorage.formatFluid(tankOut1.getCap())}`,
        `§aOut2: §f${_fmt(recipe.output2.type)} §7${FluidStorage.formatFluid(tankOut2.get())} / ${FluidStorage.formatFluid(tankOut2.getCap())}`,
        `§cCost: §f${EnergyStorage.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    ]);
}
