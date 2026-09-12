/**
 * Greenhouse plant registry — max yield / max speed tuned.
 *
 * cost  — base energy per cycle. Divided at runtime by (soil.cost × growthMultiplier).
 *         Worst case (dirt + no fluids): full cost. Best case (black soil +
 *         advanced_growth_catalyst): cost ÷ (0.25 × 1.70) = cost ÷ 0.425 ≈ ×2.35 faster.
 *
 * drops — BASE amounts before soil.multi (up to ×4) and yieldMultiplier (up to ×1.50)
 *         are applied. scaleWithYield: false pins an entry to its base amount.
 *
 * Sections
 *   §1  Vanilla trees / saplings       cost 2 000
 *   §2  Vanilla crops & plants         cost 2 000
 *   §3  Vanilla nether / rare plants   cost 2 000
 *   §4  Vanilla rare seeds             cost 4 000
 *   §5  UC custom (apple sapling)      cost 2 000
 *   §6  BC Tier-1 seeds                cost 4 000
 *   §7  BC Tier-2 seeds                cost 8 000
 *   §8  BC Tier-3 seeds                cost 16 000
 *   §9  BC Tier-4 seeds                cost 32 000
 */

export const greenhousePlantsData = {

    // ── §1  Vanilla trees ─────────────────────────────────────────────────────

    'minecraft:oak_sapling': { cost: 2000, drops: [
        { item: 'minecraft:log',         amount: [12, 20], chance: 1    },
        { item: 'minecraft:leaves',      amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',       amount: [8,  14], chance: 1    },
        { item: 'minecraft:oak_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:birch_sapling': { cost: 2000, drops: [
        { item: 'minecraft:birch_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:birch_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',         amount: [8,  14], chance: 1    },
        { item: 'minecraft:birch_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:spruce_sapling': { cost: 2000, drops: [
        { item: 'minecraft:spruce_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:spruce_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',          amount: [8,  14], chance: 1    },
        { item: 'minecraft:spruce_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:jungle_sapling': { cost: 2000, drops: [
        { item: 'minecraft:jungle_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:jungle_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:cocoa_beans',    amount: [2,  8],  chance: 1    },
        { item: 'minecraft:stick',          amount: [8,  14], chance: 1    },
        { item: 'minecraft:jungle_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:acacia_sapling': { cost: 2000, drops: [
        { item: 'minecraft:acacia_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:acacia_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',          amount: [12, 20], chance: 1    },
        { item: 'minecraft:acacia_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:dark_oak_sapling': { cost: 2000, drops: [
        { item: 'minecraft:dark_oak_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:dark_oak_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',            amount: [8,  14], chance: 1    },
        { item: 'minecraft:dark_oak_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:cherry_sapling': { cost: 2000, drops: [
        { item: 'minecraft:cherry_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:cherry_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',          amount: [8,  14], chance: 1    },
        { item: 'minecraft:cherry_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:mangrove_propagule': { cost: 2000, drops: [
        { item: 'minecraft:mangrove_log',       amount: [12, 20], chance: 1    },
        { item: 'minecraft:mangrove_leaves',    amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',              amount: [8,  14], chance: 1    },
        { item: 'minecraft:mangrove_propagule', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:pale_oak_sapling': { cost: 2000, drops: [
        { item: 'minecraft:pale_oak_log',     amount: [12, 20], chance: 1    },
        { item: 'minecraft:pale_oak_leaves',  amount: [4,  8],  chance: 1    },
        { item: 'minecraft:stick',            amount: [8,  14], chance: 1    },
        { item: 'minecraft:resin_clump',      amount: [2,  4],  chance: 0.06 },
        { item: 'minecraft:pale_oak_sapling', amount: 1,        chance: 0.08 },
    ]},

    'minecraft:azalea': { cost: 2000, drops: [
        { item: 'minecraft:oak_log',          amount: [8,  18], chance: 1    },
        { item: 'minecraft:azalea_leaves',    amount: [4,  10], chance: 1    },
        { item: 'minecraft:stick',            amount: [12, 16], chance: 1    },
        { item: 'minecraft:azalea',           amount: [2,  4],  chance: 0.12 },
        { item: 'minecraft:flowering_azalea', amount: 1,        chance: 0.04 },
    ]},

    'minecraft:flowering_azalea': { cost: 2000, drops: [
        { item: 'minecraft:oak_log',                 amount: [8,  18], chance: 1    },
        { item: 'minecraft:flowering_azalea_leaves', amount: [4,  10], chance: 1    },
        { item: 'minecraft:stick',                   amount: [12, 16], chance: 1    },
        { item: 'minecraft:flowering_azalea',        amount: [2,  4],  chance: 0.20 },
        { item: 'minecraft:spore_flower',            amount: 1,        chance: 0.10 },
    ]},

    // ── §2  Vanilla crops & plants ────────────────────────────────────────────

    'minecraft:wheat_seeds': { cost: 2000, drops: [
        { item: 'minecraft:wheat',       amount: [4, 8], chance: 1    },
        { item: 'minecraft:wheat_seeds', amount: 1,      chance: 0.08 },
        { item: 'minecraft:bread',       amount: 1,      chance: 0.15 },
    ]},

    'minecraft:carrot': { cost: 2000, drops: [
        { item: 'minecraft:carrot',        amount: [4, 8], chance: 1    },
        { item: 'minecraft:golden_carrot', amount: 1,      chance: 0.15 },
    ]},

    'minecraft:potato': { cost: 2000, drops: [
        { item: 'minecraft:potato',           amount: [4, 8], chance: 1    },
        { item: 'minecraft:poisonous_potato', amount: 1,      chance: 0.15 },
    ]},

    'minecraft:beetroot_seeds': { cost: 2000, drops: [
        { item: 'minecraft:beetroot',       amount: [4, 8], chance: 1    },
        { item: 'minecraft:beetroot_seeds', amount: 1,      chance: 0.08 },
    ]},

    'minecraft:melon_seeds': { cost: 2000, drops: [
        { item: 'minecraft:melon_slice', amount: [4, 8], chance: 1    },
        { item: 'minecraft:melon_block', amount: 1,      chance: 0.10 },
    ]},

    'minecraft:pumpkin_seeds': { cost: 2000, drops: [
        { item: 'minecraft:pumpkin',     amount: [4, 8], chance: 1    },
        { item: 'minecraft:pumpkin_pie', amount: 1,      chance: 0.15 },
    ]},

    'minecraft:sugar_cane': { cost: 2000, drops: [
        { item: 'minecraft:sugar_cane', amount: [8, 16], chance: 1 },
    ]},

    'minecraft:bamboo': { cost: 2000, drops: [
        { item: 'minecraft:bamboo', amount: [8, 16], chance: 1 },
    ]},

    'minecraft:cactus': { cost: 2000, drops: [
        { item: 'minecraft:cactus', amount: [4, 8], chance: 1 },
    ]},

    'minecraft:kelp': { cost: 2000, drops: [
        { item: 'minecraft:kelp', amount: [8, 16], chance: 1 },
    ]},

    'minecraft:sweet_berries': { cost: 2000, drops: [
        { item: 'minecraft:sweet_berries', amount: [4, 8], chance: 1 },
    ]},

    'minecraft:glow_berries': { cost: 2000, drops: [
        { item: 'minecraft:glow_berries', amount: [4, 32], chance: 1 },
    ]},

    'minecraft:sea_pickle': { cost: 2000, drops: [
        { item: 'minecraft:sea_pickle', amount: [2, 8], chance: 1 },
    ]},

    // ── §3  Vanilla nether / rare plants ──────────────────────────────────────

    'minecraft:nether_wart': { cost: 2000, drops: [
        { item: 'minecraft:nether_wart', amount: [8, 16], chance: 1 },
    ]},

    'minecraft:crimson_fungus': { cost: 2000, drops: [
        { item: 'minecraft:crimson_stem',      amount: [12, 20], chance: 1    },
        { item: 'minecraft:nether_wart_block', amount: [4,  8],  chance: 1    },
        { item: 'minecraft:shroomlight',       amount: [2,  8],  chance: 1    },
        { item: 'minecraft:stick',             amount: [8,  14], chance: 1    },
        { item: 'minecraft:crimson_fungus',    amount: 1,        chance: 0.08 },
    ]},

    'minecraft:warped_fungus': { cost: 2000, drops: [
        { item: 'minecraft:warped_stem',       amount: [12, 20], chance: 1    },
        { item: 'minecraft:warped_wart_block', amount: [4,  8],  chance: 1    },
        { item: 'minecraft:shroomlight',       amount: [2,  8],  chance: 1    },
        { item: 'minecraft:stick',             amount: [8,  14], chance: 1    },
        { item: 'minecraft:warped_fungus',     amount: 1,        chance: 0.08 },
    ]},

    'minecraft:red_mushroom': { cost: 2000, drops: [
        { item: 'minecraft:red_mushroom', amount: [4, 8], chance: 1 },
    ]},

    'minecraft:brown_mushroom': { cost: 2000, drops: [
        { item: 'minecraft:brown_mushroom', amount: [4, 8], chance: 1 },
    ]},

    'minecraft:chorus_fruit': { cost: 2000, drops: [
        { item: 'minecraft:chorus_fruit',  amount: [2, 4], chance: 1    },
        { item: 'minecraft:chorus_flower', amount: 1,      chance: 0.08 },
    ]},

    'minecraft:chorus_flower': { cost: 2000, drops: [
        { item: 'minecraft:chorus_fruit',  amount: [2, 4], chance: 1    },
        { item: 'minecraft:chorus_flower', amount: 1,      chance: 0.08 },
    ]},

    'minecraft:poppy': { cost: 2000, drops: [
        { item: 'minecraft:dandelion',          amount: 1, chance: 0.08 },
        { item: 'minecraft:poppy',              amount: 1, chance: 0.08 },
        { item: 'minecraft:blue_orchid',        amount: 1, chance: 0.08 },
        { item: 'minecraft:allium',             amount: 1, chance: 0.08 },
        { item: 'minecraft:azure_bluet',        amount: 1, chance: 0.08 },
        { item: 'minecraft:red_tulip',          amount: 1, chance: 0.08 },
        { item: 'minecraft:orange_tulip',       amount: 1, chance: 0.08 },
        { item: 'minecraft:white_tulip',        amount: 1, chance: 0.08 },
        { item: 'minecraft:pink_tulip',         amount: 1, chance: 0.08 },
        { item: 'minecraft:oxeye_daisy',        amount: 1, chance: 0.08 },
        { item: 'minecraft:cornflower',         amount: 1, chance: 0.08 },
        { item: 'minecraft:lily_of_the_valley', amount: 1, chance: 0.08 },
        { item: 'minecraft:sunflower',          amount: 1, chance: 0.08 },
        { item: 'minecraft:lilac',              amount: 1, chance: 0.08 },
        { item: 'minecraft:rose_bush',          amount: 1, chance: 0.08 },
        { item: 'minecraft:peony',              amount: 1, chance: 0.08 },
        { item: 'minecraft:pitcher_plant',      amount: 1, chance: 0.08 },
        { item: 'minecraft:torchflower',        amount: 1, chance: 0.08 },
        { item: 'minecraft:cactus_flower',      amount: 1, chance: 0.08 },
    ]},

    // ── §4  Vanilla rare seeds ────────────────────────────────────────────────

    'minecraft:torchflower_seeds': { cost: 4000, drops: [
        { item: 'minecraft:torchflower',       amount: [1, 2], chance: 1    },
        { item: 'minecraft:torchflower_seeds', amount: 1,      chance: 0.15 },
    ]},

    'minecraft:pitcher_pod': { cost: 4000, drops: [
        { item: 'minecraft:pitcher_plant', amount: [1, 2], chance: 1    },
        { item: 'minecraft:pitcher_pod',   amount: 1,      chance: 0.15 },
    ]},

    // ── §5  UC custom plants ──────────────────────────────────────────────────

    'utilitycraft:apple_sapling': { cost: 2000, drops: [
        { item: 'minecraft:log',                    amount: [12, 20], chance: 1                        },
        { item: 'minecraft:leaves',                 amount: [4,  8],  chance: 1                        },
        { item: 'minecraft:stick',                  amount: [12, 20], chance: 1                        },
        { item: 'minecraft:apple',                  amount: [2,  8],  chance: 1                        },
        { item: 'utilitycraft:apple_sapling',       amount: 1,        chance: 0.08                     },
        { item: 'minecraft:golden_apple',           amount: 1,        chance: 0.02,  scaleWithYield: false },
        { item: 'minecraft:enchanted_golden_apple', amount: 1,        chance: 0.0001, scaleWithYield: false },
    ]},

    // ── §6  BC Tier-1 seeds  (base ×2 from loot tables, cost 4 000) ──────────

    'utilitycraft:coal_seeds': { cost: 4000, drops: [
        { item: 'minecraft:coal',          amount: [6,  12], chance: 1    },
        { item: 'utilitycraft:coal_seeds', amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:copper_seeds': { cost: 4000, drops: [
        { item: 'minecraft:raw_copper',       amount: [8,  16], chance: 1    },
        { item: 'utilitycraft:copper_seeds',  amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:dyes_seeds': { cost: 4000, drops: [
        { item: 'minecraft:black_dye',     amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:blue_dye',      amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:brown_dye',     amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:cyan_dye',      amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:gray_dye',      amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:green_dye',     amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:light_blue_dye',amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:light_gray_dye',amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:lime_dye',      amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:magenta_dye',   amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:orange_dye',    amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:pink_dye',      amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:purple_dye',    amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:red_dye',       amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:white_dye',     amount: [2, 4], chance: 0.5  },
        { item: 'minecraft:yellow_dye',    amount: [2, 4], chance: 0.5  },
        { item: 'utilitycraft:dyes_seeds', amount: 1,      chance: 0.12 },
    ]},

    'utilitycraft:glass_seeds': { cost: 4000, drops: [
        { item: 'minecraft:glass',          amount: [16, 32], chance: 1    },
        { item: 'utilitycraft:glass_seeds', amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:gunpowder_seeds': { cost: 4000, drops: [
        { item: 'minecraft:gunpowder',           amount: [10, 20], chance: 1    },
        { item: 'utilitycraft:gunpowder_seeds',  amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:iron_seeds': { cost: 4000, drops: [
        { item: 'minecraft:raw_iron',      amount: [4, 8], chance: 1    },
        { item: 'utilitycraft:iron_seeds', amount: 1,      chance: 0.12 },
    ]},

    'utilitycraft:leather_seeds': { cost: 4000, drops: [
        { item: 'minecraft:leather',          amount: [8, 16], chance: 1    },
        { item: 'utilitycraft:leather_seeds', amount: 1,       chance: 0.12 },
    ]},

    'utilitycraft:prismarine_crystals_seeds': { cost: 4000, drops: [
        { item: 'minecraft:prismarine_crystals',          amount: [12, 24], chance: 1    },
        { item: 'utilitycraft:prismarine_crystals_seeds', amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:prismarine_shards_seeds': { cost: 4000, drops: [
        { item: 'minecraft:prismarine_shard',           amount: [16, 32], chance: 1    },
        { item: 'utilitycraft:prismarine_shards_seeds', amount: 1,        chance: 0.12 },
    ]},

    'utilitycraft:water_seeds': { cost: 4000, drops: [
        { item: 'utilitycraft:water_ball',  amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:water_seeds', amount: 1,      chance: 0.12 },
    ]},

    'utilitycraft:wool_seeds': { cost: 4000, drops: [
        { item: 'minecraft:wool',          amount: [8, 16], chance: 1    },
        { item: 'utilitycraft:wool_seeds', amount: 1,       chance: 0.12 },
    ]},

    // ── §7  BC Tier-2 seeds  (base ×2 from loot tables, cost 8 000) ──────────

    'utilitycraft:ghast_seeds': { cost: 8000, drops: [
        { item: 'minecraft:ghast_tear',      amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:ghast_seeds',  amount: 1,      chance: 0.10 },
    ]},

    'utilitycraft:glowstone_seeds': { cost: 8000, drops: [
        { item: 'minecraft:glowstone_dust',       amount: [12, 24], chance: 1    },
        { item: 'utilitycraft:glowstone_seeds',   amount: 1,        chance: 0.10 },
    ]},

    'utilitycraft:gold_seeds': { cost: 8000, drops: [
        { item: 'minecraft:raw_gold',       amount: [4, 8], chance: 1    },
        { item: 'utilitycraft:gold_seeds',  amount: 1,      chance: 0.10 },
    ]},

    'utilitycraft:honey_seeds': { cost: 8000, drops: [
        { item: 'utilitycraft:honey_ball',  amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:honey_seeds', amount: 1,      chance: 0.10 },
    ]},

    'utilitycraft:lapis_seeds': { cost: 8000, drops: [
        { item: 'minecraft:lapis_lazuli',    amount: [12, 24], chance: 1    },
        { item: 'utilitycraft:lapis_seeds',  amount: 1,        chance: 0.10 },
    ]},

    'utilitycraft:lava_seeds': { cost: 8000, drops: [
        { item: 'utilitycraft:lava_ball',  amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:lava_seeds', amount: 1,      chance: 0.10 },
    ]},

    'utilitycraft:quartz_seeds': { cost: 8000, drops: [
        { item: 'minecraft:quartz',          amount: [12, 24], chance: 1    },
        { item: 'utilitycraft:quartz_seeds', amount: 1,        chance: 0.10 },
    ]},

    'utilitycraft:redstone_seeds': { cost: 8000, drops: [
        { item: 'minecraft:redstone',           amount: [12, 24], chance: 1    },
        { item: 'utilitycraft:redstone_seeds',  amount: 1,        chance: 0.10 },
    ]},

    'utilitycraft:resin_seeds': { cost: 8000, drops: [
        { item: 'minecraft:resin_clump',      amount: [6, 12], chance: 1    },
        { item: 'utilitycraft:resin_seeds',   amount: 1,       chance: 0.10 },
    ]},

    'utilitycraft:slime_seeds': { cost: 8000, drops: [
        { item: 'minecraft:slime_ball',      amount: [6, 12], chance: 1    },
        { item: 'utilitycraft:slime_seeds',  amount: 1,       chance: 0.10 },
    ]},

    // ── §8  BC Tier-3 seeds  (base ×2 from loot tables, cost 16 000) ─────────

    'utilitycraft:amethyst_seeds': { cost: 16000, drops: [
        { item: 'minecraft:amethyst_shard',      amount: [8, 16], chance: 1    },
        { item: 'utilitycraft:amethyst_seeds',   amount: 1,       chance: 0.08 },
    ]},

    'utilitycraft:blaze_seeds': { cost: 16000, drops: [
        { item: 'minecraft:blaze_rod',        amount: [4, 8], chance: 1    },
        { item: 'utilitycraft:blaze_seeds',   amount: 1,      chance: 0.08 },
    ]},

    'utilitycraft:diamond_seeds': { cost: 16000, drops: [
        { item: 'utilitycraft:diamond_shard',  amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:diamond_seeds',  amount: 1,      chance: 0.08 },
    ]},

    'utilitycraft:emerald_seeds': { cost: 16000, drops: [
        { item: 'utilitycraft:emerald_shard',  amount: [4, 6], chance: 1    },
        { item: 'utilitycraft:emerald_seeds',  amount: 1,      chance: 0.08 },
    ]},

    'utilitycraft:enderpearl_seeds': { cost: 16000, drops: [
        { item: 'minecraft:ender_pearl',          amount: [4, 8], chance: 1    },
        { item: 'utilitycraft:enderpearl_seeds',  amount: 1,      chance: 0.08 },
    ]},

    'utilitycraft:obsidian_seeds': { cost: 16000, drops: [
        { item: 'minecraft:obsidian',           amount: [6, 12], chance: 1    },
        { item: 'utilitycraft:obsidian_seeds',  amount: 1,       chance: 0.08 },
    ]},

    // ── §9  BC Tier-4 seeds  (base ×1.5 from loot tables, cost 32 000) ───────

    'utilitycraft:netherite_seeds': { cost: 32000, drops: [
        { item: 'utilitycraft:netherite_nugget',  amount: [3, 6], chance: 1    },
        { item: 'utilitycraft:netherite_seeds',   amount: 1,      chance: 0.06 },
    ]},

    'utilitycraft:nether_star_seeds': { cost: 32000, drops: [
        { item: 'utilitycraft:nether_star_fragment', amount: [3, 6], chance: 1    },
        { item: 'utilitycraft:nether_star_seeds',    amount: 1,      chance: 0.06 },
    ]},

    'utilitycraft:shulker_seeds': { cost: 32000, drops: [
        { item: 'utilitycraft:shulker_shell_shard', amount: [3, 6], chance: 1    },
        { item: 'utilitycraft:shulker_seeds',       amount: 1,      chance: 0.06 },
    ]},

    'utilitycraft:totem_seeds': { cost: 32000, drops: [
        { item: 'utilitycraft:totem_shard',  amount: [3, 6], chance: 1    },
        { item: 'utilitycraft:totem_seeds',  amount: 1,      chance: 0.06 },
    ]},

    'utilitycraft:wither_seeds': { cost: 32000, drops: [
        { item: 'utilitycraft:wither_skull_shard', amount: [3, 6], chance: 1    },
        { item: 'utilitycraft:wither_seeds',       amount: 1,      chance: 0.06 },
    ]},
};
