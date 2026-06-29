import { showOfflineCat } from "./log_console.js";


let fallbackPollingTimer = null;
let backendDisconnected = false;
let wasServerOnline = false;
let hasReceivedFirstStatus = false;
let lastServerStatusRevision = null;
let currentPlayers = new Map();
let previousServerState = null;
export let latestServerStatusData = null;
let effectiveOnlineModeForAvatars = null;

// 管理介面已中斷圖片的base64檔案
const STATUS_DISCONNECTED_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGHaVRYdFhNTDpjb20uYWRvYmUueG1wAAAAAAA8P3hwYWNrZXQgYmVnaW49J++7vycgaWQ9J1c1TTBNcENlaGlIenJlU3pOVGN6a2M5ZCc/Pg0KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyI+PHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj48cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0idXVpZDpmYWY1YmRkNS1iYTNkLTExZGEtYWQzMS1kMzNkNzUxODJmMWIiIHhtbG5zOnRpZmY9Imh0dHA6Ly9ucy5hZG9iZS5jb20vdGlmZi8xLjAvIj48dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPjwvcmRmOkRlc2NyaXB0aW9uPjwvcmRmOlJERj48L3g6eG1wbWV0YT4NCjw/eHBhY2tldCBlbmQ9J3cnPz4slJgLAAACOklEQVQ4T6WSMUgbURjHfxpCMCQleeUICelwHOE6ZBGHqlUI18GGihQMbkIHHVysQ23XQKeC7eZuheASukpVQkGS2lqrBBHPi9uVND1MUKxiI2mHek+ztt/y4PH//d//+97X0R0L/+Y/qhPAG0/gniOT04xMThPQklIU0JK8yb1jdm6+TQvgiQa7sq2TOt54gnQ6LaFQKMT59wpn503uPRiiVqtxdHTE8PAwm3sWTduCmwlmZmbQdR0AXdc5Li7h1M8AOC4ukUqlADBNk3Q6LRN0Avh8PjY2NiT8/vVTytVLAlqSwcw45eolC8/GpInLSAPDMAiHwwASfvIiSyaTobe3t80EoFAoYBgGuDP4dvwTVVXZevuScvWSwcw4uq5j2zaVSgVN0whG77D5eQdfdYvuoTEKhQK/Gj/ocL9REX6c+hkBLcnU1BSmacq4APv7+/T397PwKiu1uC0A8iIWi+E4jgQbjQa6rhOJRCiVSm1aXIPZuXkCWhJF+DlYX5HgzarVahysr6AIf9ueeKLBrqzn1m0GBga4//Ax1pcPlNZWqV+06OnpQQjB4uIi1Z2PKMJP3+gEAKqqYn799DeBpmkAOI5D3+gEivBzerhLPp8nn89zerjbBgshZLJOgFwuB4CiKABtJjdhdx4Ay8vL1wZN25ImruDR5HMU4QfgrjEKV3Pg6kF3lT3RYFfWG0/QtC029yy2t7cJhUIIISitrQJQv2ihqirlcplisUjTtvDGE7RO6td78K/1BwpL7TSFok7aAAAAAElFTkSuQmCC";



export function initServerStatus() {
    warmStatusLightCache();
    loadEffectiveOnlineModeForAvatars();

    fallbackPollingTimer = setInterval(updateStatus, 10000);

    updateStatus();

    window.addEventListener("server-status-changed", (event) => {
        const data = event.detail;

        if (!data) return;

        applyTemporaryServerState(data);
    });

    window.addEventListener(
        "player-op-status-changed",
        handlePlayerOpStatusChanged
    );

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
        const response = await fetch("/api/server/status?force=1", { cache: "no-store" });
        const payload = await response.json();
        applyServerStatusPayload(payload);

        const avatarModeChanged =
            await loadEffectiveOnlineModeForAvatars();

        if (avatarModeChanged && currentPlayers.size > 0) {
            renderPlayersFromQuery(
                [...currentPlayers.values()]
            );
        }

    } catch (error) {
        console.error("更新狀態失敗:", error);
        handleBackendDisconnected();
    }
}


function setPlayersFromQuery(players) {

    currentPlayers.clear();

    for (const player of (players || [])) {

        const playerName =
            getPlayerName(player);

        currentPlayers.set(
            playerName,
            player
        );
    }

    renderPlayersFromQuery(
        [...currentPlayers.values()]
    );
}


export function addPlayerFromLog(playerName) {
    if (!playerName) return;

    const existingPlayer =
        currentPlayers.get(playerName);

    if (existingPlayer) {
        return;
    }

    currentPlayers.set(playerName, {
        name: playerName,
        avatar_url: "/static/img/player/default_skins/steve.png"
    });

    renderPlayersFromQuery(
        [...currentPlayers.values()]
    );

    refreshPlayerAvatarFromBackend(playerName);
}


export function removePlayerFromLog(playerName) {
    if (!playerName) return;

    currentPlayers.delete(playerName);

    renderPlayersFromQuery(
        [...currentPlayers.values()]
    );
}


async function refreshPlayerAvatarFromBackend(playerName) {
    try {
        const response = await fetch(
            `/api/player/avatar?player=${encodeURIComponent(playerName)}`,
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) return;

        const currentPlayer =
            currentPlayers.get(playerName);

        if (!currentPlayer) return;

        currentPlayers.set(playerName, {
            ...currentPlayer,
            avatar_url: data.avatar_url
        });

        renderPlayersFromQuery(
            [...currentPlayers.values()]
        );

    } catch (error) {
        console.error("更新玩家頭像失敗:", error);
    }
}


async function loadEffectiveOnlineModeForAvatars() {
    try {
        const response = await fetch(
            "/api/player/permissions",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) return false;

        const newOnlineMode =
            data.online_mode === true;

        const changed =
            effectiveOnlineModeForAvatars !== newOnlineMode;

        effectiveOnlineModeForAvatars =
            newOnlineMode;

        return changed;

    } catch (error) {
        console.error("讀取正版驗證狀態失敗:", error);
        return false;
    }
}


function getPlayerAvatarUrl(player) {
    if (typeof player === "string") {
        return `https://mc-heads.net/avatar/${encodeURIComponent(player)}`;
    }

    return player.avatar_url
        || `https://mc-heads.net/avatar/${encodeURIComponent(player.name)}`;
}


function getPlayerName(player) {
    return typeof player === "string"
        ? player
        : player.name;
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
        const playerName = getPlayerName(player);

        const item = document.createElement("div");
        item.className = "player-item";

        const left = document.createElement("div");
        left.className = "player-main";

        const avatar = document.createElement("img");
        avatar.className = "player-avatar";
        avatar.src = getPlayerAvatarUrl(player);
        avatar.alt = `${playerName} avatar`;

        const name = document.createElement("span");
        name.className = "player-name";
        name.textContent = playerName;

        left.appendChild(avatar);
        left.appendChild(name);

        const menuWrap = document.createElement("div");
        menuWrap.className = "player-menu-wrap";

        const menuBtn = document.createElement("button");
        menuBtn.className = "player-menu-btn";
        menuBtn.type = "button";
        menuBtn.textContent = "⋮";
        menuBtn.dataset.player = playerName;

        const menu = document.createElement("div");
        menu.className = "player-menu";
        menu.hidden = true;

        const opBtn = document.createElement("button");
        opBtn.className = "player-menu-item";
        opBtn.type = "button";
        opBtn.textContent = "檢查權限中...";
        opBtn.disabled = true;
        opBtn.dataset.action = "toggle-op";
        opBtn.dataset.player = playerName;

        const kickBtn = document.createElement("button");
        kickBtn.className = "player-menu-item";
        kickBtn.type = "button";
        kickBtn.textContent = "踢出伺服器";
        kickBtn.dataset.action = "kick";
        kickBtn.dataset.player = playerName;

        menu.appendChild(opBtn);
        loadPlayerOpStatus(playerName, opBtn);

        menu.appendChild(kickBtn);

        menuWrap.appendChild(menuBtn);
        menuWrap.appendChild(menu);

        item.appendChild(left);
        item.appendChild(menuWrap);
        playersList.appendChild(item);
    });
}


async function loadPlayerOpStatus(player, opBtn) {
    try {
        const response = await fetch(
            `/api/player/op-status?player=${encodeURIComponent(player)}`,
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            opBtn.textContent = "設為/收回管理員";
            opBtn.disabled = false;
            return;
        }

        opBtn.textContent = data.op
            ? "收回管理員權限"
            : "設為管理員";

        opBtn.disabled = false;

    } catch (error) {
        console.error("讀取玩家 OP 狀態失敗:", error);

        opBtn.textContent = "設為/收回管理員";
        opBtn.disabled = false;
    }
}


function handlePlayerOpStatusChanged(event) {
    const detail = event.detail;

    if (!detail) return;

    const {
        player,
        op
    } = detail;

    const opBtn = document.querySelector(
        `.player-menu-item[data-action="toggle-op"][data-player="${CSS.escape(player)}"]`
    );

    if (!opBtn) return;

    opBtn.textContent = op
        ? "收回管理員權限"
        : "設為管理員";
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


function applyTemporaryServerState(data) {
    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");

    if (!statusLight || !statusText) return;

    if (data.state === "stopping") {

        statusLight.classList.remove("online", "offline");

        setStatusLightImage(statusLight, "busy");

        statusText.textContent = "關閉中...";

        if (powerBtn) {
            powerBtn.disabled = true;
            powerBtn.classList.add("loading");
        }
    }
}


const statusLightCache = {};

const STATUS_LIGHT_SRC = {
    disconnected: STATUS_DISCONNECTED_DATA_URL,
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