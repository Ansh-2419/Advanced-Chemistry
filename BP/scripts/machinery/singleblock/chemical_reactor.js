import { world, ItemStack } from '@minecraft/server';
import {
    Machine, Energy, FluidManager,
    buildOverclockLoreLine, updatePipes,
    tickGate, formatFluidDisplayName,
    feedFluidSlot, fillFluidSlot,
} from '../../DoriosCore/index.js';
import { getChemicalReactorRecipes } from '../../config/recipes/machinery/chemical_reactor.js';

// ── Slot indices ──────────────────────────────────────────────────────────────
const ENERGY_DISPLAY_SLOT  = 0;
const LABEL_SLOT           = 1;
const PROGRESS_SLOT        = 2;
const FLUID_INPUT_CAPSULE  = 3;   // blocked — pipes only
const FLUID_DISPLAY_IN     = 4;
const FLUID_DISPLAY_OUT    = 5;
const BYPRODUCT_SLOT       = 6;   // item output — player collects
const UPGRADE_SLOT_1       = 7;
const UPGRADE_SLOT_2       = 8;
const UPGRADE_SLOT_3       = 9;

const FLUID_CAP_DEFAULT    = 128_000;

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent('chemical_reactor', {

    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnMachineEntity(e, settings, () => {
            const machine = new Machine(e.block, settings, true);
            if (!machine?.entity) return;

            const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
            machine.setEnergyCost(settings.machine.energy_cost ?? 7200);
            machine.displayProgress();
            machine.displayEnergy();

            // Two independent tanks: index 0 = input, index 1 = output
            const tankIn  = FluidManager.initializeSingle(machine.entity);
            const tankOut = new FluidManager(machine.entity, 1);
            tankIn.setCap(fluidCap);
            tankOut.setCap(fluidCap);
            tankIn.display(FLUID_DISPLAY_IN);
            tankOut.display(FLUID_DISPLAY_OUT);

            machine.blockSlots([FLUID_INPUT_CAPSULE, FLUID_DISPLAY_IN, FLUID_DISPLAY_OUT]);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine   = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
        const entity   = machine.entity;

        // Ensure caps survive world reload
        const tankIn  = new FluidManager(entity, 0);
        const tankOut = new FluidManager(entity, 1);
        if (tankIn.getCap()  <= 0) tankIn.setCap(fluidCap);
        if (tankOut.getCap() <= 0) tankOut.setCap(fluidCap);

        // ── Pull input fluid from pipe network ────────────────────────────
        if (tickGate(entity, 'cr:pipe_in', 2)) {
            if (tickGate(entity, 'cr:net_refresh', 100)) updatePipes(block, 'fluid');

            let nodes = [];
            try {
                const raw = entity.getDynamicProperty('dorios:fluid_nodes');
                if (raw) nodes = JSON.parse(raw);
            } catch { }

            if (!nodes.length) {
                updatePipes(block, 'fluid');
                try {
                    const raw = entity.getDynamicProperty('dorios:fluid_nodes');
                    if (raw) nodes = JSON.parse(raw);
                } catch { }
            }

            const dim = block.dimension;
            for (const node of nodes) {
                if (!Number.isFinite(node?.x)) continue;
                if ((node.role ?? 'direct') === 'direct') continue;
                if (tankIn.getFreeSpace() <= 0) break;

                const srcBlock = dim.getBlock({ x: node.x, y: node.y, z: node.z });
                if (!srcBlock?.hasTag?.('dorios:fluid')) continue;

                const srcEnt = dim.getEntitiesAtBlockLocation(srcBlock.location)[0];
                if (!srcEnt || srcEnt === entity) continue;

                // Check all indices on source for a matching fluid
                for (let idx = 0; idx < 4; idx++) {
                    let src;
                    try { src = new FluidManager(srcEnt, idx); } catch { break; }
                    if (src.getCap() <= 0) break;
                    if (src.get() <= 0)    continue;

                    const incoming = src.getType();
                    if (!incoming || incoming === 'empty') continue;
                    if (tankIn.getType() !== 'empty' && tankIn.getType() !== incoming) continue;

                    const amount = Math.min(src.get(), tankIn.getFreeSpace(), 1000);
                    if (amount <= 0) continue;

                    src.add(-amount);
                    if (src.get() <= 0) src.setType('empty');
                    if (tankIn.getType() === 'empty') tankIn.setType(incoming);
                    tankIn.add(amount);
                    break;
                }
            }
        }

        // ── Push output fluid to pipe network ─────────────────────────────
        if (tickGate(entity, 'cr:pipe_out', 4)) {
            const avail = tankOut.get();
            if (avail > 0) {
                let nodes = [];
                try {
                    const raw = entity.getDynamicProperty('dorios:fluid_nodes');
                    if (raw) nodes = JSON.parse(raw);
                } catch { }
                if (!nodes.length) updatePipes(block, 'fluid');

                tankOut.transferFluids(block, avail, { useFacing: true });
                if (nodes.length) tankOut.transferToNetwork(avail, 'nearest', nodes);
            }
        }

        // ── Display ───────────────────────────────────────────────────────
        machine.blockSlots([FLUID_INPUT_CAPSULE, FLUID_DISPLAY_IN, FLUID_DISPLAY_OUT]);
        tankIn.display(FLUID_DISPLAY_IN);
        tankOut.display(FLUID_DISPLAY_OUT);
        machine.displayEnergy();
        machine.displayProgress();

        // ── Recipe matching ───────────────────────────────────────────────
        const fail = msg => { machine.showWarning(msg); machine.off(); };

        const recipes = getChemicalReactorRecipes();
        if (!recipes.length) { fail('No Recipes'); return; }

        const inType = tankIn.getType();
        if (!inType || inType === 'empty') { fail('No Input Fluid'); return; }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) { fail('Wrong Fluid'); return; }

        const outType = tankOut.getType();
        if (outType !== 'empty' && outType !== recipe.output.type) { fail('Output Full'); return; }
        if (tankOut.getFreeSpace() <= 0) { fail('Output Full'); return; }
        if (tankIn.get() < recipe.input.amount) { fail('Not Enough Input'); return; }

        const energyCost = recipe.energyCost ?? settings.machine.energy_cost ?? 7200;
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0) { fail('No Energy'); return; }

        // ── Byproduct ─────────────────────────────────────────────────────
        if (recipe.byproduct) {
            const bp    = recipe.byproduct;
            const roll  = Math.random();
            if (roll < (bp.chance ?? 1.0)) {
                _addByproduct(entity, BYPRODUCT_SLOT, bp.item, bp.count ?? 1);
            }
        }

        // ── Process ───────────────────────────────────────────────────────
        const yieldBoost = machine.boosts?.overclockYield ?? 1;
        const crafts = Math.min(
            Math.floor(tankIn.get()         / recipe.input.amount),
            Math.floor(tankOut.getFreeSpace() / Math.ceil(recipe.output.amount * yieldBoost)),
        );
        if (crafts <= 0) { fail('Tank Full'); return; }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);
                if (tankOut.getType() === 'empty') tankOut.setType(recipe.output.type);
                tankOut.add(Math.floor(recipe.output.amount * runs * yieldBoost));
                machine.addProgress(-(runs * energyCost));
            }
        } else {
            const consumption = machine.boosts?.consumption ?? 1;
            const needed      = energyCost - progress;
            const spendable   = Math.min(machine.energy.get(), machine.rate, needed * consumption);
            if (spendable > 0) {
                machine.energy.consume(spendable);
                machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
            }
        }

        _updateHud(machine, recipe, tankIn, tankOut, crafts);
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
        const container = entity.getComponent('inventory')?.container;
        if (!container) return;
        const existing = container.getItem(slot);
        if (existing && existing.typeId === itemId && existing.amount < existing.maxAmount) {
            existing.amount = Math.min(existing.maxAmount, existing.amount + count);
            container.setItem(slot, existing);
        } else if (!existing) {
            container.setItem(slot, new ItemStack(itemId, count));
        }
    } catch { }
}

function _updateHud(machine, recipe, tankIn, tankOut, queued) {
    const lore = [
        `§bInput:  §f${formatFluidDisplayName(recipe.input.type)} §7${FluidManager.formatFluid(tankIn.get())} / ${FluidManager.formatFluid(tankIn.getCap())}`,
        `§aOutput: §f${formatFluidDisplayName(recipe.output.type)} §7${FluidManager.formatFluid(tankOut.get())} / ${FluidManager.formatFluid(tankOut.getCap())}`,
        `§cCost:   §f${Energy.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`,
    ];
    if (recipe.byproduct) {
        lore.push(`§dByproduct: §f${recipe.byproduct.item} §7(${Math.round((recipe.byproduct.chance ?? 1) * 100)}%)`);
    }
    const overclockLine = buildOverclockLoreLine(machine);
    if (overclockLine) lore.push(overclockLine);
    machine.setLabel({ title: '§6Chemical Reactor', lore });
}

// Invalidate pipe caches when fluid blocks change nearby
function _invalidateNeighbourCaches(block) {
    const { x, y, z } = block.location;
    const dim = block.dimension;
    for (const o of [{x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1}]) {
        const nb  = dim.getBlock({ x: x+o.x, y: y+o.y, z: z+o.z });
        const ent = nb && dim.getEntitiesAtBlockLocation(nb.location)?.[0];
        if (ent) try { ent.setDynamicProperty('dorios:fluid_nodes', undefined); } catch { }
    }
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.hasTag('dorios:fluid')) _invalidateNeighbourCaches(block);
});
world.afterEvents.playerBreakBlock.subscribe(({ block }) => {
    if (block.hasTag('dorios:fluid')) _invalidateNeighbourCaches(block);
});
