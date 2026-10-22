const nativeFetch = window.fetch.bind(window);
const NativeEventSource = window.EventSource;
const sources = new Set();
const token = Array.from(crypto.getRandomValues(new Uint8Array(32)),
    value => value.toString(16).padStart(2, "0")).join("");
const LEASE_HEADER = "X-OxO-UI-Lease";
let granted = false;
let leaving = false;
let lost = false;
let heartbeatTimer = null;
let heartbeatRunning = false;
let lastHeartbeat = 0;
let leaseMs = 90000;


function stopConnections() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    sources.forEach(source => source.close());
    sources.clear();
}


function loseSession() {
    if (lost || leaving) return;
    lost = true;
    granted = false;
    stopConnections();
    window.location.replace("/single-tab");
}


function releaseSession() {
    if (leaving) return;
    leaving = true;
    stopConnections();
    const body = JSON.stringify({ token });
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon("/api/ui-session/release", blob)) {
        nativeFetch("/api/ui-session/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
        }).catch(() => {});
    }
}


export function getUiSessionUrl(input) {
    const url = new URL(input, window.location.href);
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        url.searchParams.set("ui_lease", token);
    }
    return url.href;
}


function installTransports() {
    window.fetch = async (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : input,
            window.location.href);
        if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
            return nativeFetch(input, init);
        }
        if (lost || leaving || !granted) return new Promise(() => {});

        const headers = new Headers(init.headers ??
            (input instanceof Request ? input.headers : undefined));
        headers.set(LEASE_HEADER, token);
        const response = await nativeFetch(input, { ...init, headers });
        if (response.status === 409) {
            const data = await response.clone().json().catch(() => null);
            if (data?.error_code === "ui_session_required") {
                loseSession();
                // 即將離開，避免舊 UI 的 catch 又觸發重載或彈窗。
                return new Promise(() => {});
            }
        }
        return response;
    };

    window.EventSource = class extends NativeEventSource {
        constructor(url, options) {
            super(getUiSessionUrl(url), options);
            sources.add(this);
        }

        close() {
            sources.delete(this);
            super.close();
        }
    };
}


async function heartbeat() {
    if (heartbeatRunning || !granted || lost || leaving) return;
    heartbeatRunning = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await nativeFetch("/api/ui-session/heartbeat", {
            method: "POST",
            headers: { [LEASE_HEADER]: token },
            cache: "no-store",
            signal: controller.signal,
        });
        if (response.status === 409) {
            loseSession();
        } else if (response.ok) {
            lastHeartbeat = performance.now();
        }
    } catch {
        // 暫時斷線仍由原本的後端斷線畫面處理。
    } finally {
        clearTimeout(timer);
        heartbeatRunning = false;
        if (performance.now() - lastHeartbeat >= leaseMs) loseSession();
    }
}


function showGate(message) {
    document.querySelector("#uiSessionGateMessage").textContent = message;
    document.querySelector("#uiSessionRetryBtn").hidden = false;
}


async function bootstrap() {
    document.querySelector("#uiSessionRetryBtn")?.addEventListener("click", () => {
        window.location.reload();
    });
    window.addEventListener("pagehide", releaseSession);
    window.addEventListener("pageshow", event => {
        if (event.persisted) window.location.reload();
    });

    try {
        // 重新整理時，給上一份文件的 release 少量時間抵達後端。
        let response;
        for (let attempt = 0; attempt < 4; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            try {
                response = await nativeFetch("/api/ui-session/acquire", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ token }),
                    cache: "no-store",
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timer);
            }
            if (response.status !== 409 || attempt === 3 || leaving) break;
            await new Promise(resolve => setTimeout(resolve, 400));
        }
        if (leaving) return;
        if (response.status === 409) {
            loseSession();
            return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (!result.success) throw new Error("無法取得分頁操作權");

        granted = true;
        leaseMs = result.lease_seconds * 1000;
        lastHeartbeat = performance.now();
        installTransports();
        heartbeatTimer = setInterval(heartbeat, 15000);
        window.addEventListener("focus", heartbeat);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) heartbeat();
        });

        const { initApp } = await import("../main.js");
        if (leaving || lost) return;
        initApp();
        document.body.classList.remove("ui-session-pending");
        document.querySelector("#uiSessionGate").remove();
    } catch (error) {
        console.error("初始化分頁操作權失敗:", error);
        // 包括 acquire 回應遺失的情況，也釋放本份文件的憑證。
        stopConnections();
        granted = false;
        nativeFetch("/api/ui-session/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            keepalive: true,
        }).catch(() => {});
        showGate("無法載入管理介面，請確認 OxOcraft-Manager 仍在執行，再重新檢查。");
    }
}


if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
    bootstrap();
}
