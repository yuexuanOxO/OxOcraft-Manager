export function closeFirstAvailableLayer(layers) {
    for (const layer of layers) {
        if (!layer || typeof layer.isOpen !== "function") {
            continue;
        }

        if (!layer.isOpen()) {
            continue;
        }

        if (typeof layer.close === "function") {
            layer.close();
        }

        return true;
    }

    return false;
}


export function isFlatpickrOpen(...pickers) {
    return pickers.some(picker => picker?.isOpen);
}


export function closeFlatpickr(...pickers) {
    pickers.forEach(picker => {
        picker?.close?.();
    });
}