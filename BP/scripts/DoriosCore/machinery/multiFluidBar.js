/**
 * ════════════════════════════════════════════════════════════════════════════
 * DoriosCore — MultiFluidBar API
 *
 * Manages an ordered array of FluidManager tanks as a single logical unit,
 * with batch init, batch display, smart slot assignment, and convenience
 * accessors — so machines with 2-N tanks don't repeat the same boilerplate
 * in every onTick / beforeOnPlayerPlace.
 *
 * Usage (2-tank machine example):
 *
 *   import { MultiFluidBar } from '../../DoriosCore/index.js';
 *
 *   // In beforeOnPlayerPlace:
 *   const bar = MultiFluidBar.create(entity, [
 *       { cap: 64_000, displaySlot: 12 },
 *       { cap: 64_000, displaySlot: 13 },
 *       { cap: 64_000, displaySlot: 15 },
 *   ]);
 *   bar.display();
 *
 *   // In onTick:
 *   const bar = MultiFluidBar.from(entity, [
 *       { cap: 64_000, displaySlot: 12 },
 *       { cap: 64_000, displaySlot: 13 },
 *       { cap: 64_000, displaySlot: 15 },
 *   ]);
 *   bar.restoreCaps();   // re-applies caps after world reload
 *   bar.display();       // refreshes all bar items
 *   const tank0 = bar.get(0);
 *   const tank1 = bar.get(1);
 * ════════════════════════════════════════════════════════════════════════════
 */

import { FluidManager } from './fluidStorage.js';

// ─── Slot-descriptor normalizer ───────────────────────────────────────────────
//
// Each entry in the descriptor array passed to create() / from() can be:
//   - A plain number:  the display slot (cap defaults to 0 — set later)
//   - An object:       { cap?, displaySlot? }
//
// After normalization every descriptor is { cap: number, displaySlot: number }.

const DEFAULT_CAP = 0;

/**
 * @typedef {Object} TankDescriptor
 * @property {number} [cap]         Capacity in mB. 0 = not set yet (caller sets it later).
 * @property {number} [displaySlot] Inventory slot index used for the animated fluid-bar item.
 */

/**
 * @param {number | TankDescriptor} raw
 * @returns {{ cap: number, displaySlot: number }}
 */
function normalizeDescriptor(raw) {
    if (typeof raw === 'number') {
        return { cap: DEFAULT_CAP, displaySlot: raw };
    }
    return {
        cap:         typeof raw?.cap         === 'number' ? raw.cap         : DEFAULT_CAP,
        displaySlot: typeof raw?.displaySlot === 'number' ? raw.displaySlot : -1,
    };
}

// ─── MultiFluidBar ────────────────────────────────────────────────────────────

export class MultiFluidBar {
    /**
     * @param {FluidManager[]}                                   tanks
     * @param {Array<{ cap: number, displaySlot: number }>}      descriptors
     */
    constructor(tanks, descriptors) {
        /** @type {FluidManager[]} */
        this.tanks = tanks;

        /** @type {Array<{ cap: number, displaySlot: number }>} */
        this._descs = descriptors;
    }

    // ── Factory helpers ───────────────────────────────────────────────────────

    /**
     * Creates and fully initialises tanks on a freshly-placed entity.
     * Calls setCap and display for every tank that has a cap > 0 and/or a
     * valid display slot.  Use this inside `beforeOnPlayerPlace`.
     *
     * @param {Entity}                                          entity
     * @param {Array<number | TankDescriptor>}                  descriptors
     * @returns {MultiFluidBar}
     */
    static create(entity, descriptors) {
        const descs = descriptors.map(normalizeDescriptor);
        const tanks = FluidManager.initializeMultiple(entity, descs.length);

        const bar = new MultiFluidBar(tanks, descs);
        bar._applyAllCaps();
        bar.display();
        return bar;
    }

    /**
     * Binds to existing tanks on a live entity without re-initialising.
     * Use this every `onTick` call.
     *
     * @param {Entity}                                          entity
     * @param {Array<number | TankDescriptor>}                  descriptors
     * @returns {MultiFluidBar}
     */
    static from(entity, descriptors) {
        const descs = descriptors.map(normalizeDescriptor);
        const tanks = FluidManager.initializeMultiple(entity, descs.length);
        return new MultiFluidBar(tanks, descs);
    }

    // ── Tank accessors ────────────────────────────────────────────────────────

    /**
     * Returns the FluidManager at position `index`.
     * Throws a range-error if out of bounds.
     *
     * @param {number} index
     * @returns {FluidManager}
     */
    get(index) {
        if (index < 0 || index >= this.tanks.length) {
            throw new RangeError(
                `[MultiFluidBar] Tank index ${index} out of range (0–${this.tanks.length - 1})`
            );
        }
        return this.tanks[index];
    }

    /** Number of tanks managed by this bar. */
    get count() { return this.tanks.length; }

    /** Iterates over [index, FluidManager] pairs (for…of support). */
    *entries() {
        for (let i = 0; i < this.tanks.length; i++) yield [i, this.tanks[i]];
    }

    // ── Cap helpers ───────────────────────────────────────────────────────────

    /**
     * Sets individual caps from the descriptor array.
     * Any descriptor with cap === 0 is skipped.
     */
    _applyAllCaps() {
        for (let i = 0; i < this.tanks.length; i++) {
            const { cap } = this._descs[i];
            if (cap > 0) this.tanks[i].setCap(cap);
        }
    }

    /**
     * Re-applies all caps — typically called once per tick to handle the
     * case where an entity's scoreboard is wiped on world reload.
     * Only writes if the stored cap is ≤ 0 and the descriptor cap is > 0.
     *
     * @returns {MultiFluidBar} `this` for chaining.
     */
    restoreCaps() {
        for (let i = 0; i < this.tanks.length; i++) {
            const { cap } = this._descs[i];
            if (cap > 0 && this.tanks[i].getCap() <= 0) {
                this.tanks[i].setCap(cap);
            }
        }
        return this;
    }

    /**
     * Overrides the runtime capacity for a single tank.
     * Also updates the descriptor so `restoreCaps` uses the new value.
     *
     * @param {number} index
     * @param {number} cap   New capacity in mB.
     * @returns {MultiFluidBar} `this` for chaining.
     */
    setCap(index, cap) {
        this.get(index).setCap(cap);
        this._descs[index].cap = cap;
        return this;
    }

    /**
     * Sets the same capacity on every tank at once.
     *
     * @param {number} cap
     * @returns {MultiFluidBar} `this` for chaining.
     */
    setAllCaps(cap) {
        for (let i = 0; i < this.tanks.length; i++) this.setCap(i, cap);
        return this;
    }

    // ── Display helpers ───────────────────────────────────────────────────────

    /**
     * Calls `.display(slot)` on every tank whose descriptor has a valid slot.
     * Skips tanks with displaySlot < 0.
     *
     * @param {object} [options]  Forwarded to FluidManager.display() as-is.
     * @returns {MultiFluidBar} `this` for chaining.
     */
    display(options) {
        for (let i = 0; i < this.tanks.length; i++) {
            const { displaySlot } = this._descs[i];
            if (displaySlot >= 0) this.tanks[i].display(displaySlot, options ?? {});
        }
        return this;
    }

    /**
     * Refreshes a single tank's display bar.
     *
     * @param {number} index
     * @param {object} [options]
     * @returns {MultiFluidBar} `this` for chaining.
     */
    displayOne(index, options) {
        const { displaySlot } = this._descs[index];
        if (displaySlot >= 0) this.get(index).display(displaySlot, options ?? {});
        return this;
    }

    // ── Lookup helpers ────────────────────────────────────────────────────────

    /**
     * Returns the first tank whose current fluid type matches `type`.
     * Returns `null` if none match.
     *
     * @param {string} type
     * @returns {FluidManager | null}
     */
    findByType(type) {
        return this.tanks.find(t => t.getType() === type) ?? null;
    }

    /**
     * Returns the index of the first tank whose fluid type matches `type`.
     * Returns -1 if none match.
     *
     * @param {string} type
     * @returns {number}
     */
    indexOfType(type) {
        return this.tanks.findIndex(t => t.getType() === type);
    }

    /**
     * Returns the first tank that is empty (type === 'empty') and has free
     * space, or null if all tanks are occupied / full.
     *
     * @returns {FluidManager | null}
     */
    findEmpty() {
        return this.tanks.find(t => t.getType() === 'empty' && t.getCap() > 0) ?? null;
    }

    /**
     * Returns true if every managed tank is empty.
     */
    allEmpty() {
        return this.tanks.every(t => t.getType() === 'empty');
    }

    /**
     * Returns true if every managed tank is full (stored >= cap).
     */
    allFull() {
        return this.tanks.every(t => t.isFull());
    }

    // ── Bulk operations ───────────────────────────────────────────────────────

    /**
     * Attempts to insert `amount` mB of `type` into the first tank that
     * can accept it (matching type or currently empty).
     * Returns the amount actually inserted (0 if no tank could accept it).
     *
     * @param {string} type
     * @param {number} amount
     * @returns {number}
     */
    insert(type, amount) {
        for (const tank of this.tanks) {
            const tankType = tank.getType();
            if (tankType !== 'empty' && tankType !== type) continue;
            const free = tank.getFreeSpace();
            if (free <= 0) continue;
            const toAdd = Math.min(amount, free);
            if (tank.getType() === 'empty') tank.setType(type);
            tank.add(toAdd);
            return toAdd;
        }
        return 0;
    }

    /**
     * Drains `amount` mB of `type` from the first matching tank.
     * Returns the amount actually drained (0 if type not found or insufficient).
     *
     * @param {string} type
     * @param {number} amount
     * @returns {number}
     */
    drain(type, amount) {
        const tank = this.findByType(type);
        if (!tank) return 0;
        if (tank.get() < amount) return 0;
        tank.consume(amount);
        if (tank.get() <= 0) tank.setType('empty');
        return amount;
    }

    /**
     * Returns a snapshot array describing every tank's current state.
     * Useful for HUD building or recipe matching.
     *
     * @returns {Array<{ index: number, type: string, stored: number, cap: number, free: number }>}
     */
    snapshot() {
        return this.tanks.map((t, i) => ({
            index:  i,
            type:   t.getType(),
            stored: t.get(),
            cap:    t.getCap(),
            free:   t.getFreeSpace(),
        }));
    }

    // ── Slot blocking helper ──────────────────────────────────────────────────

    /**
     * Returns an array of all display slots defined in the descriptors,
     * suitable for passing directly to `machine.blockSlots([...])`.
     * Slots with displaySlot < 0 are excluded.
     *
     * @returns {number[]}
     */
    get displaySlots() {
        return this._descs
            .map(d => d.displaySlot)
            .filter(s => s >= 0);
    }
}
