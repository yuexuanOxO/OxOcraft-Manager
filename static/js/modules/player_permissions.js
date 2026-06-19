import {
    showInfo,
    showHelp,
    showConfirm,
} from "./system_dialog.js";

import {
    getPlayerAvatarUrl,
    getAccountTypeLabel,
    getAccountTypeClass,
} from "./player_avatar.js";

import {
    getUiServerState,
    isUiServerTransitionState
} from "./server_ui_state.js";

let currentFilter = "op";
let allPlayers = [];
let candidatePlayers = [];
let permissionOnlineMode = true;
let permissionServerReady = false;
let permissionServerState = "offline";

const OFFLINE_OP_HELP_DISABLED_KEY =
    "oxo_offline_op_help_disabled";


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

    window.addEventListener(
        "server-ui-state-changed",
        (event) => {

            const data = event.detail;

            if (!data) return;

            permissionServerReady =
                data.state === "ready";

            permissionServerState =
                data.state || "offline";

            renderAddOpInputState();
            renderPermissionActionButtons();
        }
    );

}


async function showPermissionHelp(showDontRemind = false) {
    const helpPromise = showHelp({
        title: "權限管理說明",

        icon: "/static/icons/general_icon/knowledge_book.png",

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
            },
        ]
    });

    window.setTimeout(() => {

        const panel =
            document.querySelector(".system-dialog-panel");

        if (!panel || !showDontRemind) {
            return;
        }

        let footer =
            document.getElementById("permissionHelpFooter");

        if (!footer) {

            footer = document.createElement("div");

            footer.id = "permissionHelpFooter";

            footer.className = "permission-help-footer system-dialog-extra";

            footer.innerHTML = `
                <label class="permission-help-check-row">
                    <input
                        id="disableOfflineOpHelpCheck"
                        type="checkbox"
                    >
                    <span>下次不要自動提醒</span>
                </label>
            `;

            panel.appendChild(footer);
        }

        const checkbox =
            document.getElementById("disableOfflineOpHelpCheck");

        checkbox.checked =
            localStorage.getItem(
                OFFLINE_OP_HELP_DISABLED_KEY
            ) === "1";

        checkbox?.addEventListener("change", () => {

            localStorage.setItem(
                OFFLINE_OP_HELP_DISABLED_KEY,
                checkbox.checked ? "1" : "0"
            );
        });

    }, 0);

    window.setTimeout(() => {
        const checkbox =
            document.getElementById("disableOfflineOpHelpCheck");

        checkbox?.addEventListener("change", () => {
            localStorage.setItem(
                OFFLINE_OP_HELP_DISABLED_KEY,
                checkbox.checked ? "1" : "0"
            );
        });
    }, 0);

    await helpPromise;
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
        permissionServerReady =
            getUiServerState() === "ready";

        permissionServerState =
            getUiServerState();

        console.log("[Permission] server_state =", permissionServerState, data);

        updatePermissionModeSummary(
            data.online_mode
        );

        renderPlayerPermissionList();
        renderAddOpInputState();
        renderPermissionActionButtons();

        if (
            permissionServerReady
            && !permissionOnlineMode
            && localStorage.getItem(OFFLINE_OP_HELP_DISABLED_KEY) !== "1"
        ) {
            await showPermissionHelp(true);
        }

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
                    ? "✓ 正版伺服器"
                    : "⚠ 離線伺服器"
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

    renderPermissionActionButtons();

}


function createPlayerPermissionCard(player) {
    const card = document.createElement("div");

    card.className =
        "player-permission-card";

    if (player.valid_for_current_mode === false) {
        card.classList.add("invalid-mode");
    }

    const avatarUrl = getPlayerAvatarUrl(player);

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
                    ${getAccountTypeClass(player)}
                ">
                    ${getAccountTypeLabel(player)}
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
                            ${player.op_since
                                ? escapeHtml(player.op_since.slice(0, 16))
                                : "未知"}
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

    if (isPermissionActionLocked()) {
        actionBtn.disabled = true;
    }

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

    const confirmBtn =
        document.getElementById("confirmAddOpPlayerBtn");

    if (!playerName) {
        await showInfo({
            title: "玩家權限",
            message: "請輸入玩家名稱",
            confirmText: "關閉",
            variant: "warning"
        });

        return;
    }


    confirmBtn.disabled = true;
    confirmBtn.textContent = "…";

    if (input) {
        input.disabled = true;
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
    } finally {

        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "新增";
        }

        renderAddOpInputState();
    }


}


async function addPlayerOpByName(playerName) {
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


function isPermissionActionLocked() {
    return isUiServerTransitionState();
}


function renderPermissionActionButtons() {

    const uiLocked =
        isPermissionActionLocked();

    const openAddBtn =
        document.getElementById("openAddOpPlayerBtn");

    const refreshBtn =
        document.getElementById("refreshPlayerPermissionBtn");

    if (openAddBtn) {
        openAddBtn.disabled = uiLocked;
    }

    if (refreshBtn) {
        refreshBtn.disabled = uiLocked;
    }

    document
        .querySelectorAll(".player-permission-action")
        .forEach((button) => {
            button.disabled = uiLocked;
        });

    document
        .querySelectorAll(".op-candidate-add-btn")
        .forEach((button) => {
            button.disabled = uiLocked;
        });

    document
        .querySelectorAll(".player-permission-card")
        .forEach((card) => {
            card.classList.toggle(
                "disabled",
                uiLocked
            );
        });

    document
        .querySelectorAll(".op-candidate-card")
        .forEach((card) => {
            card.classList.toggle(
                "disabled",
                uiLocked
            );
        });
}


function renderAddOpInputState() {
    const input =
        document.getElementById("addOpPlayerInput");

    const confirmBtn =
        document.getElementById("confirmAddOpPlayerBtn");

    const locked =
        isPermissionActionLocked()
        || (
            permissionServerReady
            && !permissionOnlineMode
        );

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
                    ${getAccountTypeClass(player)}
                ">
                    ${getAccountTypeLabel(player)}
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

    if (isPermissionActionLocked()) {
        addBtn.disabled = true;
    }

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

    const confirmed = await showConfirm({
        title: "刪除玩家紀錄",
        message: `確定要刪除「${player.player_name}」嗎？\n\n將從「之前加入過的玩家」清單移除。`,
        icon: getPlayerAvatarUrl(player),
        confirmText: "刪除",
        cancelText: "取消",
        variant: "warning",
    });

    if (!confirmed) {
        return;
    }

    try {

        const response = await fetch(
            "/api/player/candidate/hide",
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
