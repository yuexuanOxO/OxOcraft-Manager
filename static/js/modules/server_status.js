import { showOfflineCat } from "./log_console.js";

let fallbackPollingTimer = null;
let backendDisconnected = false;
let wasServerOnline = false;
let hasReceivedFirstStatus = false;
let lastServerStatusRevision = null;
let currentPlayers = new Set();
let previousServerState = null;
export let latestServerStatusData = null;


export function initServerStatus() {
    warmStatusLightCache();
    fallbackPollingTimer = setInterval(updateStatus, 10000);
    updateStatus();
}



function stopAllPolling() {
    if (fallbackPollingTimer !== null) {
        clearInterval(fallbackPollingTimer);
        fallbackPollingTimer = null;
    }
}


export function handleBackendDisconnected() {
    if (backendDisconnected) return;

    backendDisconnected = true;
    stopAllPolling();

    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");

    if (statusLight) {
        statusLight.classList.remove("online", "offline", "starting");
        setStatusLightImage(statusLight, "disconnected");
    }

    if (statusText) {
        statusText.textContent = "管理介面已中斷";
    }

    if (powerBtn) {
        powerBtn.disabled = true;
        powerBtn.classList.add("loading");
    }

    latestServerStatusData = {
        state: "disconnected",
        online: false
    };

    window.dispatchEvent(new CustomEvent("server-status-changed", {
        detail: latestServerStatusData
    }));

    console.error("Flask 後端已失聯，已停止輪詢。");
}


export async function updateStatus() {
    try {
        const response = await fetch("/api/server/query-status?force=1", { cache: "no-store" });
        const payload = await response.json();
        applyServerStatusPayload(payload);

    } catch (error) {
        console.error("更新狀態失敗:", error);
        handleBackendDisconnected();
    }
}


function setPlayersFromQuery(players) {
    currentPlayers = new Set(players || []);
    renderPlayersFromQuery([...currentPlayers]);
}


export function addPlayerFromLog(playerName) {
    if (!playerName) return;

    currentPlayers.add(playerName);
    renderPlayersFromQuery([...currentPlayers]);
}


export function removePlayerFromLog(playerName) {
    if (!playerName) return;

    currentPlayers.delete(playerName);
    renderPlayersFromQuery([...currentPlayers]);
}


function renderPlayersFromQuery(players) {
    const playersList = document.getElementById("playersList");
    if (!playersList) return;

    playersList.innerHTML = "";

    if (!players || players.length === 0) {
        playersList.innerHTML = "<div class='no-player'>目前沒有玩家在線</div>";
        return;
    }

    players.forEach(player => {
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
}


export function clearPlayersList() {
    const playersList = document.getElementById("playersList");
    if (!playersList) return;

    playersList.innerHTML = "<div class='no-player'>目前沒有玩家在線</div>";
}


export function applyServerStatusPayload(payload) {
    if (!payload || !payload.data) return;


    if (payload.revision === lastServerStatusRevision) {
        return;
    }

    lastServerStatusRevision = payload.revision;

    const data = payload.data;
    latestServerStatusData = data;

    const isFirstStatus = !hasReceivedFirstStatus;
    hasReceivedFirstStatus = true;

    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");

    

    if (isFirstStatus && data.state === "offline") {
        showOfflineCat();
        clearPlayersList();
    }

    if (!isFirstStatus && previousServerState !== "offline" && data.state === "offline") {
        showOfflineCat();
        clearPlayersList();
    }

    if (data.online && data.query_ready !== false) {
        setPlayersFromQuery(data.players || []);
    }

    if (!statusLight || !statusText) return;

    if (data.state === "ready") {
        statusLight.classList.remove("offline", "starting");
        setStatusLightImage(statusLight, "online");
        statusText.textContent = "在線";

        if (powerBtn) {
            powerBtn.disabled = false;
            powerBtn.classList.remove("loading");
        }
        
    }else if (data.state === "backuping") {
        statusLight.classList.remove("online", "offline");
        setStatusLightImage(statusLight, "busy");

        statusText.textContent = "備份中...";

        if (powerBtn) {
            powerBtn.disabled = true;
            powerBtn.classList.add("loading");
        }
    }else if (data.state === "stopping") {
        statusLight.classList.remove("online", "offline");
        setStatusLightImage(statusLight, "busy");

        statusText.textContent = "關閉中...";

        if (powerBtn) {
            powerBtn.disabled = true;
            powerBtn.classList.add("loading");

        }

    }else if (data.state === "starting") {
        statusLight.classList.remove("online", "offline");
        setStatusLightImage(statusLight, "busy");
        statusText.textContent = "啟動中...";

        if (powerBtn) {
            powerBtn.disabled = true;
            powerBtn.classList.add("loading");
        }

    } else {
        statusLight.classList.remove("online", "starting");
        setStatusLightImage(statusLight, "offline");
        statusText.textContent = "離線";

        if (powerBtn) {
            powerBtn.disabled = false;
            powerBtn.classList.remove("loading");
        }
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

    wasServerOnline = data.online;
    previousServerState = data.state;

    window.dispatchEvent(new CustomEvent("server-status-changed", {
        detail: data
    }));
}

const statusLightCache = {};

const STATUS_LIGHT_SRC = {
    disconnected: "/static/icons/server_settings/status_disconnected.png",
    online: "/static/icons/server_settings/status_online.png",
    busy: "/static/icons/server_settings/status_busy.png",
    offline: "/static/icons/server_settings/status_offline.png",
};

function warmStatusLightCache() {
    Object.entries(STATUS_LIGHT_SRC).forEach(([key, src]) => {
        const img = new Image();
        img.src = src;
        statusLightCache[key] = img;
    });
}

function setStatusLightImage(statusLight, key) {
    if (!statusLight) return;

    const cachedImage = statusLightCache[key];

    if (cachedImage && cachedImage.complete) {
        statusLight.src = cachedImage.src;
        return;
    }

    statusLight.src = STATUS_LIGHT_SRC[key];
}