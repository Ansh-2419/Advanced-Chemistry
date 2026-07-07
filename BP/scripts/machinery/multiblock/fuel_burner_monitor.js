import { ItemStack } from '@minecraft/server';
import {
    Energy,
    FluidManager,
    Multiblock,
    MultiblockGenerator,
    tickGate,
} from '../../DoriosCore/index.js';
import { BLOCKED_SLOT_ITEM_ID } from '../../DoriosCore/machinery/constants.js';
import {
    refreshFluidInputNetworks,
    pullFluidThroughInputValves,
    validateValves,
} from './valves.js';

// ── Tuneable constants ────────────────────────────────────────────────────────

const BIOFUEL_TYPE            = 'biofuel';
const CAPACITY_PER_AIR_BLOCK  = 64_000;
const DE_PER_MB               = 8_000;
const BURN_RATE_MB_PER_TICK   = 20;
const ENERGY_CAP              = 2_000_000;
const MAX_PULL_PER_PORT       = 2_000;   // mB pulled per fluid valve per tick window

// ── Display slot indices ──────────────────────────────────────────────────────

const ENERGY_DISPLAY_SLOT     = 0;
const LABEL_SLOT              = 1;
const FLUID_DISPLAY_SLOT      = 2;
const CAPSULE_INPUT_SLOT      = 3;
const CAPSULE_OUTPUT_SLOT     = 4;

// ── Persisted dynamic property keys ──────────────────────────────────────────

const PROP_LIFETIME_BURN      = 'fb:lifetime_mb';
const PROP_FLUID_CAP          = 'fb:fluid_cap';

// ── Multiblock config ─────────────────────────────────────────────────────────

const MULTIBLOCK_CONFIG = {
    required_case:  'dorios:multiblock.case.fuel_burner',
    entity: {
        type:           'simple_machine',
        inventory_size: 5,
        identifier:     'utilitycraft:multiblock_machine',
    },
    generator: {
        rate_speed_base: 0,
        energy_cap:      ENERGY_CAP,
    },
    requirements: {},  // valves are casing-edge blocks; validated manually in onActivate
};

// ─────────────────────────────────────────────────────────────────────────────
// Block component
// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent('fuel_burner_monitor', {

    onPlayerInteract(e) {
        return MultiblockGenerator.handlePlayerInteract(e, MULTIBLOCK_CONFIG, {

            // Called once when the entity first spawns (before any scan).
            initializeEntity(entity) {
                const tank = FluidManager.initializeSingle(entity);
                tank.setCap(CAPACITY_PER_AIR_BLOCK);
                tank.display(FLUID_DISPLAY_SLOT);

                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);

                _blockSlots(entity);
            },

            // Called each time the wrench validates and activates the structure.
            onActivate({ entity, structure, player, block }) {
                // ── Validate required valves ─────────────────────────────────────
                const valveError = validateValves(entity, { fluidInput: 1 });
                if (valveError) { player.sendMessage(valveError); return false; }

                // ── Set fluid capacity based on interior air block count ──────
                const fluidCap = _calcFluidCap(structure);

                const tank = FluidManager.initializeSingle(entity);
                tank.setCap(fluidCap);
                tank.display(FLUID_DISPLAY_SLOT);

                const energy = new Energy(entity);
                energy.setCap(ENERGY_CAP);
                energy.display(ENERGY_DISPLAY_SLOT);

                entity.setDynamicProperty(PROP_FLUID_CAP, fluidCap);

                // ── Discover fluid pipe networks from each fluid input valve ──
                // Cache each valve's network node list on the entity so onTick
                // doesn't re-traverse the graph every tick.
                refreshFluidInputNetworks(entity);

                _blockSlots(entity);
            },

            successMessages({ structure }) {
                const fluidCap   = _calcFluidCap(structure);
                const ratePerSec = DE_PER_MB * BURN_RATE_MB_PER_TICK * 20;
                return [
                    '§a[Fuel Burner] Structure validated and online!',
                    `§7Fuel Capacity : §b${FluidManager.formatFluid(fluidCap)}`,
                    `§7Energy Buffer : §e${Energy.formatEnergyToText(ENERGY_CAP)}`,
                    `§7Max Output    : §f${Energy.formatEnergyToText(ratePerSec)}§7/s`,
                    '§7Fuel In       : connect a pipe to the Fluid Input Valve',
                    '§8Ports: 1× Fluid Input Valve · 1× Energy Port',
                ];
            },
        });
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const generator = new MultiblockGenerator(block, MULTIBLOCK_CONFIG);
        if (!generator.valid) return;

        const entity = generator.entity;
        const tank   = FluidManager.initializeSingle(entity);
        const energy = new Energy(entity);

        _restoreCaps(entity, tank, energy);

        // ── Pull biofuel through fluid input valves from the pipe network ─────
        if (tickGate(entity, 'fb:pipe_in', 2)) {
            pullFluidThroughInputValves(entity, [tank], new Set(['biofuel']));
        }

        // ── Burn biofuel → produce DE ─────────────────────────────────────────
        const status = _burn(entity, tank, energy);

        // ── Refresh pipe network cache occasionally ───────────────────────────
        // Re-scan every ~200 ticks in case pipes or sources changed.
        if (tickGate(entity, 'fb:net_refresh', 200)) {
            refreshFluidInputNetworks(entity);
        }

        // ── Display bars ──────────────────────────────────────────────────────
        tank.display(FLUID_DISPLAY_SLOT);
        energy.display(ENERGY_DISPLAY_SLOT);

        _updateHud(generator, tank, energy, status);
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────



function _calcFluidCap(structure) {
    const airBlocks = structure?.components?.air ?? 1;
    return Math.max(1, airBlocks) * CAPACITY_PER_AIR_BLOCK;
}

function _restoreCaps(entity, tank, energy) {
    if (tank.getCap() <= 0) {
        const saved = entity.getDynamicProperty(PROP_FLUID_CAP);
        tank.setCap(typeof saved === 'number' && saved > 0 ? saved : CAPACITY_PER_AIR_BLOCK);
    }
    if (energy.getCap() <= 0) {
        energy.setCap(ENERGY_CAP);
    }
}

function _blockSlots(entity) {
    const container = entity.getComponent('inventory')?.container;
    if (!container) return;
    for (const idx of [CAPSULE_INPUT_SLOT, CAPSULE_OUTPUT_SLOT]) {
        if (!container.getItem(idx)) {
            container.setItem(idx, new ItemStack(BLOCKED_SLOT_ITEM_ID, 1));
        }
    }
}

function _burn(entity, tank, energy) {
    const fuelType   = tank.getType();
    const fuelStored = tank.get();
    const energyFree = energy.getFreeSpace();

    if (fuelType !== 'empty' && fuelType !== BIOFUEL_TYPE) return '§cWrong Fluid';
    if (fuelStored <= 0)                                    return '§eNo Fuel';
    if (energyFree <= 0)                                    return '§6Buffer Full';

    const speed  = globalThis.tickSpeed ?? 1;
    let burnMb   = BURN_RATE_MB_PER_TICK * speed;

    const fillRatio = energy.get() / Math.max(1, energy.getCap());
    if (fillRatio >= THROTTLE_THRESHOLD) {
        burnMb = Math.max(1, Math.floor(burnMb / 2));
    }

    burnMb = Math.min(
        burnMb,
        fuelStored,
        Math.floor(energyFree / DE_PER_MB),
    );
    if (burnMb <= 0) return '§7Idle';

    tank.consume(burnMb);
    energy.add(burnMb * DE_PER_MB);
    if (tank.get() <= 0) tank.setType('empty');

    const prev = entity.getDynamicProperty(PROP_LIFETIME_BURN) ?? 0;
    entity.setDynamicProperty(PROP_LIFETIME_BURN, prev + burnMb);

    return fillRatio >= THROTTLE_THRESHOLD ? '§aBurning §7(throttled)' : '§aBurning';
}

function _updateHud(generator, tank, energy, status) {
    const fuelStored = tank.get();
    const fuelCap    = tank.getCap();
    const fuelPct    = fuelCap > 0 ? ((fuelStored / fuelCap) * 100).toFixed(1) : '0.0';

    const eFe        = energy.get();
    const eCap       = energy.getCap();
    const ePct       = eCap > 0 ? ((eFe / eCap) * 100).toFixed(1) : '0.0';

    const speed      = globalThis.tickSpeed ?? 1;
    const burnMbS    = BURN_RATE_MB_PER_TICK * speed * 20;
    const dePerSec   = burnMbS * DE_PER_MB;

    const lifetimeMb = generator.entity.getDynamicProperty(PROP_LIFETIME_BURN) ?? 0;

    generator.setLabel({
        lines: [
            `§r§6⚡ Fuel Burner  §7— ${status}`,
            `§r§bFuel   §f${FluidManager.formatFluid(fuelStored)} §7/ §f${FluidManager.formatFluid(fuelCap)} §8(${fuelPct}%)`,
            `§r§eEnergy §f${Energy.formatEnergyToText(eFe)} §7/ §f${Energy.formatEnergyToText(eCap)} §8(${ePct}%)`,
            `§r§aRate   §f${Energy.formatEnergyToText(dePerSec)}§7/s`,
            `§r§7Lifetime burned: §f${FluidManager.formatFluid(lifetimeMb)}`,
        ],
    });
}
