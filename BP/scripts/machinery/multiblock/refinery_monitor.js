import { ItemStack } from '@minecraft/server';
import {
    Energy,
    FluidManager,
    Multiblock,
    MultiblockMachine,
    tickGate,
} from '../../DoriosCore/index.js';
import {
    refreshFluidInputNetworks,
    pullFluidThroughInputValves,
    pushFluidThroughOutputValves,
    validateValves,
} from './valves.js';
import { getRefineryRecipes } from '../../config/recipes/machinery/refinery.js';

const ENERGY_DISPLAY_SLOT  = 0;
const LABEL_SLOT           = 1;
const PROGRESS_SLOT        = 2;
const FLUID_DISPLAY_IN     = 3;
const FLUID_DISPLAY_OUT1   = 4;
const FLUID_DISPLAY_OUT2   = 5;
const FLUID_DISPLAY_OUT3   = 6;

const FLUID_CAP            = 256_000;
const ENERGY_CAP           = 4_000_000;
const ENERGY_COST          = 12_000;

const MULTIBLOCK_CONFIG = {
    required_case: 'dorios:multiblock.case.refinery',
    entity: {
        type:           'simple_container',
        inventory_size: 7,
        identifier:     'utilitycraft:multiblock_machine',
    },
    machine: {
        rate_speed_base: ENERGY_COST,
        energy_cap:      ENERGY_CAP,
    },
    requirements: {},
};

DoriosAPI.register.blockComponent('refinery_monitor', {

    onPlayerInteract(e) {
        return MultiblockMachine.handlePlayerInteract(e, MULTIBLOCK_CONFIG, {

            initializeEntity(entity) {
                _initTanks(entity);
                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);
            },

            onActivate({ entity, player }) {
                const valveError = validateValves(entity, { fluidInput: 1, energyInput: 1 });
                if (valveError) { player.sendMessage(valveError); return false; }

                _initTanks(entity);
                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);
                refreshFluidInputNetworks(entity);
            },

            successMessages() {
                return [
                    '§a[Refinery] 3×3×3 structure validated and online!',
                    `§7Fluid Cap (each) : §b${FluidManager.formatFluid(FLUID_CAP)}`,
                    `§7Energy Buffer    : §e${Energy.formatEnergyToText(ENERGY_CAP)}`,
                    `§7Energy Cost      : §c${Energy.formatEnergyToText(ENERGY_COST)}§7/op`,
                    '§8Ports: 1× Fluid Input Valve · 1× Energy Input Valve',
                    '§7Attach Fluid Output Valves to drain each product.',
                ];
            },
        });
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const machine = new MultiblockMachine(block, MULTIBLOCK_CONFIG);
        if (!machine.valid) return;

        const entity = machine.entity;

        const tankIn   = new FluidManager(entity, 0);
        const tankOut1 = new FluidManager(entity, 1);
        const tankOut2 = new FluidManager(entity, 2);
        const tankOut3 = new FluidManager(entity, 3);
        const energy   = new Energy(entity);

        _restoreCaps(tankIn, tankOut1, tankOut2, tankOut3, energy);

        if (tickGate(entity, 'ref:pipe_in', 2)) {
            const validTypes = new Set(getRefineryRecipes().map(r => r.input.type));
            pullFluidThroughInputValves(entity, [tankIn], validTypes);
        }

        if (tickGate(entity, 'ref:pipe_out', 4)) {
            for (const tank of [tankOut1, tankOut2, tankOut3]) {
                if (tank.get() > 0) pushFluidThroughOutputValves(entity, tank);
            }
        }

        if (tickGate(entity, 'ref:net_refresh', 200)) {
            refreshFluidInputNetworks(entity);
        }

        tankIn.display(FLUID_DISPLAY_IN);
        tankOut1.display(FLUID_DISPLAY_OUT1);
        tankOut2.display(FLUID_DISPLAY_OUT2);
        tankOut3.display(FLUID_DISPLAY_OUT3);
        energy.display(ENERGY_DISPLAY_SLOT);
        machine.displayProgress();

        const fail = msg => { machine.showWarning(msg); machine.off(); };

        const recipes = getRefineryRecipes();
        if (!recipes.length) { fail('No Recipes'); return; }

        const inType = tankIn.getType();
        if (!inType || inType === 'empty') { fail('No Input Fluid'); return; }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) { fail('Wrong Fluid'); return; }

        const out1Type = tankOut1.getType();
        const out2Type = tankOut2.getType();
        const out3Type = tankOut3.getType();
        if (out1Type !== 'empty' && out1Type !== recipe.output1.type) { fail('Out 1 Blocked'); return; }
        if (out2Type !== 'empty' && out2Type !== recipe.output2.type) { fail('Out 2 Blocked'); return; }
        if (out3Type !== 'empty' && out3Type !== recipe.output3.type) { fail('Out 3 Blocked'); return; }
        if (tankOut1.getFreeSpace() <= 0) { fail('Diesel Tank Full'); return; }
        if (tankOut2.getFreeSpace() <= 0) { fail('Petrol Tank Full'); return; }
        if (tankOut3.getFreeSpace() <= 0) { fail('Naphtha Tank Full'); return; }
        if (tankIn.get() < recipe.input.amount) { fail('Not Enough Crude Oil'); return; }

        const energyCost = recipe.energyCost ?? ENERGY_COST;
        machine.setEnergyCost(energyCost);
        if (energy.get() <= 0) { fail('No Energy'); return; }

        const yieldBoost = machine.boosts?.overclockYield ?? 1;
        const crafts = Math.min(
            Math.floor(tankIn.get()           / recipe.input.amount),
            Math.floor(tankOut1.getFreeSpace() / Math.ceil(recipe.output1.amount * yieldBoost)),
            Math.floor(tankOut2.getFreeSpace() / Math.ceil(recipe.output2.amount * yieldBoost)),
            Math.floor(tankOut3.getFreeSpace() / Math.ceil(recipe.output3.amount * yieldBoost)),
        );
        if (crafts <= 0) { fail('Tanks Full'); return; }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType('empty');

                if (tankOut1.getType() === 'empty') tankOut1.setType(recipe.output1.type);
                tankOut1.add(Math.floor(recipe.output1.amount * runs * yieldBoost));

                if (tankOut2.getType() === 'empty') tankOut2.setType(recipe.output2.type);
                tankOut2.add(Math.floor(recipe.output2.amount * runs * yieldBoost));

                if (tankOut3.getType() === 'empty') tankOut3.setType(recipe.output3.type);
                tankOut3.add(Math.floor(recipe.output3.amount * runs * yieldBoost));

                machine.addProgress(-(runs * energyCost));
            }
        } else {
            const consumption = machine.boosts?.consumption ?? 1;
            const needed      = energyCost - progress;
            const spendable   = Math.min(energy.get(), machine.rate, needed * consumption);
            if (spendable > 0) {
                energy.consume(spendable);
                machine.addProgress(spendable / Math.max(consumption, Number.EPSILON));
            }
        }

        _updateHud(machine, recipe, tankIn, tankOut1, tankOut2, tankOut3, crafts);
        machine.on();
    },
});

function _initTanks(entity) {
    for (let i = 0; i < 4; i++) {
        new FluidManager(entity, i).setCap(FLUID_CAP);
    }
    new FluidManager(entity, 0).display(FLUID_DISPLAY_IN);
    new FluidManager(entity, 1).display(FLUID_DISPLAY_OUT1);
    new FluidManager(entity, 2).display(FLUID_DISPLAY_OUT2);
    new FluidManager(entity, 3).display(FLUID_DISPLAY_OUT3);
}

function _restoreCaps(tankIn, tankOut1, tankOut2, tankOut3, energy) {
    for (const t of [tankIn, tankOut1, tankOut2, tankOut3]) {
        if (t.getCap() <= 0) t.setCap(FLUID_CAP);
    }
    if (energy.getCap() <= 0) energy.setCap(ENERGY_CAP);
}

function _updateHud(machine, recipe, tankIn, tankOut1, tankOut2, tankOut3, queued) {
    const fmt = FluidManager.formatFluid.bind(FluidManager);
    const cap = FLUID_CAP;
    machine.setLabel({
        lines: [
            `§r§6⚗ Refinery  §7— §aProcessing`,
            `§r§bIn:  §f${recipe.input.type} §7${fmt(tankIn.get())} / ${fmt(cap)}`,
            `§r§aOut1:§f ${recipe.output1.type} §7${fmt(tankOut1.get())} / ${fmt(cap)}`,
            `§r§aOut2:§f ${recipe.output2.type} §7${fmt(tankOut2.get())} / ${fmt(cap)}`,
            `§r§aOut3:§f ${recipe.output3.type} §7${fmt(tankOut3.get())} / ${fmt(cap)}`,
            `§r§cCost: §f${Energy.formatEnergyToText(recipe.energyCost ?? ENERGY_COST)} §7Queued: ${queued}`,
        ],
    });
}