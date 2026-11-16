let initialized = false;
let online = false;
let generation = 0;
let timer = null;
let controller = null;

function render(data = {}, enabled = false) {
    const container = document.getElementById("serverResources");
    if (!container) return;
    container.classList.toggle("is-disabled", !enabled);
    container.setAttribute("aria-disabled", String(!enabled));
    const cpu = document.getElementById("serverCpuUsage");
    const memory = document.getElementById("serverMemoryUsage");
    const valid = value => typeof value === "number" && Number.isFinite(value);
    if (cpu) cpu.textContent = enabled && valid(data.cpu_percent)
        ? `${data.cpu_percent.toFixed(1)}%` : "--";
    if (memory) {
        const available = enabled && valid(data.heap_used_bytes)
            && valid(data.heap_max_bytes) && valid(data.heap_percent);
        memory.textContent = available
            ? `${formatBytes(data.heap_used_bytes)}/${formatBytes(data.heap_max_bytes)} (${data.heap_percent.toFixed(1)}%)`
            : "--";
    }
}

export function formatBytes(bytes) {
    return bytes >= 1024 ** 3
        ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
        : `${Math.round(bytes / 1024 ** 2)} MB`;
}

async function poll(epoch) {
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 5000);
    try {
        const response = await fetch("/api/server/resources", {
            cache: "no-store", signal: request.signal
        });
        if (!response.ok) throw new Error("無法讀取資源資訊");
        const data = await response.json();
        if (epoch !== generation || !online) return;
        render(data, data.active === true);
    } catch (error) {
        if (epoch === generation && online) render({}, true);
    } finally {
        clearTimeout(timeout);
        if (controller === request) controller = null;
        if (epoch === generation && online) {
            timer = setTimeout(() => poll(epoch), 2000);
        }
    }
}

function applyStatus(data) {
    const next = data?.state === "ready" && data?.online === true;
    if (next === online) return;
    online = next;
    generation += 1;
    clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
    render({}, online);
    if (online) poll(generation);
}

export function initServerResources() {
    if (initialized) return;
    initialized = true;
    render();
    window.addEventListener("server-status-changed", event => applyStatus(event.detail));
    window.addEventListener("pagehide", () => applyStatus({ state: "offline" }));
}
