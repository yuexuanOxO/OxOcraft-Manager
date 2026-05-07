let serverSettingKeyword = "";
let serverSettingsServerState = "offline";
let serverSettingFields = [];
let serverSettingsState = {};
let serverSettingsEffectiveState = {};
let serverSettingsBusyMode = null;
let serverSettingsBusyUnlockAt = 0;
let serverSettingsBusyRecheckTimer = null;

const SERVER_SETTINGS_BUSY_MIN_MS = 2500;

import {
    latestServerStatusData
} from "./server_status.js";

import {
    saveAndRestartServer
} from "./server_control.js";

export function initServerSettings() {
    setupServerSettingsModal();
    setupServerSettingSearch();
    setupServerSettingHelp();
}


function setupServerSettingHelp() {
    document.addEventListener("click", (event) => {
        const helpBtn = event.target.closest(".setting-help-btn");
        if (!helpBtn) return;

        const key = helpBtn.dataset.key;
        const field = serverSettingFields.find(item => item.key === key);
        if (!field) return;

        alert(`${field.label} (${field.key})\n\n${field.description || "目前沒有說明。"}`);
    });
}


function setupServerSettingsModal() {
    const modal = document.getElementById("serverSettingsModal");
    const openBtn = document.getElementById("serverSettingBtn");
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const restartBtn = document.getElementById("serverSettingsRestartBtn");
    const resetBtn = document.getElementById("serverSettingsResetBtn");

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

    if (resetBtn) {
        resetBtn.addEventListener("click", resetServerSettingsToDefault);
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


function resetServerSettingsToDefault() {

    const confirmed = confirm(`
是否將所有設定恢復為 Minecraft 原版預設值？

此操作不會立即套用，
需再次按下「確定套用」或「套用後並重啟」。
`);

    if (!confirmed) return;

    serverSettingFields.forEach((field) => {

        if (field.default === undefined) return;

        serverSettingsState[field.key] =
            String(field.default);
    });

    renderServerSettings();
    updateServerSettingsStatusCard();
}


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


export async function loadServerSettings() {
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

        const effectiveResponse = await fetch("/api/server/effective-settings", { cache: "no-store" });
        const effectiveData = await effectiveResponse.json();

        if (effectiveData.success) {
            const snapshot = effectiveData.snapshot || {};

            serverSettingsEffectiveState = {
                ...(snapshot.properties || {}),
                ...(snapshot.runtime_config || {})
            };
        } else {
            serverSettingsEffectiveState = structuredClone(serverSettingsState);
        }

        // 更新最近修改時間
        updateServerSettingsModifiedTime(data.modified_comment);

        renderServerSettings();
        updateServerSettingsStatusCard();

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
            btn.className = "setting-switch-btn";
            btn.dataset.key = field.key;

            if (field.locked) {
                btn.disabled = true;
                btn.classList.add("locked");
                btn.title = field.lockedReason || "此設定由 OxOcraft-Manager 管理，不能修改。";
            }

            const value = String(serverSettingsState[field.key] || "false").toLowerCase();
            const isTrue = value === "true";

            btn.classList.toggle("on", isTrue);
            btn.classList.toggle("off", !isTrue);

            if (isFieldDirty(field.key)) {
                btn.classList.add("dirty");
            }

            btn.innerHTML = `
                <span class="setting-switch-visual">
                    <span class="setting-switch-track"></span>
                    <span class="setting-switch-thumb"></span>
                </span>
                <span class="setting-switch-text">${isTrue ? "true" : "false"}</span>
            `;

            btn.addEventListener("click", () => {
                if (field.locked) return;

                serverSettingsState[field.key] = isTrue ? "false" : "true";
                renderServerSettings();
                updateServerSettingsStatusCard();
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

            if (field.locked) {
                select.disabled = true;
                select.classList.add("locked");
                select.title = field.lockedReason || "此設定由 OxOcraft-Manager 管理，不能修改。";
            }

            if (isFieldDirty(field.key)) {
                select.classList.add("dirty");
            }

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

                if (isFieldDirty(field.key)) {
                    select.classList.add("dirty");
                } else {
                    select.classList.remove("dirty");
                }

                updateServerSettingsStatusCard();
            });

            valueWrap.appendChild(select);
        } else {
            const input = document.createElement("input");
            input.className = "setting-input";
            input.dataset.key = field.key;

            if (field.locked) {
                input.disabled = true;
                input.classList.add("locked");
                input.title = field.lockedReason || "此設定由 OxOcraft-Manager 管理，不能修改。";
            }

            input.type = field.type === "number" ? "number" : "text";
            input.value = serverSettingsState[field.key] || "";

            if (isFieldDirty(field.key)) {
                input.classList.add("dirty");
            }

            const defaultValue =
                field.default !== undefined && field.default !== ""
                    ? field.default
                    : "無";

            input.placeholder = `預設值:${defaultValue}`;

            input.addEventListener("input", () => {
                serverSettingsState[field.key] = input.value;

                if (isFieldDirty(field.key)) {
                    input.classList.add("dirty");
                } else {
                    input.classList.remove("dirty");
                }

                updateServerSettingsStatusCard();
            });

            valueWrap.appendChild(input);
        }

        row.appendChild(label);
        row.appendChild(valueWrap);
        body.appendChild(row);
    });
}


function updateServerSettingsModifiedTime(commentText) {
    const box = document.getElementById("settingsStatusModifiedTime");
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


export async function saveServerSettings(showAlert = true) {
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
            if (serverSettingsServerState === "ready") {
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

        if (serverSettingsServerState === "ready") {
            renderServerSettings();
        } else {
            await loadServerSettings();
        }

        return true;

    } catch (error) {
        console.error("儲存 server.properties 失敗:", error);
        alert("儲存失敗，請查看 console。");
        return false;

    } finally {
        updateServerSettingsFooterMode();
    }
}


function scheduleServerSettingsFooterRecheck() {
    if (serverSettingsBusyRecheckTimer) return;

    const delay = Math.max(0, serverSettingsBusyUnlockAt - Date.now());

    serverSettingsBusyRecheckTimer = setTimeout(() => {
        serverSettingsBusyRecheckTimer = null;
        updateServerSettingsFooterMode();
    }, delay + 50);
}


export function updateServerSettingsFooterMode() {
    updateServerSettingsFooterModeByState(latestServerStatusData);
}


export function updateServerSettingsFooterModeByState(data) {
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const restartBtn = document.getElementById("serverSettingsRestartBtn");
    const resetBtn = document.getElementById("serverSettingsResetBtn");
    

    if (resetBtn) {
        resetBtn.disabled = false;
    }

    if (!applyBtn || !restartBtn) return;

    const state = data?.state || "offline";
    const online = !!data?.online;
    const now = Date.now();

    if (state === "starting" || state === "stopping") {
        serverSettingsBusyMode = state;
        serverSettingsBusyUnlockAt = now + SERVER_SETTINGS_BUSY_MIN_MS;
    }

    if (serverSettingsBusyMode) {
        const canUnlock = now >= serverSettingsBusyUnlockAt;

        if (serverSettingsBusyMode === "starting" && state === "ready" && canUnlock) {
            serverSettingsBusyMode = null;
        } else if (serverSettingsBusyMode === "stopping" && !online && state !== "starting" && canUnlock) {
            serverSettingsBusyMode = null;
        } else {
            scheduleServerSettingsFooterRecheck();
        }
    }

    const displayState = serverSettingsBusyMode || state;
    serverSettingsServerState = displayState;

    updateServerSettingsStatusState(displayState);

    if (displayState === "ready") {
        applyBtn.textContent = "僅保留變更";
        applyBtn.disabled = false;

        restartBtn.textContent = "套用後並重啟";
        restartBtn.classList.remove("hidden");
        restartBtn.disabled = false;

        if (resetBtn) {
            resetBtn.disabled = false;
        }

        return;
    }

    if (displayState === "starting" || displayState === "stopping") {
        applyBtn.textContent =
        displayState === "starting"
            ? "伺服器啟動中..."
            : "伺服器關閉中...";

        applyBtn.disabled = true;

        restartBtn.textContent = "套用後並重啟";
        restartBtn.classList.remove("hidden");
        restartBtn.disabled = true;

        if (resetBtn) {
            resetBtn.disabled = true;
        }

        return;
    }

    if (displayState === "disconnected" || displayState === "unknown") {
        applyBtn.textContent = "無法確認狀態";
        applyBtn.disabled = true;

        restartBtn.classList.add("hidden");
        restartBtn.disabled = true;

        if (resetBtn) {
            resetBtn.disabled = true;
        }

        return;
    }

    applyBtn.textContent = "確定套用";
    applyBtn.disabled = false;

    restartBtn.classList.add("hidden");
    restartBtn.disabled = true;

    if (resetBtn) {
        resetBtn.disabled = false;
    }

}


function updateServerSettingsStatusState(state) {
    const box = document.getElementById("settingsStatusServerState");
    if (!box) return;

    const statusMap = {
        ready: {
            icon: "/static/icons/server_settings/status_online.ico",
            text: "伺服器運行中"
        },
        starting: {
            icon: "/static/icons/server_settings/status_busy.ico",
            text: "伺服器啟動中"
        },
        stopping: {
            icon: "/static/icons/server_settings/status_busy.ico",
            text: "伺服器關閉中"
        },
        offline: {
            icon: "/static/icons/server_settings/status_offline.ico",
            text: "伺服器未啟動"
        },
        disconnected: {
            icon: "/static/icons/server_settings/status_disconnected.ico",
            text: "管理介面中斷"
        },
        unknown: {
            icon: "/static/icons/server_settings/status_disconnected.ico",
            text: "狀態未知"
        }
    };

    const status = statusMap[state] || statusMap.offline;

    box.innerHTML = `
        <img class="settings-status-icon" src="${status.icon}" alt="">
        <span>${status.text}</span>
    `;
}


function updateServerSettingsStatusCard() {
    updateServerSettingsStatusState(serverSettingsServerState);
    updateServerSettingsStatusSummary();
    updateServerSettingsDirtyList();
    
}


function updateServerSettingsStatusSummary() {

    const summary = document.getElementById("settingsStatusSummary");
    if (!summary) return;

    const dirtyCount = getDirtySettingKeys().length;

    if (dirtyCount <= 0) {
        summary.textContent = "所有設定已生效";
        return;
    }

    summary.textContent =
        `${dirtyCount} 項設定尚未生效\n重新啟動後才會套用`;
}


function updateServerSettingsDirtyList() {

    const list = document.getElementById("settingsDirtyList");
    if (!list) return;

    const dirtyKeys = getDirtySettingKeys();

    if (dirtyKeys.length <= 0) {
        list.innerHTML = `<div class="settings-dirty-item">無</div>`;
        return;
    }

    list.innerHTML = "";

    dirtyKeys.forEach((key) => {

        const field = serverSettingFields.find(item => item.key === key);

        const div = document.createElement("div");
        div.className = "settings-dirty-item";

        const oldValue = serverSettingsEffectiveState[key] ?? "無";
        const newValue = serverSettingsState[key] ?? "無";

        div.textContent =
            `▸ ${field?.label || key} (${key})：${oldValue} > ${newValue}`;

        list.appendChild(div);
    });

}


function getDirtySettingKeys() {

    return serverSettingFields
        .map(field => field.key)
        .filter(key => isFieldDirty(key));
}


function isFieldDirty(key) {
    const current = String(serverSettingsState[key] ?? "");
    const effective = String(serverSettingsEffectiveState[key] ?? "");

    return current !== effective;
}