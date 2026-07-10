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


let allPlayers = [];
let candidatePlayers = [];
let selectedWhitelistCandidate = null;
let whitelistSearchKeyword = "";
let currentWhitelistTab = "whitelist";
let whitelistHistory = [];
const whitelistHistoryFilters = new Set();
let whitelistSettingsTimer = null;
let whitelistSettings = {
    white_list: false,
    enforce_whitelist: false,
    server_ready: false,
    server_state: "offline",
};

const OFFLINE_WHITELIST_HELP_DISABLED_KEY = "oxo_offline_whitelist_help_disabled";
const OXOCRAFT_OPERATOR_ICON = "/static/icons/player_ban/OxOcraft_origin.png";



export function initPlayerWhitelist() {
    const openBtn = document.getElementById("playerWhitelistBtn");
    const modal = document.getElementById("playerWhitelistModal");
    const closeBtn = document.getElementById("closePlayerWhitelistBtn");
    const refreshBtn = document.getElementById("refreshPlayerWhitelistBtn");
    const searchInput = document.getElementById("playerWhitelistSearchInput");
    const searchBtn = document.getElementById("playerWhitelistSearchBtn");
    const openAddBtn = document.getElementById("openAddWhitelistPlayerBtn");
    const addModal = document.getElementById("addWhitelistPlayerModal");
    const closeAddBtn = document.getElementById("closeAddWhitelistPlayerBtn");
    const confirmAddBtn = document.getElementById("confirmAddWhitelistPlayerBtn");
    const addInput = document.getElementById("addWhitelistPlayerInput");
    const whiteListToggleBtn = document.getElementById("whiteListToggleBtn");
    const enforceWhitelistToggleBtn = document.getElementById("enforceWhitelistToggleBtn");
    const historySearchInput = document.getElementById("playerWhitelistHistorySearchInput");
    const historyFilterBtn = document.getElementById("playerWhitelistHistoryFilterBtn");
    const historyFilterMenu = document.getElementById("playerWhitelistHistoryFilterMenu");


    if (!openBtn || !modal) {
        return;
    }

    document.querySelectorAll(".player-whitelist-tab").forEach((button) => {
        button.addEventListener("click", async () => {
            const nextTab =
                button.dataset.tab || "whitelist";

            if (currentWhitelistTab === nextTab) {
                return;
            }

            currentWhitelistTab = nextTab;

            updateWhitelistTabs();
            await loadCurrentWhitelistTab();
        });
    });

    searchBtn?.addEventListener("click", () => {
        applyPlayerWhitelistSearch();
    });

    searchInput?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            applyPlayerWhitelistSearch();
        }
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
                    whitelistHistoryFilters.clear();

                    historyFilterMenu
                        .querySelectorAll("button[data-filter]")
                        .forEach(btn => {
                            btn.classList.remove("active");
                        });

                    renderWhitelistHistory();
                    return;
                }

                if (whitelistHistoryFilters.has(filter)) {
                    whitelistHistoryFilters.delete(filter);
                    button.classList.remove("active");
                } else {
                    whitelistHistoryFilters.add(filter);
                    button.classList.add("active");
                }

                renderWhitelistHistory();
            });
        });

    historyFilterMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    document.addEventListener("click", () => {
        historyFilterMenu?.classList.add("hidden");
    });

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");

        whitelistSettings.server_state = getUiServerState();
        whitelistSettings.server_ready = getUiServerState() === "ready";
        renderWhitelistSettings();

        currentWhitelistTab = "whitelist";
        updateWhitelistTabs();

        await loadWhitelistSettings();
        await loadCurrentWhitelistTab();
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.add("hidden");
        stopWhitelistSettingsWatcher();
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
            stopWhitelistSettingsWatcher();
        }
    });

    refreshBtn?.addEventListener("click", async () => {
        await loadWhitelistSettings();
        await loadPlayerWhitelist();
    });

    searchInput?.addEventListener("input", () => {
        renderPlayerWhitelistList();
    });

    openAddBtn?.addEventListener("click", async () => {
        addModal?.classList.remove("hidden");

        selectedWhitelistCandidate = null;
        addInput.value = "";

        await loadWhitelistCandidates();
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
        await handleAddWhitelistPlayer();
    });

    addInput?.addEventListener("keydown", async (event) => {
        if (event.key === "Enter") {
            await handleAddWhitelistPlayer();
        }
    });

    addInput?.addEventListener("input", () => {
        selectedWhitelistCandidate = null;
        renderWhitelistCandidates();
    });

    whiteListToggleBtn?.addEventListener("click", async () => {
        await toggleWhitelistSetting("white-list");
    });

    enforceWhitelistToggleBtn?.addEventListener("click", async () => {
        await toggleWhitelistSetting("enforce-whitelist");
    });

    window.addEventListener("player_whitelist_should_refresh", async () => {
            const modal =
                document.getElementById("playerWhitelistModal");

            if (!modal || modal.classList.contains("hidden")) {
                return;
            }

            await loadPlayerWhitelist();
            await loadWhitelistCandidates();
        }
    );

    window.addEventListener(
        "server-ui-state-changed",
        (event) => {
            const data = event.detail;

            if (!data) return;

            whitelistSettings.server_state =
                data.state || "offline";

            whitelistSettings.server_ready =
                data.state === "ready";

            renderWhitelistSettings();
        }
    );

}


function updateWhitelistTabs() {
    document
        .querySelectorAll(".player-whitelist-tab")
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.tab === currentWhitelistTab
            );
        });

    document
        .getElementById("playerWhitelistPage")
        ?.classList.toggle(
            "hidden",
            currentWhitelistTab !== "whitelist"
        );

    document
        .getElementById("playerWhitelistHistoryPage")
        ?.classList.toggle(
            "hidden",
            currentWhitelistTab !== "history"
        );

    document
        .getElementById("playerWhitelistHelpPage")
        ?.classList.toggle(
            "hidden",
            currentWhitelistTab !== "help"
        );

    const historySearchInput =
        document.getElementById("playerWhitelistHistorySearchInput");

    if (historySearchInput) {
        historySearchInput.value = "";
    }
}


async function loadCurrentWhitelistTab() {
    if (currentWhitelistTab === "whitelist") {
        await loadPlayerWhitelist();
        return;
    }

    if (currentWhitelistTab === "history") {
        await loadWhitelistHistory();
        return;
    }

    renderWhitelistHelpPage();
}


async function showWhitelistHelp(showDontRemind = false) {

    const helpPromise = showHelp({
        title: "白名單說明",

        icon: "/static/icons/general_icon/knowledge_book.png",

        sections: [
            {
                title: "白名單是什麼?",
                content:
                    "白名單開啟後，只有在白名單內的玩家才能加入伺服器，不在白名單內的玩家將無法進入。\n管理員(OP)不受白名單限制，即使不在白名單內也能加入伺服器。"
            },
            {
                title: "離線模式注意事項",
                content:
                    "離線模式下，Minecraft /whitelist add 可能受玩家名稱大小寫與快取影響，可能加入錯誤 UUID。\n若存在 creeper1 / Creeper1 這類只差大小寫的玩家名稱，Minecraft 可能會套用到其他玩家。"
            },
            {
                title: "建議操作方式",
                content:
                    "請優先使用 OxOcraft 的白名單頁新增玩家。\nOxOcraft 會依目前登入模式決定 UUID，並直接寫入 whitelist.json。\n避免混用 Minecraft /whitelist add 指令。"
            },
            {
                title: "如果看到灰色玩家資料?",
                content:
                    "代表該 UUID 不符合目前伺服器登入模式。\n通常是 online-mode 切換後殘留，或曾使用 Minecraft 指令加入錯誤 UUID。\n建議移除後重新加入。"
            }
        ]
    });

    window.setTimeout(() => {

        const panel =
            document.querySelector(".system-dialog-panel");

        if (!panel || !showDontRemind) {
            return;
        }

        let footer =
            document.getElementById("whitelistHelpFooter");

        if (!footer) {

            footer = document.createElement("div");

            footer.id = "whitelistHelpFooter";

            footer.className = "permission-help-footer system-dialog-extra";

            footer.innerHTML = `
                <label class="permission-help-check-row">
                    <input
                        id="disableOfflineWhitelistHelpCheck"
                        type="checkbox"
                    >
                    <span>下次不要自動提醒</span>
                </label>
            `;

            panel.appendChild(footer);
        }

        const checkbox =
            document.getElementById(
                "disableOfflineWhitelistHelpCheck"
            );

        checkbox.checked =
            localStorage.getItem(
                OFFLINE_WHITELIST_HELP_DISABLED_KEY
            ) === "1";

        checkbox?.addEventListener("change", () => {

            localStorage.setItem(
                OFFLINE_WHITELIST_HELP_DISABLED_KEY,
                checkbox.checked ? "1" : "0"
            );
        });

    }, 0);

    await helpPromise;
}


function startWhitelistSettingsWatcher() {
    stopWhitelistSettingsWatcher();

    whitelistSettingsTimer = window.setInterval(async () => {
        const modal =
            document.getElementById("playerWhitelistModal");

        if (!modal || modal.classList.contains("hidden")) {
            stopWhitelistSettingsWatcher();
            return;
        }

        await loadWhitelistSettings();

    }, 1000);
}


function stopWhitelistSettingsWatcher() {
    if (whitelistSettingsTimer) {
        window.clearInterval(whitelistSettingsTimer);
        whitelistSettingsTimer = null;
    }
}


async function loadWhitelistSettings() {
    try {
        const response = await fetch(
            "/api/player/whitelist/settings",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "白名單設定載入失敗"
            );
        }

        whitelistSettings = {
            white_list: Boolean(data.white_list),
            enforce_whitelist: Boolean(data.enforce_whitelist),
            server_ready: getUiServerState() === "ready",
            server_state: getUiServerState(),
        };

        renderWhitelistSettings();

    } catch (error) {
        console.error("白名單設定載入失敗:", error);
    }
}


function renderWhitelistSettings() {
    const whiteListToggleBtn =
        document.getElementById("whiteListToggleBtn");

    const enforceWhitelistToggleBtn =
        document.getElementById("enforceWhitelistToggleBtn");

    const enforceHint =
        document.getElementById("enforceWhitelistHint");

    if (whiteListToggleBtn) {
        whiteListToggleBtn.classList.toggle(
            "on",
            whitelistSettings.white_list
        );

        whiteListToggleBtn.classList.toggle(
            "off",
            !whitelistSettings.white_list
        );

        const whiteListText =
            whiteListToggleBtn.querySelector(".setting-switch-text");

        if (whiteListText) {
            whiteListText.textContent =
                whitelistSettings.white_list
                    ? "已開啟"
                    : "已關閉";
        }

        whiteListToggleBtn.disabled = isWhitelistUiLocked();
    }

    if (enforceWhitelistToggleBtn) {
        enforceWhitelistToggleBtn.classList.toggle(
            "on",
            whitelistSettings.enforce_whitelist
        );

        enforceWhitelistToggleBtn.classList.toggle(
            "off",
            !whitelistSettings.enforce_whitelist
        );

        const enforceWhitelistText =
            enforceWhitelistToggleBtn.querySelector(".setting-switch-text");

        if (enforceWhitelistText) {
            enforceWhitelistText.textContent =
                whitelistSettings.enforce_whitelist
                    ? "已開啟"
                    : "已關閉";
        }

        enforceWhitelistToggleBtn.disabled =
            isWhitelistUiLocked() ||
            whitelistSettings.server_ready;
    }

    if (enforceHint) {
        if (whitelistSettings.server_ready) {
            enforceHint.textContent =
                "伺服器在線時無法修改，需關閉伺服器後變更";
        } else {
            enforceHint.textContent =
                "離線修改 server.properties";
        }
    }

    renderWhitelistActionButtons();

}


function isWhitelistUiLocked() {
    return isUiServerTransitionState();
}


function renderWhitelistActionButtons() {
    const whitelistEnabled =
        whitelistSettings.white_list;

    const uiLocked = isWhitelistUiLocked();

    const openAddBtn =
        document.getElementById("openAddWhitelistPlayerBtn");

    const refreshBtn =
        document.getElementById("refreshPlayerWhitelistBtn");

    if (openAddBtn) {
        openAddBtn.disabled =
            uiLocked || !whitelistEnabled;
    }

    if (refreshBtn) {
        refreshBtn.disabled =
            uiLocked || !whitelistEnabled;
    }

    document
        .querySelectorAll(".player-whitelist-action")
        .forEach((button) => {
            button.disabled =
                uiLocked || !whitelistEnabled;
        });

    document
        .querySelectorAll(".player-whitelist-card")
        .forEach((card) => {
            card.classList.toggle(
                "disabled",
                uiLocked || !whitelistEnabled
            );
        });


}


function setWhitelistUiBusy(busy) {

    document
        .querySelectorAll(`
            #playerWhitelistModal button,
            #playerWhitelistModal input
        `)
        .forEach((element) => {

            if (
                element.id === "closePlayerWhitelistBtn"
            ) {
                return;
            }

            element.disabled = busy;
        });
}


async function toggleWhitelistSetting(key) {
    const whiteListToggleBtn =
        document.getElementById("whiteListToggleBtn");

    const enforceWhitelistToggleBtn =
        document.getElementById("enforceWhitelistToggleBtn");

    setWhitelistUiBusy(true);

    try {
        const response = await fetch(
            "/api/player/whitelist/settings/toggle",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ key })
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "白名單設定切換失敗"
            );
        }

        await loadWhitelistSettings();

        await showInfo({
            title: "玩家白名單",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("白名單設定切換失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "白名單設定切換失敗",
            confirmText: "關閉",
            variant: "error"
        });

    } finally {

        setWhitelistUiBusy(false);

        renderWhitelistSettings();
    }
}


async function loadPlayerWhitelist() {
    const summary =
        document.getElementById("playerWhitelistSummary");

    try {
        summary.textContent = "載入玩家資料中...";

        const response = await fetch(
            "/api/player/whitelist",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "白名單資料載入失敗"
            );
        }

        allPlayers = (data.players || [])
            .filter(player => player.whitelisted);

        updateWhitelistModeSummary(data.online_mode);

        if (
            whitelistSettings.server_ready
            && !data.online_mode
            && localStorage.getItem(
                OFFLINE_WHITELIST_HELP_DISABLED_KEY
            ) !== "1"
        ) {
            await showWhitelistHelp(true);
        }

        renderPlayerWhitelistList();

    } catch (error) {
        console.error("白名單資料載入失敗:", error);

        summary.textContent = "白名單資料載入失敗";

        await showInfo({
            title: "錯誤",
            message: "白名單資料載入失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function updateWhitelistModeSummary(onlineMode) {
    const summary =
        document.getElementById("playerWhitelistSummary");

    if (!summary) return;

    summary.innerHTML = `
        <span class="
            player-whitelist-mode
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


function applyPlayerWhitelistSearch() {
    const searchInput =
        document.getElementById(
            "playerWhitelistSearchInput"
        );

    whitelistSearchKeyword =
        String(searchInput?.value || "")
            .trim()
            .toLowerCase();

    renderPlayerWhitelistList();
}


function renderPlayerWhitelistList() {
    const list = document.getElementById("playerWhitelistList");

    if (!list) return;

    let players = [...allPlayers];

    if (whitelistSearchKeyword) {
        players = players.filter(player => {
            const playerName =
                String(
                    player.player_name || ""
                ).toLowerCase();

            return playerName.includes(
                whitelistSearchKeyword
            );
        });
    }

    const playerCount =
        document.getElementById("playerWhitelistPlayerCount");

    if (playerCount) {
        playerCount.textContent =
            `共 ${players.length} 位白名單玩家`;
    }

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-whitelist-empty">
                目前沒有符合條件的白名單玩家
            </div>
        `;
        return;
    }

    players.forEach(player => {
        list.appendChild(
            createPlayerWhitelistCard(player)
        );
    });

    renderWhitelistActionButtons();

}


async function loadWhitelistHistory() {
    const list =
        document.getElementById("playerWhitelistHistoryList");

    if (list) {
        list.innerHTML = `
            <div class="player-whitelist-empty">
                載入白名單紀錄中...
            </div>
        `;
    }

    try {
        const response = await fetch(
            "/api/player/access-history/whitelist",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "白名單紀錄載入失敗"
            );
        }

        whitelistHistory = data.records || [];

        renderWhitelistHistory();

    } catch (error) {
        console.error("白名單紀錄載入失敗:", error);

        if (list) {
            list.innerHTML = `
                <div class="player-whitelist-empty">
                    白名單紀錄載入失敗
                </div>
            `;
        }
    }
}


function renderWhitelistHistory() {
    const list = document.getElementById("playerWhitelistHistoryList");
    const searchInput = document.getElementById("playerWhitelistHistorySearchInput");

    if (!list) return;

    const keyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    let rows = [...whitelistHistory];

    const actionFilters = [...whitelistHistoryFilters].filter(filter => filter === "add" || filter === "remove");
    const sourceFilters = [...whitelistHistoryFilters].filter(filter =>
        [
            "oxocraft",
            "minecraft_sync",
            "rcon",
            "command",
            "system",
        ].includes(filter)
    );

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
            <div class="player-whitelist-empty">
                目前沒有符合條件的白名單紀錄
            </div>
        `;
        return;
    }

    rows.forEach(item => {
        list.appendChild(
            createWhitelistHistoryCard(item)
        );
    });
}


function createWhitelistHistoryCard(item) {
    const card = document.createElement("div");

    card.className = "player-whitelist-history-card";

    const actionText =
        getWhitelistHistoryActionText(item.action);

    const operator =
        getDisplayWhitelistOperator(item);

    card.innerHTML = `
        <img
            class="player-whitelist-history-avatar"
            src="${getPlayerAvatarUrl({
                player_uuid: item.target_uuid,
                player_name: item.target_name,
                account_type: item.account_type
            })}"
            alt="${escapeHtml(item.target_name || "玩家")}"
        >

        <div class="player-whitelist-history-main">

            <div class="player-whitelist-history-title-row">
                <span class="player-whitelist-history-action">
                    ${escapeHtml(actionText)}
                </span>

                <span class="player-whitelist-history-target">
                    ${escapeHtml(item.target_name || "未知玩家")}
                </span>
            </div>

            <div class="player-whitelist-history-meta">
                UUID：${escapeHtml(item.target_uuid || "未知")}
            </div>

            <div class="player-whitelist-history-meta">
                日期：${escapeHtml(formatDateTime(item.created_at))}
            </div>

        </div>

        <div class="player-whitelist-history-right">

            <div class="player-whitelist-history-source">
                <span class="player-whitelist-history-label">
                    操作來源：
                </span>

                <span class="player-whitelist-history-value">
                    ${escapeHtml(getWhitelistSourceText(item.source))}
                </span>
            </div>

            <div class="player-whitelist-history-operator">
                <span class="player-whitelist-history-label">
                    操作人：
                </span>

                <img
                    class="player-whitelist-history-operator-avatar
                        ${operator === "OxOcraft" ? "oxocraft" : "player"}"
                    src="${getWhitelistOperatorAvatarUrl(item)}"
                    alt="${escapeHtml(operator)}"
                >

                <span class="player-whitelist-history-operator-name">
                    ${escapeHtml(operator)}
                </span>
            </div>

        </div>
    `;

    return card;
}


function getWhitelistHistoryActionText(action) {
    action = String(action || "");

    if (
        action.includes("remove") ||
        action.includes("pardon")
    ) {
        return "移出白名單";
    }

    return "加入白名單";
}


function getDisplayWhitelistOperator(item) {
    const operator =
        String(item.operator_name || "OxOcraft").trim();

    const source =
        String(item.source || "").trim();

    if (
        source === "ui" ||
        source === "offline_ui_edit" ||
        source === "minecraft_json" ||
        source === "rcon" ||
        source === "console_rcon" ||
        operator === "Rcon" ||
        operator === "whitelist.json 同步"
    ) {
        return "OxOcraft";
    }

    return operator || "OxOcraft";
}


function getWhitelistOperatorAvatarUrl(item) {
    const operator =
        getDisplayWhitelistOperator(item);

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


function getWhitelistSourceText(source) {
    const sourceMap = {
        ui: "OxOcraft",
        offline_ui_edit: "OxOcraft",
        minecraft_json: "Minecraft資料同步",
        player_command: "遊戲內指令",
        console_rcon: "UI輸入指令",
        rcon: "UI輸入指令",
        system: "系統操作",
        ui_reload: "OxOcraft",
        console_rcon_reload: "UI輸入指令(reload)",
        player_command_reload: "遊戲內指令(reload)",
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


function renderWhitelistHelpPage() {
    const content =
        document.getElementById("playerWhitelistHelpContent");

    if (!content) return;

    const sections = [
        {
            title: "白名單是什麼?",
            content: [
                "白名單開啟後，只有在白名單內的玩家才能加入伺服器。",
                "管理員(OP)不受白名單限制，即使不在白名單內也能加入伺服器。"
            ]
        },
        {
            title: "離線模式注意事項",
            content: [
                "離線模式下，Minecraft /whitelist add 可能受玩家名稱大小寫與快取影響，可能加入錯誤 UUID。",
                "若存在 creeper1 / Creeper1 這類只差大小寫的玩家名稱，Minecraft 可能會套用到其他玩家。"
            ]
        },
        {
            title: "建議操作方式",
            content: [
                "請優先使用 OxOcraft 的白名單頁新增玩家。",
                "OxOcraft 會依目前登入模式決定 UUID，並直接寫入 whitelist.json。"
            ]
        },
        {
            title: "灰色玩家資料代表什麼?",
            content: [
                "代表該 UUID 不符合目前伺服器登入模式。",
                "通常是 online-mode 切換後殘留，或曾使用 Minecraft 指令加入錯誤 UUID。"
            ]
        }
    ];

    content.innerHTML = sections
        .map(section => `
            <section class="player-whitelist-help-card">
                <h3 class="player-whitelist-help-card-title">
                    ${escapeHtml(section.title)}
                </h3>

                ${section.content
                    .map(text => `
                        <p class="player-whitelist-help-card-text">
                            ${escapeHtml(text)}
                        </p>
                    `)
                    .join("")}
            </section>
        `)
        .join("");
}


function createPlayerWhitelistCard(player) {
    const card = document.createElement("div");

    card.className = "player-whitelist-card";

    if (player.valid_for_current_mode === false) {
        card.classList.add("invalid-mode");
    }

    const avatarUrl = getPlayerAvatarUrl(player);

    card.innerHTML = `
        <img
            class="player-whitelist-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(player.player_name)}"
        >

        <div class="player-whitelist-info">

            <div class="player-whitelist-name-row">

                <div class="player-whitelist-name">
                    ${escapeHtml(player.player_name)}
                </div>

                <div class="
                    player-whitelist-badge
                    whitelisted
                ">
                    已加入白名單
                </div>

                <div class="
                    player-whitelist-uuid-type
                    getAccountTypeClass(player)
                ">
                    ${getAccountTypeLabel(player)}
                </div>

            </div>

            <div class="player-whitelist-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>

            <div class="player-whitelist-meta">
                加入白名單時間：
                ${player.whitelisted_since
                    ? escapeHtml(player.whitelisted_since.slice(0, 16))
                    : "未知"}
            </div>

            ${
                player.valid_for_current_mode === false
                    ? `
                        <div class="player-whitelist-invalid-hint">
                            此資料不符合目前伺服器的登入模式，可能無效
                        </div>
                    `
                    : ""
            }

        </div>

        <button
            class="player-whitelist-action whitelisted"
            type="button"
        >
            移出白名單
        </button>
    `;

    const actionBtn =
        card.querySelector(".player-whitelist-action");

    actionBtn?.addEventListener("click", async () => {
        await removePlayerWhitelist(player);
    });

    return card;
}


async function removePlayerWhitelist(player) {

    const confirmed = await showConfirm({
        title: "移出白名單",
        message: `確定要將「${player.player_name}」移出白名單嗎？`,
        icon: getPlayerAvatarUrl(player),
        confirmText: "移出",
        cancelText: "取消",
        variant: "warning",
    });

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            "/api/player/whitelist/toggle",
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
                data.message || "移出白名單失敗"
            );
        }

        await loadPlayerWhitelist();
        await loadWhitelistCandidates();

        await showInfo({
            title: "玩家白名單",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("移出白名單失敗:", error);

        await showInfo({
            title: "錯誤",
            message: "移出白名單失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function findWhitelistCandidateByName(playerName) {
    const keyword =
        String(playerName || "").trim();

    if (!keyword) {
        return null;
    }

    return candidatePlayers.find(player => {
        const name =
            String(
                player.player_name || ""
            ).trim();

        const accountType =
            String(
                player.account_type || ""
            ).toLowerCase();

        if (accountType === "premium") {
            return (
                name.toLowerCase()
                === keyword.toLowerCase()
            );
        }

        return name === keyword;
    }) || null;
}


function scrollSelectedWhitelistCandidateIntoView() {
    window.setTimeout(() => {
        const selectedCard =
            document.querySelector(
                ".whitelist-candidate-card.selected"
            );

        if (!selectedCard) {
            return;
        }

        selectedCard.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    }, 0);
}


async function handleAddWhitelistPlayer() {
    const input =
        document.getElementById(
            "addWhitelistPlayerInput"
        );

    const playerName =
        (input?.value || "").trim();

    const confirmBtn =
        document.getElementById(
            "confirmAddWhitelistPlayerBtn"
        );

    if (!playerName) {
        await showInfo({
            title: "玩家白名單",
            message: "請輸入玩家名稱",
            confirmText: "關閉",
            variant: "warning"
        });

        return;
    }

    const existingPlayer = findWhitelistCandidateByName(playerName);

    if (existingPlayer) {
        selectedWhitelistCandidate =
            existingPlayer;

        renderWhitelistCandidates();
        scrollSelectedWhitelistCandidateIntoView();

        return;
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
    }

    if (input) {
        input.disabled = true;
    }

    try {
        const player =
            await resolveWhitelistCandidateByName(
                playerName
            );

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
            return;
        }

        const data =
            await addWhitelistCandidate(player);

        if (input) {
            input.value = "";
        }

        await showInfo({
            title: "玩家白名單",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error(
            "加入白名單失敗:",
            error
        );

        await showInfo({
            title: "錯誤",
            message:
                error.message
                || "加入白名單失敗",
            confirmText: "關閉",
            variant: "error"
        });

    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
        }

        if (input) {
            input.disabled = false;
        }
    }
}


async function resolveWhitelistCandidateByName(
    playerName
) {
    const response = await fetch(
        "/api/player/whitelist/resolve-candidate",
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

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "搜尋玩家失敗"
        );
    }

    if (!data.player) {
        throw new Error("搜尋玩家失敗");
    }

    return data.player;
}


async function loadWhitelistCandidates() {
    const list =
        document.getElementById("whitelistCandidateList");

    try {
        if (list) {
            list.innerHTML = `
                <div class="player-whitelist-empty">
                    載入玩家資料中...
                </div>
            `;
        }

        const response = await fetch(
            "/api/player/whitelist/candidates",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "玩家資料載入失敗"
            );
        }

        candidatePlayers = data.players || [];

        renderWhitelistCandidates();

    } catch (error) {
        console.error("候選玩家載入失敗:", error);

        if (list) {
            list.innerHTML = `
                <div class="player-whitelist-empty">
                    玩家資料載入失敗
                </div>
            `;
        }
    }
}


function renderWhitelistCandidates() {
    const list =
        document.getElementById(
            "whitelistCandidateList"
        );

    if (!list) return;

    const input =
        document.getElementById(
            "addWhitelistPlayerInput"
        );

    const keyword =
        String(input?.value || "")
            .trim()
            .toLowerCase();

    let players = [...candidatePlayers];

    if (keyword) {
        players = players.filter(player => {
            const playerName =
                String(
                    player.player_name || ""
                ).toLowerCase();

            return playerName.includes(keyword);
        });
    }

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-whitelist-empty">
                ${
                    keyword
                        ? "找不到符合的玩家"
                        : "尚未有玩家紀錄"
                }
            </div>
        `;

        return;
    }

    players.forEach(player => {
        list.appendChild(
            createWhitelistCandidateCard(player)
        );
    });
}


function createWhitelistCandidateCard(player) {
    const card = document.createElement("div");

    card.className = "whitelist-candidate-card";

    if (
        selectedWhitelistCandidate &&
        String(
            selectedWhitelistCandidate.player_uuid || ""
        ).toLowerCase()
        ===
        String(
            player.player_uuid || ""
        ).toLowerCase()
    ) {
        card.classList.add("selected");
    }

    const avatarUrl = getPlayerAvatarUrl(player);

    card.innerHTML = `
        <img
            class="player-whitelist-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(player.player_name)}"
        >

        <div class="player-whitelist-info">

            <div class="player-whitelist-name-row">

                <div class="player-whitelist-name">
                    ${escapeHtml(player.player_name)}
                </div>

                <div class="
                    player-whitelist-uuid-type
                    getAccountTypeClass(player)
                ">
                    ${getAccountTypeLabel(player)}
                </div>

                ${
                    player.whitelisted
                        ? `
                            <div class="player-whitelist-badge whitelisted">
                                已加入
                            </div>
                        `
                        : ""
                }

            </div>

            <div class="player-whitelist-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>

        </div>

        <div class="whitelist-candidate-actions">

            <button
                class="
                    whitelist-candidate-add-btn
                    ${player.whitelisted ? "disabled" : ""}
                "
                type="button"
                ${player.whitelisted ? "disabled" : ""}
            >
                ＋
            </button>

            <button
                class="whitelist-candidate-delete-btn"
                type="button"
                title="刪除玩家紀錄"
            >
                ✕
            </button>

        </div>
    `;

    const addBtn =
        card.querySelector(".whitelist-candidate-add-btn");

    const deleteBtn =
        card.querySelector(".whitelist-candidate-delete-btn");

    deleteBtn?.addEventListener("click", async () => {
        await deleteWhitelistCandidate(player);
    });

    addBtn?.addEventListener("click", async () => {
    if (player.whitelisted || addBtn.disabled) return;

    addBtn.disabled = true;
    addBtn.textContent = "…";

    try {
        const data = await addWhitelistCandidate(player);

            await showInfo({
                title: "玩家白名單",
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
                message: error.message || "加入白名單失敗",
                confirmText: "關閉",
                variant: "error"
            });
        }
    });

    return card;
}


async function deleteWhitelistCandidate(player) {

    const confirmed = await showConfirm({
        title: "刪除玩家紀錄",
        message: `確定要刪除「${player.player_name}」嗎？\n將從「之前加入過的玩家」清單移除。`,
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

        if (
            selectedWhitelistCandidate &&
            String(
                selectedWhitelistCandidate.player_uuid || ""
            ).toLowerCase()
            ===
            String(
                player.player_uuid || ""
            ).toLowerCase()
        ) {
            selectedWhitelistCandidate = null;
        }

        await loadWhitelistCandidates();

        await showInfo({
            title: "玩家白名單",
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


function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


async function addWhitelistCandidate(player) {

    const response = await fetch(
        "/api/player/whitelist/add-candidate",
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
            data.message || "加入白名單失敗"
        );
    }

    selectedWhitelistCandidate = null;

    await loadPlayerWhitelist();
    await loadWhitelistCandidates();

    return data;
}