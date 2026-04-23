let isTransitioning = false;
let logPollingTimer = null;
let statusPollingTimer = null;
let backendDisconnected = false;
let lastLogText = "";
let wasServerOnline = false;
let deathRecords = [];
let currentDeathPage = 0;

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

            clearPlayersList();
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


const mobIconMap = {
    zombie: "/static/icons/mobs/zombie.png",
    skeleton: "/static/icons/mobs/skeleton.png",
    creeper: "/static/icons/mobs/creeper.png",
    spider: "/static/icons/mobs/spider.png",
    enderman: "/static/icons/mobs/enderman.png",
    wither: "/static/icons/mobs/wither.png",
    warden: "/static/icons/mobs/warden.png",
    slime: "/static/icons/mobs/slime.png",
    blaze: "/static/icons/mobs/blaze.png",
    ghast: "/static/icons/mobs/ghast.png",
    drowned: "/static/icons/mobs/drowned.png",
    husk: "/static/icons/mobs/husk.png",
    stray: "/static/icons/mobs/stray.png"
};

function formatDimensionName(dimension) {
    if (!dimension) return "未知維度";

    const map = {
        "minecraft:overworld": "主世界",
        "minecraft:the_nether": "地獄",
        "minecraft:the_end": "終界"
    };

    return `${map[dimension]}：` || dimension;
}

function formatDeathTime(value) {
    if (!value) return "死亡時間：未知";

    const dt = new Date(value.replace(" ", "T"));
    if (Number.isNaN(dt.getTime())) {
        return `死亡時間：${value}`;
    }

    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");

    return `死亡時間：${y}/${m}/${d} ${hh}:${mm}`;
}

function getKillerDisplayInfo(killer) {
    if (!killer) {
        return {
            type: "none",
            text: "",
            icon: ""
        };
    }

    const normalized = killer.trim().toLowerCase();

    if (mobIconMap[normalized]) {
        return {
            type: "mob",
            text: killer,
            icon: mobIconMap[normalized]
        };
    }

    return {
        type: "player",
        text: killer,
        icon: `https://mc-heads.net/avatar/${encodeURIComponent(killer)}`
    };
}

function renderDeathRecordPage() {
    if (!deathRecords.length) {
        document.getElementById("deathPlayerAvatar").src = "";
        document.getElementById("deathPlayerName").textContent = "目前沒有死亡紀錄";
        document.getElementById("deathPageInfo").textContent = "第 0 頁 / 第 0 頁";
        document.getElementById("deathText").textContent = "目前沒有資料";
        document.getElementById("deathLocation").textContent = "";
        document.getElementById("deathTime").textContent = "";
        document.getElementById("deathKillerSection").classList.add("hidden");
        document.getElementById("deathWeaponSection").classList.add("hidden");
        return;
    }

    const record = deathRecords[currentDeathPage];

    document.getElementById("deathPlayerAvatar").src =
        `https://mc-heads.net/avatar/${encodeURIComponent(record.player_name)}`;
    document.getElementById("deathPlayerName").textContent = record.player_name;
    document.getElementById("deathPageInfo").textContent =
        `第 ${currentDeathPage + 1} 頁 / 第 ${deathRecords.length} 頁`;

    document.getElementById("deathText").textContent =
        record.death_text || "未知死因";

    const dimensionName = formatDimensionName(record.dimension);
    document.getElementById("deathLocation").textContent =
        `${dimensionName} [${record.x}, ${record.y}, ${record.z}]`;

    document.getElementById("deathTime").textContent =
        formatDeathTime(record.death_time);

    const killerInfo = getKillerDisplayInfo(record.killer);
    const killerSection = document.getElementById("deathKillerSection");
    const killerIcon = document.getElementById("deathKillerIcon");
    const killerText = document.getElementById("deathKillerText");

    if (killerInfo.type === "none") {
        killerSection.classList.add("hidden");
    } else {
        killerSection.classList.remove("hidden");
        killerText.textContent = killerInfo.text;
        killerIcon.src = killerInfo.icon;
        killerIcon.classList.remove("hidden");
    }

    const weaponSection = document.getElementById("deathWeaponSection");
    const weaponText = document.getElementById("deathWeaponText");

    if (!record.item) {
        weaponSection.classList.add("hidden");
    } else {
        weaponSection.classList.remove("hidden");
        weaponText.textContent = record.item;
    }

    document.getElementById("deathPrevBtn").disabled = currentDeathPage <= 0;
    document.getElementById("deathNextBtn").disabled = currentDeathPage >= deathRecords.length - 1;
}

async function openDeathBook() {
    try {
        const response = await fetch("/api/deaths", { cache: "no-store" });
        const data = await response.json();

        if (!data.success) {
            alert(data.message || "讀取死亡紀錄失敗");
            return;
        }

        deathRecords = Array.isArray(data.deaths) ? data.deaths : [];
        currentDeathPage = 0;

        renderDeathRecordPage();
        document.getElementById("deathBookModal").classList.remove("hidden");
    } catch (error) {
        console.error("開啟死亡紀錄失敗:", error);
        alert("開啟死亡紀錄失敗");
    }
}

function closeDeathBook() {
    document.getElementById("deathBookModal").classList.add("hidden");
}

function showPrevDeathPage() {
    if (currentDeathPage > 0) {
        currentDeathPage -= 1;
        renderDeathRecordPage();
    }
}

function showNextDeathPage() {
    if (currentDeathPage < deathRecords.length - 1) {
        currentDeathPage += 1;
        renderDeathRecordPage();
    }
}


// 功能卡顯示
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

    const deathRecordBtn = document.getElementById("deathRecordBtn");
    if (deathRecordBtn) {
        deathRecordBtn.addEventListener("click", openDeathBook);
    }

    const deathBookCloseBtn = document.getElementById("deathBookCloseBtn");
    if (deathBookCloseBtn) {
        deathBookCloseBtn.addEventListener("click", closeDeathBook);
    }

    const deathPrevBtn = document.getElementById("deathPrevBtn");
    if (deathPrevBtn) {
        deathPrevBtn.addEventListener("click", showPrevDeathPage);
    }

    const deathNextBtn = document.getElementById("deathNextBtn");
    if (deathNextBtn) {
        deathNextBtn.addEventListener("click", showNextDeathPage);
    }

    const deathBookModal = document.getElementById("deathBookModal");
    if (deathBookModal) {
        deathBookModal.addEventListener("click", (event) => {
            if (event.target === deathBookModal) {
                closeDeathBook();
            }
        });
    }

    // ===== 定時更新 =====
    statusPollingTimer = setInterval(updateStatus, 2000);


    // ===== 初始化 =====
    updatePlayers();
    updateStatus();
    setupGlobalFeatureCard();
    
});