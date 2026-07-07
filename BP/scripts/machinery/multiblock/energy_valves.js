/**
 * machinery/multiblock/energy_valves.js
 *
 * Energy valve block component.
 *
 * Energy transfer is fully passive — UtilityCraft's dorios:updatePipes
 * scriptevent fires during multiblock activation (via activationManager.js)
 * and registers the valve with the UC energy network automatically.
 * No custom pull/push or registerEnergyValves call is needed.
 */

import { ActionFormData } from "@minecraft/server-ui";
import { MODE_INPUT, MODE_OUTPUT } from "./valve_shared.js";

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
