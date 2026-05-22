import { showInfo } from "./system_dialog.js";


let currentFilter = "op";
let allPlayers = [];
let candidatePlayers = [];


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

    const openAddBtn =
        document.getElementById("openAddOpPlayerBtn");

    const addModal =
        document.getElementById("addOpPlayerModal");

    const closeAddBtn =
        document.getElementById("closeAddOpPlayerBtn");

    const confirmAddBtn =
        document.getElementById("confirmAddOpPlayerBtn");

    const addInput =
        document.getElementById("addOpPlayerInput");

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

    openAddBtn?.addEventListener("click", async () => {
        addModal?.classList.remove("hidden");
        addInput.value = "";
        await loadOpCandidates();
    });

    closeAddBtn?.addEventListener("click", () => {
        addModal?.classList.add("hidden");
    });

    addModal?.addEventListener("click", (event) => {
        if (event.target === addModal) {
            addModal.classList.add("hidden");
        }
    });

    confirmAddBtn?.addEventListener("click", async () => {
        await handleAddOpPlayer();
    });

    addInput?.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            await handleAddOpPlayer();
        }
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

            ${
                player.op
                    ? `
                        <div class="player-permission-meta">
                            成為管理員時間：
                            ${player.op_since ? escapeHtml(player.op_since) : "未知"}
                        </div>
                    `
                    : (
                        player.op_since
                            ? `
                                <div class="player-permission-meta">
                                    曾成為管理員：
                                    ${escapeHtml(player.op_since)}
                                </div>
                            `
                            : `
                                <div class="player-permission-meta empty">
                                    　
                                </div>
                            `
                    )
            }

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

async function addPlayerOpByName(playerName) {
    try {
        const response = await fetch(
            "/api/player/permission/add-op",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    name: playerName
                })
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "新增管理員失敗"
            );
        }

        await loadPlayerPermissions();
        await loadOpCandidates();

        return data;

    } catch (error) {
        console.error("新增管理員失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "新增管理員失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}

async function loadOpCandidates() {
    const list =
        document.getElementById("opCandidateList");

    try {
        if (list) {
            list.innerHTML = `
                <div class="player-permission-empty">
                    載入玩家資料中...
                </div>
            `;
        }

        const response = await fetch(
            "/api/player/permissions/candidates",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "玩家資料載入失敗"
            );
        }

        candidatePlayers = data.players || [];

        renderOpCandidates();

    } catch (error) {
        console.error("候選玩家載入失敗:", error);

        if (list) {
            list.innerHTML = `
                <div class="player-permission-empty">
                    玩家資料載入失敗
                </div>
            `;
        }
    }
}


function renderOpCandidates() {
    const list =
        document.getElementById("opCandidateList");

    if (!list) return;

    const players = [...candidatePlayers];

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-permission-empty">
                尚未有玩家紀錄
            </div>
        `;
        return;
    }

    players.forEach(player => {
        list.appendChild(
            createOpCandidateCard(player)
        );
    });
}


function createOpCandidateCard(player) {
    const card = document.createElement("div");

    card.className = "op-candidate-card";

    const avatarUrl = getPlayerAvatarUrl(player);

    card.innerHTML = `
        <img
            class="player-permission-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(player.player_name)}"
        >

        <div class="player-permission-info">
            <div class="player-permission-name-row">
                <div class="player-permission-name">
                    ${escapeHtml(player.player_name)}
                </div>

                <div class="
                    player-permission-uuid-type
                    ${player.uuid_type === "online" ? "online" : "offline"}
                ">
                    ${getUuidTypeLabel(player)}
                </div>
            </div>

            <div class="player-permission-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>
        </div>

        <div class="op-candidate-actions">
            <button class="op-candidate-add-btn" type="button">
                ＋
            </button>

            <button
                class="op-candidate-delete-btn"
                type="button"
                title="刪除玩家紀錄"
            >
                ✕
            </button>
        </div>
    `;

    const addBtn =
        card.querySelector(".op-candidate-add-btn");

    const deleteBtn =
        card.querySelector(".op-candidate-delete-btn");

    addBtn?.addEventListener("click", async () => {
        if (addBtn.disabled) return;

        addBtn.disabled = true;
        addBtn.textContent = "…";

        try {
            const data =
                await addPlayerOpByName(player.player_name);

            await showInfo({
                title: "玩家權限",
                message: data.message,
                confirmText: "關閉",
                variant: "success"
            });

        } catch (error) {
            addBtn.disabled = false;
            addBtn.textContent = "＋";
            console.error("加入候選玩家失敗:", error);

            await showInfo({
                title: "錯誤",
                message: error.message || "新增管理員失敗",
                confirmText: "關閉",
                variant: "error"
            });
        }
    });

    deleteBtn?.addEventListener("click", async () => {
        await deleteOpCandidate(player);
    });

    return card;
}


async function deleteOpCandidate(player) {
    const confirmed = window.confirm(
        `確定要刪除「${player.player_name}」的玩家紀錄嗎？\n\n這會從之前加入過的玩家清單中移除。`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            "/api/player/permission/candidate/delete",
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

        if (!data.success) {
            throw new Error(
                data.message || "刪除玩家紀錄失敗"
            );
        }

        await loadOpCandidates();

        await showInfo({
            title: "玩家權限",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("刪除玩家紀錄失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "刪除玩家紀錄失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function getPlayerAvatarUrl(player) {
    if (player.uuid_type === "online") {
        return `https://mc-heads.net/avatar/${encodeURIComponent(player.player_name)}`;
    }

    return "/static/img/player/steve_avatar.png";
}


function getUuidTypeLabel(player) {
    if (player.uuid_type === "online") {
        return "正版驗證";
    }

    if (player.uuid_type === "offline") {
        return "離線遊玩";
    }

    return "未知類型";
}