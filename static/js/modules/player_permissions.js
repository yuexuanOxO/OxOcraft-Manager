import { showInfo } from "./system_dialog.js";


let currentFilter = "all";
let allPlayers = [];


export function initPlayerPermissions() {
    const openBtn =
        document.getElementById("playerPermissionBtn");

    const modal =
        document.getElementById("playerPermissionModal");

    const closeBtn =
        document.getElementById("closePlayerPermissionBtn");

    const refreshBtn =
        document.getElementById("refreshPlayerPermissionBtn");

    const searchInput =
        document.getElementById("playerPermissionSearchInput");

    if (!openBtn || !modal) {
        return;
    }

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        await loadPlayerPermissions();
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });

    refreshBtn?.addEventListener("click", async () => {
        await loadPlayerPermissions();
    });

    searchInput?.addEventListener("input", () => {
        renderPlayerPermissionList();
    });

    document
        .querySelectorAll(".player-permission-filter")
        .forEach(button => {

            button.addEventListener("click", () => {

                document
                    .querySelectorAll(".player-permission-filter")
                    .forEach(btn => btn.classList.remove("active"));

                button.classList.add("active");

                currentFilter =
                    button.dataset.filter || "all";

                renderPlayerPermissionList();
            });
        });
}


async function loadPlayerPermissions() {
    const summary =
        document.getElementById("playerPermissionSummary");

    try {
        summary.textContent = "載入玩家資料中...";

        const response = await fetch(
            "/api/player/permissions",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "玩家資料載入失敗"
            );
        }

        allPlayers = data.players || [];

        updatePermissionModeSummary(
            data.online_mode
        );

        renderPlayerPermissionList();

    } catch (error) {
        console.error("玩家權限資料載入失敗:", error);

        summary.textContent = "玩家資料載入失敗";

        await showInfo({
            title: "錯誤",
            message: "玩家權限資料載入失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function updatePermissionModeSummary(
    onlineMode
) {
    const summary =
        document.getElementById(
            "playerPermissionSummary"
        );

    if (!summary) return;

    summary.innerHTML = `
        <span class="
            player-permission-mode
            ${onlineMode ? "online" : "offline"}
        ">
            ${
                onlineMode
                    ? "✓ 已開啟正版驗證"
                    : "⚠ 未開啟正版驗證"
            }
        </span>
    `;
}


function renderPlayerPermissionList() {
    const list =
        document.getElementById("playerPermissionList");

    const summary =
        document.getElementById("playerPermissionSummary");

    const searchInput =
        document.getElementById("playerPermissionSearchInput");

    if (!list) return;

    const keyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    let players = [...allPlayers];

    if (currentFilter === "op") {
        players = players.filter(player => player.op);
    }

    if (currentFilter === "normal") {
        players = players.filter(player => !player.op);
    }

    if (keyword) {
        players = players.filter(player => {
            return (
                String(player.player_name || "")
                    .toLowerCase()
                    .includes(keyword)
                ||
                String(player.player_uuid || "")
                    .toLowerCase()
                    .includes(keyword)
            );
        });
    }

    const playerCount =
        document.getElementById(
            "playerPermissionPlayerCount"
        );

    if (playerCount) {
        playerCount.textContent =
            `共 ${players.length} 位玩家`;
    }

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-permission-empty">
                找不到符合條件的玩家
            </div>
        `;
        return;
    }

    players.forEach(player => {
        list.appendChild(
            createPlayerPermissionCard(player)
        );
    });
}


function createPlayerPermissionCard(player) {
    const card = document.createElement("div");

    card.className =
        "player-permission-card";

    const avatarUrl =
        player.uuid_type === "online"
            ? `https://mc-heads.net/avatar/${encodeURIComponent(player.player_name)}`
            : "/static/img/player/steve_avatar.png";

    card.innerHTML = `
        <img
            class="player-permission-avatar"
            src="${avatarUrl}"
            alt="${player.player_name}"
        >

        <div class="player-permission-info">

            <div class="player-permission-name-row">

                <div class="player-permission-name">
                    ${escapeHtml(player.player_name)}
                </div>

                <div class="
                    player-permission-badge
                    ${player.op ? "op" : "normal"}
                ">
                    ${player.op ? "管理員" : "一般玩家"}
                </div>

            </div>

            <div class="player-permission-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>

            <div class="player-permission-meta">
                成為管理員時間：
                ${player.op_since || "未知"}
            </div>

        </div>

        <button
            class="
                player-permission-action
                ${player.op ? "op" : "normal"}
            "
            type="button"
        >
            ${player.op
                ? "收回管理員權限"
                : "設為管理員"}
        </button>
    `;

    const actionBtn =
        card.querySelector(".player-permission-action");

    actionBtn?.addEventListener("click", async () => {
        await togglePlayerOp(player);
    });

    return card;
}


async function togglePlayerOp(player) {
    try {
        const response = await fetch(
            "/api/player/permission/toggle-op",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    uuid: player.player_uuid,
                    name: player.player_name,
                })
            }
        );

        const data = await response.json();
        console.log("toggle-op response:", data);

        if (!data.success) {
            throw new Error(
                data.message || "玩家權限修改失敗"
            );
        }

        player.op = data.op;

        if (data.op_since) {
            player.op_since = data.op_since;
        }

        renderPlayerPermissionList();

        

        await showInfo({
            title: "玩家權限",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("玩家權限修改失敗:", error);

        await showInfo({
            title: "錯誤",
            message: "玩家權限修改失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}