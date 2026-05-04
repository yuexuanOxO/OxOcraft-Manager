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


let isTransitioning = false;



let serverSettingKeyword = "";
let serverSettingsServerOnline = false;
let serverEvents = null;


let commandHistory = [];
let commandHistoryIndex = -1;
let backupRecordsCache = [];
let backupRecordKeyword = "";
let backupProviderFilters = new Set();
let backupStatusFilters = new Set();
let selectedCloudBackupFolder = "";
let currentBackupLevelName = "world";
let manualBackupSelectedWorld = null;
let currentPlayers = new Set();
let autoBackupMissedPromptOpen = false;
let currentServerWorldPath = "";
let manualBackupUploadCloud = false;

let autoBackupState = {
    enabled: false,
    frequency: "daily",
    startAt: "",
    nextRunAt: "",
    uploadCloud: false
};










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


async function handleAutoBackupMissed(event) {
    if (autoBackupMissedPromptOpen) return;

    autoBackupMissedPromptOpen = true;

    try {
        const data = JSON.parse(event.data || "{}");
        const missedRunAt = data.missed_run_at
            ? data.missed_run_at.replace("T", " ")
            : "";
        const promptText = missedRunAt
            ? `偵測到上次自動備份排程 (${missedRunAt}) 沒有執行。\n\n是否要跳過這次排程？\n\n按「確定」：跳過並更新下次備份時間。\n按「取消」：現在補做備份。`
            : "偵測到上次自動備份排程沒有執行。\n\n是否要跳過這次排程？\n\n按「確定」：跳過並更新下次備份時間。\n按「取消」：現在補做備份。";
        const skipMissedBackup = confirm(promptText);
        const endpoint = skipMissedBackup
            ? "/api/backup/auto-missed/skip"
            : "/api/backup/auto-missed/run-now";

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        });
        const result = await response.json();

        if (!result.success) {
            alert(result.message || "處理上次未執行的自動備份排程失敗");
            return;
        }

        await loadAutoBackupConfig();

    } catch (error) {
        console.error("處理未執行自動備份排程失敗:", error);
        alert("處理未執行自動備份排程失敗，請查看 console。");

    } finally {
        autoBackupMissedPromptOpen = false;
    }
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


function scrollLogToBottom() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.scrollTop = logBox.scrollHeight;
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






// server設定頁面
function setupServerSettingsModal() {
    const modal = document.getElementById("serverSettingsModal");
    const openBtn = document.getElementById("serverSettingBtn");
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const restartBtn = document.getElementById("serverSettingsRestartBtn");

    if (!modal || !openBtn) return;

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");

        try {
            await updateServerSettingsFooterMode();
            await loadServerSettingFields();
            await loadServerSettings();
        } catch (error) {
            console.error(error);
            const body = document.getElementById("serverSettingsBody");
            if (body) {
                body.innerHTML = "<div class='settings-placeholder'>讀取設定欄位失敗</div>";
            }
        }
    });

    if (applyBtn) {
        applyBtn.addEventListener("click", saveServerSettings);
    }

    if (restartBtn) {
        restartBtn.addEventListener("click", saveAndRestartServer);
    }

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
            serverSettingKeyword = "";

            const searchInput = document.getElementById("serverSettingSearch");
            if (searchInput) {
                searchInput.value = "";
            }
        }
    });
}


let serverSettingFields = [];
let serverSettingsState = {};

async function loadServerSettingFields() {
    if (serverSettingFields.length > 0) return;

    const response = await fetch("/static/data/server_properties_fields.json", {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("讀取 server_properties_fields.json 失敗");
    }

    serverSettingFields = await response.json();
}


async function loadServerSettings() {
    const body = document.getElementById("serverSettingsBody");
    if (!body) return;

    body.innerHTML = "<div class='settings-placeholder'>讀取中...</div>";

    try {
        const response = await fetch("/api/server/properties", { cache: "no-store" });
        const data = await response.json();

        if (!data.success) {
            body.innerHTML = `<div class="settings-placeholder">讀取失敗：${data.message || "未知錯誤"}</div>`;
            return;
        }

        const runtimeResponse = await fetch("/api/server/runtime-config", { cache: "no-store" });
        const runtimeData = await runtimeResponse.json();

        serverSettingsState = data.properties || {};

        if (runtimeData.success) {
            serverSettingsState = {
                ...serverSettingsState,
                ...runtimeData.config
            };
        }

        // 更新最近修改時間
        updateServerSettingsModifiedTime(data.modified_comment);

        renderServerSettings();

    } catch (error) {
        body.innerHTML = "<div class='settings-placeholder'>讀取失敗，請查看 console。</div>";
        console.error("讀取 server.properties 失敗:", error);
    }
}

function renderServerSettings() {
    const body = document.getElementById("serverSettingsBody");
    if (!body) return;

    body.innerHTML = "";

    serverSettingFields.forEach((field) => {

        const keyword = serverSettingKeyword;

        if(keyword){

            const searchText = `
                ${field.key}
                ${field.label}
                ${field.description || ""}
            `.toLowerCase();

            if(!searchText.includes(keyword)){
                return;
            }
        }

        if (field.dependsOn) {
            const parentValue = serverSettingsState[field.dependsOn.key];
            if (parentValue !== field.dependsOn.value) {
                return;
            }
        }

        const row = document.createElement("div");
        row.className = "setting-row";
        if (field.dependsOn) {
            row.classList.add("setting-child-row");
        }

        const label = document.createElement("div");
        label.className = "setting-label";
        label.innerHTML = `
            <div class="setting-label-main">
                <span>${field.label}</span>
                <button class="setting-help-btn" type="button" data-key="${field.key}">?</button>
            </div>
            <div class="setting-label-key">(${field.key})</div>
        `;

        const valueWrap = document.createElement("div");
        valueWrap.className = "setting-value";

        if (field.type === "boolean") {

            const boolWrap = document.createElement("div");
            boolWrap.className = "setting-bool-wrap";

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "setting-bool-btn";
            btn.dataset.key = field.key;

            const value = String(serverSettingsState[field.key] || "false").toLowerCase();

            btn.textContent = value === "true" ? "True" : "False";
            btn.classList.toggle("true", value === "true");
            btn.classList.toggle("false", value !== "true");

            btn.addEventListener("click", () => {
                serverSettingsState[field.key] =
                    value === "true" ? "false" : "true";

                renderServerSettings();
            });

            const defaultText = document.createElement("div");
            defaultText.className = "setting-default-text";

            const defaultValue =
                field.default !== undefined && field.default !== ""
                    ? field.default
                    : "無";

            defaultText.textContent = `預設值:${defaultValue}`;

            boolWrap.appendChild(btn);
            boolWrap.appendChild(defaultText);

            valueWrap.appendChild(boolWrap);

        } else if (field.type === "select") {
            const select = document.createElement("select");
            select.className = "setting-input";
            select.dataset.key = field.key;

            const currentValue = serverSettingsState[field.key] || "";

            (field.options || []).forEach((option) => {
                const opt = document.createElement("option");
                opt.value = option.value;
                opt.textContent = option.label;
                opt.selected = option.value === currentValue;
                select.appendChild(opt);
            });

            select.addEventListener("change", () => {
                serverSettingsState[field.key] = select.value;
            });

            valueWrap.appendChild(select);
        } else {
            const input = document.createElement("input");
            input.className = "setting-input";
            input.dataset.key = field.key;
            input.type = field.type === "number" ? "number" : "text";
            input.value = serverSettingsState[field.key] || "";

            const defaultValue =
                field.default !== undefined && field.default !== ""
                    ? field.default
                    : "無";

            input.placeholder = `預設值:${defaultValue}`;

            input.addEventListener("input", () => {
                serverSettingsState[field.key] = input.value;
            });

            valueWrap.appendChild(input);
        }

        row.appendChild(label);
        row.appendChild(valueWrap);
        body.appendChild(row);
    });
}


document.addEventListener("click", (event) => {
    const helpBtn = event.target.closest(".setting-help-btn");
    if (!helpBtn) return;

    const key = helpBtn.dataset.key;
    const field = serverSettingFields.find(item => item.key === key);
    if (!field) return;

    alert(`${field.label} (${field.key})\n\n${field.description || "目前沒有說明。"}`);
});


function updateServerSettingsModifiedTime(commentText) {
    const box = document.getElementById("serverSettingsModifiedTime");
    if (!box) return;

    if (!commentText) {
        box.textContent = "最近修改：未知";
        return;
    }

    const parts = commentText.split(/\s+/);

    if (parts.length >= 6) {
        const monthMap = {
            Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
            Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
        };

        const month = monthMap[parts[1]] || parts[1];
        const day = Number(parts[2]);
        const time = parts[3];
        const year = parts[5];

        box.textContent = `最近修改：${year}/${month}/${day} ${time}`;
        return;
    }

    box.textContent = `最近修改：${commentText}`;
}


// 伺服器參數頁面搜尋欄


function setupServerSettingSearch(){

    const input = document.getElementById("serverSettingSearch");
    const btn = document.getElementById("serverSettingSearchBtn");

    if (!input || !btn) return;

    function doSearch(){
        serverSettingKeyword = input.value.trim().toLowerCase();
        renderServerSettings();
    }

    btn.addEventListener("click", doSearch);

    input.addEventListener("keydown", (e)=>{
        if(e.key === "Enter"){
            doSearch();
        }
    });

    input.addEventListener("input", ()=>{
        if(input.value.trim() === ""){
            serverSettingKeyword = "";
            renderServerSettings();
        }
    });
}


async function saveServerSettings(showAlert = true) {
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const propertiesPayload = {};
    const runtimeConfigPayload = {};

    serverSettingFields.forEach((field) => {
        const value = serverSettingsState[field.key];

        if (field.source === "config") {
            runtimeConfigPayload[field.key] = value;
        } else {
            propertiesPayload[field.key] = value;
        }
    });

    if (applyBtn) {
        applyBtn.disabled = true;
    }

    try {
        const response = await fetch("/api/server/properties", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                properties: propertiesPayload
            })
        });

        const data = await response.json();

        if (!data.success) {
            alert("儲存失敗：" + (data.message || "未知錯誤"));
            return false;
        }

        const runtimeResponse = await fetch("/api/server/runtime-config", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                config: runtimeConfigPayload
            })
        });

        const runtimeData = await runtimeResponse.json();

        if (!runtimeData.success) {
            alert("記憶體設定儲存失敗：" + (runtimeData.message || "未知錯誤"));
            return false;
        }

        if (showAlert) {
            if (serverSettingsServerOnline) {
                alert(`
                此次變更已保留。

                若設定值不符合格式，
                伺服器重啟後將自動修正或恢復預設值。`);
            } else {
                alert(`
                參數已修改。

                若設定值不符合格式，
                伺服器啟動時將自動修正或恢復預設值。`);
            }
        }

        await loadServerSettings();
        return true;

    } catch (error) {
        console.error("儲存 server.properties 失敗:", error);
        alert("儲存失敗，請查看 console。");
        return false;

    } finally {
        if (applyBtn) {
            applyBtn.disabled = false;
        }
    }
}


async function updateServerSettingsFooterMode() {
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const restartBtn = document.getElementById("serverSettingsRestartBtn");

    if (!applyBtn || !restartBtn) return;

    try {
        const response = await fetch("/api/server/query-status", { cache: "no-store" });
        const payload = await response.json();
        const data = payload.data || payload;

        serverSettingsServerOnline = !!data.online;

        if (serverSettingsServerOnline) {
            applyBtn.textContent = "僅保留變更";
            restartBtn.classList.remove("hidden");
        } else {
            applyBtn.textContent = "確定套用";
            restartBtn.classList.add("hidden");
        }

    } catch (error) {
        console.error("讀取伺服器狀態失敗:", error);
        serverSettingsServerOnline = false;
        applyBtn.textContent = "確定套用";
        restartBtn.classList.add("hidden");
    }
}


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





function appendLogLine(line) {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    const wasNearBottom =
        logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

    if (
        logBox.textContent === "伺服器尚未啟動" ||
        logBox.textContent === ""
    ) {
        logBox.textContent = line;
    } else {
        logBox.textContent += "\n" + line;
    }

    const lines = logBox.textContent.split("\n");
    if (lines.length > 500) {
        logBox.textContent = lines.slice(-500).join("\n");
    }

    if (wasNearBottom) {
        logBox.scrollTop = logBox.scrollHeight;
    }
}


function clearLogBox() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.textContent = "伺服器尚未啟動";
}


function setupBackupModal() {
    const modal = document.getElementById("backupModal");
    const openBtn = document.getElementById("backupBtn");
    const tabs = document.querySelectorAll(".backup-tab");
    const manualPage = document.getElementById("backupManualPage");
    const settingsPage = document.getElementById("backupSettingsPage");
    const recordsPage = document.getElementById("backupRecordsPage");

    if (!modal || !openBtn) return;

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        tabs.forEach(item => {
            item.classList.toggle("active", item.dataset.tab === "manual");
        });

        if (manualPage) {
            manualPage.classList.remove("hidden");
        }
        settingsPage.classList.add("hidden");
        recordsPage.classList.add("hidden");

        const cloudPage = document.getElementById("backupCloudPage");
        if (cloudPage) {
            cloudPage.classList.add("hidden");
        }

        await loadBackupConfig();
        await loadAutoBackupConfig();
    });


    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {

            tabs.forEach(item => item.classList.remove("active"));
            tab.classList.add("active");

            const target = tab.dataset.tab;

            const cloudPage = document.getElementById("backupCloudPage");

            if (manualPage) {
                manualPage.classList.add("hidden");
            }
            settingsPage.classList.add("hidden");
            recordsPage.classList.add("hidden");

            if (cloudPage) {
                cloudPage.classList.add("hidden");
            }

            if (target === "manual") {

                if (manualPage) {
                    manualPage.classList.remove("hidden");
                }

            } else if (target === "settings") {

                settingsPage.classList.remove("hidden");

            } else if (target === "records") {

                recordsPage.classList.remove("hidden");
                loadBackupRecords();

            } else if (target === "cloud") {

                if (cloudPage) {
                    cloudPage.classList.remove("hidden");
                }

                loadCloudStatus();
            }
        });
    });
}



const choosePathBtn = document.getElementById("backupChoosePathBtn");
if (choosePathBtn) {
    choosePathBtn.addEventListener("click", () => {
        alert("瀏覽器版暫不支援直接開啟資料夾選擇器，第一版可先手動輸入路徑。");
    });
}


async function startManualBackup() {
    const btn = document.getElementById("backupMainActionBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        const sourceInput = document.getElementById("backupSourceRootInput");
        const backupInput = document.getElementById("backupRootInput");

        const response = await fetch("/api/backup/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                source_root: sourceInput ? sourceInput.value.trim() : "",
                backup_root: backupInput ? backupInput.value.trim() : ""
            })
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "開始備份失敗");

            if (btn) {
                btn.disabled = false;
            }

            return;
        }


        if (btn) {
            btn.disabled = false;
        }

    } catch (error) {
        console.error("開始備份失敗:", error);
        alert("開始備份失敗，請查看 console。");

        setBackupRunning(false);

        if (btn) {
            btn.disabled = false;
        }
    }
}

async function cancelManualBackup() {
    const btn = document.getElementById("backupMainActionBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        await fetch("/api/backup/cancel", {
            method: "POST"
        });
    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}

function setBackupRunning(isRunning) {
    const btn = document.getElementById("backupMainActionBtn");
    if (!btn) return;

    if (isRunning) {
        btn.textContent = "取消備份";
        btn.dataset.mode = "cancel";
    } else {
        btn.textContent = "立即備份";
        btn.dataset.mode = "start";
    }
}

function setupBackupActionButton() {
    const btn = document.getElementById("backupMainActionBtn");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        if (btn.dataset.mode === "cancel") {
            await cancelManualBackup();
            return;
        }

        await startManualBackup();
    });
}

function setupBackupRecordFilters() {
    const searchInput = document.getElementById("backupRecordSearchInput");
    const searchBtn = document.getElementById("backupRecordSearchBtn");
    const filterBtn = document.getElementById("backupRecordFilterBtn");
    const filterPanel = document.getElementById("backupRecordFilterPanel");
    const clearBtn = document.getElementById("backupClearFiltersBtn");

    function applySearch() {
        backupRecordKeyword = searchInput ? searchInput.value.trim() : "";
        renderFilteredBackupRecords();
    }

    if (searchBtn) {
        searchBtn.addEventListener("click", applySearch);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                applySearch();
            }
        });

        searchInput.addEventListener("input", () => {
            backupRecordKeyword = searchInput.value.trim();
            renderFilteredBackupRecords();
        });
    }

    if (filterBtn && filterPanel) {
        filterBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            filterPanel.classList.toggle("hidden");
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            backupProviderFilters.clear();
            backupStatusFilters.clear();

            document.querySelectorAll("[data-filter-provider], [data-filter-status]").forEach((btn) => {
                btn.classList.remove("active");
            });

            renderFilteredBackupRecords();
        });
    }

    document.querySelectorAll("[data-filter-provider]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const provider = btn.dataset.filterProvider;

            if (backupProviderFilters.has(provider)) {
                backupProviderFilters.delete(provider);
                btn.classList.remove("active");
            } else {
                backupProviderFilters.add(provider);
                btn.classList.add("active");
            }

            renderFilteredBackupRecords();
        });
    });

    document.querySelectorAll("[data-filter-status]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const status = btn.dataset.filterStatus;

            if (backupStatusFilters.has(status)) {
                backupStatusFilters.delete(status);
                btn.classList.remove("active");
            } else {
                backupStatusFilters.add(status);
                btn.classList.add("active");
            }

            renderFilteredBackupRecords();
        });
    });

    document.addEventListener("click", (event) => {
        if (!filterPanel || filterPanel.classList.contains("hidden")) return;

        const clickedInsidePanel = filterPanel.contains(event.target);
        const clickedFilterButton = filterBtn && filterBtn.contains(event.target);

        if (!clickedInsidePanel && !clickedFilterButton) {
            filterPanel.classList.add("hidden");
        }
    });

}

function renderBackupProgress(data) {
    const statusText = document.getElementById("backupStatusText");
    const progressBar = document.getElementById("backupProgressBar");
    const progressText = document.getElementById("backupProgressText");
    const currentFile = document.getElementById("backupCurrentFile");
    const manualStatusText = document.getElementById("manualBackupStatusText");
    const manualProgressBar = document.getElementById("manualBackupProgressBar");
    const manualProgressText = document.getElementById("manualBackupProgressText");
    const manualCurrentFile = document.getElementById("manualBackupCurrentFile");
    const mapName = document.getElementById("backupMapName");

    const percent = data.percent || 0;

    if (statusText) {
        statusText.textContent = `狀態：${data.message || data.status || "未知"}`;
    }

    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }

    if (progressText) {
        progressText.textContent = `${percent}%`;
    }

    if (currentFile) {
        currentFile.textContent = `目前檔案：${data.current_file || "無"}`;
    }

    if (manualStatusText) {
        manualStatusText.textContent = `狀態：${data.message || data.status || "未知"}`;
    }

    if (manualProgressBar) {
        manualProgressBar.style.width = `${percent}%`;
    }

    if (manualProgressText) {
        manualProgressText.textContent = `${percent}%`;
    }

    if (manualCurrentFile) {
        manualCurrentFile.textContent = `目前檔案：${data.current_file || "無"}`;
    }

    if (mapName && data.map_name) {
        mapName.textContent = data.map_name;
    }

    if (data.running || data.status === "running") {
        document.getElementById("manualLocalBackupBtn")?.setAttribute("disabled", "disabled");
        document.getElementById("manualLocalCloudBackupBtn")?.setAttribute("disabled", "disabled");
        showBackupTaskButton(percent);
    } else if (isBackupEndStatus(data)) {
        showBackupTaskButton(100);

        setTimeout(() => {
            hideBackupTaskButton();
        }, 3000);

        const status = String(data.status || "").toLowerCase();
        const message = String(data.message || "");

        const isLocalSuccess = status === "success";
        const isCanceledOrFailed =
            status === "failed" ||
            status === "canceled" ||
            status === "cancelled" ||
            status.includes("cancel") ||
            message.includes("取消");

        if (!manualBackupUploadCloud || isCanceledOrFailed) {
            fadeOutAndHide(document.getElementById("manualBackupProgressBox"), 3000);
        }

        document.getElementById("manualLocalBackupBtn")?.removeAttribute("disabled");
        document.getElementById("manualLocalCloudBackupBtn")?.removeAttribute("disabled");
    }
}


function setupBackgroundTaskButtons() {
    const backupTaskBtn = document.getElementById("backupTaskBtn");
    const backupModal = document.getElementById("backupModal");
    const cloudUploadTaskBtn = document.getElementById("cloudUploadTaskBtn");

    if (!backupTaskBtn || !backupModal) return;

    backupTaskBtn.addEventListener("click", async () => {
        backupModal.classList.remove("hidden");
        await loadBackupConfig();

        document.querySelectorAll(".backup-tab").forEach(tab => {
            tab.classList.toggle("active", tab.dataset.tab === "manual");
        });

        document.getElementById("backupManualPage")?.classList.remove("hidden");
        document.getElementById("backupSettingsPage")?.classList.add("hidden");
        document.getElementById("backupRecordsPage")?.classList.add("hidden");
        document.getElementById("backupCloudPage")?.classList.add("hidden");
    });

    if (cloudUploadTaskBtn && backupModal) {
        cloudUploadTaskBtn.addEventListener("click", async () => {
            backupModal.classList.remove("hidden");
            await loadBackupConfig();

            document.querySelectorAll(".backup-tab").forEach(tab => {
                tab.classList.toggle("active", tab.dataset.tab === "manual");
            });

            document.getElementById("backupManualPage")?.classList.remove("hidden");
            document.getElementById("backupSettingsPage")?.classList.add("hidden");
            document.getElementById("backupRecordsPage")?.classList.add("hidden");
            document.getElementById("backupCloudPage")?.classList.add("hidden");
        });
    }

}


async function loadBackupConfig() {
    try {
        const response = await fetch("/api/backup/config", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        const sourceInput = document.getElementById("backupSourceRootInput");
        const backupInput = document.getElementById("backupRootInput");
        const manualSourceInput = document.getElementById("manualBackupSourceInput");
        const manualBackupInput = document.getElementById("manualBackupRootInput");
        const mapName = document.getElementById("backupMapName");
        const sourceText = document.getElementById("backupSourceRootText");
        const backupText = document.getElementById("backupRootText");
        const manualSourceText = document.getElementById("manualBackupSourceText");
        const manualBackupText = document.getElementById("manualBackupRootText");

        currentServerWorldPath = data.world_path || "";

        if (sourceInput && sourceText) {
            sourceInput.value = data.source_root || "";
            sourceText.textContent = data.source_root || "";
        }

        if (backupInput && backupText && !backupInput.value.trim()) {
            backupInput.value = data.backup_root || "";
            backupText.textContent = data.backup_root || "";
        }

        if (manualSourceInput && manualSourceText) {
            const manualScanRoot = data.manual_scan_root || data.source_root || "";
            manualSourceInput.value = manualScanRoot;
            manualSourceText.textContent = manualScanRoot;
            await loadManualBackupWorlds(manualScanRoot, data.world_path || "");
        }

        if (manualBackupInput && manualBackupText && !manualBackupInput.value.trim()) {
            manualBackupInput.value = data.manual_backup_root || data.backup_root || "";
            manualBackupText.textContent = manualBackupInput.value;
        }

        currentBackupLevelName = data.level_name || "world";

        if (mapName) {
            const worldPath = data.world_path || "";
            mapName.textContent = worldPath
                ? worldPath.split(/[\\/]/).filter(Boolean).pop()
                : currentBackupLevelName;
        }

        updateDefaultCloudBackupFolderText();

    } catch (error) {
        console.error("讀取備份設定失敗:", error);
    }
}


function updateDefaultCloudBackupFolderText() {
    const text = document.getElementById("cloudBackupFolderText");
    if (!text || selectedCloudBackupFolder) return;

    text.textContent = `未指定，使用伺服器上次開啟的世界${currentBackupLevelName}備份`;
}


async function startSafeManualBackup(uploadCloud) {
    const sourceInput = document.getElementById("manualBackupSourceInput");
    const backupInput = document.getElementById("manualBackupRootInput");
    const localBtn = document.getElementById("manualLocalBackupBtn");
    const cloudBtn = document.getElementById("manualLocalCloudBackupBtn");
    const selectedWorldPath = manualBackupSelectedWorld?.path || "";
    manualBackupUploadCloud = uploadCloud;

    if (!sourceInput?.value.trim()) {
        alert("請先選擇世界資料夾");
        return;
    }

    if (!selectedWorldPath) {
        alert("請先選擇要備份的世界資料夾");
        return;
    }

    if (!backupInput?.value.trim()) {
        alert("請先選擇備份輸出路徑");
        return;
    }

    try {
        const statusRes = await fetch("/api/server/query-status", { cache: "no-store" });
        const statusPayload = await statusRes.json();
        const statusData = statusPayload.data || statusPayload;
        const isSelectedCurrentWorld =
            normalizePath(manualBackupSelectedWorld?.path || "") ===
            normalizePath(currentServerWorldPath);

        if (statusData.online && isSelectedCurrentWorld) {
            const ok = confirm("你要備份的是目前伺服器使用中的世界。\n\n手動備份需要先關閉伺服器，備份完成後會重新啟動。是否繼續？");
            if (!ok) return;
        }

        if (localBtn) localBtn.disabled = true;
        if (cloudBtn) cloudBtn.disabled = true;

        document.getElementById("manualBackupProgressBox")?.classList.remove("hidden");

        const cloudBox = document.getElementById("manualCloudUploadBox");
        const cloudBar = document.getElementById("manualCloudUploadProgressBar");
        const cloudText = document.getElementById("manualCloudUploadProgressText");
        const cloudStatus = document.getElementById("manualCloudUploadStatus");
        const cloudFile = document.getElementById("manualCloudUploadFile");

        if (cloudBox) {
            cloudBox.classList.add("hidden");
            cloudBox.style.opacity = "1";
        }

        if (cloudBar) cloudBar.style.width = "0%";
        if (cloudText) cloudText.textContent = "0%";
        if (cloudStatus) cloudStatus.textContent = "雲端上傳：待機";
        if (cloudFile) cloudFile.textContent = "目前檔案：無";

        document.getElementById("manualCancelBackupBtn")?.removeAttribute("disabled");
        document.getElementById("manualCancelCloudUploadBtn")?.removeAttribute("disabled");

        const response = await fetch("/api/backup/manual-safe-start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                manual_scan_root: sourceInput.value.trim(),
                selected_world_path: selectedWorldPath,
                backup_root: backupInput.value.trim(),
                upload_cloud: uploadCloud
            })
        });
        const data = await response.json();

        if (!data.success) {
            alert(data.message || "開始手動備份失敗");
            if (localBtn) localBtn.disabled = false;
            if (cloudBtn) cloudBtn.disabled = false;
        }

    } catch (error) {
        console.error("開始手動備份失敗:", error);
        alert("開始手動備份失敗，請查看 console。");
        if (localBtn) localBtn.disabled = false;
        if (cloudBtn) cloudBtn.disabled = false;
    }
}


function setupManualBackupButtons() {
    document.getElementById("manualLocalBackupBtn")?.addEventListener("click", () => {
        startSafeManualBackup(false);
    });

    document.getElementById("manualLocalCloudBackupBtn")?.addEventListener("click", () => {
        startSafeManualBackup(true);
    });
}


async function loadManualBackupWorlds(rootPath, currentWorldPath = "") {
    if (!rootPath) return;

    const response = await fetch("/api/backup/worlds", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            root: rootPath
        })
    });

    const data = await response.json();

    if (!data.success) {
        alert(data.message || "找不到有效的世界資料夾");
        return;
    }

    renderManualBackupWorlds(data.worlds || [], currentWorldPath);
}


function normalizePath(path) {
    return String(path || "")
        .replaceAll("\\\\", "/")
        .replaceAll("\\", "/")
        .toLowerCase();
}


function renderManualBackupWorlds(worlds, currentWorldPath = "") {
    const list = document.getElementById("manualBackupWorldList");
    const info = document.getElementById("manualBackupWorldInfo");

    if (!list) return;

    list.innerHTML = "";

    if (!worlds.length) {
        manualBackupSelectedWorld = null;
        if (info) info.textContent = "找不到有效的世界資料夾";
        return;
    }

    const matchedWorld = worlds.find(world => {
        return normalizePath(world.path) === normalizePath(currentWorldPath);
    });

    manualBackupSelectedWorld = matchedWorld || worlds[0];

    worlds.forEach((world) => {
        const isCurrentWorld =
            normalizePath(world.path) === normalizePath(currentWorldPath);

        const isSelected =
            normalizePath(world.path) === normalizePath(manualBackupSelectedWorld.path);

        const row = document.createElement("button");
        row.type = "button";
        row.className = "manual-world-row";

        if (isSelected) {
            row.classList.add("active");
        }

        row.innerHTML = `
            <div class="manual-world-name">${world.name}</div>
            <div class="manual-world-size">${formatBytes(world.total_bytes || 0)}</div>
            <div class="manual-world-status ${isCurrentWorld ? "using" : "ready"}">
                ${isCurrentWorld ? "使用中" : "可備份"}
            </div>
        `;

        row.addEventListener("click", () => {
            document.querySelectorAll(".manual-world-row").forEach(item => {
                item.classList.remove("active");
            });

            row.classList.add("active");
            manualBackupSelectedWorld = world;

            const sourceInput = document.getElementById("manualBackupSourceInput");
            const sourceText = document.getElementById("manualBackupSourceText");
            const parentPath = (world.path || "").replace(/[\\/][^\\/]+$/, "");

            if (sourceInput) sourceInput.value = parentPath || world.path || "";
            if (sourceText) sourceText.textContent = parentPath || world.path || "";

            if (info) {
                info.textContent = `${world.name} | ${formatBytes(world.total_bytes || 0)}`;
            }
        });

        list.appendChild(row);
    });

    const sourceInput = document.getElementById("manualBackupSourceInput");
    const sourceText = document.getElementById("manualBackupSourceText");
    const selectedParentPath =
        (manualBackupSelectedWorld.path || "").replace(/[\\/][^\\/]+$/, "");

    if (sourceInput) {
        sourceInput.value = selectedParentPath || manualBackupSelectedWorld.path || "";
    }

    if (sourceText) {
        sourceText.textContent = selectedParentPath || manualBackupSelectedWorld.path || "";
    }

    if (info) {
        info.textContent =
            `${manualBackupSelectedWorld.name} | ${formatBytes(manualBackupSelectedWorld.total_bytes || 0)}`;
    }
}


async function openFolderPicker() {
    const response = await fetch("/api/backup/select-folder", {
        method: "POST"
    });

    const data = await response.json();

    if (!data.success || !data.path) {
        return "";
    }

    return data.path;
}


function setupBackupPathEditButtons() {
    document.querySelectorAll(".backup-path-edit-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const target = btn.dataset.target;

            const textEl = target === "source"
                ? document.getElementById("backupSourceRootText")
                : target === "manual-source"
                    ? document.getElementById("manualBackupSourceText")
                    : target === "manual-backup"
                        ? document.getElementById("manualBackupRootText")
                        : document.getElementById("backupRootText");

            const inputEl = target === "source"
                ? document.getElementById("backupSourceRootInput")
                : target === "manual-source"
                    ? document.getElementById("manualBackupSourceInput")
                    : target === "manual-backup"
                        ? document.getElementById("manualBackupRootInput")
                        : document.getElementById("backupRootInput");

            if (!textEl || !inputEl) return;

            btn.disabled = true;

            try {
                const path = await openFolderPicker();

                if (!path) {
                    return;
                }

                inputEl.value = path;
                textEl.textContent = path;

                if (target === "manual-source") {
                    await loadManualBackupWorlds(path);
                }

            } catch (error) {
                console.error("選擇資料夾失敗:", error);
                alert("選擇資料夾失敗，請查看 console。");
            } finally {
                btn.disabled = false;
            }
        });
    });
}


async function loadBackupRecords() {
    try {
        const response = await fetch("/api/backup/records", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        backupRecordsCache = data.records || [];
        renderFilteredBackupRecords();

    } catch (error) {
        console.error("讀取備份紀錄失敗:", error);
    }
}

function renderBackupRecords(records) {
    const list = document.getElementById("backupRecordsList");
    if (!list) return;

    list.innerHTML = "";

    if (!records.length) {
        list.innerHTML = "<div class='backup-empty'>沒有符合條件的備份紀錄</div>";
        return;
    }

    records.forEach(record => {
        list.appendChild(createBackupRecordItem(record));
    });
}

function renderFilteredBackupRecords() {
    const keyword = backupRecordKeyword.trim().toLowerCase();

    const filtered = backupRecordsCache.filter((record) => {
        const providerKey = getBackupProviderKey(record);
        const statusKey = record.status || "unknown";

        if (backupProviderFilters.size > 0 && !backupProviderFilters.has(providerKey)) {
            return false;
        }

        if (backupStatusFilters.size > 0 && !backupStatusFilters.has(statusKey)) {
            return false;
        }

        if (!keyword) {
            return true;
        }

        const searchText = [
            record.status,
            getBackupStatusLabel(record.status),
            record.backup_type,
            providerKey,
            getCloudProviderLabel(record.cloud_provider),
            record.map_name,
            record.message,
            record.source_path,
            record.backup_path,
            record.cloud_account,
            record.cloud_file_id,
            record.cloud_link,
            record.cloud_file_status,
        ].join(" ").toLowerCase();

        return searchText.includes(keyword);
    });

    renderBackupRecords(filtered);
}

function getBackupProviderKey(record) {
    if ((record.backup_type || "local") === "local") {
        return "local";
    }

    return record.cloud_provider || "cloud";
}

function prependBackupRecord(record) {
    if (!record) return;

    backupRecordsCache = [
        record,
        ...backupRecordsCache.filter(item => item.id !== record.id)
    ];

    renderFilteredBackupRecords();
}

function createBackupRecordItem(record) {
    const item = document.createElement("div");
    item.className = `backup-record-item ${record.status || ""}`;
    item.dataset.recordId = record.id;

    const statusText = getBackupStatusLabel(record.status);
    const sizeText = formatBytes(record.total_bytes || 0);
    const backupType = record.backup_type || "local";
    const providerIconHtml = getBackupProviderIconHtml(record);

    if (backupType === "cloud") {
        const providerText = getCloudProviderLabel(record.cloud_provider);
        const fileName = record.backup_path
            ? record.backup_path.split(/[\\/]/).pop()
            : "未知檔案";

        const linkHtml =
            record.cloud_file_status === "deleted"
                ? `<span class="cloud-link-deleted">已刪除的雲端備份</span>`
                : record.cloud_link
                    ? `<a class="cloud-link-active" href="${record.cloud_link}" target="_blank" rel="noopener noreferrer">開啟雲端備份</a>`
                    : `<span class="cloud-link-missing">沒有連結</span>`;

        item.innerHTML = `
            <div class="backup-record-main">
                <div class="backup-record-title">
                    ${statusText}｜${providerIconHtml} ${providerText}｜${record.map_name || "未知世界"}
                </div>
                <div class="backup-record-time">
                    ${record.created_at || ""}
                </div>
            </div>
            <div class="backup-record-message">
                ${record.message || ""}
            </div>
            <div class="backup-record-meta">
                帳號：${record.cloud_account || "未知"}
            </div>
            <div class="backup-record-meta">
                檔案：${fileName}
            </div>
            <div class="backup-record-meta">
                大小：${sizeText}
            </div>
            <div class="backup-record-path">
                連結：${linkHtml}
            </div>
        `;

        return item;
    }

    item.innerHTML = `
        <div class="backup-record-main">
            <div class="backup-record-title">
                ${statusText}｜${providerIconHtml} 本機｜${record.map_name || "未知世界"}
            </div>
            <div class="backup-record-time">
                ${record.created_at || ""}
            </div>
        </div>
        <div class="backup-record-message">
            ${record.message || ""}
        </div>
        <div class="backup-record-path">
            ${record.backup_path || ""}
        </div>
        <div class="backup-record-meta">
            檔案數：${record.total_files || 0}　大小：${sizeText}
        </div>
    `;

    return item;
}

function getBackupStatusLabel(status) {
    if (status === "success") return "成功";
    if (status === "failed") return "失敗";
    if (status === "canceled") return "已取消";
    if (status === "running") return "備份中";
    return "未知";
}

function getCloudProviderLabel(provider) {
    if (provider === "google_drive") return "Google Drive";
    return provider || "雲端";
}

function getBackupProviderIconHtml(record) {
    const providerKey = getBackupProviderKey(record);

    if (providerKey === "local") {
        return `
        <img class="backup-provider-img-icon" src="/static/icons/backup/grass_block.ico" alt="本機備份">`;
    }

    if (providerKey === "google_drive") {
        return `<img class="backup-provider-img-icon" src="/static/icons/backup/google_drive.ico" alt="Google Drive">`;
    }

    return `<span class="backup-provider-text-icon">☁</span>`;
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Number(bytes);
    let index = 0;

    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }

    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}


function showBackupTaskButton(percent = 0) {
    const btn = document.getElementById("backupTaskBtn");
    const ring = document.getElementById("backupTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

    const circumference = 106.8;
    const offset = circumference - (circumference * percent / 100);
    ring.style.strokeDashoffset = offset;
}

function hideBackupTaskButton() {
    const btn = document.getElementById("backupTaskBtn");
    if (btn) btn.classList.add("hidden");
}


function setupCloudBackupFolderPicker() {
    const selectBtn = document.getElementById("cloudBackupFolderSelectBtn");
    const clearBtn = document.getElementById("cloudBackupFolderClearBtn");
    const text = document.getElementById("cloudBackupFolderText");

    if (selectBtn) {
        selectBtn.addEventListener("click", async () => {
            selectBtn.disabled = true;

            try {
                const path = await openFolderPicker();

                if (!path) {
                    return;
                }

                selectedCloudBackupFolder = path;

                if (text) {
                    text.textContent = path;
                }

            } catch (error) {
                console.error("選擇雲端備份資料夾失敗:", error);
                alert("選擇資料夾失敗，請查看 console。");

            } finally {
                selectBtn.disabled = false;
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            selectedCloudBackupFolder = "";

            if (text) {
                updateDefaultCloudBackupFolderText();
            }
        });
    }
}


async function loadCloudStatus() {
    const res = await fetch("/api/cloud/google/status", {
        cache: "no-store"
    });

    const data = await res.json();

    const status = document.getElementById("cloudStatusText");
    const email = document.getElementById("cloudEmailText");
    const connectBtn = document.getElementById("cloudConnectBtn");

    if (!status) return;

    if (data.connected) {
        status.textContent = "Google Drive：已連接";
        status.classList.remove("cloud-status-disconnected");
        status.classList.add("cloud-status-connected");

        if (email) {
            email.innerHTML = `
                <div class="cloud-account-row">
                    ${
                        data.picture
                            ? `<img class="cloud-account-avatar" src="${data.picture}" alt="Google account avatar">`
                            : ""
                    }
                    <span>${data.email || ""}</span>
                    <button id="cloudDisconnectInlineBtn" class="cloud-disconnect-inline-btn" type="button">
                        解除連結
                    </button>
                </div>
            `;

            document.getElementById("cloudDisconnectInlineBtn")?.addEventListener("click", disconnectGoogleDrive);
        }

        connectBtn?.classList.add("hidden");

        document.getElementById("cloudUploadLatestBtn")?.classList.remove("hidden");

    } else {
        status.textContent = "Google Drive：未連接";
        status.classList.remove("cloud-status-connected");
        status.classList.add("cloud-status-disconnected");

        if (email) {
            email.innerHTML = "";
        }

        connectBtn?.classList.remove("hidden");

        document.getElementById("cloudUploadLatestBtn")?.classList.add("hidden");
    }
}


document.getElementById("cloudConnectBtn")?.addEventListener("click", () => {
    window.location.href = "/api/cloud/google/login";
});

async function disconnectGoogleDrive() {
    const ok = confirm("確定要解除 Google Drive 連結嗎？\n解除後將無法上傳雲端備份，直到重新連接。");
    if (!ok) return;

    await fetch("/api/cloud/google/disconnect", {
        method: "POST"
    });

    loadCloudStatus();
}



async function uploadLatestBackupToGoogleDrive() {
    const status = document.getElementById("cloudUploadStatus");
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn && btn.dataset.mode === "cancel") {
        await cancelGoogleDriveUpload();
        return;
    }

    if (status) {
        status.textContent = "準備雲端上傳...";
    }

    if (btn) {
        btn.disabled = true;
    }

    try {
        const response = await fetch("/api/cloud/google/upload-latest", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                backup_folder: selectedCloudBackupFolder
            })
        });

        const data = await response.json();

        if (!data.success) {
            if (status) status.textContent = data.message || "上傳失敗";
            if (btn) btn.disabled = false;
            return;
        }

        if (status) {
            status.textContent = data.message || "已開始雲端上傳";
        }

    } catch (error) {
        console.error("Google Drive 上傳失敗:", error);
        if (status) status.textContent = "上傳失敗，請查看 console。";
        if (btn) btn.disabled = false;
    }
}

function setCloudUploadRunning(isRunning) {
    const btn = document.getElementById("cloudUploadLatestBtn");
    if (!btn) return;

    if (isRunning) {
        btn.textContent = "取消上傳";
        btn.dataset.mode = "cancel";
        btn.disabled = false;
    } else {
        btn.textContent = "立即上傳最新備份";
        btn.dataset.mode = "start";
        btn.disabled = false;
    }
}


function renderCloudUploadProgress(data) {

    const percent = data.percent || 0;
    showCloudUploadTaskButton(percent);

    // 原本雲端頁
    const status = document.getElementById("cloudUploadStatus");
    const file = document.getElementById("cloudUploadFile");
    const bar = document.getElementById("cloudUploadProgressBar");
    const text = document.getElementById("cloudUploadProgressText");

    // 手動備份頁新增
    const manualStatus = document.getElementById("manualCloudUploadStatus");
    const manualFile = document.getElementById("manualCloudUploadFile");
    const manualBar = document.getElementById("manualCloudUploadProgressBar");
    const manualText = document.getElementById("manualCloudUploadProgressText");

    const manualCloudBox = document.getElementById("manualCloudUploadBox");

    if (manualCloudBox && data.status === "running") {
        manualCloudBox.classList.remove("hidden");
    }

    const msg = data.message || "雲端上傳中";
    const fileName = data.file_name || "無";

    if (status) status.textContent = msg;
    if (file) file.textContent = `目前檔案：${fileName}`;
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${percent}%`;

    if (manualStatus) manualStatus.textContent = `雲端上傳：${msg}`;
    if (manualFile) manualFile.textContent = `目前檔案：${fileName}`;
    if (manualBar) manualBar.style.width = `${percent}%`;
    if (manualText) manualText.textContent = `${percent}%`;

    if (isBackupEndStatus(data)) {
        setTimeout(() => {
            hideCloudUploadTaskButton();
        }, 3000);

        fadeOutAndHide(document.getElementById("manualBackupProgressBox"), 3000);
    }

    
}


function showCloudUploadTaskButton(percent = 0) {
    const btn = document.getElementById("cloudUploadTaskBtn");
    const ring = document.getElementById("cloudUploadTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

    const circumference = 106.8;
    const offset = circumference - (circumference * percent / 100);
    ring.style.strokeDashoffset = offset;
}

function hideCloudUploadTaskButton() {
    const btn = document.getElementById("cloudUploadTaskBtn");
    if (btn) btn.classList.add("hidden");
}


function updateBackupRecordItem(record) {
    if (!record || !record.id) return;

    backupRecordsCache = backupRecordsCache.map(item => {
        return item.id === record.id ? record : item;
    });

    if (!backupRecordsCache.some(item => item.id === record.id)) {
        backupRecordsCache.unshift(record);
    }

    renderFilteredBackupRecords();
}

async function cancelGoogleDriveUpload() {
    const status = document.getElementById("cloudUploadStatus");
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        const response = await fetch("/api/cloud/google/cancel-upload", {
            method: "POST"
        });

        const data = await response.json();

        if (status) {
            status.textContent = data.message || "已送出取消雲端上傳請求";
        }

    } catch (error) {
        console.error("取消 Google Drive 上傳失敗:", error);
        if (status) status.textContent = "取消上傳失敗，請查看 console。";

    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}


function setBoolButton(btn, value) {
    if (!btn) return;

    btn.dataset.value = value ? "true" : "false";
    btn.textContent = value ? "True" : "False";

    btn.classList.toggle("true", value);
    btn.classList.toggle("false", !value);
}

function formatAutoBackupTime(value) {
    if (!value) return "未啟用";

    return value.replace("T", " ");
}

async function loadAutoBackupConfig() {
    try {
        const response = await fetch("/api/backup/auto-config", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        const config = data.config || {};

        autoBackupState.enabled = !!config.auto_backup_enabled;
        autoBackupState.frequency = config.auto_backup_frequency || "daily";
        autoBackupState.startAt = config.auto_backup_start_at || "";
        autoBackupState.nextRunAt = config.auto_backup_next_run_at || "";
        autoBackupState.uploadCloud = !!config.auto_backup_upload_cloud;

        const enabledBtn = document.getElementById("autoBackupEnabledBtn");
        const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
        const frequency = document.getElementById("autoBackupFrequency");
        const startAt = document.getElementById("autoBackupStartAt");
        const nextText = document.getElementById("autoBackupNextRunText");

        setBoolButton(enabledBtn, autoBackupState.enabled);
        setBoolButton(uploadBtn, autoBackupState.uploadCloud);

        if (frequency) frequency.value = autoBackupState.frequency;
        if (startAt) startAt.value = autoBackupState.startAt;
        if (nextText) nextText.textContent = formatAutoBackupTime(autoBackupState.nextRunAt);

        if (config.auto_backup_missed_pending) {
            await handleAutoBackupMissed({
                data: JSON.stringify({
                    missed_run_at: config.auto_backup_missed_run_at || ""
                })
            });
        }

    } catch (error) {
        console.error("讀取自動備份設定失敗:", error);
    }
}

async function saveAutoBackupConfig() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const frequency = document.getElementById("autoBackupFrequency");
    const startAt = document.getElementById("autoBackupStartAt");

    const enabled = enabledBtn?.dataset.value === "true";
    const uploadCloud = uploadBtn?.dataset.value === "true";

    if (enabled && !startAt?.value) {
        alert("請先選擇自動備份開始時間。");
        return;
    }

    try {
        const response = await fetch("/api/backup/auto-config", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                auto_backup_enabled: enabled,
                auto_backup_frequency: frequency ? frequency.value : "daily",
                auto_backup_start_at: startAt ? startAt.value : "",
                auto_backup_upload_cloud: uploadCloud
            })
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "儲存自動備份設定失敗");
            return;
        }

        alert(data.message || "自動備份設定已儲存");
        await loadAutoBackupConfig();

    } catch (error) {
        console.error("儲存自動備份設定失敗:", error);
        alert("儲存自動備份設定失敗，請查看 console。");
    }
}

function setupAutoBackupSettings() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const saveBtn = document.getElementById("autoBackupSaveBtn");

    if (enabledBtn) {
        enabledBtn.addEventListener("click", () => {
            const nextValue = enabledBtn.dataset.value !== "true";
            setBoolButton(enabledBtn, nextValue);

            if (nextValue) {
                alert(
                    "若要自動備份，請確保 OxOcraft-Manager 在預定備份時間是執行中的。\n\n" +
                    "若預定時間未執行，系統會在下次啟動時詢問是否補做該次備份。"
                );
            }
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            const nextValue = uploadBtn.dataset.value !== "true";
            setBoolButton(uploadBtn, nextValue);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", saveAutoBackupConfig);
    }
}


function fadeOutAndHide(element, delay = 3000) {
    if (!element) return;

    element.style.opacity = "1";
    element.style.transition = "opacity 0.8s ease";

    setTimeout(() => {
        element.style.opacity = "0";

        setTimeout(() => {
            element.classList.add("hidden");
            element.style.opacity = "1";
        }, 800);

    }, delay);
}


function isBackupEndStatus(data) {
    const status = String(data.status || "").toLowerCase();
    const message = String(data.message || "");

    return (
        status === "success" ||
        status === "failed" ||
        status === "canceled" ||
        status === "cancelled" ||
        status.includes("cancel") ||
        message.includes("取消")
    );
}


function setupManualProgressCancelButtons() {
    const localCancelBtn = document.getElementById("manualCancelBackupBtn");
    const cloudCancelBtn = document.getElementById("manualCancelCloudUploadBtn");

    if (localCancelBtn) {
        localCancelBtn.addEventListener("click", async () => {
            const ok = confirm("確定要取消目前的本機備份嗎？");
            if (!ok) return;

            localCancelBtn.disabled = true;
            await cancelManualBackup();
        });
    }

    if (cloudCancelBtn) {
        cloudCancelBtn.addEventListener("click", async () => {
            const ok = confirm("確定要取消目前的雲端上傳嗎？");
            if (!ok) return;

            cloudCancelBtn.disabled = true;
            await cancelGoogleDriveUpload();
        });
    }
}


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

    const logBox = document.getElementById("logBox");
    if (logBox) {
        logBox.textContent = "伺服器尚未啟動";
    }
   

    const backupRefreshRecordsBtn = document.getElementById("backupRefreshRecordsBtn");
    if (backupRefreshRecordsBtn) {
        backupRefreshRecordsBtn.addEventListener("click", loadBackupRecords);
    }


    document.getElementById("cloudUploadLatestBtn")?.addEventListener("click", uploadLatestBackupToGoogleDrive);

    // ===== 定時更新 =====
    initServerStatus();


    // ===== 初始化 =====
    setupServerSettingsModal();
    setupServerSettingSearch();
    setupEulaModal();
    checkEulaStatus();
    setupServerInitModal();
    checkFirstRunGuide();
    setupServerEvents();
    setupBackupModal();
    setupBackupActionButton();
    setupBackupPathEditButtons();
    setupCloudBackupFolderPicker();
    setupBackgroundTaskButtons();
    setupBackupRecordFilters();
    setupAutoBackupSettings();
    setupManualBackupButtons();
    loadAutoBackupConfig();
    setupManualProgressCancelButtons();
    initDeathBook();
    initFeatureCards();
    


    
});
