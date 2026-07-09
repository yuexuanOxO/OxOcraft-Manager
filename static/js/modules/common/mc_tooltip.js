// minecraft風格的提示小視窗，黑紫配色

let tooltip = null;
let showTimer = null;
let initialized = false;
let activeTarget = null;
let lastMouseEvent = null;

function removeTooltip() {
    if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
    }

    if (tooltip) {
        tooltip.remove();
        tooltip = null;
    }

    activeTarget = null;
    lastMouseEvent = null;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function moveTooltip(event) {
    if (!tooltip || !event) return;

    const padding = 12;
    const offsetX = 14;
    const offsetY = 2;

    const rect = tooltip.getBoundingClientRect();

    let left = event.clientX + offsetX;
    let top = event.clientY - rect.height - offsetY;

    if (left + rect.width > window.innerWidth - padding) {
        left = event.clientX - rect.width - offsetX;
    }

    if (top < padding) {
        top = event.clientY + offsetY;
    }

    tooltip.style.left = `${Math.max(padding, left)}px`;
    tooltip.style.top = `${Math.max(padding, top)}px`;
}

function showTooltip(target, event) {
    const text = target.dataset.mcTooltip;
    if (!text) return;

    tooltip = document.createElement("div");
    tooltip.className = "mc-tooltip";

    tooltip.innerHTML = `
        <div class="mc-tooltip-border">
            <div class="mc-tooltip-content">
                ${escapeHtml(text)}
            </div>
        </div>
    `;

    document.body.appendChild(tooltip);

    lastMouseEvent = event;

    requestAnimationFrame(() => {
        moveTooltip(lastMouseEvent);
    });
}

export function initMinecraftTooltip() {
    if (initialized) return;
    initialized = true;

    document.addEventListener("mouseover", (event) => {
        const target = event.target.closest("[data-mc-tooltip]");
        if (!target) return;

        if (activeTarget === target) {
            return;
        }

        removeTooltip();

        activeTarget = target;
        lastMouseEvent = event;

        showTimer = setTimeout(() => {
            showTooltip(target, lastMouseEvent);
        }, 120);
    });

    document.addEventListener("mousemove", (event) => {
        const target = event.target.closest("[data-mc-tooltip]");
        if (!target || target !== activeTarget) return;

        lastMouseEvent = event;
        moveTooltip(event);
    });

    document.addEventListener("mouseout", (event) => {
        const target = event.target.closest("[data-mc-tooltip]");
        if (!target || target !== activeTarget) return;

        const nextTarget = event.relatedTarget;

        if (nextTarget && target.contains(nextTarget)) {
            return;
        }

        removeTooltip();
    });

    window.addEventListener("scroll", removeTooltip, true);
}