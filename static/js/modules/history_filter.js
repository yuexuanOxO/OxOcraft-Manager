export function parseHistoryDate(value) {
    if (!value) return null;

    const text = String(value).trim();

    const date = new Date(text.replace(" ", "T"));

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

export function filterRowsByDateRange(rows, options = {}) {
    const getDate = options.getDate || (item => item.created_at);
    const start = parseHistoryDate(options.start);
    const end = parseHistoryDate(options.end);

    if (!start && !end) {
        return rows;
    }

    return rows.filter(item => {
        const itemDate = parseHistoryDate(getDate(item));

        if (!itemDate) return false;
        if (start && itemDate < start) return false;
        if (end && itemDate > end) return false;

        return true;
    });
}

export function setActiveHistoryTimeRange(
    menu,
    range = ""
) {
    if (!menu) return;

    const activeRange =
        String(range || "").trim();

    menu
        .querySelectorAll(
            "button[data-time-range]"
        )
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.timeRange === activeRange
            );
        });
}