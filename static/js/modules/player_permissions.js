import {
    showInfo,
    showHelp
} from "./system_dialog.js";


let currentFilter = "op";
let allPlayers = [];
let candidatePlayers = [];
let permissionOnlineMode = true;
let permissionServerReady = false;


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

    const openPermissionHelpBtn =
        document.getElementById("openPermissionHelpBtn");

    const permissionTooltip =
        document.getElementById("playerPermissionTooltip");

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

        renderAddOpInputState();

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

    openPermissionHelpBtn?.addEventListener("click", async () => {
        await showPermissionHelp();
    });

    openPermissionHelpBtn?.addEventListener("mouseenter", () => {
        permissionTooltip?.classList.remove("hidden");
    });

    openPermissionHelpBtn?.addEventListener("mousemove", (event) => {
        if (!permissionTooltip) return;

        permissionTooltip.style.left = `${event.clientX + 14}px`;
        permissionTooltip.style.top = `${event.clientY - 38}px`;
    });

    openPermissionHelpBtn?.addEventListener("mouseleave", () => {
        permissionTooltip?.classList.add("hidden");
    });

    window.addEventListener(
        "player-permissions-should-refresh",
        async () => {
            const modal =
                document.getElementById("playerPermissionModal");

            if (!modal || modal.classList.contains("hidden")) {
                return;
            }

            await loadPlayerPermissions();
            await loadOpCandidates();
        }
    );

}


async function showPermissionHelp() {
    await showHelp({
        title: "權限管理說明",

        icon: "/static/icons/player_whitelist/knowledge_book.png",

        sections: [
            {
                title: "離線模式注意事項",
                content:
                    "伺服器在離線模式且正在運行時，Minecraft /op 與 /deop 可能受玩家名稱大小寫與快取影響。\n若存在 creeper1 / Creeper1 這類只差大小寫的玩家名稱，權限可能會套用到錯誤玩家。"
            },
            {
                title: "建議操作方式",
                content:
                    "請先讓玩家進入伺服器一次，再從「之前加入過的玩家」清單加入管理員。\n避免讓玩家使用只差大小寫的名稱。\n若看到灰色或標示無效的玩家資料，代表該 UUID 不符合目前伺服器的登入模式，建議移除。"
            },
            {
                title: "為什麼會發生?",
                content:
                    "Minecraft 的 OP 權限實際依 UUID 判斷。\n正版驗證模式使用 Mojang UUID；離線模式則依玩家名稱產生 OfflinePlayer UUID。\n在線使用 /op 時，Minecraft 會自行解析玩家名稱，因此 OxOcraft 無法完全控制它最後套用到哪個 UUID。"
            },
            {
                title: "如果權限套用錯誤怎麼辦?",
                content:
                    "請先從權限管理頁移除錯誤的玩家資料。\n若在線移除仍不正常，請關閉伺服器後再調整 OP 名單。\n若希望完全避免此類問題，建議改用正版驗證模式。"
            }
        ]
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

        permissionOnlineMode = Boolean(data.online_mode);
        permissionServerReady = Boolean(data.server_ready);

        updatePermissionModeSummary(
            data.online_mode
        );

        renderPlayerPermissionList();
        renderAddOpInputState();

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

    if (player.valid_for_current_mode === false) {
        card.classList.add("invalid-mode");
    }

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
                    player-permission-uuid-type
                    ${player.uuid_type === "online" ? "online" : "offline"}
                ">
                    ${getUuidTypeLabel(player)}
                </div>

            </div>

            <div class="player-permission-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>

            ${
                player.valid_for_current_mode === false
                    ? `
                        <div class="player-permission-invalid-hint">
                            此資料不符合目前伺服器的登入模式，可能無效
                        </div>
                    `
                    : ""
            }

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


async function handleAddOpPlayer() {
    const input =
        document.getElementById("addOpPlayerInput");

    const playerName =
        (input?.value || "").trim();

    if (!playerName) {
        await showInfo({
            title: "玩家權限",
            message: "請輸入玩家名稱",
            confirmText: "關閉",
            variant: "warning"
        });

        return;
    }

    try {
        const data =
            await addPlayerOpByName(playerName);

        input.value = "";

        await showInfo({
            title: "玩家權限",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

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


function renderAddOpInputState() {
    const input =
        document.getElementById("addOpPlayerInput");

    const confirmBtn =
        document.getElementById("confirmAddOpPlayerBtn");

    const locked =
        permissionServerReady && !permissionOnlineMode;

    if (input) {
        input.disabled = locked;
        input.placeholder = locked
            ? "離線模式且伺服器在線時，請從下方玩家清單加入"
            : "請輸入玩家名稱";
    }

    if (confirmBtn) {
        confirmBtn.disabled = locked;
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
                await togglePlayerOpFromCandidate(player);

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


async function togglePlayerOpFromCandidate(player) {
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

    if (!data.success) {
        throw new Error(
            data.message || "新增管理員失敗"
        );
    }

    await loadPlayerPermissions();
    await loadOpCandidates();

    return data;
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