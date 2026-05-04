let statusPollingTimer = null;
let backendDisconnected = false;
let wasServerOnline = false;
let lastServerStatusRevision = null;
// let pendingServerStatusPayload = null;
let currentPlayers = new Set();


export function initServerStatus() {
    statusPollingTimer = setInterval(updateStatus, 10000);
    updateStatus();
}



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


export async function updateStatus() {
    try {
        const response = await fetch("/api/server/query-status", { cache: "no-store" });
        const payload = await response.json();
        applyServerStatusPayload(payload);

    } catch (error) {
        console.error("更新狀態失敗:", error);
        handleBackendDisconnected();
    }
}


export async function updateStatusForce() {
    try {
        const response = await fetch("/api/server/query-status?force=1", {
            cache: "no-store"
        });

        const payload = await response.json();
        applyServerStatusPayload(payload);

    } catch (error) {
        console.error("強制更新狀態失敗:", error);
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

    // if (isTransitioning) {
    //     pendingServerStatusPayload = payload;
    //     return;
    // }

    if (payload.revision === lastServerStatusRevision) {
        return;
    }

    lastServerStatusRevision = payload.revision;

    const data = payload.data;

    const statusLight = document.getElementById("statusLight");
    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");
    const logBox = document.getElementById("logBox");

    if (data.online) {
        setPlayersFromQuery(data.players || []);
    }

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

    if (!data.online && wasServerOnline) {
        if (logBox) {
            logBox.textContent = "伺服器尚未啟動";
        }

        clearPlayersList();
    }

    wasServerOnline = data.online;
}