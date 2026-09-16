import {
    EnergyStorage,
    FluidStorage,
    Multiblock,
    MultiblockGenerator,
    registerLinkNodeIO,
}                   from "DoriosCore/index.js";
import * as DoriosLib from "DoriosLib/index.js";

// ── Coolant registry ──────────────────────────────────────────────────────────
const COOLANTS = {
    water:          { speedMultiplier: 1.0, consumption: 150, label: "Water"          },
    saline_coolant: { speedMultiplier: 1.5, consumption: 100, label: "Saline Coolant" },
    liquid_nitrogen:{ speedMultiplier: 2.0, consumption:  60, label: "Liquid Nitrogen" },
};

// ── Reaction constants ────────────────────────────────────────────────────────
const THORIUM_PER_CYCLE   = 50;
const ENERGY_PER_CYCLE    = 50_000;
const WASTE_PER_CYCLE     = 10;
const BASE_CYCLE_TICKS    = 400;
const NO_COOLANT_DIVISOR  = 0.5;   // speed penalty with no / unknown coolant
const FLUID_CAPACITY      = 64_000;
const ENERGY_CAPACITY     = 5_000_000;
const THROTTLE_AT         = 0.95;

const EMPTY               = "empty";

// ── Slot map ──────────────────────────────────────────────────────────────────
const ENERGY_SLOT   = 0;
const LABEL_SLOT    = 1;
const PROGRESS_SLOT = 2;
const COOLANT_SLOT  = 3;
const THORIUM_SLOT  = 4;
const WASTE_SLOT    = 5;

// ── Port requirements ─────────────────────────────────────────────────────────
const PORT_REQ = {
    fluid:  { min: 2, id: "utilitycraft:ind_fluid_port",  label: "Industrial Fluid Port"  },
    energy: { min: 1, id: "utilitycraft:ind_energy_port", label: "Industrial Energy Port" },
};

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
    required_case: "dorios:multiblock.case.ind",
    entity: {
        identifier:     "utilitycraft:nuclear_reactor_multiblock",
        name:           "nuclear_reactor_multiblock",
        inventory_size: 6,
    },
    generator: {
        rate_speed_base: ENERGY_PER_CYCLE / BASE_CYCLE_TICKS,
        energy_cap:      ENERGY_CAPACITY,
        fluid_cap:       FLUID_CAPACITY,
        fluid_types:     3,
    },
    requirements: {},
};

// ── Link node IO ──────────────────────────────────────────────────────────────
registerLinkNodeIO("utilitycraft:nuclear_reactor_controller", {
    liquids: {
        anyInputIndices:  [0, 1],
        anyOutputIndices: [2],
        inputs: [
            { id: "thorium",  label: "Liquified Thorium Tank", color: "§e", indices: [0]    },
            { id: "coolant",  label: "Coolant Tank",           color: "§b", indices: [1]    },
            { id: "any_in",   label: "Any Input Tank",         color: "§9", indices: [0, 1] },
        ],
        outputs: [
            { id: "waste", label: "Nuclear Waste Output", color: "§2", indices: [2] },
        ],
    },
});

// ── Block component ───────────────────────────────────────────────────────────
DoriosLib.registry.blockComponent("utilitycraft:nuclear_reactor_controller", {

    onPlayerInteract(event) {
        if (!event.player) return;
        return MultiblockGenerator.handlePlayerInteract(
            /** @type {any} */ (event),
            CONFIG,
            {
                initializeEntity(entity) {
                    initStorage(entity);
                },

                onActivate({ entity, structure, player }) {
                    const { min, max } = structure.bounds;
                    const [sX, sY, sZ] = [max.x - min.x + 1, max.y - min.y + 1, max.z - min.z + 1];

                    if (sX !== 3 || sY !== 3 || sZ !== 3) {
                        player.sendMessage(`§c[Nuclear Reactor] Must be 3×3×3. Detected: ${sX}×${sY}×${sZ}.`);
                        return false;
                    }

                    const dim   = entity.dimension;
                    const found = { fluid: 0, energy: 0 };
                    for (const tag of structure.inputBlocks) {
                        const loc   = DoriosLib.linkNode.parseLinkNodeTag(tag);
                        const block = loc && dim.getBlock(loc);
                        if (!block) continue;
                        if (block.typeId === PORT_REQ.fluid.id)  found.fluid++;
                        if (block.typeId === PORT_REQ.energy.id) found.energy++;
                    }

                    for (const [key, req] of Object.entries(PORT_REQ)) {
                        if (found[key] < req.min) {
                            player.sendMessage(`§c[Nuclear Reactor] Needs ${req.min}× §e${req.label}§c — found ${found[key]}.`);
                            return false;
                        }
                    }

                    initStorage(entity);
                },

                successMessages: [
                    "§a[Nuclear Reactor] Structure online — 3×3×3 confirmed.",
                    "§7Thorium capacity: §b64 B",
                    "§7Coolants: §fWater  §bSaline Coolant  §3Liquid Nitrogen",
                    "§7Energy output: §e50 kDE §7per reaction cycle",
                    "§7Byproduct: §2Nuclear Waste §710 mB/cycle",
                ],
            }
        );
    },

    onPlayerBreak({ block, player }) {
        Multiblock.DeactivationManager.handleBreakController(block, player);
    },

    onTick({ block }) {
        if (!globalThis.worldLoaded) return;

        const reactor = new MultiblockGenerator(block, CONFIG);
        if (!reactor.valid) return;
        if (reactor.entity.getDynamicProperty("dorios:state") !== "on") return;

        const { energy, thoriumTank, coolantTank, wasteTank } = initStorage(reactor.entity);

        // ── Transfer buffered energy to network ───────────────────────────────
        energy.transferToNetwork(reactor.rate);

        // ── Run reaction ──────────────────────────────────────────────────────
        const { status, coolantCfg } = react(reactor, thoriumTank, coolantTank, wasteTank, energy);

        // ── Display ───────────────────────────────────────────────────────────
        energy.display(ENERGY_SLOT);
        thoriumTank.display(THORIUM_SLOT);
        coolantTank.display(COOLANT_SLOT);
        wasteTank.display(WASTE_SLOT);
        updateLabel(reactor, energy, thoriumTank, coolantTank, wasteTank, status, coolantCfg);
    },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function initStorage(entity) {
    const [thoriumTank, coolantTank, wasteTank] = FluidStorage.initializeMultiple(entity, 3);
    if (thoriumTank.getCap() !== FLUID_CAPACITY) thoriumTank.setCap(FLUID_CAPACITY);
    if (coolantTank.getCap() !== FLUID_CAPACITY) coolantTank.setCap(FLUID_CAPACITY);
    if (wasteTank.getCap()   !== FLUID_CAPACITY) wasteTank.setCap(FLUID_CAPACITY);
    const energy = new EnergyStorage(entity);
    if (energy.getCap() !== ENERGY_CAPACITY) energy.setCap(ENERGY_CAPACITY);
    return { energy, thoriumTank, coolantTank, wasteTank };
}

function react(reactor, thoriumTank, coolantTank, wasteTank, energy) {
    // ── Thorium check ──────────────────────────────────────────────────────
    if (thoriumTank.getType() !== "liquified_thorium" || thoriumTank.get() < THORIUM_PER_CYCLE) {
        return {
            status: thoriumTank.get() <= 0 ? "§cNo Thorium" : "§cInsufficient Thorium",
            coolantCfg: null,
        };
    }

    // ── Coolant check ─────────────────────────────────────────────────────
    const coolantType = coolantTank.getType();
    const coolantCfg  = COOLANTS[coolantType] ?? null;

    // Detect unknown coolant (tank has fluid but it isn't a registered coolant)
    const hasUnknownCoolant = coolantType !== EMPTY && coolantCfg === null;

    // ── Throttle when energy buffer is nearly full ─────────────────────────
    const fillRatio = energy.get() / Math.max(1, energy.getCap());
    if (fillRatio >= THROTTLE_AT) {
        return { status: "§6Buffer Full", coolantCfg };
    }

    // ── Waste output check ────────────────────────────────────────────────
    if (wasteTank.getFreeSpace() < WASTE_PER_CYCLE) {
        return { status: "§cWaste Tank Full", coolantCfg };
    }

    // ── Unknown coolant warning — reactor still runs but at penalty speed ─
    if (hasUnknownCoolant) {
        // Fall through with penalty speed, status reported in updateLabel
    }

    // ── Compute cycle ticks ───────────────────────────────────────────────
    const speedDivisor = coolantCfg?.speedMultiplier ?? NO_COOLANT_DIVISOR;
    const cycleTicks   = Math.max(1, Math.floor(BASE_CYCLE_TICKS / speedDivisor));
    const tick         = ((reactor.entity.getDynamicProperty("ac:nr_tick") ?? 0) + 1);
    reactor.entity.setDynamicProperty("ac:nr_tick", tick % cycleTicks);

    if (tick % cycleTicks !== 0) {
        const status = hasUnknownCoolant
            ? `§e⚠ Unknown Coolant — running at ×${NO_COOLANT_DIVISOR} speed`
            : "§aReacting";
        return { status, coolantCfg };
    }

    // ── One cycle completes ───────────────────────────────────────────────
    thoriumTank.consume(THORIUM_PER_CYCLE);
    if (thoriumTank.get() <= 0) thoriumTank.setType(EMPTY);

    if (coolantCfg && coolantTank.get() >= coolantCfg.consumption) {
        coolantTank.consume(coolantCfg.consumption);
        if (coolantTank.get() <= 0) coolantTank.setType(EMPTY);
    }

    energy.add(ENERGY_PER_CYCLE);

    if (wasteTank.getType() === EMPTY) wasteTank.setType("nuclear_waste");
    wasteTank.add(WASTE_PER_CYCLE);

    const status = hasUnknownCoolant
        ? `§e⚠ Unknown Coolant — running at ×${NO_COOLANT_DIVISOR} speed`
        : "§aReacting";
    return { status, coolantCfg };
}

function updateLabel(reactor, energy, thoriumTank, coolantTank, wasteTank, status, coolantCfg) {
    const FL = FluidStorage.formatFluid;
    const E  = EnergyStorage.formatEnergyToText;

    const coolantType = coolantTank.getType();
    let speedLabel;
    if (coolantCfg) {
        speedLabel = `§f${coolantCfg.label} §7(×${coolantCfg.speedMultiplier.toFixed(1)})`;
    } else if (coolantType === EMPTY) {
        speedLabel = `§7None §7(×${NO_COOLANT_DIVISOR} speed — add a coolant)`;
    } else {
        speedLabel = `§e${coolantType} §c(Unknown — ×${NO_COOLANT_DIVISOR} speed)`;
    }

    reactor.setLabel([
        `§6Nuclear Reactor §7| ${status}`,
        `§r§eThorium: §f${FL(thoriumTank.get())} §7/ §f${FL(thoriumTank.getCap())}`,
        `§r§bCoolant: ${speedLabel}  §f${FL(coolantTank.get())}`,
        `§r§2Waste:   §f${FL(wasteTank.get())} §7/ §f${FL(wasteTank.getCap())}`,
        `§r§eEnergy:  §f${E(energy.get())} §7/ §f${E(energy.getCap())}`,
    ], LABEL_SLOT);
}
