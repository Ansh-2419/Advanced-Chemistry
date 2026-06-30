import { world, ItemStack } from "@minecraft/server";
import {
    Machine,
    Energy,
    FluidManager,
    buildOverclockLoreLine,
    updatePipes,
    tickGate,
    formatFluidDisplayName
} from "../../DoriosCore/index.js";
import { getChemicalReactorRecipes } from "../../config/recipes/machinery/chemical_reactor.js";

// ── Slot indices ──────────────────────────────────────────────────────────────
const ENERGY_DISPLAY_SLOT = 0;
const LABEL_SLOT = 1;
const PROGRESS_SLOT = 2;
const FLUID_INPUT_CAPSULE = 3; // blocked — pipes only
const FLUID_DISPLAY_IN = 4;
const FLUID_DISPLAY_OUT = 5;
const FLUID_DISPLAY_BYPRODUCT = 6; // fluid byproduct tank display
const BYPRODUCT_SLOT = 7; // item byproduct — player collects
const UPGRADE_SLOT_1 = 8;
const UPGRADE_SLOT_2 = 9;
const UPGRADE_SLOT_3 = 10;

const FLUID_CAP_DEFAULT = 128_000;

// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("chemical_reactor", {
    beforeOnPlayerPlace(e, { params: settings }) {
        Machine.spawnMachineEntity(e, settings, () => {
            const machine = new Machine(e.block, settings, true);
            if (!machine?.entity) return;

            const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
            machine.setEnergyCost(settings.machine.energy_cost ?? 7200);
            machine.displayProgress();
            machine.displayEnergy();

            // Three independent tanks: 0 = input, 1 = output, 2 = fluid byproduct
            const tankIn = FluidManager.initializeSingle(machine.entity);
            const tankOut = new FluidManager(machine.entity, 1);
            const tankByproduct = new FluidManager(machine.entity, 2);
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
                FLUID_DISPLAY_BYPRODUCT
            ]);
        });
    },

    onTick(e, { params: settings }) {
        if (!globalThis.worldLoaded) return;

        const { block } = e;
        const machine = new Machine(block, settings);
        if (!machine.valid) return;

        const fluidCap = settings.machine.fluid_cap ?? FLUID_CAP_DEFAULT;
        const entity = machine.entity;

        // Ensure caps survive world reload
        const tankIn = new FluidManager(entity, 0);
        const tankOut = new FluidManager(entity, 1);
        const tankByproduct = new FluidManager(entity, 2);
        if (tankIn.getCap() <= 0) tankIn.setCap(fluidCap);
        if (tankOut.getCap() <= 0) tankOut.setCap(fluidCap);
        if (tankByproduct.getCap() <= 0) tankByproduct.setCap(fluidCap);

        // ── Pull input fluid from pipe network ────────────────────────────
        if (tickGate(entity, "cr:pipe_in", 2)) {
            if (tickGate(entity, "cr:net_refresh", 100))
                updatePipes(block, "fluid");

            let nodes = [];
            try {
                const raw = entity.getDynamicProperty("dorios:fluid_nodes");
                if (raw) nodes = JSON.parse(raw);
            } catch {}

            if (!nodes.length) {
                updatePipes(block, "fluid");
                try {
                    const raw = entity.getDynamicProperty("dorios:fluid_nodes");
                    if (raw) nodes = JSON.parse(raw);
                } catch {}
            }

            const dim = block.dimension;
            for (const node of nodes) {
                if (!Number.isFinite(node?.x)) continue;
                if ((node.role ?? "direct") === "direct") continue;
                if (tankIn.getFreeSpace() <= 0) break;

                const srcBlock = dim.getBlock({
                    x: node.x,
                    y: node.y,
                    z: node.z
                });
                if (!srcBlock?.hasTag?.("dorios:fluid")) continue;

                const srcEnt = dim.getEntitiesAtBlockLocation(
                    srcBlock.location
                )[0];
                if (!srcEnt || srcEnt === entity) continue;

                // Only pull fluid types that match a registered recipe input.
                const validTypes = new Set(
                    getChemicalReactorRecipes().map(r => r.input.type)
                );
                for (let idx = 0; idx < 4; idx++) {
                    let src;
                    try {
                        src = new FluidManager(srcEnt, idx);
                    } catch {
                        break;
                    }
                    if (src.getCap() <= 0) break;
                    if (src.get() <= 0) continue;

                    const incoming = src.getType();
                    if (!incoming || incoming === "empty") continue;
                    if (!validTypes.has(incoming)) continue;
                    if (
                        tankIn.getType() !== "empty" &&
                        tankIn.getType() !== incoming
                    )
                        continue;

                    const amount = Math.min(
                        src.get(),
                        tankIn.getFreeSpace(),
                        1000
                    );
                    if (amount <= 0) continue;

                    src.add(-amount);
                    if (src.get() <= 0) src.setType("empty");
                    if (tankIn.getType() === "empty") tankIn.setType(incoming);
                    tankIn.add(amount);
                    break;
                }
            }
        }

        // ── Push output fluid to pipe network ─────────────────────────────
        if (tickGate(entity, "cr:pipe_out", 4)) {
            const avail = tankOut.get();
            if (avail > 0) {
                let nodes = [];
                try {
                    const raw = entity.getDynamicProperty("dorios:fluid_nodes");
                    if (raw) nodes = JSON.parse(raw);
                } catch {}
                if (!nodes.length) updatePipes(block, "fluid");

                tankOut.transferFluids(block, avail, { useFacing: true });
                if (nodes.length)
                    tankOut.transferToNetwork(avail, "nearest", nodes);
            }

            const availByproduct = tankByproduct.get();
            if (availByproduct > 0) {
                let nodes = [];
                try {
                    const raw = entity.getDynamicProperty("dorios:fluid_nodes");
                    if (raw) nodes = JSON.parse(raw);
                } catch {}
                if (!nodes.length) updatePipes(block, "fluid");

                tankByproduct.transferFluids(block, availByproduct, {
                    useFacing: true
                });
                if (nodes.length)
                    tankByproduct.transferToNetwork(
                        availByproduct,
                        "nearest",
                        nodes
                    );
            }
        }

        // ── Display ───────────────────────────────────────────────────────
        machine.blockSlots([
            FLUID_INPUT_CAPSULE,
            FLUID_DISPLAY_IN,
            FLUID_DISPLAY_OUT,
            FLUID_DISPLAY_BYPRODUCT
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
        if (!recipes.length) {
            fail("No Recipes");
            return;
        }

        const inType = tankIn.getType();
        if (!inType || inType === "empty") {
            fail("No Input Fluid");
            return;
        }

        const recipe = recipes.find(r => r.input.type === inType) ?? null;
        if (!recipe) {
            fail("Wrong Fluid");
            return;
        }

        const hasFluidOutput = recipe.output.amount > 0;

        // Normalize byproduct config — supports:
        //   - item only:  { item, count?, chance? }
        //   - fluid only: { fluid: { type, amount }, chance? }
        //   - both:       { item, count?, fluid: { type, amount }, chance? }
        //   - array of any mix of the above
        const byproducts = [].concat(recipe.byproduct ?? []).filter(Boolean);
        const itemByproducts = byproducts.filter(bp => bp.item);
        const fluidByproducts = byproducts.filter(
            bp => bp.fluid?.type && bp.fluid?.amount > 0
        );
        const hasFluidByproduct = fluidByproducts.length > 0;

        if (hasFluidOutput) {
            const outType = tankOut.getType();

            if (outType !== "empty" && outType !== recipe.output.type) {
                fail("Output Full");
                return;
            }

            if (tankOut.getFreeSpace() <= 0) {
                fail("Output Full");
                return;
            }
        }

        if (hasFluidByproduct) {
            for (const bp of fluidByproducts) {
                const bpType = tankByproduct.getType();
                if (bpType !== "empty" && bpType !== bp.fluid.type) {
                    fail("Byproduct Tank Full");
                    return;
                }
                if (tankByproduct.getFreeSpace() < bp.fluid.amount) {
                    fail("Byproduct Tank Full");
                    return;
                }
            }
        }

        if (tankIn.get() < recipe.input.amount) {
            fail("Not Enough Input");
            return;
        }

        const energyCost =
            recipe.energyCost ?? settings.machine.energy_cost ?? 7200;
        machine.setEnergyCost(energyCost);

        if (machine.energy.get() <= 0) {
            fail("No Energy");
            return;
        }

        // ── Process ───────────────────────────────────────────────────────
        const yieldBoost = machine.boosts?.overclockYield ?? 1;

        const inputLimited = Math.floor(tankIn.get() / recipe.input.amount);

        const outputLimited = hasFluidOutput
            ? Math.floor(
                  tankOut.getFreeSpace() /
                      Math.ceil(recipe.output.amount * yieldBoost)
              )
            : Infinity;

        const byproductLimited = hasFluidByproduct
            ? Math.min(
                  ...fluidByproducts.map(bp =>
                      Math.floor(
                          tankByproduct.getFreeSpace() /
                              Math.ceil(bp.fluid.amount * yieldBoost)
                      )
                  )
              )
            : Infinity;

        const crafts = Math.min(inputLimited, outputLimited, byproductLimited);
        if (crafts <= 0) {
            fail(
                hasFluidOutput
                    ? "Tank Full"
                    : hasFluidByproduct
                      ? "Byproduct Tank Full"
                      : "Not Enough Input"
            );
            return;
        }

        const progress = machine.getProgress();
        if (progress >= energyCost) {
            const runs = Math.min(crafts, Math.floor(progress / energyCost));
            if (runs > 0) {
                tankIn.consume(recipe.input.amount * runs);

                if (hasFluidOutput) {
                    if (tankOut.getType() === "empty")
                        tankOut.setType(recipe.output.type);
                    tankOut.add(
                        Math.floor(recipe.output.amount * runs * yieldBoost)
                    );
                }

                // ── Byproducts ────────────────────────────────────────────
                // Only granted once actual crafts occur, scaled to runs.
                for (let i = 0; i < runs; i++) {
                    for (const bp of itemByproducts) {
                        if (Math.random() < (bp.chance ?? 1.0)) {
                            _addByproduct(
                                entity,
                                BYPRODUCT_SLOT,
                                bp.item,
                                bp.count ?? 1
                            );
                        }
                    }
                    for (const bp of fluidByproducts) {
                        if (Math.random() < (bp.chance ?? 1.0)) {
                            if (tankByproduct.getType() === "empty")
                                tankByproduct.setType(bp.fluid.type);
                            tankByproduct.add(
                                Math.floor(bp.fluid.amount * yieldBoost)
                            );
                        }
                    }
                }

                machine.addProgress(-(runs * energyCost));
            }
        } else {
            const consumption = machine.boosts?.consumption ?? 1;
            const needed = energyCost - progress;
            const spendable = Math.min(
                machine.energy.get(),
                machine.rate,
                needed * consumption
            );
            if (spendable > 0) {
                machine.energy.consume(spendable);
                machine.addProgress(
                    spendable / Math.max(consumption, Number.EPSILON)
                );
            }
        }

        _updateHud(machine, recipe, tankIn, tankOut, tankByproduct, crafts);
        machine.on();
    },

    onPlayerBreak(e) {
        Machine.onDestroy(e);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _addByproduct(entity, slot, itemId, count) {
    try {
        const container = entity.getComponent("inventory")?.container;
        if (!container) return;
        const existing = container.getItem(slot);
        if (
            existing &&
            existing.typeId === itemId &&
            existing.amount < existing.maxAmount
        ) {
            existing.amount = Math.min(
                existing.maxAmount,
                existing.amount + count
            );
            container.setItem(slot, existing);
        } else if (!existing) {
            container.setItem(slot, new ItemStack(itemId, count));
        }
    } catch {}
}

function _updateHud(machine, recipe, tankIn, tankOut, tankByproduct, queued) {
    const hasFluidOutput = recipe.output.amount > 0;
    const byproducts = [].concat(recipe.byproduct ?? []).filter(Boolean);
    const itemByproducts = byproducts.filter(bp => bp.item);
    const fluidByproducts = byproducts.filter(
        bp => bp.fluid?.type && bp.fluid?.amount > 0
    );

    const lore = [
        `§bInput:  §f${formatFluidDisplayName(recipe.input.type)} §7${FluidManager.formatFluid(tankIn.get())} / ${FluidManager.formatFluid(tankIn.getCap())}`
    ];
    if (hasFluidOutput) {
        lore.push(
            `§aOutput: §f${formatFluidDisplayName(recipe.output.type)} §7${FluidManager.formatFluid(tankOut.get())} / ${FluidManager.formatFluid(tankOut.getCap())}`
        );
    }
    lore.push(
        `§cCost:   §f${Energy.formatEnergyToText(machine.getEnergyCost())}`,
        `§7Queued: §f${queued}`
    );
    for (const bp of itemByproducts) {
        lore.push(
            `§dByproduct: §f${bp.item} §7(${Math.round((bp.chance ?? 1) * 100)}%)`
        );
    }
    for (const bp of fluidByproducts) {
        lore.push(
            `§dByproduct: §f${formatFluidDisplayName(bp.fluid.type)} §7${FluidManager.formatFluid(tankByproduct.get())} / ${FluidManager.formatFluid(tankByproduct.getCap())} §7(${Math.round((bp.chance ?? 1) * 100)}%)`
        );
    }
    const overclockLine = buildOverclockLoreLine(machine);
    if (overclockLine) lore.push(overclockLine);
    machine.setLabel({ title: "§6Chemical Reactor", lore });
}

// Invalidate pipe caches when fluid blocks change nearby
function _invalidateNeighbourCaches(block) {
    const { x, y, z } = block.location;
    const dim = block.dimension;
    for (const o of [
        { x: 1, y: 0, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 0, y: -1, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: -1 }
    ]) {
        const nb = dim.getBlock({ x: x + o.x, y: y + o.y, z: z + o.z });
        const ent = nb && dim.getEntitiesAtBlockLocation(nb.location)?.[0];
        if (ent)
            try {
                ent.setDynamicProperty("dorios:fluid_nodes", undefined);
            } catch {}
    }
}

world.afterEvents.playerPlaceBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateNeighbourCaches(block);
});
world.afterEvents.playerBreakBlock.subscribe(({ block }) => {
    if (block.hasTag("dorios:fluid")) _invalidateNeighbourCaches(block);
});
