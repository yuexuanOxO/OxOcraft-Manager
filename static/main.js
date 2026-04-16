let isTransitioning = false;
let logPollingTimer = null;
let statusPollingTimer = null;
let backendDisconnected = false;
let lastLogText = "";
let wasServerOnline = false;

function startLogPolling() {
    if (logPollingTimer !== null || backendDisconnected) {
        return;
    }

    logPollingTimer = setInterval(() => {
        updateLog();
    }, 2000);
}

function stopLogPolling() {
    if (logPollingTimer !== null) {
        clearInterval(logPollingTimer);
        logPollingTimer = null;
    }
}

function stopAllPolling() {
    if (logPollingTimer !== null) {
        clearInterval(logPollingTimer);
        logPollingTimer = null;
    }

    if (statusPollingTimer !== null) {
        clearInterval(statusPollingTimer);
        statusPollingTimer = null;
    }
}

function handleBackendDisconnected() {
    if (backendDisconnected) return;

    backendDisconnected = true;
    stopAllPolling();

    const statusText = document.getElementById("statusText");
    const powerBtn = document.getElementById("powerBtn");

    if (statusText) {
        statusText.textContent = "管理介面已中斷";
    }

    if (powerBtn) {
        powerBtn.disabled = true;
        powerBtn.classList.add("loading");
    }

    console.error("Flask 後端已失聯，已停止輪詢。");
}

async function updateLog() {
    if (!wasServerOnline) {
        return;
    }

    try {
        const response = await fetch("/log", { cache: "no-store" });
        const data = await response.json();

        const newLogText = data.logs;
        const logBox = document.getElementById("logBox");

        if (!logBox) return;

        if (newLogText.length < lastLogText.length) {
            lastLogText = "";
        }

        if (newLogText !== lastLogText) {
            const newPart = newLogText.slice(lastLogText.length);

            if (
                newPart.includes("joined the game") ||
                newPart.includes("left the game")
            ) {
                updatePlayers();
            }

            lastLogText = newLogText;
        }

        const wasNearBottom =
            logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

        logBox.textContent = newLogText;

        if (wasNearBottom) {
            logBox.scrollTop = logBox.scrollHeight;
        }

    } catch (error) {
        console.error("更新 log 失敗:", error);
        handleBackendDisconnected();
    }
}

async function updateStatus() {
    try {
        const response = await fetch("/status", { cache: "no-store" });
        const data = await response.json();

        const statusLight = document.getElementById("statusLight");
        const statusText = document.getElementById("statusText");
        const powerBtn = document.getElementById("powerBtn");
        const logBox = document.getElementById("logBox");

        if (!isTransitioning) {
            if (data.online) {
                statusLight.classList.remove("offline");
                statusLight.classList.add("online");
                statusText.textContent = "在線";
            } else {
                statusLight.classList.remove("online");
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
        }

        // server 剛上線
        if (data.online && !wasServerOnline) {
            lastLogText = "";
            startLogPolling();
            updateLog();
            updatePlayers();
        }

        // server 剛離線
        if (!data.online && wasServerOnline) {
            stopLogPolling();
            lastLogText = "";
            if (logBox) {
                logBox.textContent = "伺服器尚未啟動";
            }
        }

        wasServerOnline = data.online;

    } catch (error) {
        console.error("更新狀態失敗:", error);
        handleBackendDisconnected();
    }
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

        input.value = "";

        // 送出指令後稍微等一下，再更新 log / status
        setTimeout(() => {
            updateLog();
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


async function toggleServer() {
    const powerBtn = document.getElementById("powerBtn");

    if (isTransitioning || (powerBtn && powerBtn.disabled)) {
        return;
    }

    try {
        const statusRes = await fetch("/status", { cache: "no-store" });
        const statusData = await statusRes.json();

        let url = "";
        let targetOnline = false;
        let actionText = "";

        if (statusData.online) {
            url = "/api/server/stop";
            targetOnline = false;
            actionText = "關閉中...";
        } else {
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

        const reachedTarget = await waitForServerStatus(targetOnline, 30000, 1000);

        isTransitioning = false;
        setPowerButtonLoading(false);

        await updateStatus();
        await updateLog();

        if (!reachedTarget) {
            alert(targetOnline ? "伺服器啟動逾時，請查看 log。" : "伺服器關閉逾時，請查看 log。");
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
        if (actionText) {
            statusText.textContent = actionText;
        }
    } else {
        powerBtn.disabled = false;
        powerBtn.classList.remove("loading");
    }
}

async function waitForServerStatus(targetOnline, timeoutMs = 30000, intervalMs = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/status", { cache: "no-store" });
            const data = await response.json();

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

                updateLog();
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
            }
        });
    }

    const logBox = document.getElementById("logBox");
    if (logBox) {
        logBox.textContent = "伺服器尚未啟動";
    }

    // ===== 定時更新 =====
    statusPollingTimer = setInterval(updateStatus, 2000);


    // ===== 初始化 =====
    updatePlayers();
});