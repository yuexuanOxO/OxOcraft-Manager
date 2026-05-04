let serverSettingKeyword = "";
let serverSettingsServerOnline = false;
let serverSettingFields = [];
let serverSettingsState = {};

import {
    updateStatus
} from "./server_status.js";


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

    // if (restartBtn) {
    //     restartBtn.addEventListener("click", saveAndRestartServer);
    // }

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


