import { initDeathBook } from "./modules/death_book.js";
import { initFeatureCards } from "./modules/feature_cards.js";

import {
    initServerStatus,
    updateStatus,
    updateStatusForce,
    applyServerStatusPayload,
    addPlayerFromLog,
    removePlayerFromLog,
    clearPlayersList
} from "./modules/server_status.js";

import {
    initLogConsole,
    appendLogLine,
    clearLogBox,
    scrollLogToBottom
} from "./modules/log_console.js";

import {
    initServerSettings
} from "./modules/server_settings.js";


import {
    initBackup,
    renderBackupProgress,
    setBackupRunning,
    prependBackupRecord,
    updateBackupRecordItem,
    loadBackupRecords,
    loadBackupConfig,
    fadeOutAndHide,
    isBackupEndStatus,
    formatBytes,
    cancelManualBackup
} from "./modules/backup.js";

import {
    initCloudBackup,
    renderCloudUploadProgress,
    setCloudUploadRunning,
} from "./modules/cloud_backup.js";


import {
    initAutoBackup,
    loadAutoBackupConfig,
    handleAutoBackupMissed
} from "./modules/auto_backup.js";


let isTransitioning = false;
let serverEvents = null;
let commandHistory = [];
let commandHistoryIndex = -1;

let currentPlayers = new Set();








function setupServerEvents() {
    if (serverEvents !== null) {
        return;
    }

    serverEvents = new EventSource("/api/events");

    serverEvents.addEventListener("server_status_changed", (event) => {
        const payload = JSON.parse(event.data);
        applyServerStatusPayload(payload);
    });

    serverEvents.onerror = () => {
        console.warn("SSE 暫時中斷，檢查後端連線...");

        setTimeout(async () => {
            try {
                const response = await fetch("/api/server/query-status", {
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error("後端回應異常");
                }

            } catch (error) {
                handleBackendDisconnected();
            }
        }, 1500);
    };

    serverEvents.addEventListener("log_append", (event) => {
        const payload = JSON.parse(event.data);
        const line = payload.line || "";

        appendLogLine(line);

        const joinMatch = line.match(/\]:\s*(.+?) joined the game$/);
        const leftMatch = line.match(/\]:\s*(.+?) left the game$/);

        if (joinMatch) {
            addPlayerFromLog(joinMatch[1]);
            setTimeout(updateStatusForce, 3000); // 延後用 Query 校正
        }

        if (leftMatch) {
            removePlayerFromLog(leftMatch[1]);
            setTimeout(updateStatusForce, 3000); // 延後用 Query 校正
        }

    });

    serverEvents.addEventListener("log_clear", () => {
        clearLogBox();
    });

    serverEvents.addEventListener("backup_started", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(true);
    });

    serverEvents.addEventListener("backup_progress", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
    });

    serverEvents.addEventListener("backup_finished", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_failed", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_canceled", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_record_added", (event) => {
        const record = JSON.parse(event.data);
        prependBackupRecord(record);
    });

    serverEvents.addEventListener("cloud_upload_started", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(true);
    });

    serverEvents.addEventListener("cloud_upload_progress", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
    });

    serverEvents.addEventListener("cloud_upload_finished", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(false);

        const btn = document.getElementById("cloudUploadLatestBtn");
        if (btn) btn.disabled = false;
    });

    serverEvents.addEventListener("cloud_upload_failed", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(false);

        const btn = document.getElementById("cloudUploadLatestBtn");
        if (btn) btn.disabled = false;
    });

    serverEvents.addEventListener("backup_record_updated", (event) => {
        const record = JSON.parse(event.data);
        updateBackupRecordItem(record);
    });

    serverEvents.addEventListener("cloud_upload_canceled", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(false);
    });

    serverEvents.addEventListener("auto_backup_started", (event) => {
        const data = JSON.parse(event.data);

        isTransitioning = true;
        setPowerButtonLoading(true, data.message || "自動備份進行中");
    });

    serverEvents.addEventListener("auto_backup_finished", async (event) => {
        isTransitioning = false;
        setPowerButtonLoading(false);

        await updateStatus();
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_failed", async (event) => {
        const data = JSON.parse(event.data);

        isTransitioning = false;
        setPowerButtonLoading(false);

        alert("自動備份失敗：" + (data.message || "未知錯誤"));

        await updateStatus();
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_config_updated", async () => {
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_warning", (event) => {
        const data = JSON.parse(event.data);
        console.log(data.message || "自動備份公告階段");
    });

    serverEvents.addEventListener("auto_backup_missed", handleAutoBackupMissed);

}


















async function sendCommand() {
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");
    const command = input.value.trim();

    if (!command) {
        return;
    }

    input.disabled = true;
    button.disabled = true;

    try {
        const response = await fetch("/api/command", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ command })
        });

        const data = await response.json();

        if (!data.success) {
            alert("指令送出失敗：" + (data.message || "未知錯誤"));
            return;
        }

        if (commandHistory[commandHistory.length - 1] !== command) {
            commandHistory.push(command);
        }

        commandHistoryIndex = commandHistory.length;
        input.value = "";
        scrollLogToBottom();

    } catch (error) {
        console.error("送出指令失敗:", error);
        alert("送出指令失敗，請查看 console。");
    } finally {
        input.disabled = false;
        button.disabled = false;
        input.focus();
    }
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

        await updateStatus();

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


function setPowerButtonLoading(isLoading, actionText = "") {
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

async function waitForServerStatus(targetOnline, timeoutMs = 30000, intervalMs = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/api/server/query-status", { cache: "no-store" });
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

function closeAllPlayerMenus() {
    document.querySelectorAll(".player-menu").forEach(menu => {
        menu.hidden = true;
    });
}

document.addEventListener("click", async (event) => {
    const menuBtn = event.target.closest(".player-menu-btn");
    const menuItem = event.target.closest(".player-menu-item");

    if (menuBtn) {
        const wrap = menuBtn.closest(".player-menu-wrap");
        const menu = wrap.querySelector(".player-menu");
        const isHidden = menu.hidden;

        closeAllPlayerMenus();
        menu.hidden = !isHidden;
        return;
    }

    if (menuItem) {
        const action = menuItem.dataset.action;
        const player = menuItem.dataset.player;

        closeAllPlayerMenus();

        if (action === "kick") {
            const ok = confirm(`確定要踢出玩家 ${player} 嗎？`);
            if (!ok) return;

            try {
                const response = await fetch("/api/player/action", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        action: "kick",
                        player: player
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    alert(data.message || "操作失敗");
                    return;
                }

            } catch (error) {
                console.error("玩家操作失敗:", error);
                alert("玩家操作失敗");
            }
        }

        return;
    }

    if (!event.target.closest(".player-menu-wrap")) {
        closeAllPlayerMenus();
    }
});




async function saveAndRestartServer() {
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
    }
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














const choosePathBtn = document.getElementById("backupChoosePathBtn");
if (choosePathBtn) {
    choosePathBtn.addEventListener("click", () => {
        alert("瀏覽器版暫不支援直接開啟資料夾選擇器，第一版可先手動輸入路徑。");
    });
}













































































document.getElementById("cloudConnectBtn")?.addEventListener("click", () => {
    window.location.href = "/api/cloud/google/login";
});


































document.addEventListener("DOMContentLoaded", () => {
    // ===== 啟動server按鈕 =====
    const powerBtn = document.getElementById("powerBtn");
    if (powerBtn) {
        powerBtn.addEventListener("click", toggleServer);
    }


    // ===== 指令輸入 =====
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");

    if (button) {
        button.addEventListener("click", sendCommand);
    }

    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                sendCommand();
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();

                if (commandHistory.length === 0) return;

                if (commandHistoryIndex > 0) {
                    commandHistoryIndex--;
                } else {
                    commandHistoryIndex = 0;
                }

                input.value = commandHistory[commandHistoryIndex] || "";
                input.setSelectionRange(input.value.length, input.value.length);
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();

                if (commandHistory.length === 0) return;

                if (commandHistoryIndex < commandHistory.length - 1) {
                    commandHistoryIndex++;
                    input.value = commandHistory[commandHistoryIndex] || "";
                } else {
                    commandHistoryIndex = commandHistory.length;
                    input.value = "";
                }

                input.setSelectionRange(input.value.length, input.value.length);
            }
        });
    }


    const backupRefreshRecordsBtn = document.getElementById("backupRefreshRecordsBtn");
    if (backupRefreshRecordsBtn) {
        backupRefreshRecordsBtn.addEventListener("click", loadBackupRecords);
    }


    // ===== 定時更新 =====
    initServerStatus();


    // ===== 初始化 =====
    
    setupEulaModal();
    checkEulaStatus();
    setupServerInitModal();
    checkFirstRunGuide();
    setupServerEvents();
    initDeathBook();
    initFeatureCards();
    initLogConsole();
    initServerSettings();
    initBackup();
    initCloudBackup();
    initAutoBackup();


    
});
