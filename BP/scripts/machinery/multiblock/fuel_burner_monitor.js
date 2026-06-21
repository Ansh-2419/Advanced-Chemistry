import { ItemStack } from '@minecraft/server';
import {
    Energy,
    FluidManager,
    Multiblock,
    MultiblockGenerator,
    tickGate,
    collectFluidNetworkNodes,
    canFluidNodeProvide,
    isFluidNodeEnabled,
    updatePipes,
} from '../../DoriosCore/index.js';
import { BLOCKED_SLOT_ITEM_ID } from '../../DoriosCore/machinery/constants.js';
import {
    pushEnergyThroughOutputValves,
    getPortBlocks,
    VALVE_IDS,
} from './valves.js';

// ── Tuneable constants ────────────────────────────────────────────────────────

const BIOFUEL_TYPE            = 'biofuel';
const CAPACITY_PER_AIR_BLOCK  = 64_000;
const DE_PER_MB               = 8_000;
const BURN_RATE_MB_PER_TICK   = 20;
const ENERGY_CAP              = 2_000_000;
const PUSH_RATE_MAX           = ENERGY_CAP;
const PUSH_INTERVAL           = 4;
const THROTTLE_THRESHOLD      = 0.90;
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
const PROP_FLUID_NODES_PFX    = 'fb:fnodes_';  // fb:fnodes_0, fb:fnodes_1, … per valve

// ── Multiblock config ─────────────────────────────────────────────────────────

const MULTIBLOCK_CONFIG = {
    required_case:  'dorios:multiblock.case.fuel_burner',
    entity: {
        type:           'simple_container',
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
                // ── Validate valves (they're casing-edge blocks, not 'components') ──
                const dim = block.dimension;
                let fluidInputCount   = 0;
                let energyOutputCount = 0;

                for (const tag of (structure.inputBlocks ?? [])) {
                    const coordStr = tag.slice('input:['.length, -1);
                    const [x, y, z] = coordStr.split(',').map(Number);
                    const b = dim.getBlock({ x, y, z });
                    if (!b) continue;
                    if (b.typeId === VALVE_IDS.FLUID_INPUT)    fluidInputCount++;
                    if (b.typeId === VALVE_IDS.ENERGY_OUTPUT)  energyOutputCount++;
                }

                if (fluidInputCount < 1) {
                    player.sendMessage('§c[Fuel Burner] At least 1 Fluid Input Valve required.');
                    return false;
                }
                if (energyOutputCount < 1) {
                    player.sendMessage('§c[Fuel Burner] At least 1 Energy Output Valve required.');
                    return false;
                }

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
                _refreshFluidNetworks(entity, block);

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
                    '§8Ports: 1× Fluid Input Valve · 1× Energy Output Valve',
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
            _pullBiofuelFromNetwork(entity, tank);
        }

        // ── Burn biofuel → produce DE ─────────────────────────────────────────
        const status = _burn(entity, tank, energy);

        // ── Push DE through energy output valves ──────────────────────────────
        if (tickGate(entity, 'fb:energy_out', PUSH_INTERVAL) && energy.get() > 0) {
            pushEnergyThroughOutputValves(entity, energy, PUSH_RATE_MAX, Energy);
        }

        // ── Refresh pipe network cache occasionally ───────────────────────────
        // Re-scan every ~200 ticks in case pipes or sources changed.
        if (tickGate(entity, 'fb:net_refresh', 200)) {
            _refreshFluidNetworks(entity, block);
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

/**
 * Walk the fluid pipe network from every fluid input valve and pull
 * biofuel from any source machine we find into the tank.
 *
 * Network topology:
 *   [Fermenter] ──pipe──> [Fluid Input Valve] ──casing──> [Controller]
 *
 * `collectFluidNetworkNodes` traverses outward from the valve block
 * through pipes and returns the position of each source machine.
 * We then find the entity at that position and drain it.
 */
function _pullBiofuelFromNetwork(entity, tank) {
    if (tank.getFreeSpace() <= 0) return;

    const dim   = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID_INPUT);

    for (let i = 0; i < ports.length; i++) {
        const valveBlock = ports[i];

        // Read cached node list for this valve (stored as JSON on the entity).
        let nodes = [];
        try {
            const raw = entity.getDynamicProperty(PROP_FLUID_NODES_PFX + i);
            if (raw) nodes = JSON.parse(raw);
        } catch { /* ignore */ }

        if (!Array.isArray(nodes) || nodes.length === 0) continue;

        for (const node of nodes) {
            if (!canFluidNodeProvide(node))  continue;
            if (!isFluidNodeEnabled(node))   continue;
            if (tank.getFreeSpace() <= 0)    break;

            const srcBlock = dim.getBlock({ x: node.x, y: node.y, z: node.z });
            if (!srcBlock?.hasTag?.('dorios:fluid')) continue;

            // Find the fluid-holding entity at this source position.
            const srcEnt = dim.getEntitiesAtBlockLocation(srcBlock.location)[0];
            if (!srcEnt || srcEnt === entity) continue;

            // Scan all tank indices — the fuel mixer stores biofuel at
            // index 2 (output tank), not index 0.
            let srcFluid = null;
            for (let idx = 0; idx < 4; idx++) {
                try {
                    const candidate = new FluidManager(srcEnt, idx);
                    if (candidate.getCap() <= 0) break;
                    if (candidate.get() > 0 && candidate.getType() === BIOFUEL_TYPE) {
                        srcFluid = candidate;
                        break;
                    }
                } catch { break; }
            }
            if (!srcFluid) continue;

            const amount = Math.min(
                srcFluid.get(),
                tank.getFreeSpace(),
                MAX_PULL_PER_PORT,
            );
            if (amount <= 0) continue;

            srcFluid.add(-amount);
            if (srcFluid.get() <= 0) srcFluid.setType('empty');
            if (tank.getType() === 'empty') tank.setType(BIOFUEL_TYPE);
            tank.add(amount);
        }
    }
}

/**
 * Traverse the pipe network from each fluid input valve and cache
 * the discovered source-node positions on the controller entity.
 * Called once on activation and periodically during onTick.
 */
function _refreshFluidNetworks(entity, block) {
    const ports = getPortBlocks(entity, VALVE_IDS.FLUID_INPUT);

    for (let i = 0; i < ports.length; i++) {
        const valveBlock = ports[i];
        try {
            // Walk pipes outward from the valve block to find source machines.
            const nodes = collectFluidNetworkNodes(valveBlock);
            entity.setDynamicProperty(
                PROP_FLUID_NODES_PFX + i,
                JSON.stringify(nodes),
            );
        } catch {
            // Ignore traversal errors (e.g. chunk not loaded).
        }
    }
}

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
