// @ts-check

/** @type {import("./dependencies/index.js").AddonMetadata} */
export const ADDON_METADATA = {
  name: "Advanced Chemistry",
  author: "Dorios Studios",
  identifier: "advanced_chemistry",
  version: "0.1.0",
  dependencies: {
    utilitycraft: {
      name: "UtilityCraft",
      version: "3.5.0",
      warning: "Advanced Chemistry requires UtilityCraft 3.5.0 or newer.",
    },
  },
};

/** @type {import("./dependencies/index.js").InitializeOptions} */
export const DEPENDENCY_OPTIONS = {
  validationDelayTicks: 300,
  announceSuccess: true,
};
