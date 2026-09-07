# Changelog

## 0.3.1 (Upcoming)

### CHANGED

- Regenerated all 41 block renders with the vanilla preset and refreshed the in-game guide images, including the missing Industrial Crusher icon.

- Moved the Greenhouse information tab to the top right using the Storage Drive layout, with an extended scrolling panel and machine information in English and Spanish. Added a separate close button inside the main panel’s top-right corner.

- Centered the Greenhouse seed grid vertically and moved the soil slot beneath the progress arrow, clearing the Inventory label; lowered the arrow by eight pixels to refine its visual alignment.

- Unified the Greenhouse seed inputs into the Reaction Chamber-style 2×2 grid with a single surrounding outline.

- Replaced the Greenhouse interface with the Auto Sieve extended main panel and status side panel, without recipe-book controls. The layout now groups two liquid bars, four seed inputs, a larger centered soil slot, a horizontal progress indicator, and nine output slots while retaining energy and machine information.

### FIXED

- Initialized the Greenhouse progress arrow for new controllers and restored it when missing on existing controllers, including while idle, without resetting accumulated progress.

- Added Greenhouse UI, controller block, and multiblock entity display names in English and both supported Spanish locales so the machine title no longer shows its localization key.
