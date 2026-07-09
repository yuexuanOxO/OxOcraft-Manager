export function initFilterMenu({
    button,
    menu,
    filters,
    onChange,
    onToggle,
}) {
    if (!button || !menu || !filters) {
        return;
    }

    button.addEventListener("click", (event) => {
        event.stopPropagation();

        onToggle?.();

        menu.classList.toggle("hidden");
    });

    menu.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    menu
        .querySelectorAll("button[data-filter]")
        .forEach((filterBtn) => {
            filterBtn.addEventListener("click", () => {
                const filter = filterBtn.dataset.filter || "";

                if (!filter) return;

                if (filter === "clear") {
                    filters.clear();

                    menu
                        .querySelectorAll("button[data-filter]")
                        .forEach(btn => {
                            btn.classList.remove("active");
                        });

                    onChange?.();
                    return;
                }

                if (filters.has(filter)) {
                    filters.delete(filter);
                    filterBtn.classList.remove("active");
                } else {
                    filters.add(filter);
                    filterBtn.classList.add("active");
                }

                onChange?.();
            });
        });
}

export function isFilterMenuOpen(menu) {
    return menu && !menu.classList.contains("hidden");
}

export function closeFilterMenu(menu) {
    menu?.classList.add("hidden");
}