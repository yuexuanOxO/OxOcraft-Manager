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
let currentPermissionTab = "permissions";
let permissionHistory = [];
let allPlayers = [];
let candidatePlayers = [];
let permissionServerReady = false;
let permissionOnlineMode = true;
let permissionServerState = "offline";
let selectedOpLevel = 4;
let defaultOpLevel = 4;
let selectedOpCandidate = null;
let lockedOpCandidate = null;

const permissionHistoryFilters = new Set();
const OXOCRAFT_OPERATOR_ICON = "/static/icons/player_ban/OxOcraft_origin.png";
const OFFLINE_OP_HELP_DISABLED_KEY = "oxo_offline_op_help_disabled";

const OP_LEVEL_INFO = {
    1: {
        icon: "/static/icons/op_level/gold_ingot.png",
        title: "權限等級 1 (僅可修改出生點，不常使用)",
        description: [
            "可無視出生點保護，適合只需要基本保護區管理權限的玩家。",
            "(出生點保護：需在有一名管理員及一名一般玩家才會才會生效。)"
        ],
    },
    2: {
        icon: "/static/icons/op_level/diamond.png",
        title: "權限等級 2 (若不確定要給多高權限建議給)",
        description: [
            "可使用大部分遊戲管理指令(傳送、給物品、切換模式等...)。",
            "適合一般伺服器管理員。"
        ],
    },
    3: {
        icon: "/static/icons/op_level/netherite_ingot.png",
        title: "權限等級 3 (擁有僅限於服主的權限)",
        description: [
            "可使用更高階的管理指令(封鎖、踢出、管理 OP等...)。",
            "適合需要管理玩家與伺服器狀態的管理員。"
        ],
    },
    4: {
        icon: "/static/icons/op_level/nether_star.png",
        title: "權限等級 4 (與服主相同的權限)",
        description: [
            "最高等級管理員權限。",
            "完整伺服器管理權限。建議僅服主使用。"
        ],
    },
};


export async function openAddOpPlayerModalWithLockedPlayer(player) {
    const addModal = document.getElementById("addOpPlayerModal");
    const addInput = document.getElementById("addOpPlayerInput");
    const bypassCheck = document.getElementById("addOpBypassPlayerLimitCheck");

    if (!addModal || !addInput) return;

    lockedOpCandidate = player;
    selectedOpCandidate = player;

    defaultOpLevel = getDefaultOpLevel();
    selectedOpLevel = defaultOpLevel;

    addInput.value = player.player_name || player.name || "";

    if (bypassCheck) {
        bypassCheck.checked = false;
    }

    addModal.classList.remove("hidden");

    renderAddOpInputState();
    renderAddOpLevelState();
    renderOpCandidates();
}


function closeAddOpPlayerModal() {
    const addModal =
        document.getElementById("addOpPlayerModal");

    lockedOpCandidate = null;
    selectedOpCandidate = null;

    addModal?.classList.add("hidden");
}


export function initPlayerPermissions() {
    const openBtn = document.getElementById("playerPermissionBtn");
    const modal = document.getElementById("playerPermissionModal");
    const closeBtn = document.getElementById("closePlayerPermissionBtn");
    const refreshBtn = document.getElementById("refreshPlayerPermissionBtn");
    const searchInput = document.getElementById("playerPermissionSearchInput");
    const openAddBtn = document.getElementById("openAddOpPlayerBtn");
    const addModal = document.getElementById("addOpPlayerModal");
    const closeAddBtn = document.getElementById("closeAddOpPlayerBtn");
    const confirmAddBtn = document.getElementById("confirmAddOpPlayerBtn");
    const addInput = document.getElementById("addOpPlayerInput");
    const searchOpBtn = document.getElementById("searchOpPlayerBtn");
    const bypassCheck = document.getElementById("addOpBypassPlayerLimitCheck");
    const historySearchInput = document.getElementById("playerPermissionHistorySearchInput");
    const historyFilterBtn = document.getElementById("playerPermissionHistoryFilterBtn");
    const historyFilterMenu = document.getElementById("playerPermissionHistoryFilterMenu");


    if (!openBtn || !modal) {
        return;
    }

    document
        .querySelectorAll(".add-op-level-option")
        .forEach((button) => {
            button.addEventListener("click", () => {
                if (button.disabled) return;

                selectedOpLevel =
                    Number(button.dataset.level || defaultOpLevel);

                renderAddOpLevelState();
            });
        });

    historySearchInput?.addEventListener("input", () => {
        renderPermissionHistory();
    });

    historyFilterBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        historyFilterMenu?.classList.toggle("hidden");
    });

    historyFilterMenu
        ?.querySelectorAll("button[data-filter]")
        .forEach((button) => {
            button.addEventListener("click", () => {
                const filter = button.dataset.filter || "";

                if (!filter) return;

                if (filter === "clear") {
                    permissionHistoryFilters.clear();

                    historyFilterMenu
                        .querySelectorAll("button[data-filter]")
                        .forEach(btn => {
                            btn.classList.remove("active");
                        });

                    renderPermissionHistory();
                    return;
                }

                if (permissionHistoryFilters.has(filter)) {
                    permissionHistoryFilters.delete(filter);
                    button.classList.remove("active");
                } else {
                    permissionHistoryFilters.add(filter);
                    button.classList.add("active");
                }

                renderPermissionHistory();
            });
        });

    historyFilterMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", () => {
        historyFilterMenu?.classList.add("hidden");
    });

    document.querySelectorAll(".player-permission-tab").forEach((button) => {
        button.addEventListener("click", async () => {
            const nextTab =
                button.dataset.tab || "permissions";

            if (currentPermissionTab === nextTab) {
                return;
            }

            currentPermissionTab = nextTab;

            updatePermissionTabs();
            await loadCurrentPermissionTab();
        });
    });

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");

        currentPermissionTab = "permissions";
        updatePermissionTabs();

        await loadCurrentPermissionTab();
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

    lockedOpCandidate = null;
    selectedOpCandidate = null;

    addInput.value = "";

        defaultOpLevel = getDefaultOpLevel();
        selectedOpLevel = defaultOpLevel;

        if (bypassCheck) {
            bypassCheck.checked = false;
        }

        renderAddOpInputState();
        renderAddOpLevelState();

        await loadOpCandidates();
    });

    closeAddBtn?.addEventListener("click", () => {
        closeAddOpPlayerModal();
    });

    addModal?.addEventListener("click", (event) => {
        if (event.target === addModal) {
            closeAddOpPlayerModal();
        }
    });

    confirmAddBtn?.addEventListener("click", async () => {
        await handleAddOpPlayer();
    });

    searchOpBtn?.addEventListener("click", async () => {
        await handleSearchOpPlayer();
    });

    addInput?.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            await handleSearchOpPlayer();
        }
    });

    addInput?.addEventListener("input", () => {
        if (lockedOpCandidate) {
            return;
        }

        if (!permissionServerReady) {
            return;
        }

        selectedOpCandidate = null;
        renderOpCandidates();
        renderAddOpInputState();
    });

    window.addEventListener("player-permissions-should-refresh", async (event) => {
            console.log(
                "[Permission] refresh event received",
                event.detail
            );

            const modal =
                document.getElementById("playerPermissionModal");

            if (!modal || modal.classList.contains("hidden")) {
                return;
            }

            const state = getUiServerState();

            if (state === "starting" || state === "stopping") {
                console.log(
                    "[Permission] skip refresh during transition:",
                    state
                );
                return;
            }

            await loadPlayerPermissions();
            await loadOpCandidates();
        }
    );

    window.addEventListener("server-ui-state-changed", (event) => {
            const data = event.detail;

            if (!data) return;

            permissionServerReady =
                data.rawState === "ready" || data.state === "ready";

            permissionServerState =
                data.rawState || data.state || "offline";

            updatePermissionModeSummary();
            renderAddOpInputState();
            renderPermissionActionButtons();
            renderAddOpLevelState();
        }
    );

}


function updatePermissionTabs() {
    document.querySelectorAll(".player-permission-tab").forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.tab === currentPermissionTab
            );
        });

    document.getElementById("playerPermissionPage")
        ?.classList.toggle(
            "hidden",
            currentPermissionTab !== "permissions"
        );

    document
        .getElementById("playerPermissionHistoryPage")
        ?.classList.toggle(
            "hidden",
            currentPermissionTab !== "history"
        );

    document
        .getElementById("playerPermissionHelpPage")
        ?.classList.toggle(
            "hidden",
            currentPermissionTab !== "help"
        );

    const historySearchInput = document.getElementById("playerPermissionHistorySearchInput");

    if (historySearchInput) {
        historySearchInput.value = "";
    }

}


async function loadCurrentPermissionTab() {
    if (currentPermissionTab === "permissions") {
        await loadPlayerPermissions();
        return;
    }

    if (currentPermissionTab === "history") {
        await loadPermissionHistory();
        return;
    }

    renderPermissionHelpPage();
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

        permissionServerReady = Boolean(data.server_ready);
        permissionOnlineMode = Boolean(data.online_mode);

        permissionServerState = data.server_state || getUiServerState();

        defaultOpLevel = getDefaultOpLevelFromData(data);

        console.log("[Permission] server_state =", permissionServerState, data);

        updatePermissionModeSummary(
            data.online_mode
        );

        renderPlayerPermissionList();
        renderAddOpInputState();
        renderPermissionActionButtons();

        // 自動提醒暫停使用，保留 showPermissionHelp() 供之後導覽或提醒功能使用。
        // if (
        //     permissionServerReady
        //     && !permissionOnlineMode
        //     && localStorage.getItem(OFFLINE_OP_HELP_DISABLED_KEY) !== "1"
        // ) {
        //     await showPermissionHelp(true);
        // }

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


function updatePermissionModeSummary() {
    const summary =
        document.getElementById(
            "playerPermissionSummary"
        );

    if (!summary) return;

    const isReady =
        permissionServerReady;

    summary.innerHTML = `
        <span class="
            player-permission-mode
            ${isReady ? "online-manage" : "offline-config"}
        ">
            ${
                isReady
                    ? "⚙ 在線管理模式"
                    : "⚙ 離線設定模式"
            }
        </span>
    `;
}


function renderPlayerPermissionList() {
    const list = document.getElementById("playerPermissionList");
    const summary = document.getElementById("playerPermissionSummary");
    const searchInput = document.getElementById("playerPermissionSearchInput");

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

    const onlinePlayers = players.filter(player =>
        String(player.permission_state || "") === "online"
    );

    const offlinePlayers = players.filter(player =>
        String(player.permission_state || "") !== "online"
    );

    appendPermissionGroup(
        list,
        "上線",
        onlinePlayers,
        "online"
    );

    appendPermissionGroup(
        list,
        "離線",
        offlinePlayers,
        "offline"
    );

    renderPermissionActionButtons();

}


function appendPermissionGroup(list, title, players, groupType) {
    const group = document.createElement("div");
    group.className = `player-permission-group ${groupType}`;

    const header = document.createElement("button");
    header.className = "player-permission-group-header";
    header.type = "button";

    header.innerHTML = `
        <span>${escapeHtml(title)} (${players.length})</span>
        <span class="player-permission-group-arrow">▾</span>
    `;

    const body = document.createElement("div");
    body.className = "player-permission-group-body";

    players.forEach(player => {
        const card = createPlayerPermissionCard(player);

        if (groupType === "offline") {
            card.classList.add("offline-player");
        }

        body.appendChild(card);
    });

    header.addEventListener("click", () => {
        group.classList.toggle("collapsed");
    });

    group.appendChild(header);
    group.appendChild(body);

    list.appendChild(group);
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

        <div class="player-permission-op-detail">

            <div class="player-permission-op-level">

                <span>權限等級：</span>

                <span>Lv${escapeHtml(getOpLevel(player))}</span>

                <img
                    class="player-permission-op-level-icon"
                    src="${getOpLevelIcon(player)}"
                    alt="權限等級 ${escapeHtml(getOpLevel(player))}"
                >

            </div>

            <div class="player-permission-op-bypass">
                可無視玩家上限：
                ${player.op_bypasses_player_limit ? "是" : "否"}
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

    if (
        isPermissionActionLocked() ||
        (
            permissionServerReady &&
            player.permission_online_editable === false
        )
    ) {
        actionBtn.disabled = true;
        actionBtn.title = "此玩家目前只能在伺服器關閉後使用離線設定模式編輯";
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

        window.dispatchEvent(
            new CustomEvent(
                "player-op-status-changed",
                {
                    detail: {
                        player: player.player_name,
                        uuid: player.player_uuid,
                        op: data.op
                    }
                }
            )
        );

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


function getOpLevel(player) {
    const value = Number(player.op_level || 4);

    if (!Number.isFinite(value)) {
        return 4;
    }

    return Math.max(1, Math.min(value, 4));
}


function getOpLevelIcon(player) {
    const level = getOpLevel(player);

    return OP_LEVEL_INFO[level]?.icon ||
        OP_LEVEL_INFO[4].icon;
}


function findOpCandidateByName(playerName) {
    const keyword = String(playerName || "")
        .trim()
        .toLowerCase();

    if (!keyword) return null;

    return candidatePlayers.find(player => {
        return String(player.player_name || "")
            .toLowerCase() === keyword;
    }) || null;
}


async function resolveOpCandidateByInput(playerName) {
    const existingPlayer =
        findOpCandidateByName(playerName);

    if (existingPlayer) {
        selectedOpCandidate = existingPlayer;

        const input = document.getElementById("addOpPlayerInput");

        if (input) {
            input.value = existingPlayer.player_name;
        }

        renderOpCandidates();
        renderAddOpInputState();
        scrollSelectedOpCandidateIntoView();

        return true;
    }

    if (!permissionOnlineMode) {
        return false;
    }

    const response = await fetch(
        "/api/player/permission/resolve-candidate",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name: playerName,
            })
        }
    );

    const data = await response.json();

    if (!data.success) {
        throw new Error(
            data.message || "搜尋玩家失敗"
        );
    }

    const player = data.player;

    if (!player) {
        throw new Error("搜尋玩家失敗");
    }

    const confirmed = await showConfirm({
        title: "搜尋結果",
        message:
            `請問是否為這位玩家？\n\n` +
            `玩家 ID：${player.player_name}\n` +
            `UUID：${player.player_uuid}`,
        icon: getPlayerAvatarUrl(player),
        confirmText: "是",
        cancelText: "不是",
        variant: "info",
    });

    if (!confirmed) {
        return "cancelled";
    }

    const exists = candidatePlayers.some(item =>
        String(item.player_uuid || "").toLowerCase()
        === String(player.player_uuid || "").toLowerCase()
    );

    if (!exists) {
        candidatePlayers.unshift(player);
    }

    selectedOpCandidate = player;

    const input =
        document.getElementById("addOpPlayerInput");

    if (input) {
        input.value = player.player_name;
    }

    renderOpCandidates();
    renderAddOpInputState();
    scrollSelectedOpCandidateIntoView();

    return true;
}


async function handleSearchOpPlayer() {
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
        const resolved =
            await resolveOpCandidateByInput(playerName);

        if (resolved === "cancelled") {
            return;
        }

        if (!resolved) {
            await showInfo({
                title: "玩家權限",
                message: permissionOnlineMode
                    ? "找不到符合的正版玩家"
                    : "請從清單選擇可編輯的玩家",
                confirmText: "關閉",
                variant: "warning"
            });
        }

    } catch (error) {
        await showInfo({
            title: "錯誤",
            message: error.message || "搜尋玩家失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


async function handleAddOpPlayer() {
    const input = document.getElementById("addOpPlayerInput");
    const playerName = (input?.value || "").trim();
    const confirmBtn = document.getElementById("confirmAddOpPlayerBtn");

    if (
        selectedOpCandidate &&
        playerName &&
        String(selectedOpCandidate.player_name || "").toLowerCase()
            !== playerName.toLowerCase()
    ) {
        selectedOpCandidate = null;
    }

    if (permissionOnlineMode) {
        if (!selectedOpCandidate) {
            try {
                const resolved =
                    await resolveOpCandidateByInput(playerName);

                if (resolved === "cancelled") {
                    return;
                }

                if (!resolved) {
                    await showInfo({
                        title: "玩家權限",
                        message: "請先選擇或搜尋一位正版玩家",
                        confirmText: "關閉",
                        variant: "warning"
                    });

                    return;
                }

                return;
            } catch (error) {
                await showInfo({
                    title: "錯誤",
                    message: error.message || "搜尋玩家失敗",
                    confirmText: "關閉",
                    variant: "error"
                });

                return;
            }
        }
    } else if (permissionServerReady) {
        if (!selectedOpCandidate) {
            await showInfo({
                title: "玩家權限",
                message: "請先選擇一位可在線編輯的玩家",
                confirmText: "關閉",
                variant: "warning"
            });

            return;
        }
    } else if (!playerName) {
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

        const addedPlayer =
            selectedOpCandidate ||
            lockedOpCandidate ||
            {
                player_name: playerName,
                player_uuid: ""
            };

        const data =
            await addPlayerOpByName(playerName);

        input.value = "";

        selectedOpLevel = getDefaultOpLevel();

        const bypassCheck =
            document.getElementById(
                "addOpBypassPlayerLimitCheck"
            );

        if (bypassCheck) {
            bypassCheck.checked = false;
        }

        renderAddOpLevelState();

        window.dispatchEvent(
            new CustomEvent(
                "player-op-status-changed",
                {
                    detail: {
                        player: addedPlayer.player_name,
                        uuid: addedPlayer.player_uuid,
                        op: true
                    }
                }
            )
        );

        closeAddOpPlayerModal();

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
            confirmBtn.textContent = "＋加入管理員";
        }

        renderAddOpInputState();
    }


}


async function addPlayerOpByName(playerName) {
    const payload = {
        level: selectedOpLevel,
        bypassesPlayerLimit:
            Boolean(
                document.getElementById("addOpBypassPlayerLimitCheck")
                    ?.checked
            ),
    };

    let url = "/api/player/permission/add-op";

    if (permissionServerReady && selectedOpCandidate) {
        url = "/api/player/permission/toggle-op";

        payload.uuid = selectedOpCandidate.player_uuid;
        payload.name = selectedOpCandidate.player_name;
    } else {
        payload.name = playerName;
    }

    const response = await fetch(
        url,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        }
    );

    const data = await response.json();

    if (!data.success) {
        throw new Error(
            data.message || "新增管理員失敗"
        );
    }

    selectedOpCandidate = null;

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


function getDefaultOpLevelFromData(data) {
    const value =
        Number(data.op_permission_level || 4);

    if (!Number.isFinite(value)) {
        return 4;
    }

    return Math.max(1, Math.min(value, 4));
}


function getDefaultOpLevel() {
    return Math.max(
        1,
        Math.min(
            Number(defaultOpLevel || 4),
            4
        )
    );
}


function isOpLevelLocked() {
    return isPermissionActionLocked();
}


function renderAddOpLevelState() {
    const locked =
        isOpLevelLocked();

    const level =
        locked
            ? getDefaultOpLevel()
            : selectedOpLevel;

    selectedOpLevel = level;

    document
        .querySelectorAll(".add-op-level-option")
        .forEach((button) => {
            const buttonLevel =
                Number(button.dataset.level || 4);

            button.classList.toggle(
                "active",
                buttonLevel === level
            );

            button.disabled = locked;
        });

    const bypassCheck =
        document.getElementById("addOpBypassPlayerLimitCheck");

    if (bypassCheck) {
        bypassCheck.disabled = locked;
    }

    const lockedHint =
        document.getElementById("addOpLevelLockedHint");

    lockedHint?.classList.toggle(
        "hidden",
        !locked
    );

    renderAddOpLevelDescription(level);
}


function renderAddOpLevelDescription(level) {
    const content =
        document.getElementById("addOpLevelDescription");

    if (!content) return;

    const info =
        OP_LEVEL_INFO[level] || OP_LEVEL_INFO[4];

    content.innerHTML = `
        <div class="add-op-level-description-title">
            ${escapeHtml(info.title)}
        </div>

        ${info.description
            .map(text => `
                <div class="add-op-level-description-text">
                    ${escapeHtml(text)}
                </div>
            `)
            .join("")}
    `;
}


function renderAddOpInputState() {
    const input = document.getElementById("addOpPlayerInput");
    const confirmBtn = document.getElementById("confirmAddOpPlayerBtn");
    const searchBtn = document.getElementById("searchOpPlayerBtn");
    const locked = isPermissionActionLocked();

    if (input) {
        input.disabled = locked || !!lockedOpCandidate;
        input.placeholder = locked
            ? "伺服器狀態切換中，請稍後再操作"
            : (
                lockedOpCandidate
                    ? "已從玩家列表選擇玩家"
                    : (
                        permissionServerReady
                            ? "搜尋在線玩家"
                            : "請輸入玩家名稱"
                    )
            );
    }

    if (confirmBtn) {
        confirmBtn.disabled = locked;
    }

    if (searchBtn) {
        searchBtn.disabled = locked || !!lockedOpCandidate;
    }

    const subtitle = document.getElementById("addOpPlayerSubtitle");

    if (subtitle) {
        subtitle.textContent = "之前加入過 / 已新增的玩家";
    }

}


function renderOpCandidates() {
    const list =
        document.getElementById("opCandidateList");

    if (!list) return;

    const input =
            document.getElementById("addOpPlayerInput");

        const keyword =
            (input?.value || "")
                .trim()
                .toLowerCase();

        let players = lockedOpCandidate
            ? [lockedOpCandidate]
            : [...candidatePlayers];

        if (permissionServerReady && keyword) {
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


function scrollSelectedOpCandidateIntoView() {
    window.setTimeout(() => {
        const selectedCard =
            document.querySelector(".op-candidate-card.selected");

        if (!selectedCard) {
            return;
        }

        selectedCard.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    }, 0);
}


function createOpCandidateCard(player) {
    const card = document.createElement("div");

    card.className = "op-candidate-card";

    if (
        selectedOpCandidate &&
        selectedOpCandidate.player_uuid === player.player_uuid
    ) {
        card.classList.add("selected");
    }

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

            ${permissionServerReady ? "" : `
                <button
                    class="op-candidate-delete-btn"
                    type="button"
                    title="刪除玩家紀錄"
                >
                    ✕
                </button>
            `}

        </div>
    `;

    const addBtn =
        card.querySelector(".op-candidate-add-btn");

    if (isPermissionActionLocked()) {
        addBtn.disabled = true;
    }

    const deleteBtn =
        card.querySelector(".op-candidate-delete-btn");

    const selectCandidate = () => {
        if (isPermissionActionLocked()) {
            return;
        }

        selectedOpCandidate = player;

        const input = document.getElementById("addOpPlayerInput");

        if (!permissionServerReady && input) {
            input.value = player.player_name;
            input.focus();
        }

        renderOpCandidates();
        renderAddOpInputState();
    };

    card.addEventListener("click", (event) => {
        if (event.target.closest(".op-candidate-delete-btn")) {
            return;
        }

        selectCandidate();
    });

    addBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCandidate();
    });

    deleteBtn?.addEventListener("click", async () => {
        await deleteOpCandidate(player);
    });

    return card;
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


async function loadPermissionHistory() {
    const list =
        document.getElementById("playerPermissionHistoryList");

    if (list) {
        list.innerHTML = `
            <div class="player-permission-empty">
                載入權限管理紀錄中...
            </div>
        `;
    }

    try {
        const response = await fetch(
            "/api/player/access-history/op",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "權限管理紀錄載入失敗"
            );
        }

        permissionHistory = data.records || [];

        renderPermissionHistory();

    } catch (error) {
        console.error("權限管理紀錄載入失敗:", error);

        if (list) {
            list.innerHTML = `
                <div class="player-permission-empty">
                    權限管理紀錄載入失敗
                </div>
            `;
        }
    }
}


function renderPermissionHistory() {
    const list =
        document.getElementById("playerPermissionHistoryList");

    const searchInput =
        document.getElementById("playerPermissionHistorySearchInput");

    if (!list) return;

    const keyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    let rows = [...permissionHistory];

    const actionFilters =
        [...permissionHistoryFilters]
            .filter(filter =>
                filter === "add" ||
                filter === "remove"
            );

    const sourceFilters =
        [...permissionHistoryFilters]
            .filter(filter =>
                [
                    "oxocraft",
                    "minecraft_sync",
                    "rcon",
                    "command",
                    "system",
                ].includes(filter)
            );

    const levelFilters =
        [...permissionHistoryFilters]
            .filter(filter =>
                [
                    "level_1",
                    "level_2",
                    "level_3",
                    "level_4",
                ].includes(filter)
            );

    if (actionFilters.length > 0) {
        rows = rows.filter(item => {
            const action =
                String(item.action || "").toLowerCase();

            const isRemove =
                action.includes("remove") ||
                action.includes("deop");

            const isAdd =
                action.includes("add") ||
                action.includes("op");

            return (
                (actionFilters.includes("add") && isAdd && !isRemove) ||
                (actionFilters.includes("remove") && isRemove)
            );
        });
    }

    if (sourceFilters.length > 0) {
        rows = rows.filter(item => {
            const source = String(item.source || "");

            const isOxocraft =
                source === "ui" ||
                source === "offline_ui_edit" ||
                source === "ui_reload";

            const isMinecraftSync =
                source === "minecraft_json";

            const isRcon =
                source === "rcon" ||
                source === "console_rcon" ||
                source === "console_rcon_reload";

            const isCommand =
                source === "player_command" ||
                source === "player_command_reload";

            const isSystem =
                source === "system";

            return (
                (sourceFilters.includes("oxocraft") && isOxocraft) ||
                (sourceFilters.includes("minecraft_sync") && isMinecraftSync) ||
                (sourceFilters.includes("rcon") && isRcon) ||
                (sourceFilters.includes("command") && isCommand) ||
                (sourceFilters.includes("system") && isSystem)
            );
        });
    }

    if (levelFilters.length > 0) {
        rows = rows.filter(item => {
            const level =
                getPermissionHistoryLevel(item);

            if (!level) {
                return false;
            }

            return levelFilters.includes(
                `level_${level}`
            );
        });
    }

    if (keyword) {
        rows = rows.filter(item => {
            return (
                String(item.target_name || "")
                    .toLowerCase()
                    .includes(keyword)
                ||
                String(item.target_uuid || "")
                    .toLowerCase()
                    .includes(keyword)
            );
        });
    }

    list.innerHTML = "";

    if (rows.length === 0) {
        list.innerHTML = `
            <div class="player-permission-empty">
                目前沒有符合條件的權限管理紀錄
            </div>
        `;
        return;
    }

    rows.forEach(item => {
        list.appendChild(
            createPermissionHistoryCard(item)
        );
    });
}


function createPermissionHistoryCard(item) {
    const card = document.createElement("div");
    const actionText = getPermissionHistoryActionText(item.action);
    const operator = getDisplayPermissionOperator(item);
    const levelIcon = getPermissionHistoryLevelIcon(item);
    const bypassText = getPermissionHistoryBypassText(item);

    card.className = "player-permission-history-card";

    card.innerHTML = `
        <img
            class="player-permission-history-avatar"
            src="${getPlayerAvatarUrl({
                player_uuid: item.target_uuid,
                player_name: item.target_name,
                account_type: item.account_type
            })}"
            alt="${escapeHtml(item.target_name || "玩家")}"
        >

        <div class="player-permission-history-main">

            <div class="player-permission-history-title-row">
                <span class="player-permission-history-action">
                    ${escapeHtml(actionText)}
                </span>

                <span class="player-permission-history-target">
                    ${escapeHtml(item.target_name || "未知玩家")}
                </span>

                ${
                    levelIcon
                        ? `
                            <img
                                class="player-permission-history-level-icon"
                                src="${levelIcon}"
                                alt="權限等級"
                            >
                        `
                        : ""
                }
            </div>

            <div class="player-permission-history-meta">
                UUID：${escapeHtml(item.target_uuid || "未知")}
            </div>

            <div class="player-permission-history-meta">
                日期：${escapeHtml(formatDateTime(item.created_at))}
            </div>

            ${
                bypassText
                    ? `
                        <div class="player-permission-history-meta">
                            ${escapeHtml(bypassText)}
                        </div>
                    `
                    : ""
            }

        </div>

        <div class="player-permission-history-right">

            <div class="player-permission-history-source">
                <span class="player-permission-history-label">
                    操作來源：
                </span>

                <span class="player-permission-history-value">
                    ${escapeHtml(getPermissionSourceText(item.source))}
                </span>
            </div>

            <div class="player-permission-history-operator">
                <span class="player-permission-history-label">
                    操作人：
                </span>

                <img
                    class="player-permission-history-operator-avatar
                        ${operator === "OxOcraft" ? "oxocraft" : "player"}"
                    src="${getPermissionOperatorAvatarUrl(item)}"
                    alt="${escapeHtml(operator)}"
                >

                <span class="player-permission-history-operator-name">
                    ${escapeHtml(operator)}
                </span>
            </div>

        </div>
    `;

    return card;
}


function getPermissionHistoryActionText(action) {
    action = String(action || "");

    if (
        action.includes("remove") ||
        action.includes("deop")
    ) {
        return "移除管理員";
    }

    return "加入管理員";
}


function getDisplayPermissionOperator(item) {
    const operator =
        String(item.operator_name || "OxOcraft").trim();

    const source =
        String(item.source || "").trim();

    if (
        source === "ui" ||
        source === "online_ui_manage" ||
        source === "offline_ui_edit" ||
        source === "minecraft_json" ||
        source === "rcon" ||
        source === "console_rcon" ||
        operator === "Rcon" ||
        operator === "ops.json 同步"
    ) {
        return "OxOcraft";
    }

    return operator || "OxOcraft";
}


function getPermissionOperatorAvatarUrl(item) {
    const operator =
        getDisplayPermissionOperator(item);

    if (operator === "OxOcraft") {
        return OXOCRAFT_OPERATOR_ICON;
    }

    return getPlayerAvatarUrl({
        player_uuid: item.operator_uuid || "",
        player_name: operator,
        account_type:
            item.operator_account_type ||
            item.account_type ||
            "unknown"
    });
}


function getPermissionSourceText(source) {
    const sourceMap = {
        ui: "OxOcraft",
        offline_ui_edit: "離線設定模式",
        minecraft_json: "Minecraft資料同步",
        player_command: "遊戲內指令",
        console_rcon: "UI輸入指令",
        rcon: "UI輸入指令",
        system: "系統操作",
        ui_reload: "OxOcraft",
        console_rcon_reload: "UI輸入指令(reload)",
        player_command_reload: "遊戲內指令(reload)",
        online_ui_manage: "在線管理模式",
    };

    return sourceMap[source] || source || "未知";
}


function formatDateTime(text) {
    if (!text) {
        return "未知";
    }

    const value = String(text).trim();

    if (value.length >= 16) {
        return value.slice(0, 16);
    }

    return value;
}


function getPermissionHistoryDetail(item) {
    try {
        const detail = JSON.parse(item.detail || "{}");

        if (
            detail &&
            typeof detail === "object" &&
            !Array.isArray(detail)
        ) {
            return detail;
        }

        return {};
    } catch {
        return {};
    }
}


function getPermissionHistoryLevel(item) {
    const detail =
        getPermissionHistoryDetail(item);

    const value =
        Number(detail.op_level || 0);

    if (!Number.isFinite(value) || value <= 0) {
        return null;
    }

    return Math.max(1, Math.min(value, 4));
}


function getPermissionHistoryLevelIcon(item) {
    const level =
        getPermissionHistoryLevel(item);

    if (!level) {
        return "";
    }

    return OP_LEVEL_INFO[level]?.icon || "";
}


function getPermissionHistoryBypassText(item) {
    const detail =
        getPermissionHistoryDetail(item);

    if (
        typeof detail.op_bypasses_player_limit !== "boolean"
    ) {
        return "";
    }

    return detail.op_bypasses_player_limit
        ? "可無視玩家上限：是"
        : "可無視玩家上限：否";
}


function renderPermissionHelpPage() {
    const content =
        document.getElementById("playerPermissionHelpContent");

    if (!content) return;

    const sections = [
        {
            title: "離線模式注意事項",
            content: [
                "伺服器在離線模式且正在運行時，Minecraft /op 與 /deop 可能受玩家名稱大小寫與快取影響。",
                "若存在 creeper1 / Creeper1 這類只差大小寫的玩家名稱，權限可能會套用到錯誤玩家。"
            ]
        },
        {
            title: "建議操作方式",
            content: [
                "請先讓玩家進入伺服器一次，再從「之前加入過的玩家」清單加入管理員。",
                "避免讓玩家使用只差大小寫的名稱。",
                "若看到灰色或標示無效的玩家資料，代表該 UUID 不符合目前伺服器的登入模式，建議移除。"
            ]
        },
        {
            title: "為什麼會發生?",
            content: [
                "Minecraft 的 OP 權限實際依 UUID 判斷。",
                "正版驗證模式使用 Mojang UUID；離線模式則依玩家名稱產生 OfflinePlayer UUID。",
                "在線使用 /op 時，Minecraft 會自行解析玩家名稱，因此 OxOcraft 無法完全控制它最後套用到哪個 UUID。"
            ]
        },
        {
            title: "如果權限套用錯誤怎麼辦?",
            content: [
                "請先從權限管理頁移除錯誤的玩家資料。",
                "若在線移除仍不正常，請關閉伺服器後再調整 OP 名單。",
                "若希望完全避免此類問題，建議改用正版驗證模式。"
            ]
        }
    ];

    content.innerHTML = sections
        .map(section => `
            <section class="player-permission-help-card">
                <h3 class="player-permission-help-card-title">
                    ${escapeHtml(section.title)}
                </h3>

                ${section.content
                    .map(text => `
                        <p class="player-permission-help-card-text">
                            ${escapeHtml(text)}
                        </p>
                    `)
                    .join("")}
            </section>
        `)
        .join("");
}


function renderPermissionStateBadge(player) {
    const state =
        String(player.permission_state || "");

    const stateMap = {
        online: {
            className: "online",
            text: "在線",
        },
        offline: {
            className: "offline",
            text: "離線",
        },
        offline_usercache: {
            className: "usercache",
            text: "離線（曾加入過 Server）",
        },
        offline_only: {
            className: "offline-only",
            text: "僅離線編輯",
        },
    };

    const info = stateMap[state];

    if (!info) return "";

    return `
        <div class="
            player-permission-state-badge
            ${info.className}
        ">
            ${escapeHtml(info.text)}
        </div>
    `;
}