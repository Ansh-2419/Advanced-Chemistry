import { advanceReactorHeat } from "./reactorHeatExchange.js";

// ── Thermal constants ─────────────────────────────────────────────────────────
/**
 * Thermal coefficients for the Fusion Reactor.
 * Kept separate from DoriosCore so they can be tuned without touching the
 * generic temperature model.
 */
export const NUCLEAR_THERMAL = Object.freeze({
    /** HU generated per mB of fuel consumed at nominal load. */
    heatPerFuelMb:        0.10,
    /** HU/(tick K) per coolant bucket present (2-bucket max). */
    coolantConductance:   0.08,
    /** Fraction of conductance that is always active (no budget cost). */
    passiveCoolingFraction: 0.02,
    /** HU removable per mB of coolant × coolant efficiency multiplier. */
    coolantHeatPerMb:     180,
    /** Base HU/K of the reactor core regardless of structure size. */
    baseHeatCapacity:     8_000,
    /** Extra HU/K per solid casing block (shell minus air). */
    casingHeatCapacity:   2,
});

// ── Capacity helper ───────────────────────────────────────────────────────────
/**
 * Derive total heat capacity from the validated structure bounds and counted
 * component types.  Air blocks add coolant volume, not thermal mass.
 *
 * @param {{min: import('@minecraft/server').Vector3, max: import('@minecraft/server').Vector3}|undefined} bounds
 * @param {Record<string, number>} [components]
 * @returns {number} HU/K
 */
export function getNuclearHeatCapacity(bounds, components = {}) {
    let shellBlocks = 0;
    if (bounds?.min && bounds?.max) {
        const lx = Math.max(0, bounds.max.x - bounds.min.x + 1);
        const ly = Math.max(0, bounds.max.y - bounds.min.y + 1);
        const lz = Math.max(0, bounds.max.z - bounds.min.z + 1);
        const total = lx * ly * lz;
        const inner = Math.max(0, lx - 2) * Math.max(0, ly - 2) * Math.max(0, lz - 2);
        shellBlocks = total - inner;
    }
    return NUCLEAR_THERMAL.baseHeatCapacity
        + shellBlocks * NUCLEAR_THERMAL.casingHeatCapacity;
}

// ── Efficiency curve ──────────────────────────────────────────────────────────
/**
 * Map a reactor temperature to a [0, 1] efficiency scalar.
 * Peak efficiency is at `idealTemperatureFraction` of the operating range;
 * running too cold or too hot reduces yield.
 *
 * @param {number} temperature  Current K.
 * @param {{
 *   ambientTemperatureK: number,
 *   maximumTemperatureK: number,
 *   idealTemperatureFraction: number,
 *   efficiencyGamma: number,
 *   coldEfficiencyAlpha: number,
 *   hotEfficiencyAlpha: number,
 *   minimumEfficiency: number,
 *   maximumEfficiency: number,
 * }} config
 * @returns {number}
 */
export function getNuclearEfficiency(temperature, config) {
    const normalized = Math.max(0, Math.min(1,
        (temperature - config.ambientTemperatureK)
        / (config.maximumTemperatureK - config.ambientTemperatureK)));

    const ideal    = config.idealTemperatureFraction;
    const distance = Math.abs(normalized - ideal) / Math.max(ideal, 1e-9);
    const base     = Math.max(0, 1 - distance ** config.efficiencyGamma);
    const shape    = normalized < ideal
        ? base ** config.coldEfficiencyAlpha
        : base ** config.hotEfficiencyAlpha;

    return config.minimumEfficiency
        + (config.maximumEfficiency - config.minimumEfficiency) * shape;
}

// ── Simulation loop ───────────────────────────────────────────────────────────
/**
 * Pure in-memory nuclear tick.  No entity, inventory or scoreboard access.
 * Four-tick burn slices keep temperature-driven efficiency consistent across
 * the 4 / 20 / 40 / 80-tick scheduler profiles.
 *
 * @param {{
 *   temperature:      number,
 *   heatCapacity:     number,
 *   ticks:            number,
 *   running:          boolean,
 *   fuel:             number,
 *   energySpace:      number,
 *   coolantHeatBudget: number,
 *   conductance:      number,
 * }} input
 * @param {{
 *   ambientTemperatureK:  number,
 *   maximumTemperatureK:  number,
 *   meltdownTemperatureK: number,
 *   idealTemperatureFraction: number,
 *   efficiencyGamma:      number,
 *   coldEfficiencyAlpha:  number,
 *   hotEfficiencyAlpha:   number,
 *   minimumEfficiency:    number,
 *   maximumEfficiency:    number,
 *   energyPerFuelMb:      number,
 *   fuelPerCycle:         number,
 * }} config
 * @returns {{
 *   temperature:       number,
 *   consumedFuel:      number,
 *   producedEnergy:    number,
 *   coolantHeatRemoved: number,
 *   meltdown:          boolean,
 * }}
 */
export function simulateNuclearReactor(input, config) {
    // Pre-compute passive conductance so advanceReactorHeat can split it.
    const fullInput = {
        ...input,
        passiveConductance: input.conductance * NUCLEAR_THERMAL.passiveCoolingFraction,
    };

    let temperature     = input.temperature;
    let fuel            = input.fuel;
    let energySpace     = input.energySpace;
    let coolantBudget   = input.coolantHeatBudget;
    let remaining       = input.ticks;
    let consumedFuel    = 0;
    let producedEnergy  = 0;
    let removedHeat     = 0;
    let meltdown        = temperature >= config.meltdownTemperatureK;

    while (remaining > 1e-10 && !meltdown) {
        const efficiency = getNuclearEfficiency(temperature, config);
        const canBurn    = input.running && fuel > 0 && energySpace > 0 && efficiency > 0;

        let duration = remaining;
        let heatRate = 0;

        if (canBurn) {
            // Limit each slice to 4 ticks so the efficiency integral stays tight.
            const maxEnergyPerMb = config.energyPerFuelMb * efficiency;
            duration = Math.min(
                4,
                remaining,
                energySpace > 0 && maxEnergyPerMb > 0
                    ? energySpace / maxEnergyPerMb / (config.fuelPerCycle / 200)
                    : Infinity,
            );
            heatRate = (config.fuelPerCycle / 200) * NUCLEAR_THERMAL.heatPerFuelMb;
        }

        if (duration <= 1e-10) {
            heatRate = 0;
            duration = remaining;
        }

        const thermal = advanceReactorHeat(
            temperature, duration, heatRate, fullInput, coolantBudget, config,
        );

        // Proportional fuel and energy for this slice.
        const sliceFraction = duration > 0 ? thermal.elapsed / duration : 0;
        const fuelRate      = config.fuelPerCycle / 200; // mB/tick
        const burned        = canBurn ? Math.min(fuel, fuelRate * thermal.elapsed) : 0;
        const energy        = Math.min(energySpace, burned * config.energyPerFuelMb * efficiency);

        fuel         = Math.max(0, fuel - burned);
        energySpace  = Math.max(0, energySpace - energy);
        consumedFuel += burned;
        producedEnergy  += energy;
        removedHeat     += thermal.coolantHeat;
        coolantBudget    = Math.max(0, coolantBudget - thermal.coolantHeat);
        temperature      = thermal.temperature;
        meltdown         = thermal.meltdown;
        remaining        = Math.max(0, remaining - thermal.elapsed);
    }

    return { temperature, consumedFuel, producedEnergy, coolantHeatRemoved: removedHeat, meltdown };
}
