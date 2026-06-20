import {
    latestServerStatusData
} from "./server_status.js";

import {
    saveAndRestartServer
} from "./server_control.js";

import {
    showConfirm,
    showInfo
} from "./system_dialog.js";


let serverSettingKeyword = "";
let serverSettingsServerState = "offline";
let serverSettingFields = [];
let serverSettingsState = {};
let serverSettingsEffectiveState = {};
let serverSettingsBusyMode = null;
let serverSettingsBusyUnlockAt = 0;
let serverSettingsBusyRecheckTimer = null;
let pendingServerIconFile = null;
let pendingServerIconPreviewUrl = null;
let serverIconNeedsRestart = false;
const SERVER_SETTINGS_BUSY_MIN_MS = 1000;

const SERVER_SETTING_GROUPS = [
    {
        key: "java",
        label: "Java",
        description: "伺服器啟動時使用的 Java 記憶體設定。"
    },
    {
        key: "general",
        label: "一般",
        description: "最常使用的伺服器基本設定。"
    },
    {
        key: "game",
        label: "遊戲",
        description: "影響玩家進入伺服器後的遊戲規則。"
    },
    {
        key: "world",
        label: "世界",
        description: "建立或載入世界時使用的設定，目前暫時保留在此頁。"
    },
    {
        key: "network",
        label: "網路",
        description: "玩家連線、伺服器列表、RCON 與 Query 相關設定。"
    },
    {
        key: "performance",
        label: "效能",
        description: "影響伺服器負載、TPS、區塊與網路資料量的設定。"
    },
    {
        key: "advanced",
        label: "進階",
        description: "一般情況較少修改，建議了解用途後再調整。"
    }
];


export function initServerSettings() {
    setupServerSettingsModal();
    setupServerSettingSearch();
    setupServerSettingTooltip();
    setupServerSettingsStatusSync();
}


function setupServerSettingsStatusSync() {
    window.addEventListener("server-status-changed", (event) => {
        updateServerSettingsFooterModeByState(event.detail);
    });
}


function setupServerSettingTooltip() {
    let tooltip = null;
    let showTimer = null;

    function removeTooltip() {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }

        if (tooltip) {
            tooltip.remove();
            tooltip = null;
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function buildTooltipHtml(field) {
        const title = escapeHtml(field.label || field.key);
        const key = escapeHtml(field.key || "");
        const description = escapeHtml(
            field.description || "目前沒有說明。"
        ).replace(/\n/g, "<br>");

        const defaultValue =
            field.default !== undefined && field.default !== ""
                ? escapeHtml(field.default)
                : "無";

        const locked = !!field.locked;
        const statusText = locked
            ? escapeHtml(
                field.lockedReason ||
                "此設定由 OxOcraft-Manager 管理，不能修改。"
            )
            : "可修改";

        const statusClass = locked
            ? "server-setting-tooltip-status-bad"
            : "server-setting-tooltip-status-good";

        return `
            <div class="server-setting-tooltip-title">
                <span>${title}</span>
                <span class="server-setting-tooltip-key">(${key})</span>
            </div>

            <div class="server-setting-tooltip-desc">
                ${description}
            </div>

            <div class="server-setting-tooltip-meta">
                <div>
                    <span class="server-setting-tooltip-meta-label">預設值：</span>
                    <span class="server-setting-tooltip-default">${defaultValue}</span>
                </div>
                <div>
                    <span class="server-setting-tooltip-meta-label">狀態：</span>
                    <span class="${statusClass}">${statusText}</span>
                </div>
            </div>
        `;
    }

    function moveTooltip(event) {
        if (!tooltip) return;

        const padding = 16;
        const offsetX = 56;
        const offsetY = -24;

        let left = event.clientX + offsetX;
        let top = event.clientY + offsetY;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;

        const rect = tooltip.getBoundingClientRect();

        if (rect.right > window.innerWidth - padding) {
            left = event.clientX - rect.width - offsetX;
        }

        if (rect.bottom > window.innerHeight - padding) {
            top = event.clientY - rect.height - offsetY;
        }

        tooltip.style.left = `${Math.max(padding, left)}px`;
        tooltip.style.top = `${Math.max(padding, top)}px`;
    }

    document.addEventListener("mouseover", (event) => {
        const helpBtn = event.target.closest(".setting-help-btn");
        if (!helpBtn) return;

        const key = helpBtn.dataset.key;
        const field = serverSettingFields.find(item => item.key === key);
        if (!field) return;

        removeTooltip();

        showTimer = setTimeout(() => {
            tooltip = document.createElement("div");
            tooltip.className = "server-setting-tooltip";
            tooltip.innerHTML = buildTooltipHtml(field);

            document.body.appendChild(tooltip);
            moveTooltip(event);
        }, 160);
    });

    document.addEventListener("mousemove", (event) => {
        const helpBtn = event.target.closest(".setting-help-btn");

        if (!helpBtn) {
            return;
        }

        moveTooltip(event);
    });

    document.addEventListener("mouseout", (event) => {
        const helpBtn = event.target.closest(".setting-help-btn");
        if (!helpBtn) return;

        removeTooltip();
    });

    window.addEventListener("scroll", removeTooltip, true);
}


function setupServerSettingsModal() {
    const modal = document.getElementById("serverSettingsModal");
    const openBtn = document.getElementById("serverSettingBtn");
    const applyBtn = document.getElementById("serverSettingsApplyBtn");
    const restartBtn = document.getElementById("serverSettingsRestartBtn");
    const resetBtn = document.getElementById("serverSettingsResetBtn");
    const previewIcon = document.getElementById("serverPreviewIcon");
    const iconInput = document.getElementById("serverIconInput");

    if (resetBtn) {
        resetBtn.innerHTML = `<img src="/static/icons/server_settings/refresh_16.png" alt="reset"> `;
    }
    

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

    if (previewIcon && iconInput) {
        previewIcon.addEventListener("click", () => {
            iconInput.click();
        });

        iconInput.addEventListener("change", () => {
            const file = iconInput.files?.[0];
            if (!file) return;

            if (!["image/png", "image/jpeg"].includes(file.type)) {
                showInfo({
                    title: "圖片格式錯誤",
                    message: "目前只支援 PNG / JPG 圖片。"
                });

                iconInput.value = "";
                return;
            }

            pendingServerIconFile = file;
            serverIconNeedsRestart = true;

            if (pendingServerIconPreviewUrl) {
                URL.revokeObjectURL(pendingServerIconPreviewUrl);
            }

            pendingServerIconPreviewUrl = URL.createObjectURL(file);
            previewIcon.src = pendingServerIconPreviewUrl;

            updateServerSettingsStatusCard();

        });
    }

    modal.addEventListener("click", (event) => {

        const layout = modal.querySelector(".settings-layout");

        if (
            event.target !== modal &&
            event.target !== layout
        ) {
            return;
        }

        modal.classList.add("hidden");

        serverSettingKeyword = "";

        const searchInput =
            document.getElementById("serverSettingSearch");

        if (searchInput) {
            searchInput.value = "";
        }
    });

}


async function resetServerSettingsToDefault() {

    const confirmed = await showConfirm({
        title: "恢復預設值",
        message:
    `是否將所有設定恢復為 Minecraft 原版預設值？

請注意：若伺服器在線時恢復成預設值，不代表馬上就套用，仍須重啟才會生效！。`,
        confirmText: "恢復預設",
        cancelText: "取消"
    });

    if (!confirmed) return;

    serverSettingFields.forEach((field) => {

        if(field.default === undefined){
            return;
        }else if(field.key === "rcon.password"){
            return;
        }

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

    const renderedGroupSet = new Set();

    const groupOrderMap = new Map(
        SERVER_SETTING_GROUPS.map((group, index) => [
            group.key,
            index
        ])
    );

    function syncDirtyBadge(container, key) {
        let badge = container.querySelector(".setting-dirty-badge");

        if (isFieldDirty(key)) {
            if (!badge) {
                badge = document.createElement("div");
                badge.className = "setting-dirty-badge";
                badge.textContent = "● 待套用";
                container.appendChild(badge);
            }
        } else {
            badge?.remove();
        }
    }

    const visibleFields = serverSettingFields
        .filter((field) => {
            const keyword = serverSettingKeyword;

            if (keyword) {
                const searchText = `
                    ${field.key}
                    ${field.label}
                    ${field.description || ""}
                `.toLowerCase();

                if (!searchText.includes(keyword)) {
                    return false;
                }
            }

            if (field.dependsOn) {
                const parentValue = serverSettingsState[field.dependsOn.key];
                if (parentValue !== field.dependsOn.value) {
                    return false;
                }
            }

            return true;
        })
        .sort((a, b) => {
            const groupA = a.group || "advanced";
            const groupB = b.group || "advanced";

            const orderA = groupOrderMap.get(groupA) ?? 999;
            const orderB = groupOrderMap.get(groupB) ?? 999;

            if (orderA !== orderB) {
                return orderA - orderB;
            }

            return serverSettingFields.indexOf(a) - serverSettingFields.indexOf(b);
        });

    visibleFields.forEach((field) => {
        const groupKey = field.group || "advanced";

        if (!renderedGroupSet.has(groupKey)) {
            renderedGroupSet.add(groupKey);

            const group = SERVER_SETTING_GROUPS.find(
                item => item.key === groupKey
            ) || {
                label: "其他",
                description: ""
            };

            const groupBlock = document.createElement("div");
            groupBlock.className = "setting-group-header";

            groupBlock.innerHTML = `
                <div class="setting-group-title">${group.label}</div>
                ${
                    group.description
                        ? `<div class="setting-group-description">${group.description}</div>`
                        : ""
                }
            `;

            body.appendChild(groupBlock);
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
                <button class="setting-help-btn" type="button" data-key="${field.key}">ⓘ</button>
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
            syncDirtyBadge(boolWrap, field.key);
            boolWrap.appendChild(defaultText);

            valueWrap.appendChild(boolWrap);

        } else if (field.type === "select") {
            const selectWrap = document.createElement("div");
            selectWrap.className = "setting-inline-wrap";

            const select = document.createElement("select");
            select.className = "setting-input";
            select.dataset.key = field.key;

            if (field.locked) {
                select.disabled = true;
                select.classList.add("locked");
                select.title = field.lockedReason || "此設定由 OxOcraft-Manager 管理，不能修改。";
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
                syncDirtyBadge(selectWrap, field.key);
                updateServerSettingsStatusCard();
            });

            selectWrap.appendChild(select);
            syncDirtyBadge(selectWrap, field.key);

            valueWrap.appendChild(selectWrap);

        } else {
            const input = document.createElement("input");
            input.className = "setting-input";
            input.dataset.key = field.key;

            if (field.locked) {
                input.disabled = true;
                input.classList.add("locked");
                input.title = field.lockedReason || "此設定由 OxOcraft-Manager 管理，不能修改。";
            }

            const isPasswordField =
                field.key === "rcon.password" ||
                field.key === "rcon_password";

            input.type = isPasswordField
                ? "password"
                : field.type === "number"
                    ? "number"
                    : "text";

            input.value = serverSettingsState[field.key] || "";

            const defaultValue =
                field.default !== undefined && field.default !== ""
                    ? field.default
                    : "無";

            input.placeholder = `預設值:${defaultValue}`;

            if (isPasswordField) {
                const passwordWrap = document.createElement("div");
                passwordWrap.className = "setting-password-wrap";

                input.addEventListener("input", () => {
                    serverSettingsState[field.key] = input.value;
                    syncDirtyBadge(passwordWrap, field.key);
                    updateServerSettingsStatusCard();
                });

                const toggleBtn = document.createElement("button");
                toggleBtn.type = "button";
                toggleBtn.className = "setting-password-toggle";
                toggleBtn.innerHTML = `<img src="/static/icons/server_settings/eye_16.png" alt="toggle-password">`;
                toggleBtn.title = "顯示/隱藏密碼";

                const regenBtn = document.createElement("button");
                regenBtn.type = "button";
                regenBtn.className = "setting-password-regenerate";
                regenBtn.innerHTML = `<img src="/static/icons/server_settings/refresh_16.png" alt="refresh">`;
                regenBtn.title = "重新生成 RCON 密碼";

                toggleBtn.addEventListener("click", () => {
                    const isHidden = input.type === "password";
                    input.type = isHidden ? "text" : "password";
                    toggleBtn.classList.toggle("showing", isHidden);
                });

                regenBtn.addEventListener("click", async () => {
                    const confirmed = await showConfirm({
                        title: "重新生成 RCON 密碼",
                        message: "請問是否要重新生成RCON的密碼?",
                        confirmText: "確定",
                        cancelText: "取消"
                    });

                    if (!confirmed) return;

                    try {
                        regenBtn.disabled = true;

                        const response = await fetch(
                            "/api/server/regenerate-rcon-password",
                            { method: "POST" }
                        );

                        const data = await response.json();

                        if (!data.success) {
                            showInfo({
                                title: "重新生成失敗",
                                message: data.message || "未知錯誤"
                            });
                            return;
                        }

                        input.value = data.password;
                        serverSettingsState[field.key] = data.password;

                        syncDirtyBadge(passwordWrap, field.key);
                        updateServerSettingsStatusCard();

                    } catch (error) {
                        console.error(error);
                        showInfo({
                            title: "重新生成失敗",
                            message: "請查看 console。"
                        });

                    } finally {
                        regenBtn.disabled = false;
                    }
                });

                passwordWrap.appendChild(input);
                passwordWrap.appendChild(toggleBtn);
                passwordWrap.appendChild(regenBtn);
                syncDirtyBadge(passwordWrap, field.key);

                valueWrap.appendChild(passwordWrap);

            } else {
                const inputWrap = document.createElement("div");
                inputWrap.className = "setting-inline-wrap";

                input.addEventListener("input", () => {
                    serverSettingsState[field.key] = input.value;
                    syncDirtyBadge(inputWrap, field.key);
                    updateServerSettingsStatusCard();
                });

                inputWrap.appendChild(input);
                syncDirtyBadge(inputWrap, field.key);

                valueWrap.appendChild(inputWrap);
            }
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
            if (data.fallback) {
                Object.entries(data.fallback).forEach(([key, value]) => {
                    serverSettingsState[key] = value;
                });

                renderServerSettings();
                updateServerSettingsStatusCard();
            }

            showInfo({
                title: "儲存失敗!",
                message: data.message || "未知錯誤",
                variant: "error"
            });

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
            showInfo({
                title: "記憶體設定儲存失敗",
                message: runtimeData.message || "未知錯誤"
            });
            return false;
        }

        if (pendingServerIconFile) {
            const iconForm = new FormData();
            iconForm.append("icon", pendingServerIconFile);

            const iconResponse = await fetch("/api/server/icon", {
                method: "POST",
                body: iconForm
            });

            const iconData = await iconResponse.json();

            if (!iconData.success) {
                showInfo({
                    title: "伺服器圖示儲存失敗",
                    message: iconData.message || "未知錯誤"
                });
                return false;
            }

            pendingServerIconFile = null;

            if (serverSettingsServerState !== "ready") {
                serverIconNeedsRestart = false;
            }

            if (pendingServerIconPreviewUrl) {
                URL.revokeObjectURL(pendingServerIconPreviewUrl);
                pendingServerIconPreviewUrl = null;
            }

            updateServerSettingsStatusCard();
            
        }

        if (showAlert) {
            if (serverSettingsServerState === "ready") {
                await showInfo({
                    title: "設定已保留",
                    message:
                `請注意：若設定值不符合格式，伺服器重啟後將自動修正或恢復預設值。`,
                variant: "success"
                });
            } else {
                await showInfo({
                    title: "參數已修改",
                    message:
                `請注意：若設定值不符合格式，伺服器重啟後將自動修正或恢復預設值。`,
                variant: "success"
                });
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
        showInfo({
            title: "儲存失敗",
            message: "請查看 console。"
        });
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

        if (
            serverSettingsBusyMode === "starting" &&
            state !== "starting" &&
            canUnlock
        ) {
            serverSettingsBusyMode = null;

        } else if (
            serverSettingsBusyMode === "stopping" &&
            !online &&
            state !== "starting" &&
            canUnlock
        ) {
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
            icon: "/static/icons/server_settings/status_online.png",
            text: "伺服器運行中"
        },
        starting: {
            icon: "/static/icons/server_settings/status_busy.png",
            text: "伺服器啟動中"
        },
        stopping: {
            icon: "/static/icons/server_settings/status_busy.png",
            text: "伺服器關閉中"
        },
        offline: {
            icon: "/static/icons/server_settings/status_offline.png",
            text: "伺服器未啟動"
        },
        disconnected: {
            icon: "/static/icons/server_settings/status_disconnected.png",
            text: "管理介面中斷"
        },
        unknown: {
            icon: "/static/icons/server_settings/status_disconnected.png",
            text: "狀態未知"
        }
    };

    const status = statusMap[state] || statusMap.offline;

    box.innerHTML = `
        <img class="settings-status-icon" src="${status.icon}" alt="">
        <span>${status.text}</span>
    `;
}


function updateServerPreviewCard() {

    const motdBox =
        document.getElementById("serverPreviewMotd");

    const playersBox =
        document.getElementById("serverPreviewPlayers");

    if (motdBox) {
        motdBox.textContent =
            serverSettingsState["motd"]
            || "A Minecraft Server";
    }

    if (playersBox) {

        const maxPlayers =
            serverSettingsState["max-players"]
            || "20";

        playersBox.textContent =
            `0/${maxPlayers}`;
    }

    const icon =
        document.getElementById("serverPreviewIcon");

    if (icon && !pendingServerIconFile) {
        icon.src =
            `/api/server/icon-preview?t=${Date.now()}`;
    }

}


function updateServerSettingsStatusCard() {
    updateServerSettingsStatusState(serverSettingsServerState);
    updateServerSettingsStatusSummary();
    updateServerSettingsDirtyList();
    updateServerPreviewCard();
}


function updateServerSettingsStatusSummary() {

    const summary = document.getElementById("settingsStatusSummary");
    if (!summary) return;

    const dirtyCount = getDirtySettingKeys().length + (serverIconNeedsRestart ? 1 : 0);

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

    if (dirtyKeys.length <= 0 && !serverIconNeedsRestart) {
        list.innerHTML = `<div class="settings-dirty-item">無</div>`;
        return;
    }

    list.innerHTML = "";

    if (serverIconNeedsRestart) {
        const div = document.createElement("div");
        div.className = "settings-dirty-item";
        div.textContent = "▸ 伺服器圖示：已選擇新圖片";
        list.appendChild(div);
    }

    dirtyKeys.forEach((key) => {

        const field = serverSettingFields.find(item => item.key === key);

        const div = document.createElement("div");
        div.className = "settings-dirty-item";

        const isPasswordField =
            key === "rcon.password" ||
            key === "rcon_password";

        if (isPasswordField) {
            div.textContent =
                `▸ ${field?.label || key} (${key})：密碼已變更`;
        } else {
            const oldValue = serverSettingsEffectiveState[key] ?? "無";
            const newValue = serverSettingsState[key] ?? "無";

            div.textContent =
                `▸ ${field?.label || key} (${key})：${oldValue} > ${newValue}`;
        }

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

