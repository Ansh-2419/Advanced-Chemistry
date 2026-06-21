import { world } from '@minecraft/server';
import {
    Machine, Energy, FluidManager, MultiFluidBar,
    buildOverclockLoreLine, updatePipes,
    tickGate, formatFluidDisplayName,
} from '../../DoriosCore/index.js';
import { getFuelMixerRecipes } from '../../config/recipes/machinery/fuel_mixer.js';

const FLUID_INPUT_SLOT_1   = 10;
const FLUID_INPUT_SLOT_2   = 11;
const FLUID_DISPLAY_SLOT_1 = 12;
const FLUID_DISPLAY_SLOT_2 = 13;
const FLUID_OUTPUT_SLOT    = 14;
const FLUID_DISPLAY_OUTPUT = 15;

const makeDescs = cap => [
    { cap, displaySlot: FLUID_DISPLAY_SLOT_1 },
    { cap, displaySlot: FLUID_DISPLAY_SLOT_2 },
    { cap, displaySlot: FLUID_DISPLAY_OUTPUT },
];

DoriosAPI.register.blockComponent('fuel_mixer', {

    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnMachineEntity(e, settings, () => {
            const machine = new Machine(e.block, settings, true);
            if (!machine?.entity) return;
            const fluidCap = settings.machine.fluid_cap ?? 128_000;
            machine.setEnergyCost(settings.machine.energy_cost ?? 4800);
            machine.displayProgress();
            machine.displayEnergy();
            const bar = MultiFluidBar.create(machine.entity, makeDescs(fluidCap));
            machine.blockSlots(bar.displaySlots);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = settings.machine.fluid_cap ?? 128_000;
        const bar = MultiFluidBar.from(machine.entity, makeDescs(fluidCap));
        bar.restoreCaps();

        const tank1   = bar.get(0);
        const tank2   = bar.get(1);
        const tankOut = bar.get(2);

        if (tickGate(machine.entity, 'fm:fluids_cd', 4)) {
            const available = tankOut.get();
            if (available > 0) {
                let nodes = [];
                try {
                    const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                    if (cached) nodes = JSON.parse(cached);
                } catch { }

                if (!Array.isArray(nodes) || nodes.length === 0) {
                    updatePipes(block, 'fluid');
                    try {
                        const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                        if (cached) nodes = JSON.parse(cached);
                    } catch { }
                }

                tankOut.transferFluids(block, available, { useFacing: true });

                if (Array.isArray(nodes) && nodes.length) {
                    tankOut.transferToNetwork(available, 'nearest', nodes);
                }
            }
        }

        if (tickGate(machine.entity, 'fm:pipe_in_cd', 2)) {
            if (tickGate(machine.entity, 'fm:nodes_refresh_cd', 100)) {
                updatePipes(block, 'fluid');
            }

            let nodes = [];
            try {
                const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                if (cached) nodes = JSON.parse(cached);
            } catch { }

            if (!Array.isArray(nodes) || nodes.length === 0) {
                updatePipes(block, 'fluid');
                try {
                    const cached = machine.entity.getDynamicProperty('dorios:fluid_nodes');
                    if (cached) nodes = JSON.parse(cached);
                } catch { }
            }

            const dim = block.dimension;
            for (const node of nodes) {
                if (!Number.isFinite(node?.x)) continue;
                if ((node.role ?? 'direct') === 'direct') continue;

                const srcBlock = dim.getBlock({ x: node.x, y: node.y, z: node.z });
                if (!srcBlock?.hasTag('dorios:fluid')) continue;

                const srcEnt = dim.getEntitiesAtBlockLocation(srcBlock.location)[0];
                if (!srcEnt || srcEnt === machine.entity) continue;

                let srcFluid;
                try { srcFluid = new FluidManager(srcEnt, 0); } catch { continue; }
                if (!srcFluid || srcFluid.get() <= 0) continue;

                const incoming = srcFluid.getType();
                if (!incoming || incoming === 'empty') continue;

                const target =
                    [tank1, tank2].find(t => t.getType() === incoming && t.getFreeSpace() > 0) ??
                    [tank1, tank2].find(t => t.getType() === 'empty'  && t.getFreeSpace() > 0);
                if (!target) continue;

                const amount = Math.min(srcFluid.get(), target.getFreeSpace(), 1000);
                if (amount <= 0) continue;

                srcFluid.add(-amount);
                if (srcFluid.get() <= 0) srcFluid.setType('empty');
                if (target.getType() === 'empty') target.setType(incoming);
                target.add(amount);
            }
        }

        machine.blockSlots([FLUID_INPUT_SLOT_1, FLUID_INPUT_SLOT_2, FLUID_OUTPUT_SLOT]);

        const fail = (message, reset = true) => {
            machine.showWarning(message, reset);
            bar.display();
        };

        const recipes = getFuelMixerRecipes();
        if (!recipes.length) { fail('No Recipes'); return; }

        const type1 = tank1.getType();
        const type2 = tank2.getType();

        if (type1 === 'empty' && type2 === 'empty') { fail('Fill Both Tanks'); return; }

        const recipe = matchRecipe(recipes, type1, type2);
        if (!recipe) { fail('Fill Both Tanks'); return; }

        const outType = tankOut.getType();
        if (outType !== 'empty' && outType !== recipe.output.type) { fail('Output Full'); return; }

        const energyCost = recipe.energyCost ?? settings.machine.energy_cost ?? 4800;
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0) { fail('No Energy', false); return; }

        const in1Amt    = Math.max(1, recipe.input1.amount ?? 1);
        const in2Amt    = Math.max(1, recipe.input2.amount ?? 1);
        const outAmt    = Math.max(1, recipe.output.amount ?? 1);
        const yieldBoost = machine.boosts?.overclockYield ?? 1;

        const [srcTank1, srcTank2, srcAmt1, srcAmt2] =
            type1 === recipe.input1.type
                ? [tank1, tank2, in1Amt, in2Amt]
                : [tank2, tank1, in1Amt, in2Amt];

        const crafts = Math.min(
            Math.floor(srcTank1.get()         / srcAmt1),
            Math.floor(srcTank2.get()         / srcAmt2),
            Math.floor(tankOut.getFreeSpace() / (outAmt * yieldBoost)),
        );

        if (crafts <= 0) { fail('Tank Full'); return; }

        const progress = machine.getProgress();

        if (progress >= energyCost) {
            const craftRuns = Math.min(crafts, Math.floor(progress / energyCost));
            if (craftRuns > 0) {
                srcTank1.consume(srcAmt1 * craftRuns);
                srcTank2.consume(srcAmt2 * craftRuns);
                if (tankOut.getType() === 'empty') tankOut.setType(recipe.output.type);
                tankOut.add(Math.floor(outAmt * craftRuns * yieldBoost));
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

        updateHud(machine, recipe, tank1, tank2, tankOut, crafts);
        bar.display();
        machine.displayEnergy();
        machine.displayProgress();
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    },
});

function matchRecipe(recipes, type1, type2) {
    return recipes.find(r =>
        (r.input1.type === type1 && r.input2.type === type2) ||
        (r.input1.type === type2 && r.input2.type === type1)
    ) ?? null;
}

function updateHud(machine, recipe, tank1, tank2, tankOut, maxCrafts) {
    const lore = [
        `§bInput 1: §f${formatFluidDisplayName(recipe.input1.type)} §7(${FluidManager.formatFluid(tank1.get())})`,
        `§bInput 2: §f${formatFluidDisplayName(recipe.input2.type)} §7(${FluidManager.formatFluid(tank2.get())})`,
        `§aOutput:  §f${formatFluidDisplayName(recipe.output.type)}`,
        `§7Tank:    §f${FluidManager.formatFluid(tankOut.get())} §7/ §f${FluidManager.formatFluid(tankOut.getCap())}`,
        `§cCost:    §f${Energy.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued:  §f${maxCrafts}`,
    ];
    const overclockLine = buildOverclockLoreLine(machine);
    if (overclockLine) lore.push(overclockLine);
    machine.setLabel({ title: '§6Fuel Mixer', lore });
}

function _invalidateFluidNeighbourCaches(block, dim) {
    const { x, y, z } = block.location ?? block;
    const offsets = [
        { x:1,y:0,z:0 }, { x:-1,y:0,z:0 },
        { x:0,y:1,z:0 }, { x:0,y:-1,z:0 },
        { x:0,y:0,z:1 }, { x:0,y:0,z:-1 },
    ];
    for (const o of offsets) {
        const nb = dim.getBlock({ x: x+o.x, y: y+o.y, z: z+o.z });
        if (!nb?.hasTag?.('dorios:fluid')) continue;
        const ent = dim.getEntitiesAtBlockLocation(nb.location)?.[0];
        if (!ent) continue;
        try { ent.setDynamicProperty('dorios:fluid_nodes', undefined); } catch { }
    }
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.hasTag('dorios:fluid')) _invalidateFluidNeighbourCaches(block, block.dimension);
});

world.afterEvents.playerBreakBlock.subscribe(({ block }) => {
    if (block.hasTag('dorios:fluid')) _invalidateFluidNeighbourCaches(block, block.dimension);
});
