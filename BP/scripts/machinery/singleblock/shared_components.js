import { system } from "@minecraft/server";

// ─── utilitycraft:special_container ──────────────────────────────────────────
// Stamps the slot-mapping data declared in the block JSON (e.g.
// { "Input": 3, "Fluid Manual Input": 10 } or
// { "Fluid Input 1": 10, "Fluid Input 2": 11 })
// onto the spawned machine entity as a dynamic property, so other
// systems (pipes, the recipe viewer, addons) can read slot roles
// without hardcoding them.

DoriosAPI.register.blockComponent('special_container', {
    onPlace({ block }, { params }) {
        system.run(() => {
            const entity = block.dimension.getEntitiesAtBlockLocation(block.location)[0];
            if (!entity) return;
            entity.setDynamicProperty('dorios:special_container', JSON.stringify(params ?? {}));
        });
    },
});

// ─── utilitycraft:machine_recipes ────────────────────────────────────────────
// Stamps the machine's recipe-type id (e.g. "fermenter", "fuel_mixer")
// declared in the block JSON onto the spawned entity, so recipe
// viewers and automation can identify what this machine processes.

DoriosAPI.register.blockComponent('machine_recipes', {
    onPlace({ block }, { params }) {
        system.run(() => {
            const entity = block.dimension.getEntitiesAtBlockLocation(block.location)[0];
            if (!entity) return;
            entity.setDynamicProperty('utilitycraft:machine_recipe_type', params?.type ?? '');
        });
    },
});
