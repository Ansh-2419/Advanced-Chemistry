import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const machines = [
  {
    name: "Chemical Reactor",
    size: 22,
    block: "BP/blocks/machine/tier_1/chemical_reactor.json",
    source: "BP/scripts/machinery/singleblock/chemical_reactor.js",
    ui: "RP/ui/chemical_reactor.json",
    roles: [[0], [1], [2], [3], [4, 5, 6], [7], [8, 9], range(10, 15), range(16, 21)],
    upgrades: [8, 9],
    buttons: { IO_ITEM_SLOTS: [10, 15], IO_FLUID_SLOTS: [16, 21] },
  },
  {
    name: "Fermenter",
    size: 24,
    block: "BP/blocks/machine/tier_1/fermenter.json",
    source: "BP/scripts/machinery/singleblock/liquifier.js",
    ui: "RP/ui/fermenter.json",
    roles: [[0], [1], [2], range(3, 6), [7, 8], [9], [10], [11], range(12, 17), range(18, 23)],
    upgrades: [7, 8],
    buttons: { IO_ITEM_SLOTS: [12, 17], IO_FLUID_SLOTS: [18, 23] },
  },
  {
    name: "Fuel Mixer",
    size: 16,
    block: "BP/blocks/machine/tier_1/fuel_mixer.json",
    source: "BP/scripts/machinery/singleblock/fuel_mixer.js",
    ui: "RP/ui/fuel_mixer.json",
    roles: [[0], [1], [2], [3, 4], [5, 6], [7, 8, 9], range(10, 15)],
    upgrades: [3, 4],
    buttons: { IO_FLUID_SLOTS: [10, 15] },
  },
  {
    name: "Polymerizer",
    size: 19,
    block: "BP/blocks/machine/tier_1/polymerizer.json",
    source: "BP/scripts/machinery/singleblock/polymerizer.js",
    ui: "RP/ui/polymerizer.json",
    roles: [[0], [1], [2], [3], [4], [5, 6], range(7, 12), range(13, 18)],
    upgrades: [5, 6],
    buttons: { IO_ITEM_SLOTS: [7, 12], IO_FLUID_SLOTS: [13, 18] },
  },
  {
    name: "Separator",
    size: 15,
    block: "BP/blocks/machine/tier_1/separator.json",
    source: "BP/scripts/machinery/singleblock/separator.js",
    ui: "RP/ui/separator.json",
    roles: [[0], [1], [2], [3], [4, 5, 6], [7, 8], range(9, 14)],
    upgrades: [7, 8],
    buttons: { IO_FLUID_SLOTS: [9, 14] },
  },
  {
    name: "Industrial Crusher",
    size: 27,
    block: "BP/blocks/machine/industrial_crusher.json",
    source: "BP/scripts/machinery/singleblock/industrial_crusher.js",
    ui: "RP/ui/industrial_crusher.json",
    roles: [[0], [1], [2], range(3, 6), range(7, 15), [16, 17, 18], [19, 20], range(21, 26)],
    upgrades: [19, 20],
    buttons: { IO_SLOTS: [21, 26] },
  },
  {
    name: "Industrial Furnator",
    size: 10,
    block: "BP/blocks/machine/gen/industrial_furnator.json",
    roles: [[0], [1], [2], [3], range(4, 9)],
    requiredTag: "tag:utilitycraft:io.furnator",
  },
  {
    name: "Industrial Magmator",
    size: 9,
    block: "BP/blocks/machine/gen/industrial_magmator.json",
    roles: [[0], [1], [2], range(3, 8)],
    requiredTag: "tag:utilitycraft:io.magmator",
  },
  {
    name: "Industrial Thermo Generator",
    size: 9,
    block: "BP/blocks/machine/gen/industrial_thermo_generator.json",
    roles: [[0], [1], [2], range(3, 8)],
    requiredTag: "tag:utilitycraft:io.thermo_generator",
  },
  {
    name: "Industrial Solar Panel",
    size: 2,
    block: "BP/blocks/machine/gen/industrial_solar_panel.json",
    roles: [[0], [1]],
  },
  {
    name: "Industrial Wind Turbine",
    size: 2,
    block: "BP/blocks/machine/gen/industrial_wind_turbine.json",
    roles: [[0], [1]],
  },
  {
    name: "Refinery",
    size: 7,
    source: "BP/scripts/machinery/multiblock/refinery_monitor.js",
    ui: "RP/ui/refinery.json",
    roles: [[0], [1], [2], [3], [4, 5, 6]],
  },
  {
    name: "Fuel Burner",
    size: 3,
    source: "BP/scripts/machinery/multiblock/fuel_burner_monitor.js",
    ui: "RP/ui/fuel_burner.json",
    roles: [[0], [1], [2]],
  },
  {
    name: "Fluid Storage",
    size: 8,
    source: "BP/scripts/machinery/multiblock/fluid_storage_monitor.js",
    ui: "RP/ui/fluid_storage_monitor.json",
    roles: [range(0, 6), [7]],
  },
];

for (const machine of machines) {
  const assigned = machine.roles.flat().sort((a, b) => a - b);
  assertEqual(assigned, range(0, machine.size - 1), `${machine.name}: ghost, duplicated, or missing role slot`);

  const source = machine.source ? read(machine.source) : "";
  if (machine.block) {
    const block = JSON.parse(read(machine.block));
    const sizes = collectProperty(block, "inventory_size");
    if (!sizes.includes(machine.size)) fail(`${machine.name}: block inventory size is not ${machine.size}`);
    if (machine.upgrades) {
      const runtimeUpgrades = collectValues(block, "upgrades").find(Array.isArray) ?? [];
      assertEqual(runtimeUpgrades, machine.upgrades, `${machine.name}: runtime upgrade slots do not match the layout`);
      const upgradeDefinitions = collectValues(block, "utilitycraft:machine_upgrades").find(Array.isArray) ?? [];
      assertEqual(upgradeDefinitions.map(({ slot }) => slot), machine.upgrades, `${machine.name}: installable upgrade slots do not match the layout`);
    }
    if (machine.requiredTag && collectValues(block, machine.requiredTag).length === 0) {
      fail(`${machine.name}: missing ${machine.requiredTag} required by UtilityCraft's current IO registration`);
    }
  } else {
    const match = source.match(/inventory_size\s*:\s*(\d+)/);
    if (Number(match?.[1]) !== machine.size) fail(`${machine.name}: controller inventory size is not ${machine.size}`);
  }

  for (const [constant, expected] of Object.entries(machine.buttons ?? {})) {
    const match = source.match(new RegExp(`const\\s+${constant}\\s*=\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]`));
    assertEqual(match ? [Number(match[1]), Number(match[2])] : [], expected, `${machine.name}: ${constant} does not match its UI range`);
  }

  if (machine.ui) {
    const ui = JSON.parse(read(machine.ui));
    const uiIndices = collectUiIndices(ui);
    for (const index of uiIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= machine.size) {
        fail(`${machine.name}: UI references out-of-range slot ${index}`);
      }
    }
    if (!read(machine.ui).includes("info_tab@uc.info_tab")) {
      fail(`${machine.name}: missing info tab`);
    }
  }
}

console.log(`Verified ${machines.length} machine layouts: every inventory slot has one role, IO button ranges fit, and local machine UIs have info tabs.`);

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function collectProperty(value, key, result = []) {
  if (!value || typeof value !== "object") return result;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key && typeof entryValue === "number") result.push(entryValue);
    collectProperty(entryValue, key, result);
  }
  return result;
}

function collectValues(value, key, result = []) {
  if (!value || typeof value !== "object") return result;
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (entryKey === key) result.push(entryValue);
    collectValues(entryValue, key, result);
  }
  return result;
}

function collectUiIndices(value, result = []) {
  if (!value || typeof value !== "object") return result;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && (key === "collection_index" || key.includes("collection_index") || /^\$io_.+_index$/.test(key) || /^\$upgrade_index_\d+$/.test(key))) {
      result.push(entry);
    }
    collectUiIndices(entry, result);
  }
  return result;
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${message}; got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function fail(message) {
  throw new Error(message);
}
