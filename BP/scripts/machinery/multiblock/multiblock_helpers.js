export function tickGate(entity, key, interval) {
    const safeInterval = Math.max(1, Math.floor(interval ?? 1));
    const prop = `ac:tick_gate:${key}`;
    const next = ((entity.getDynamicProperty(prop) ?? 0) + 1) % safeInterval;
    entity.setDynamicProperty(prop, next);
    return next === 0;
}

export function formatFluidDisplayName(type) {
    if (!type || type === "empty") return "Empty";
    return type
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}
