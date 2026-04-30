let isTransitioning = false;
let statusPollingTimer = null;
let backendDisconnected = false;
let wasServerOnline = false;
let serverSettingKeyword = "";
let serverSettingsServerOnline = false;
let serverEvents = null;
let lastServerStatusRevision = null;
let pendingServerStatusPayload = null;
let commandHistory = [];
let commandHistoryIndex = -1;


function stopAllPolling() {
    if (statusPollingTimer !== null) {
        clearInterval(statusPollingTimer);
        statusPollingTimer = null;
    }
}

function handleBackendDisconnected() {
    if (backendDisconnected) return;

    backendDisconnected = true;
    stopAllPolling();

    if (serverEvents) {
        serverEvents.close();
        serverEvents = null;
    }

    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");

    if (statusLight) {
        statusLight.classList.remove("online", "offline", "starting");
        statusLight.classList.add("disconnected");
    }

    if (statusText) {
        statusText.textContent = "管理介面已中斷";
    }

    if (powerBtn) {
        powerBtn.disabled = true;
        powerBtn.classList.add("loading");
    }

    console.error("Flask 後端已失聯，已停止輪詢。");
}



async function updateStatus() {
    try {
        const response = await fetch("/api/server/query-status", { cache: "no-store" });
        const payload = await response.json();
        applyServerStatusPayload(payload);

    } catch (error) {
        console.error("更新狀態失敗:", error);
        handleBackendDisconnected();
    }
}

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
        appendLogLine(payload.line);
    });

    serverEvents.addEventListener("log_clear", () => {
        clearLogBox();
    });
}



async function updatePlayers() {
    try {
        const response = await fetch("/players", { cache: "no-store" });
        const data = await response.json();

        const playersList = document.getElementById("playersList");
        if (!playersList) return;

        playersList.innerHTML = "";

        if (!data.success || !data.players || data.players.length === 0) {
            playersList.innerHTML = "<div class='no-player'>目前沒有玩家在線</div>";
            return;
        }

        data.players.forEach(player => {
            const item = document.createElement("div");
            item.className = "player-item";

            const left = document.createElement("div");
            left.className = "player-main";

            const avatar = document.createElement("img");
            avatar.className = "player-avatar";
            avatar.src = `https://mc-heads.net/avatar/${player}`;
            avatar.alt = `${player} avatar`;

            const name = document.createElement("span");
            name.className = "player-name";
            name.textContent = player;

            left.appendChild(avatar);
            left.appendChild(name);

            const menuWrap = document.createElement("div");
            menuWrap.className = "player-menu-wrap";

            const menuBtn = document.createElement("button");
            menuBtn.className = "player-menu-btn";
            menuBtn.type = "button";
            menuBtn.textContent = "⋮";
            menuBtn.dataset.player = player;

            const menu = document.createElement("div");
            menu.className = "player-menu";
            menu.hidden = true;

            const kickBtn = document.createElement("button");
            kickBtn.className = "player-menu-item";
            kickBtn.type = "button";
            kickBtn.textContent = "踢出伺服器";
            kickBtn.dataset.action = "kick";
            kickBtn.dataset.player = player;

            menu.appendChild(kickBtn);
            menuWrap.appendChild(menuBtn);
            menuWrap.appendChild(menu);

            item.appendChild(left);
            item.appendChild(menuWrap);
            playersList.appendChild(item);
        });

    } catch (error) {
        console.error("更新玩家列表失敗:", error);
    }
}

function clearPlayersList() {
    const playersList = document.getElementById("playersList");
    if (!playersList) return;

    playersList.innerHTML = "<div class='no-player'>目前沒有玩家在線</div>";
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

        // 送出指令後稍微等一下，再更新 log / status
        setTimeout(() => {
            updateStatus();
        }, 300);

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

                updatePlayers();
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



// 成就功能卡顯示
function setupGlobalFeatureCard() {
    const globalCard = document.getElementById("globalFeatureCard");
    const globalButtonHost = document.getElementById("globalFeatureButtonHost");
    const featureItems = document.querySelectorAll(".feature-item");

    if (!globalCard || !globalButtonHost || !featureItems.length) return;

    let hideTimer = null;
    let activeButton = null;
    let activePlaceholder = null;
    let activeOriginalParent = null;
    let activeItem = null;

    function cancelHide() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    }

    function restoreButton() {
        if (activeButton && activeOriginalParent) {
            if (activePlaceholder && activePlaceholder.parentNode) {
                activePlaceholder.parentNode.replaceChild(activeButton, activePlaceholder);
            } else {
                activeOriginalParent.appendChild(activeButton);
            }
        }

        activeButton = null;
        activePlaceholder = null;
        activeOriginalParent = null;
        activeItem = null;

        globalButtonHost.classList.add("hidden");
        globalButtonHost.innerHTML = "";

        globalCard.classList.add("hidden");
        globalCard.innerHTML = "";
    }

    function scheduleHide() {
        cancelHide();
        hideTimer = setTimeout(() => {
            restoreButton();
        }, 80);
    }

    function showCard(item) {
        const sourceCard = item.querySelector(".feature-hover-card");
        const btn = item.querySelector(".feature-btn");

        if (!sourceCard || !btn) return;

        cancelHide();

        // 如果已經是目前這顆，就不要重複搬移，避免一直重置
        if (activeItem === item) {
            return;
        }

        // 如果目前已有其他顆在外層，先還原
        if (activeButton) {
            restoreButton();
        }

        const rect = btn.getBoundingClientRect();
        const roundedLeft = Math.round(rect.left);
        const roundedTop = Math.round(rect.top);

        globalCard.innerHTML = sourceCard.innerHTML;
        globalCard.classList.remove("hidden");
        globalCard.style.left = `${roundedLeft - 15}px`;
        globalCard.style.top = `${roundedTop - 4}px`;

        activeButton = btn;
        activeOriginalParent = btn.parentNode;
        activeItem = item;

        const placeholder = document.createElement("div");
        placeholder.className = "feature-btn-placeholder";
        activePlaceholder = placeholder;

        activeOriginalParent.replaceChild(placeholder, btn);

        globalButtonHost.classList.remove("hidden");
        globalButtonHost.style.left = `${roundedLeft}px`;
        globalButtonHost.style.top = `${roundedTop}px`;
        globalButtonHost.innerHTML = "";
        globalButtonHost.appendChild(btn);
    }

    featureItems.forEach((item) => {
        item.addEventListener("mouseenter", () => {
            showCard(item);
        });

        item.addEventListener("mouseleave", (event) => {
            const toElement = event.relatedTarget;

            // 如果滑鼠是移到外層按鈕 host，不要關閉
            if (toElement && globalButtonHost.contains(toElement)) {
                return;
            }

            scheduleHide();
        });
    });

    globalButtonHost.addEventListener("mouseenter", () => {
        cancelHide();
    });

    globalButtonHost.addEventListener("mouseleave", (event) => {
        const toElement = event.relatedTarget;

        // 如果滑鼠從外層按鈕又回到原本某個 feature-item，就不要關閉
        const movedToFeatureItem = Array.from(featureItems).some((item) => {
            return toElement && item.contains(toElement);
        });

        if (movedToFeatureItem) {
            return;
        }

        scheduleHide();
    });

    window.addEventListener("scroll", () => {
        restoreButton();
    }, true);

    window.addEventListener("resize", () => {
        restoreButton();
    });
}


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


function applyServerStatusPayload(payload) {
    if (!payload || !payload.data) return;

    if (isTransitioning) {
        pendingServerStatusPayload = payload;
        return;
    }

    if (payload.revision === lastServerStatusRevision) {
        return;
    }

    lastServerStatusRevision = payload.revision;

    const data = payload.data;

    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");
    const logBox = document.getElementById("logBox");

    if (!statusLight || !statusText) return;

    if (data.state === "ready") {
        statusLight.classList.remove("offline", "starting");
        statusLight.classList.add("online");
        statusText.textContent = "在線";
    } else if (data.state === "starting") {
        statusLight.classList.remove("online", "offline");
        statusLight.classList.add("starting");
        statusText.textContent = "啟動中...";
    } else {
        statusLight.classList.remove("online", "starting");
        statusLight.classList.add("offline");
        statusText.textContent = "離線";
    }

    if (powerBtn) {
        if (data.online) {
            powerBtn.classList.remove("offline");
            powerBtn.classList.add("online");
        } else {
            powerBtn.classList.remove("online");
            powerBtn.classList.add("offline");
        }
    }

    if (data.online && !wasServerOnline) {
        updatePlayers();
    }

    if (!data.online && wasServerOnline) {
        if (logBox) {
            logBox.textContent = "伺服器尚未啟動";
        }

        clearPlayersList();
    }

    wasServerOnline = data.online;
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
   
    setupDeathBook();

    // ===== 定時更新 =====
    statusPollingTimer = setInterval(updateStatus, 10000);


    // ===== 初始化 =====
    updatePlayers();
    updateStatus();
    setupGlobalFeatureCard();
    setupServerSettingsModal();
    setupServerSettingSearch();
    setupEulaModal();
    checkEulaStatus();
    setupServerInitModal();
    checkFirstRunGuide();
    setupServerEvents();
    
});