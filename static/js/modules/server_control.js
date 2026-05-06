import {
    updateStatus,
    updateStatusForce
} from "./server_status.js";

import {
    saveServerSettings,
    updateServerSettingsFooterMode
} from "./server_settings.js";


let isTransitioning = false;

export function initServerControl() {
    const powerBtn = document.getElementById("powerBtn");
    if (powerBtn) {
        powerBtn.addEventListener("click", toggleServer);
    }

    setupEulaModal();
    checkEulaStatus();
    setupServerInitModal();
    checkFirstRunGuide();
}

async function toggleServer() {
    const powerBtn = document.getElementById("powerBtn");

    if (isTransitioning || (powerBtn && powerBtn.disabled)) {
        return;
    }

    try {
        const statusRes = await fetch("/api/server/query-status", { cache: "no-store" });
        const statusPayload = await statusRes.json();
        const statusData = statusPayload.data || statusPayload;

        let url = "";
        let targetOnline = false;
        let actionText = "";
        let setupStage = "";

        if (statusData.online) {

            const ok = confirm("你是否要關閉伺服器？");

            if (!ok) {
                return;
            }

            url = "/api/server/stop";
            targetOnline = false;
            actionText = "關閉中...";
        } else {
            const setupStatus = await getServerSetupStatus();
            setupStage = setupStatus.stage;

            const eulaOk = await ensureEulaAcceptedBeforeStart();
            if (!eulaOk) {
                return;
            }

            url = "/api/server/start";
            targetOnline = true;
            actionText = "啟動中...";
        }

        isTransitioning = true;
        setPowerButtonLoading(true, actionText);

        const response = await fetch(url, {
            method: "POST"
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "操作失敗");
            isTransitioning = false;
            setPowerButtonLoading(false);
            updateStatus();
            return;
        }

        let reachedTarget = false;

        if (targetOnline && setupStage === "need_first_run") {
            reachedTarget = await waitForFirstRunFilesGenerated(30000, 1000);
        } else {
            reachedTarget = await waitForServerStatus(targetOnline, 30000, 1000);
        }

        isTransitioning = false;
        setPowerButtonLoading(false);

        await updateStatusForce();

        if (!reachedTarget) {
            alert(targetOnline ? "伺服器啟動逾時，請查看 log。" : "伺服器關閉逾時，請查看 log。");
        } else if (targetOnline && setupStage === "need_first_run") {
            await fetch("/api/server/sync-rcon", {
                method: "POST"
            });

            alert("伺服器必要檔案已產生，RCON 設定已同步。請同意 Minecraft EULA 後再啟動伺服器。");
            await checkEulaStatus();
        }

    } catch (error) {
        console.error("切換 server 失敗:", error);
        isTransitioning = false;
        setPowerButtonLoading(false);
        updateStatus();
    }
}


export function setPowerButtonLoading(isLoading, actionText = "") {
    const powerBtn = document.getElementById("powerBtn");
    const statusText = document.getElementById("statusText");

    if (!powerBtn || !statusText) return;

    if (isLoading) {
        powerBtn.disabled = true;
        powerBtn.classList.add("loading");

        const statusLight = document.getElementById("statusLight");

        if (statusLight) {
            statusLight.classList.remove("online", "offline");
            statusLight.classList.add("starting");
        }

        if (actionText) {
            statusText.textContent = actionText;
        }
    } else {
        powerBtn.disabled = false;
        powerBtn.classList.remove("loading");
    }
}


export async function waitForServerStatus(targetOnline, timeoutMs = 30000, intervalMs = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/api/server/query-status?force=1", {cache: "no-store"});
            const payload = await response.json();

            const data = payload.data || payload;

            if (data.online === targetOnline) {
                return true;
            }
        } catch (error) {
            console.error("等待 server 狀態時發生錯誤:", error);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}


async function checkEulaStatus() {
    try {
        const response = await fetch("/api/server/setup-status", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) {
            console.error("讀取 setup-status 失敗");
            return;
        }

        // 只有需要同意 EULA 時才顯示
        if (data.stage === "need_accept_eula") {

            const eulaRes = await fetch("/api/eula/status", {
                cache: "no-store"
            });

            const eulaData = await eulaRes.json();

            if (eulaData.success) {
                showEulaModal(eulaData);
            }
        }

    } catch (error) {
        console.error("檢查 EULA 失敗:", error);
    }
}


function showEulaModal(data) {
    const modal = document.getElementById("eulaModal");
    const message = document.getElementById("eulaMessage");
    const link = document.getElementById("eulaLink");
    const date = document.getElementById("eulaDate");

    if (!modal) return;

    if (message) {
        message.textContent = data.message_zh || "你必須同意 Minecraft EULA 才能繼續使用伺服器。";
    }

    if (link) {
        link.href = data.url || "https://aka.ms/MinecraftEULA";
        link.textContent = data.url || "https://aka.ms/MinecraftEULA";
    }

    if (date) {
        date.textContent = data.date ? `檔案建立時間：${data.date}` : "";
    }

    modal.classList.remove("hidden");
}


function showServerInitModal() {
    const modal = document.getElementById("serverInitModal");
    if (modal) {
        modal.classList.remove("hidden");
    }
}


function hideServerInitModal() {
    const modal = document.getElementById("serverInitModal");
    if (modal) {
        modal.classList.add("hidden");
    }
}


function setupServerInitModal() {
    const btn = document.getElementById("serverInitBtn");

    if (!btn) return;

    btn.addEventListener("click", async () => {
        hideServerInitModal();
        await toggleServer();
    });
}


function setupEulaModal() {
    const acceptBtn = document.getElementById("eulaAcceptBtn");
    const declineBtn = document.getElementById("eulaDeclineBtn");
    const modal = document.getElementById("eulaModal");

    if (acceptBtn) {
        acceptBtn.addEventListener("click", async () => {
            try {
                const response = await fetch("/api/eula/accept", {
                    method: "POST"
                });

                const data = await response.json();

                if (!data.success) {
                    alert(data.message || "同意 EULA 失敗");
                    return;
                }

                if (modal) {
                    modal.classList.add("hidden");
                }

                alert("已同意 EULA，可以繼續使用。");

            } catch (error) {
                console.error("同意 EULA 失敗:", error);
                alert("同意 EULA 失敗");
            }
        });
    }

    if (declineBtn) {
        declineBtn.addEventListener("click", async () => {
            try {
                await fetch("/api/app/shutdown", {
                    method: "POST"
                });
            } catch (error) {
                console.error("關閉 OxOcraft-Manager 失敗:", error);
            }

            const panel = document.querySelector(".eula-panel");
            if (panel) {
                panel.innerHTML = `
                    <div class="eula-title">OxOcraft-Manager 已關閉</div>
                    <div class="eula-message eula-closed-message">
                        未同意 Minecraft EULA，無法繼續使用管理介面。<br>
                        請手動關閉此瀏覽器分頁。
                    </div>
                `;
            }
        });
    }
}


async function ensureEulaAcceptedBeforeStart() {
    try {
        const response = await fetch("/api/server/setup-status", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) {
            alert("檢查伺服器狀態失敗");
            return false;
        }

        if (data.stage === "ready") {
            return true;
        }

        if (data.stage === "need_first_run") {
            return true;
        }

        if (data.stage === "need_accept_eula") {
            const eulaRes = await fetch("/api/eula/status", {
                cache: "no-store"
            });

            const eulaData = await eulaRes.json();

            if (eulaData.success) {
                showEulaModal(eulaData);
            }

            alert("請先同意 Minecraft EULA 後再啟動伺服器。");
            return false;
        }

        if (data.stage === "missing_server_jar") {
            alert(data.message);
            return false;
        }

        alert(data.message || "目前無法啟動伺服器");
        return false;

    } catch (error) {
        console.error("檢查啟動條件失敗:", error);
        alert("檢查啟動條件失敗");
        return false;
    }
}


async function getServerSetupStatus() {
    const response = await fetch("/api/server/setup-status", {
        cache: "no-store"
    });

    return await response.json();
}


async function waitForFirstRunFilesGenerated(timeoutMs = 30000, intervalMs = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/api/server/setup-status", {
                cache: "no-store"
            });

            const data = await response.json();

            if (
                data.eula_exists ||
                data.server_properties_exists ||
                data.stage === "need_accept_eula"
            ) {
                return true;
            }

        } catch (error) {
            console.error("等待初次啟動檔案產生時發生錯誤:", error);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}


async function checkFirstRunGuide() {
    try {
        const data = await getServerSetupStatus();

        if (data.stage === "need_first_run") {
            showServerInitModal();
        }

    } catch (error) {
        console.error(error);
    }
}


export async function saveAndRestartServer() {
    const ok = confirm("若要變動立即生效，須重啟伺服器。\n請問是否要重啟伺服器？");

    if (!ok) {
        return;
    }

    const restartBtn = document.getElementById("serverSettingsRestartBtn");
    const applyBtn = document.getElementById("serverSettingsApplyBtn");

    if (restartBtn) {
        restartBtn.disabled = true;
        restartBtn.textContent = "重啟中...";
    }

    if (applyBtn) {
        applyBtn.disabled = true;
    }

    try {
        const saved = await saveServerSettings(false);
        if (!saved) return;

        setPowerButtonLoading(true, "關閉中...");

        let response = await fetch("/api/server/stop", {
            method: "POST"
        });

        let data = await response.json();

        if (!data.success) {
            alert(data.message || "關閉伺服器失敗");
            return;
        }

        const stopped = await waitForServerStatus(false, 30000, 1000);
        if (!stopped) {
            alert("伺服器關閉逾時，請查看 log。");
            return;
        }

        setPowerButtonLoading(true, "啟動中...");

        response = await fetch("/api/server/start", {
            method: "POST"
        });

        data = await response.json();

        if (!data.success) {
            alert(data.message || "啟動伺服器失敗");
            return;
        }

        const started = await waitForServerStatus(true, 30000, 1000);

        await updateStatus();

        if (started) {
            alert("設定已套用，伺服器已重啟。");
        } else {
            alert("伺服器啟動逾時，請查看 log。");
        }

    } catch (error) {
        console.error("套用並重啟失敗:", error);
        alert("套用並重啟失敗，請查看 console。");

    } finally {
        if (restartBtn) {
            restartBtn.disabled = false;
            restartBtn.textContent = "套用後並重啟";
        }

        if (applyBtn) {
            applyBtn.disabled = false;
        }

        await updateServerSettingsFooterMode();
        setPowerButtonLoading(false);
    }
}