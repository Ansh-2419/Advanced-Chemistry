import { ActionFormData } from '@minecraft/server-ui';

const MODE_INPUT  = 0;
const MODE_OUTPUT = 1;

DoriosAPI.register.blockComponent('common_fluid_valve', {

    onPlayerInteract(e) {
        const { block, player } = e;
        if (!player?.isValid) return;

        const currentMode = block.permutation.getState('utilitycraft:mode') ?? MODE_INPUT;

        const form = new ActionFormData()
            .title('Fluid Valve')
            .body(`Current mode: \u00A7e${currentMode === MODE_OUTPUT ? 'Output' : 'Input'}\n\u00A77Choose the flow direction for this valve.`)
            .button('\u00A7aSet to Input\n\u00A77(pulls fluid in)')
            .button('\u00A7cSet to Output\n\u00A77(pushes fluid out)');

        form.show(player).then(response => {
            if (response.canceled || response.selection == null) return;
            if (!block.isValid) return;

            const newMode = response.selection === 0 ? MODE_INPUT : MODE_OUTPUT;
            if (newMode === currentMode) {
                player.sendMessage(`\u00A77Valve is already set to ${newMode === MODE_OUTPUT ? 'Output' : 'Input'}.`);
                return;
            }

            const permutation = block.permutation.withState('utilitycraft:mode', newMode);
            block.setPermutation(permutation);
            player.sendMessage(`\u00A7aValve switched to \u00A7f${newMode === MODE_OUTPUT ? 'Output' : 'Input'}\u00A7a mode.`);
        }).catch(() => {});
    },
});
