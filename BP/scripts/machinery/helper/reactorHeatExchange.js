import { advanceTemperature } from "DoriosCore/index.js";

/**
 * Binary-search the earliest time inside [0, duration] at which predicate
 * becomes true. Returns `duration` when the predicate is never satisfied
 * (i.e. the event does not occur in this slice).
 *
 * @param {number} duration
 * @param {(t: number) => boolean} predicate
 * @returns {number}
 */
function eventTime(duration, predicate) {
    let low = 0, high = duration;
    for (let i = 0; i < 40; i++) {
        const mid = (low + high) / 2;
        if (predicate(mid)) high = mid;
        else low = mid;
    }
    return low;
}

/**
 * Advance reactor temperature over `ticks`, honouring a finite coolant heat
 * budget and an optional meltdown ceiling. Cooling is split into passive
 * (always active, fraction of conductance) and active (requires budget).
 *
 * @param {number} temperature      Current reactor temperature in K.
 * @param {number} ticks            Elapsed ticks to simulate.
 * @param {number} heatRate         Internal heat generation in HU/tick.
 * @param {{heatCapacity: number, conductance: number, passiveConductance: number}} input
 * @param {number} coolantBudget    Maximum heat the coolant can absorb this call (HU).
 * @param {{ambientTemperatureK: number, meltdownTemperatureK: number}} config
 * @returns {{temperature: number, elapsed: number, coolantHeat: number, meltdown: boolean}}
 */
export function advanceReactorHeat(temperature, ticks, heatRate, input, coolantBudget, config) {
    let remaining = ticks, elapsed = 0, coolantHeat = 0;
    const passive = input.passiveConductance ?? 0;

    // At most two pieces: before and after the finite cooling budget runs out.
    while (remaining > 0) {
        const active = coolantBudget > 1e-9 ? input.conductance : 0;
        const contacts = [{ temperature: config.ambientTemperatureK, conductance: passive }];
        if (active > 0) contacts.push({ temperature: config.ambientTemperatureK, conductance: active });

        const step = duration => advanceTemperature({
            temperature,
            heatCapacity: input.heatCapacity,
            ticks: duration,
            heatRate,
            contacts,
        });

        let duration = remaining;
        let result = step(duration);
        let exhausted = false, meltdown = false;

        // Heat extracted by the active (budget-limited) coolant contact.
        const removed = r => Math.max(0, -(r.contacts[1]?.heat ?? 0));

        if (active > 0 && removed(result) > coolantBudget) {
            duration = eventTime(duration, t => removed(step(t)) >= coolantBudget);
            result   = step(duration);
            exhausted = true;
        }

        if (result.temperature >= config.meltdownTemperatureK) {
            duration = eventTime(duration, t => step(t).temperature >= config.meltdownTemperatureK);
            result   = step(duration);
            meltdown = true;
        }

        const heat = Math.min(coolantBudget, removed(result));
        coolantHeat   += heat;
        coolantBudget  = exhausted && !meltdown ? 0 : Math.max(0, coolantBudget - heat);
        temperature    = result.temperature;
        elapsed       += duration;
        remaining      = Math.max(0, remaining - duration);

        if (meltdown) {
            return { temperature: config.meltdownTemperatureK, elapsed, coolantHeat, meltdown: true };
        }
        // No event: the complete requested interval has been processed.
        if (!exhausted) break;
    }

    return { temperature, elapsed, coolantHeat, meltdown: false };
}
