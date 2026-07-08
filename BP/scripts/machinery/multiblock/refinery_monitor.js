import { ItemStack } from "@minecraft/server";
import {
    EnergyStorage as Energy,
    FluidStorage as FluidManager,
    Multiblock,
    MultiblockMachine
} from "../../DoriosCore/index.js";
import { tickGate, formatFluidDisplayName } from "./multiblock_helpers.js";
import {
    refreshFluidInputNetworks,
    pullFluidThroughInputValves,
    pushFluidThroughOutputValves,
    validateValves,
} from "./valves.js";
import { getRefineryRecipes } from "../../config/recipes/machinery/refinery.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
const ENERGY_DISPLAY_SLOT = 0;
const LABEL_SLOT = 1;
const PROGRESS_SLOT = 2;
const FLUID_DISPLAY_IN = 3;
const FLUID_DISPLAY_OUT1 = 4;
const FLUID_DISPLAY_OUT2 = 5;
const FLUID_DISPLAY_OUT3 = 6;

// ── Constants ─────────────────────────────────────────────────────────────────
const FLUID_CAP = 256_000;
const ENERGY_CAP = 400_000;
const ENERGY_COST = 12_000;

const BASE_RATE = 100;

const MULTIBLOCK_CONFIG = {
    required_case: "dorios:multiblock.case.refinery",
    entity: {
        type: 'complex_machine',
        input_range: [4, 12],
        output_range: [13, 27],
        inventory_size: 28,
        identifier: 'utilitycraft:multiblock_machine',
    },
    machine: {
        rate_speed_base: BASE_RATE,
        energy_cap: ENERGY_CAP
    },
    requirements: {}
};

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("refinery_monitor", {
    onPlayerInteract(e) {
        return MultiblockMachine.handlePlayerInteract(e, MULTIBLOCK_CONFIG, {
            initializeEntity(entity) {
                _initTanks(entity);
                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);
                _writeProgressArrow(entity);
            },

            onActivate({ entity, player }) {
                const valveError = validateValves(entity, {
                    fluidInput: 1,
                });
                if (valveError) {
                    player.sendMessage(valveError);
                    return false;
                }

                _initTanks(entity);
                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);
                _writeProgressArrow(entity);
                refreshFluidInputNetworks(entity);
            },

            successMessages() {
                return [
                    "§a[Refinery] Structure validated and online!",
                    `§7Fluid Cap (each) : §b${FluidManager.formatFluid(FLUID_CAP)}`,
                    `§7Energy Buffer    : §e${Energy.formatEnergyToText(ENERGY_CAP)}`,
                    `§7Energy Cost      : §c${Energy.formatEnergyToText(ENERGY_COST)}§7/op`,
                    "§8Ports: 1× Fluid Input Valve · 1× Energy Port",
                    "§7Attach Fluid Output Valves to drain each product."
                ];
            }
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
        const tankIn = new FluidManager(entity, 0);
        const tankOut1 = new FluidManager(entity, 1);
        const tankOut2 = new FluidManager(entity, 2);
        const tankOut3 = new FluidManager(entity, 3);
        const energy = new Energy(entity);

        _restoreCaps(tankIn, tankOut1, tankOut2, tankOut3, energy);

        // ── Fluid in ──────────────────────────────────────────────────────────
        if (tickGate(entity, "ref:pipe_in", 2)) {
            const validTypes = new Set(
                getRefineryRecipes().map(r => r.input.type)
            );
            pullFluidThroughInputValves(entity, [tankIn], validTypes);
        }

        // ── Fluid out ─────────────────────────────────────────────────────────
        if (tickGate(entity, "ref:pipe_out", 4)) {
            pushFluidThroughOutputValves(entity, [
                tankOut1,
                tankOut2,
                tankOut3
            ]);
        }

        // ── Network refresh ───────────────────────────────────────────────────
        if (tickGate(entity, "ref:net_refresh", 200)) {
            refreshFluidInputNetworks(entity);
        }

        // ── Pull energy in through energy input valves ────────────────────────

        // ── Display ───────────────────────────────────────────────────────────
        tankIn.display(FLUID_DISPLAY_IN);
        tankOut1.display(FLUID_DISPLAY_OUT1);
        tankOut2.display(FLUID_DISPLAY_OUT2);
        tankOut3.display(FLUID_DISPLAY_OUT3);
        energy.display(ENERGY_DISPLAY_SLOT, { force: true });
        _writeProgressArrow(entity);

        // ── Recipe logic ──────────────────────────────────────────────────────
        const recipes = getRefineryRecipes();
        if (!recipes.length) {
            _setStatus(machine, "§cNo Recipes", energy);
            machine.off();
            return;
        }

        const inType = tankIn.getType();
        if (!inType || inType === "empty") {
            _setStatus(machine, "§eNo Input Fluid", energy);
            machine.off();
            return;
        }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) {
            _setStatus(
                machine,
                `§cWrong Fluid: ${formatFluidDisplayName(inType)}`
            );
            machine.off();
            return;
        }

        const out1T = tankOut1.getType();
        const out2T = tankOut2.getType();
        const out3T = tankOut3.getType();
        if (out1T !== "empty" && out1T !== recipe.output1.type) {
            _setStatus(machine, "§cOut 1 Blocked", energy);
            machine.off();
            return;
        }
        if (out2T !== "empty" && out2T !== recipe.output2.type) {
            _setStatus(machine, "§cOut 2 Blocked", energy);
            machine.off();
            return;
        }
        if (out3T !== "empty" && out3T !== recipe.output3.type) {
            _setStatus(machine, "§cOut 3 Blocked", energy);
            machine.off();
            return;
        }
        if (tankOut1.getFreeSpace() <= 0) {
            _setStatus(machine, "§6Out 1 Full", energy);
            machine.off();
            return;
        }
        if (tankOut2.getFreeSpace() <= 0) {
            _setStatus(machine, "§6Out 2 Full", energy);
            machine.off();
            return;
        }
        if (tankOut3.getFreeSpace() <= 0) {
            _setStatus(machine, "§6Out 3 Full", energy);
            machine.off();
            return;
        }
        if (tankIn.get() < recipe.input.amount) {
            _setStatus(machine, "§eNot Enough Input", energy);
            machine.off();
            return;
        }

        const energyCost = recipe.energyCost ?? ENERGY_COST;
        machine.setEnergyCost(energyCost);

        if (energy.get() <= 0) {
            _setStatus(machine, "§cNo Energy", energy);
            machine.off();
            return;
        }

        // ── Process ───────────────────────────────────────────────────────────
        const crafts = Math.min(
            Math.floor(tankIn.get() / recipe.input.amount),
            Math.floor(tankOut1.getFreeSpace() / recipe.output1.amount),
            Math.floor(tankOut2.getFreeSpace() / recipe.output2.amount),
            Math.floor(tankOut3.getFreeSpace() / recipe.output3.amount)
        );
        if (crafts <= 0) {
            _setStatus(machine, "§6Tanks Full", energy);
            machine.off();
            return;
        }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);
                if (tankIn.get() <= 0) tankIn.setType("empty");

                if (out1T === "empty") tankOut1.setType(recipe.output1.type);
                tankOut1.add(recipe.output1.amount * runs);

                if (out2T === "empty") tankOut2.setType(recipe.output2.type);
                tankOut2.add(recipe.output2.amount * runs);

                if (out3T === "empty") tankOut3.setType(recipe.output3.type);
                tankOut3.add(recipe.output3.amount * runs);

                machine.addProgress(-(runs * energyCost));
            }
        } else {
            const spendable = Math.min(
                energy.get(),
                machine.rate,
                energyCost - progress
            );
            if (spendable > 0) {
                energy.consume(spendable);
                machine.addProgress(spendable);
            }
        }

        _updateHud(
            machine,
            recipe,
            tankIn,
            tankOut1,
            tankOut2,
            tankOut3,
            crafts,
            energy
        );
        machine.on();
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _writeProgressArrow(entity) {
    try {
        const inv = entity.getComponent("inventory")?.container;
        if (!inv) return;
        if (!inv.getItem(PROGRESS_SLOT)) {
            inv.setItem(
                PROGRESS_SLOT,
                new ItemStack("utilitycraft:arrow_right_0", 1)
            );
        }
    } catch {}
}

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

function _setStatus(machine, msg, energy) {
    const eLine = energy
        ? `§r§eEnergy §f${Energy.formatEnergyToText(energy.get())} §7/ §f${Energy.formatEnergyToText(energy.getCap())}`
        : null;
    machine.setLabel(eLine ? [msg, eLine] : [msg], LABEL_SLOT);
}

function _updateHud(
    machine,
    recipe,
    tankIn,
    tankOut1,
    tankOut2,
    tankOut3,
    queued,
    energy
) {
    const fmt = FluidManager.formatFluid.bind(FluidManager);
    const cap = FLUID_CAP;
    machine.setLabel(
        [
            `§r§6⚗ Refinery  §7— §aProcessing`,
            `§r§eEnergy §f${Energy.formatEnergyToText(energy.get())} §7/ §f${Energy.formatEnergyToText(energy.getCap())}`,
            `§r§bIn:   §f${formatFluidDisplayName(recipe.input.type)}   §7${fmt(tankIn.get())} / ${fmt(cap)}`,
            `§r§aOut1: §f${formatFluidDisplayName(recipe.output1.type)} §7${fmt(tankOut1.get())} / ${fmt(cap)}`,
            `§r§aOut2: §f${formatFluidDisplayName(recipe.output2.type)} §7${fmt(tankOut2.get())} / ${fmt(cap)}`,
            `§r§aOut3: §f${formatFluidDisplayName(recipe.output3.type)} §7${fmt(tankOut3.get())} / ${fmt(cap)}`,
            `§r§cCost: §f${Energy.formatEnergyToText(recipe.energyCost ?? ENERGY_COST)}  §7Queued: §f${queued}`
        ],
        LABEL_SLOT
    );
}
