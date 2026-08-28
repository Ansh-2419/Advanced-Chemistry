function defineRecipe(r) {
    const noneInput = String(r.input.type).toLowerCase() === "none";
    return {
        id:         r.id,
        input:      { type: noneInput ? "none" : String(r.input.type).toLowerCase(), amount: noneInput ? 0 : Math.max(1, r.input.amount) },
        items:      (r.items ?? []).map(i => ({ id: i.id, amount: Math.max(1, i.amount ?? 1) })),
        output:     { type: String(r.output.type).toLowerCase(), amount: Math.max(1, r.output.amount) },
        energyCost: Math.max(1, r.energyCost ?? 50_000),
        seconds:    Math.max(1, r.seconds ?? 20),
    };
}

const RECIPES = [
    defineRecipe({
        id:         "aoc:actinide_solution_from_thorium",
        input:      { type: "none", amount: 0 },
        items:      [ { id: "utilitycraft:thorium_concentrate", amount: 20 } ],
        output:     { type: "actinide_solution", amount: 100 },
        energyCost: 90_000,
        seconds:    20,
    }),
];

export function getNuclearProcessorRecipes() {
    return RECIPES;
}
