/**
 * machinery/multiblock/energy_valves.js
 *
 * Energy valve block component.
 *
 * How the energy network works (from system.js):
 *  1. startRescanEnergy BFS-walks dorios:energy blocks from a cable/port.
 *  2. When it finds a dorios:multiblock.port + dorios:energy block, it looks
 *     up the controller entity via getEntities({tags:['input:[x,y,z]']}).
 *  3. searchEnergyContainers stamps net:[ctrl_x,ctrl_y,ctrl_z] on the generator.
 *  4. transferToNetwork on the generator pushes energy directly to the controller.
 *
 * So we just need to fire dorios:updatePipes energy for the valve block after
 * the multiblock activates. The UtilityCraft system does the rest automatically.
 *
 * No custom pull/push needed.
 */

import { system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
    VALVE_IDS,
    MODE_INPUT,
    MODE_OUTPUT,
    getPortBlocks
} from "./valve_shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Block component
// ─────────────────────────────────────────────────────────────────────────────

DoriosAPI.register.blockComponent("energy_valve", {
    onPlayerInteract({ block, player }) {
        if (!player?.isValid) return;

        const current = block.permutation.getState("utilitycraft:mode") ?? MODE_INPUT;

        new ActionFormData()
            .title("§eEnergy Valve")
            .body(`Current: §e${current === MODE_OUTPUT ? "Output ▶" : "◀ Input"}`)
            .button("§aSet Input §7(accept energy)")
            .button("§6Set Output §7(push energy out)")
            .show(player)
            .then(result => {
                if (result.canceled || result.selection == null) return;
                if (!block.isValid) return;
                const newMode = result.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
                block.setPermutation(block.permutation.withState("utilitycraft:mode", newMode));
                player.sendMessage(
                    newMode === MODE_INPUT
                        ? "§e[Energy Valve] §aInput mode"
                        : "§e[Energy Valve] §6Output mode"
                );
            })
            .catch(() => {});
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Network registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire dorios:updatePipes energy for every energy valve registered to this
 * controller. UtilityCraft's startRescanEnergy will then walk the cable
 * network, find our valves as dorios:multiblock.port + dorios:energy blocks,
 * look up our controller via input:[x,y,z] tags, and stamp net:[ctrl] on all
 * connected generators — so they push energy to us automatically every tick.
 *
 * Call once from onActivate. No periodic refresh needed — the system fires
 * updatePipes itself whenever cables are placed/broken.
 *
 * @param {Entity} entity  Controller entity.
 */
export function registerEnergyValves(entity) {
    const dim   = entity.dimension;
    const ports = getPortBlocks(entity, VALVE_IDS.ENERGY, null);

    // Wait 1 tick so activationManager's setPermutation(active=1) has taken
    // effect and the dorios:energy tag is readable on the valve block.
    system.runTimeout(() => {
        for (const port of ports) {
            const { x, y, z } = port.location;
            try {
                entity.runCommand(
                    `scriptevent dorios:updatePipes energy|[${x},${y},${z}]`
                );
            } catch { /* entity may be gone */ }
        }
    }, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stubs — kept so existing monitor imports don't break.
// Actual energy transfer is handled by UtilityCraft's transferToNetwork.
// ─────────────────────────────────────────────────────────────────────────────

export function refreshEnergyInputNetworks(_entity) {}
export function pullEnergyFromValves(_entity, _store, _max) {}
export function pushEnergyFromValves(_entity, _store, _max) {}
