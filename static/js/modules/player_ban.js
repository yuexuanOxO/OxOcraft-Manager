import {
    showInfo,
    showConfirm,
} from "./system_dialog.js";

import {
    getUiServerState,
    isUiServerTransitionState
} from "./server_ui_state.js";

import {
    getPlayerAvatarUrl,
    getAccountTypeLabel,
    getAccountTypeClass,
} from "./player_avatar.js";

import { PLAYER_BAN_HELP } from "./help/player_ban_help.js";

import {
    filterRowsByDateRange,
    setActiveHistoryTimeRange,
} from "./history_filter.js";

import {
    closeFirstAvailableLayer,
    isFlatpickrOpen,
    closeFlatpickr,
} from "./ui_close_stack.js";

import {
    isFilterMenuOpen,
    closeFilterMenu,
} from "./common/filter_menu.js";


let currentBanTab = "players";
let banPlayers = [];
let banIps = [];
let banHistory = [];
let banCandidatePlayers = [];
let banIpCandidateRecords = [];
let selectedBanIpCandidate = null;
let canAddBanPlayerByName = true;
let selectedBanCandidatePlayer = null;
let lockedBanCandidate = null;
let banOnlineMode = true;
let banSearchKeyword = "";
let playerBanDateTimePicker = null;
let banHistorySearchKeyword = "";
let banHistoryStartTime = "";
let banHistoryEndTime = "";
let banHistoryStartPicker = null;
let banHistoryEndPicker = null;
let banHistoryFlatpickrWasOpenOnPointerDown = false;
let banLoadSequence = 0;
let banJsonActionBusy = false;
let banPlayerDataState = {
    status: "valid",
    message: "",
    invalid_entries: [],
    unavailable_entries: [],
    duplicate_entries: [],
};

let banIpDataState = {
    status: "valid",
    message: "",
    invalid_entries: [],
    duplicate_entries: [],
};

const banHistoryFilters = new Set();
const OXOCRAFT_OPERATOR_ICON = "/static/icons/player_ban/OxOcraft_origin.png";
const UNKNOWN_OPERATOR_ICON = "/static/icons/general_icon/unknown.png";


export async function openAddBanPlayerModalWithLockedPlayer(player) {
    currentBanTab = "players";

    await openAddBanModal(player);
}


export function initPlayerBan() {
    const openBtn = document.getElementById("playerBanBtn");
    const modal = document.getElementById("playerBanModal");
    const closeBtn = document.getElementById("closePlayerBanBtn");
    const searchInput = document.getElementById("playerBanSearchInput");
    const searchBtn = document.getElementById("playerBanSearchBtn");
    const openAddBtn = document.getElementById("openAddBanBtn");
    const addModal = document.getElementById("addPlayerBanModal");
    const closeAddBtn = document.getElementById("closeAddPlayerBanBtn");
    const confirmAddBtn = document.getElementById("confirmAddPlayerBanBtn");
    const addTargetInput = document.getElementById("addPlayerBanTargetInput");
    const searchPlayerBtn = document.getElementById("searchPlayerBanBtn");
    const historySearchInput = document.getElementById("playerBanHistorySearchInput");
    const historySearchBtn = document.getElementById("playerBanHistorySearchBtn");
    const historyFilterBtn = document.getElementById("playerBanHistoryFilterBtn");
    const historyFilterMenu = document.getElementById("playerBanHistoryFilterMenu");
    const banDateTimeInput = document.getElementById("playerBanDateTimeInput");
    const historyTimeBtn =
        document.getElementById("playerBanHistoryTimeBtn");

    const historyTimeMenu =
        document.getElementById("playerBanHistoryTimeMenu");

    const historyStartTimeInput =
        document.getElementById("playerBanHistoryStartTime");

    const historyEndTimeInput =
        document.getElementById("playerBanHistoryEndTime");

    const historyApplyTimeBtn =
        document.getElementById("playerBanHistoryApplyTimeBtn");

    const historyClearTimeBtn =
        document.getElementById("playerBanHistoryClearTimeBtn");

    if (!window.McDateTimePicker) {
        console.warn(
            "McDateTimePicker 尚未載入，"
            + "封鎖解除時間選擇器不會初始化。"
        );
    } else if (
        banDateTimeInput
        && !playerBanDateTimePicker
    ) {
        playerBanDateTimePicker =
            window.McDateTimePicker.create({
                selector: "#playerBanDateTimeInput",
                defaultDate: null,
                enableTime: true,
                minuteIncrement: 5,
            }).instance;
    }

    if (
        window.McDateTimePicker
        && historyStartTimeInput
        && !banHistoryStartPicker
    ) {
        banHistoryStartPicker =
            window.McDateTimePicker.create({
                selector: "#playerBanHistoryStartTime",
                defaultDate: null,
                enableTime: true,
                minuteIncrement: 5,
            }).instance;
    }

    if (
        window.McDateTimePicker
        && historyEndTimeInput
        && !banHistoryEndPicker
    ) {
        banHistoryEndPicker =
            window.McDateTimePicker.create({
                selector: "#playerBanHistoryEndTime",
                defaultDate: null,
                enableTime: true,
                minuteIncrement: 5,
            }).instance;
    }

    if (!openBtn || !modal) return;

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        await loadCurrentBanTab();
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.addEventListener(
        "pointerdown",
        (event) => {
            const clickedInsideFlatpickr =
                event.target.closest(".flatpickr-calendar");

            const clickedInsideTimeMenu =
                historyTimeMenu?.contains(event.target);

            banHistoryFlatpickrWasOpenOnPointerDown =
                isFlatpickrOpen(
                    banHistoryStartPicker,
                    banHistoryEndPicker
                )
                && !clickedInsideFlatpickr
                && !clickedInsideTimeMenu;
        },
        true
    );

    modal.addEventListener("click", (event) => {
        const clickedInsideTimeMenu =
            historyTimeMenu?.contains(event.target);

        const clickedTimeButton =
            historyTimeBtn?.contains(event.target);

        const clickedInsideFilterMenu =
            historyFilterMenu?.contains(event.target);

        const clickedFilterButton =
            historyFilterBtn?.contains(event.target);

        const clickedInsideFlatpickr =
            event.target.closest(".flatpickr-calendar");

        if (
            clickedInsideTimeMenu ||
            clickedTimeButton ||
            clickedInsideFilterMenu ||
            clickedFilterButton ||
            clickedInsideFlatpickr
        ) {
            return;
        }

        closeFirstAvailableLayer([
            {
                isOpen: () =>
                    banHistoryFlatpickrWasOpenOnPointerDown ||
                    isFlatpickrOpen(
                        banHistoryStartPicker,
                        banHistoryEndPicker
                    ),

                close: () => {
                    closeFlatpickr(
                        banHistoryStartPicker,
                        banHistoryEndPicker
                    );

                    banHistoryFlatpickrWasOpenOnPointerDown = false;
                },
            },
            {
                isOpen: () =>
                    historyTimeMenu &&
                    !historyTimeMenu.classList.contains("hidden"),

                close: () => {
                    historyTimeMenu.classList.add("hidden");
                },
            },
            {
                isOpen: () =>
                    isFilterMenuOpen(historyFilterMenu),

                close: () =>
                    closeFilterMenu(historyFilterMenu),
            },
            {
                isOpen: () =>
                    event.target === modal &&
                    !modal.classList.contains("hidden"),

                close: () => {
                    modal.classList.add("hidden");
                },
            },
        ]);
    });

    

    document.querySelectorAll(".player-ban-tab").forEach((button) => {
            button.addEventListener("click", async () => {

                const nextTab =
                    button.dataset.tab || "players";

                if (currentBanTab === nextTab) {
                    return;
                }

                currentBanTab = nextTab;

                updateBanTabs();
                await loadCurrentBanTab();
            });
        });

    searchBtn?.addEventListener("click", () => {
        applyBanSearch();
    });

    searchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            applyBanSearch();
        }
    });


    historySearchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            applyBanHistorySearch();
        }
    });

    historySearchBtn?.addEventListener("click", () => {
        applyBanHistorySearch();
    });

    historyFilterBtn?.addEventListener("click", (event) => {
        event.stopPropagation();

        historyFilterMenu?.classList.toggle("hidden");
        historyTimeMenu?.classList.add("hidden");
    });

    historyFilterMenu
        ?.querySelectorAll("button[data-filter]")
        .forEach((button) => {
            button.addEventListener("click", () => {
                const filter = button.dataset.filter || "";

                if (!filter) return;

                if (filter === "clear") {
                    banHistoryFilters.clear();

                    historyFilterMenu
                        .querySelectorAll("button[data-filter]")
                        .forEach(btn => {
                            btn.classList.remove("active");
                        });

                    renderBanHistory();
                    return;
                }

                if (banHistoryFilters.has(filter)) {
                    banHistoryFilters.delete(filter);
                    button.classList.remove("active");
                } else {
                    banHistoryFilters.add(filter);
                    button.classList.add("active");
                }

                renderBanHistory();
            });
        });

    historyFilterMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    

    window.addEventListener("server-ui-state-changed", async () => {
        renderBanActionButtons();

        const addModal =
            document.getElementById(
                "addPlayerBanModal"
            );

        const isAddModalOpen =
            addModal
            && !addModal.classList.contains("hidden");

        if (
            isAddModalOpen
            && currentBanTab === "players"
        ) {
            renderBanCandidates();
        }

        const modal = document.getElementById("playerBanModal");
        if (modal && !modal.classList.contains("hidden") && currentBanTab === "players") {
            await loadCurrentBanTab();
        }
    });

    openAddBtn?.addEventListener("click", async () => {
        await openAddBanModal();
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
        await submitAddBan();
    });

    searchPlayerBtn?.addEventListener("click", async () => {
        await handleSearchBanPlayer();
    });

    addTargetInput?.addEventListener("keydown", async (event) => {
        if (
            event.key !== "Enter"
            || currentBanTab !== "players"
        ) {
            return;
        }

        event.preventDefault();

        if (!canAddBanPlayerByName) {
            return;
        }

        await handleSearchBanPlayer();
    });

    addTargetInput?.addEventListener("input", () => {
        if (
            currentBanTab === "players" &&
            lockedBanCandidate
        ) {
            return;
        }

        if (currentBanTab === "players") {
            selectedBanCandidatePlayer = null;
            renderBanCandidates();
            return;
        }

        if (currentBanTab === "ips") {
            selectedBanIpCandidate = null;
            renderIpBanCandidates();
        }
    });

    document
        .querySelectorAll('input[name="playerBanExpireType"]')
        .forEach((radio) => {
            radio.addEventListener("change", renderExpireFields);
        });

    window.addEventListener(
        "player-ban-should-refresh",
        async () => {
            console.log("[PlayerBan] frontend refresh event received");

            const modal =
                document.getElementById(
                    "playerBanModal"
                );

            if (
                !modal ||
                modal.classList.contains("hidden")
            ) {
                return;
            }

            await loadCurrentBanTab();
        }
    );

    historyTimeBtn?.addEventListener("click", (event) => {
        event.stopPropagation();

        historyTimeMenu?.classList.toggle("hidden");
        historyFilterMenu?.classList.add("hidden");
    });

    historyTimeMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    historyApplyTimeBtn?.addEventListener("click", () => {
        applyBanHistoryTimeFilter();

        setActiveHistoryTimeRange(
            historyTimeMenu,
            ""
        );

        historyTimeMenu?.classList.add("hidden");
    });

    historyClearTimeBtn?.addEventListener("click", () => {
        clearBanHistoryTimeFilter();

        setActiveHistoryTimeRange(
            historyTimeMenu,
            ""
        );
    });

    historyTimeMenu?.querySelectorAll("button[data-time-range]").forEach((button) => {
        button.addEventListener("click", () => {
            const range =
                button.dataset.timeRange || "";

            applyBanHistoryQuickTimeRange(range);

            setActiveHistoryTimeRange(
                historyTimeMenu,
                range
            );
        });
    });


}

function updateBanTabs() {
    document
        .querySelectorAll(".player-ban-tab")
        .forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.tab === currentBanTab
            );
        });

    const title = document.getElementById("playerBanTitle");
    const toolbar = document.getElementById("playerBanToolbar");
    const historyToolbar = document.getElementById("playerBanHistoryToolbar");
    const summary = document.getElementById("playerBanSummary");
    const playerCount = document.getElementById("playerBanPlayerCount");
    const searchInput = document.getElementById("playerBanSearchInput");
    const addBtn = document.getElementById("openAddBanBtn");
    const historySearchInput = document.getElementById("playerBanHistorySearchInput");

    const titleMap = {
        players: "黑名單管理：封鎖玩家",
        ips: "黑名單管理：封鎖IP",
        history: "黑名單管理：封鎖紀錄",
        help: "黑名單管理：說明",
    };

    if (historySearchInput) {
        historySearchInput.value = "";
    }

    if (title) {
        title.textContent = titleMap[currentBanTab] || titleMap.players;
    }

    if (summary) {
        summary.classList.toggle("hidden", currentBanTab === "help");
    }

    if (playerCount) {
        playerCount.classList.toggle("hidden", currentBanTab === "help");
    }

    if (toolbar) {
        toolbar.classList.toggle(
            "hidden",
            currentBanTab === "history" || currentBanTab === "help"
        );
    }

    if (historyToolbar) {
        historyToolbar.classList.toggle(
            "hidden",
            currentBanTab !== "history"
        );
    }

    banSearchKeyword = "";

    if (searchInput) {
        searchInput.value = "";
        searchInput.placeholder =
            currentBanTab === "ips"
                ? "搜尋IP"
                : "搜尋玩家名稱";
    }

    if (addBtn) {
        addBtn.textContent =
            currentBanTab === "ips"
                ? "+ 新增IP到黑名單"
                : "+ 新增玩家到黑名單";
    }
}

async function loadCurrentBanTab() {
    const tab = currentBanTab;
    const sequence = ++banLoadSequence;

    try {
        updateBanTabs();

        const urls = {
            players: "/api/player/ban/players",
            ips: "/api/player/ban/ips",
            history: "/api/player/ban/history",
        };

        if (urls[tab]) {
            const response = await fetch(urls[tab], { cache: "no-store" });
            const data = await response.json();

            if (sequence !== banLoadSequence || tab !== currentBanTab) {
                return false;
            }

            if (!response.ok || !data.success) {
                throw new Error(data.message || "讀取黑名單資料失敗");
            }

            if (tab === "players") {
                banPlayers = data.players || [];
                banOnlineMode = Boolean(data.online_mode);
                banPlayerDataState = {
                    status: data.data_status || "valid",
                    message: data.message || "",
                    invalid_entries: Array.isArray(data.invalid_entries) ? data.invalid_entries : [],
                    unavailable_entries: Array.isArray(data.unavailable_entries) ? data.unavailable_entries : [],
                    duplicate_entries: Array.isArray(data.duplicate_entries) ? data.duplicate_entries : [],
                };
            } else if (tab === "ips") {
                banIps = data.ips || [];
                banOnlineMode = Boolean(data.online_mode);
                banIpDataState = {
                    status: data.data_status || "valid",
                    message: data.message || "",
                    invalid_entries: Array.isArray(data.invalid_entries) ? data.invalid_entries : [],
                    duplicate_entries: Array.isArray(data.duplicate_entries) ? data.duplicate_entries : [],
                };
            } else {
                banHistory = data.records || [];
            }
        }

        renderCurrentBanTab();
        renderBanActionButtons();
        return true;

    } catch (error) {
        if (sequence !== banLoadSequence || tab !== currentBanTab) {
            return false;
        }

        console.error(error);
        await showInfo({
            title: "黑名單管理",
            message: error.message || "讀取黑名單資料失敗",
            variant: "error",
        });
        return false;
    }
}


function renderBanModeBadge() {
    const summary = document.getElementById("playerBanSummary");

    if (!summary) return;

    summary.innerHTML = `
        <div class="player-ban-mode ${banOnlineMode ? "online" : "offline"}">
            ${banOnlineMode ? "✓ 正版伺服器" : "⚠ 離線伺服器"}
        </div>
    `;
}


function renderCurrentBanTab() {
    if (currentBanTab === "players") {
        renderBanPlayers();
        return;
    }

    if (currentBanTab === "ips") {
        renderBanIps();
        return;
    }

    if (currentBanTab === "history") {
        renderBanHistory();
        return;
    }

    renderBanHelp();
}

function renderBanPlayers() {
    const content = document.getElementById("playerBanContent");
    const playerCount = document.getElementById("playerBanPlayerCount");
    const keyword = getSearchKeyword();

    try {
        if (!content) return;

        renderBanModeBadge();

        if (banPlayerDataState.status === "file_invalid") {
            if (playerCount) playerCount.textContent = "玩家黑名單資料異常";
            renderBanFileError(content);
            return;
        }

        const matches = value => String(value || "").toLowerCase().includes(keyword);
        const matchEntry = item => matches(
            item?.validation?.player_name || item?.entry?.name
        );
        const players = banPlayers.filter(item => matches(item.target_name));
        const invalid = banPlayerDataState.invalid_entries.filter(matchEntry);
        const unavailable = banPlayerDataState.unavailable_entries.filter(matchEntry);
        const duplicates = banPlayerDataState.duplicate_entries.filter(matchEntry);

        if (playerCount) {
            const parts = [`共 ${players.length} 位封鎖玩家`];
            if (invalid.length) parts.push(`${invalid.length} 筆資料錯誤`);
            if (unavailable.length) parts.push(`${unavailable.length} 筆待驗證`);
            if (duplicates.length) parts.push(`${duplicates.length} 筆重複資料`);
            playerCount.textContent = parts.join("｜");
        }

        content.innerHTML = "";

        if (!players.length && !invalid.length && !unavailable.length && !duplicates.length) {
            content.innerHTML = `<div class="player-ban-empty">目前沒有符合條件的封鎖玩家</div>`;
            return;
        }

        invalid.forEach(item => content.appendChild(createBanPlayerJsonIssueCard(item, "invalid")));
        unavailable.forEach(item => content.appendChild(createBanPlayerJsonIssueCard(item, "unavailable")));
        duplicates.forEach(item => content.appendChild(createBanPlayerJsonIssueCard(item, "duplicate")));
        players.forEach(item => content.appendChild(createBanPlayerCard(item)));
    } finally {
        // 空清單及錯誤畫面也必須更新按鈕，避免恢復後沿用舊鎖定狀態。
        renderBanActionButtons();
    }
}


function getBanOperatorAvatarUrl(item) {
    const operator = String(item.operator || "OxOcraft").trim();

    if (operator === "OxOcraft") {
        return OXOCRAFT_OPERATOR_ICON;
    }

    return getPlayerAvatarUrl({
        player_uuid: item.operator_uuid || "",
        player_name: operator,
        account_type: item.operator_account_type || item.account_type || "unknown"
    });
}


function createBanPlayerCard(item, duplicateEntry = null) {
    const card = document.createElement("div");
    const isDuplicate = duplicateEntry !== null;
    const isInvalidMode = item.valid_for_current_mode === false;

    card.className = "player-ban-card";

    if (isDuplicate) {
        card.classList.add("player-ban-json-issue", "duplicate");
    }

    if (isInvalidMode) {
        card.classList.add("player-ban-invalid-mode");
    }

    card.dataset.id = item.id;

    card.innerHTML = `
        <img
            class="player-ban-avatar"
            src="${getPlayerAvatarUrl({
                player_uuid: item.target_uuid,
                player_name: item.target_name,
                account_type: item.account_type
            })}"
            alt="${escapeHtml(item.target_name)}"
        >

        <div class="player-ban-card-info">
            <div class="player-ban-name-row">
                <div class="player-ban-name">
                    ${escapeHtml(item.target_name)}
                </div>

                ${isDuplicate ? `
                    <span class="player-ban-json-issue-tag">
                        重複資料
                    </span>
                ` : ""}
            </div>

            <div class="player-ban-history-meta">
                UUID：${escapeHtml(item.target_uuid || "未知")}
            </div>

            <div class="player-ban-history-meta">
                封鎖原因：${escapeHtml(item.reason || "已被管理員封鎖。")}
            </div>

            ${isInvalidMode ? `
                <div class="player-ban-meta player-ban-invalid-mode-text">
                    此資料不符合目前伺服器的登入模式，可能無效
                </div>
            ` : ""}
        </div>

        <div class="player-ban-time-info">
            <div class="player-ban-history-meta">
                封鎖時間：${escapeHtml(formatDateTime(item.created_at))}
            </div>

            <div class="player-ban-history-meta">
                解除時間：${formatExpireText(item)}
            </div>
        </div>

        <button
            class="${isDuplicate
                ? "player-ban-json-repair-btn player-ban-json-duplicate-remove"
                : "player-ban-unban-btn"}"
            type="button"
            data-mc-tooltip="${isDuplicate ? "刪除此筆重複資料" : "解除封鎖"}"
            aria-label="${isDuplicate ? "刪除此筆重複資料" : "解除封鎖"}"
        >
            ✕
        </button>

        ${isDuplicate ? `
            <div class="player-ban-json-issue-footer">
                <div class="player-ban-json-issue-message">
                    同一個UUID在banned-players.json中重複出現，請自行選擇哪一筆保留。
                </div>

                <div class="player-ban-json-issue-hint">
                    banned-players.json 第 ${
                        Number.isInteger(duplicateEntry.entry_index)
                            ? duplicateEntry.entry_index + 1
                            : "未知"
                    } 筆資料
                </div>
            </div>
        ` : ""}
    `;

    const actionBtn = card.querySelector(
        isDuplicate
            ? ".player-ban-json-duplicate-remove"
            : ".player-ban-unban-btn"
    );

    actionBtn?.addEventListener("click", async event => {
        if (isDuplicate) {
            await removeDuplicateBanPlayerEntry(
                duplicateEntry,
                event.currentTarget
            );
        } else {
            await unbanPlayer(item);
        }
    });

    return card;
}


function renderBanIps() {
    const content = document.getElementById("playerBanContent");
    const count = document.getElementById("playerBanPlayerCount");
    const keyword = getSearchKeyword();
    try {
        if (!content) return;
        renderBanModeBadge();
        if (banIpDataState.status === "file_invalid") {
            if (count) count.textContent = "IP 黑名單資料異常";
            renderBanFileError(content, "ip");
            return;
        }
        const matches = value => String(value || "").toLowerCase().includes(keyword);
        const matchEntry = item => matches(item?.entry?.ip);
        const ips = banIps.filter(item => matches(item.target_name));
        const invalid = banIpDataState.invalid_entries.filter(matchEntry);
        const duplicates = banIpDataState.duplicate_entries.filter(matchEntry);
        if (count) {
            const parts = [`共 ${ips.length} 個封鎖 IP`];
            if (invalid.length) parts.push(`${invalid.length} 筆資料錯誤`);
            if (duplicates.length) parts.push(`${duplicates.length} 筆重複資料`);
            count.textContent = parts.join("｜");
        }
        content.innerHTML = "";
        if (!ips.length && !invalid.length && !duplicates.length) {
            content.innerHTML = `<div class="player-ban-empty">目前沒有符合條件的封鎖 IP</div>`;
            return;
        }
        ips.forEach(item => content.appendChild(createBanIpCard(item)));
        invalid.forEach(item => content.appendChild(createBanIpJsonIssueCard(item, "invalid")));
        duplicates.forEach(item => content.appendChild(createBanIpJsonIssueCard(item, "duplicate")));
    } finally {
        renderBanActionButtons();
    }
}

function createBanIpCard(item, issueEntry = null, kind = "") {
    const card = document.createElement("div");
    const isIssue = issueEntry !== null;
    const isDuplicate = kind === "duplicate";
    const actionText = isIssue ? `刪除此筆${isDuplicate ? "重複" : "錯誤"}資料` : "解除封鎖";
    card.className = "player-ban-card";
    if (isIssue) card.classList.add("player-ban-json-issue", "player-ban-ip-json-issue", kind);
    const expiresText = isIssue
        ? escapeHtml(item.permanent === 1 ? "永久封鎖" : formatDateTime(item.expires_at))
        : formatExpireText(item);
    card.innerHTML = `
        <div class="player-ban-ip-icon">
            <img class="player-ban-avatar" src="/static/icons/player_ban/barrier.png" alt="IP">
        </div>
        <div class="player-ban-card-info">
            <div class="player-ban-name-row">
                <div class="player-ban-name">封鎖 IP：${escapeHtml(item.target_name)}</div>
                ${isIssue ? `<span class="player-ban-json-issue-tag">${isDuplicate ? "重複資料" : "資料錯誤"}</span>` : ""}
            </div>
            <div class="player-ban-history-meta">封鎖原因：${escapeHtml(item.reason || "已被管理員封鎖。")}</div>
        </div>
        <div class="player-ban-time-info">
            <div class="player-ban-history-meta">封鎖時間：${escapeHtml(formatDateTime(item.created_at))}</div>
            <div class="player-ban-history-meta">解除時間：${expiresText}</div>
        </div>
        <button class="${isIssue ? `player-ban-json-repair-btn player-ban-json-${isDuplicate ? "duplicate" : "invalid"}-remove` : "player-ban-unban-btn"}"
            type="button" data-mc-tooltip="${actionText}" aria-label="${actionText}">✕</button>
        ${isIssue ? `
            <div class="player-ban-json-issue-footer">
                <div class="player-ban-json-issue-message">${escapeHtml(isDuplicate
                    ? "同一個 IP 在 banned-ips.json 中重複出現，請自行選擇哪一筆保留。"
                    : issueEntry.validation?.message || "封鎖 IP 資料格式錯誤")}</div>
                <div class="player-ban-json-issue-hint">banned-ips.json 第 ${issueEntry.entry_index + 1} 筆資料</div>
            </div>
        ` : ""}
    `;
    card.querySelector("button")?.addEventListener("click", async event => {
        if (isIssue) {
            await removeBanIpJsonEntry(issueEntry, kind, event.currentTarget);
        } else {
            await unbanIp(item);
        }
    });
    return card;
}


function createBanIpJsonIssueCard(item, kind) {
    const entry = item?.entry && typeof item.entry === "object" && !Array.isArray(item.entry) ? item.entry : {};
    return createBanIpCard({
        target_name: typeof entry.ip === "string" && entry.ip.trim() ? entry.ip : "未知 IP",
        reason: typeof entry.reason === "string" ? entry.reason : "未知",
        created_at: typeof entry.created === "string" ? entry.created : "",
        permanent: entry.expires === "forever" ? 1 : 0,
        expires_at: typeof entry.expires === "string" && entry.expires !== "forever" ? entry.expires : "",
    }, item, kind);
}


async function removeBanIpJsonEntry(item, kind, button) {
    if (button?.disabled || banJsonActionBusy || isUiServerTransitionState() || getUiServerState() !== "offline") return;
    const isDuplicate = kind === "duplicate";
    const confirmed = await showConfirm({
        title: `刪除${isDuplicate ? "重複" : "錯誤"} IP 資料`,
        message: `只刪除 banned-ips.json 第 ${item.entry_index + 1} 筆資料。${isDuplicate ? "\n其他相同 IP 的資料會保留。" : ""}是否繼續？`,
        confirmText: "刪除", cancelText: "取消", variant: "warning",
    });
    if (!confirmed) return;
    const success = await performBanJsonAction(button, `/api/player/ban/ip/${kind}-entry/remove`, {
        entry_index: item.entry_index, entry: item.entry,
    });
    if (!success) await loadCurrentBanTab();
}

async function unbanPlayer(item) {
    const confirmed = await showConfirm({
        title: "解除玩家封鎖",
        message: `確定要解除「${item.target_name}」的封鎖嗎？`,
        icon: getPlayerAvatarUrl({
            player_uuid: item.target_uuid,
            player_name: item.target_name,
            account_type: item.account_type
        }),
        confirmText: "解除封鎖",
        cancelText: "取消",
        variant: "warning",
    });

    if (!confirmed) return;

    try {
        const response = await fetch(
            "/api/player/ban/player/unban",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    uuid: item.target_uuid || item.player_uuid,
                    operator: "OxOcraft"
                })
            }
        );

        const data = await response.json();

        if (!data.success) {
            if (data.data_status) await loadCurrentBanTab();
            throw new Error(
                data.message || "解除玩家封鎖失敗"
            );
        }

        await loadCurrentBanTab();

        await showInfo({
            title: "黑名單管理",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("解除玩家封鎖失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "解除玩家封鎖失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


async function unbanIp(item) {
    const confirmed = await showConfirm({
        title: "解除IP封鎖",
        message: `確定要解除 IP「${item.target_name}」的封鎖嗎？`,
        icon: "/static/icons/player_ban/barrier.png",
        confirmText: "解除封鎖",
        cancelText: "取消",
        variant: "warning",
    });

    if (!confirmed) return;

    try {
        const response = await fetch(
            "/api/player/ban/ip/unban",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ip: item.ip || item.target_name,
                    operator: "OxOcraft"
                })
            }
        );

        const data = await response.json();

        if (!data.success) {
            if (data.data_status) await loadCurrentBanTab();
            throw new Error(
                data.message || "解除 IP 封鎖失敗"
            );
        }

        await loadCurrentBanTab();

        await showInfo({
            title: "黑名單管理",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("解除 IP 封鎖失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "解除 IP 封鎖失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


function applyBanHistorySearch() {
    const searchInput =
        document.getElementById(
            "playerBanHistorySearchInput"
        );

    banHistorySearchKeyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    renderBanHistory();
}


function applyBanHistoryTimeFilter() {
    const startInput =
        document.getElementById(
            "playerBanHistoryStartTime"
        );

    const endInput =
        document.getElementById(
            "playerBanHistoryEndTime"
        );

    banHistoryStartTime =
        (startInput?.value || "").trim();

    banHistoryEndTime =
        (endInput?.value || "").trim();

    renderBanHistory();
}

function clearBanHistoryTimeFilter() {
    banHistoryStartTime = "";
    banHistoryEndTime = "";

    banHistoryStartPicker?.clear();
    banHistoryEndPicker?.clear();

    const startInput =
        document.getElementById(
            "playerBanHistoryStartTime"
        );

    const endInput =
        document.getElementById(
            "playerBanHistoryEndTime"
        );

    if (startInput) startInput.value = "";
    if (endInput) endInput.value = "";

    renderBanHistory();
}

function applyBanHistoryQuickTimeRange(range) {
    if (range === "all") {
        clearBanHistoryTimeFilter();
        return;
    }

    const now = new Date();
    const start = new Date(now);

    if (range === "today") {
        start.setHours(0, 0, 0, 0);
    }

    if (range === "7d") {
        start.setDate(now.getDate() - 7);
        start.setHours(0, 0, 0, 0);
    }

    if (range === "30d") {
        start.setDate(now.getDate() - 30);
        start.setHours(0, 0, 0, 0);
    }

    banHistoryStartPicker?.setDate(start, true);
    banHistoryEndPicker?.setDate(now, true);

    applyBanHistoryTimeFilter();
}


function renderBanHistory() {
    const content = document.getElementById("playerBanContent");
    const summary = document.getElementById("playerBanSummary");
    const playerCount = document.getElementById("playerBanPlayerCount");

    const keyword = banHistorySearchKeyword;

    if (!content) return;

    let rows = [...banHistory];

    rows = filterRowsByDateRange(rows, {
        getDate: item => item.created_at,
        start: banHistoryStartTime,
        end: banHistoryEndTime,
    });

    const typeFilters = [...banHistoryFilters]
        .filter(filter => filter === "player" || filter === "ip");

    const actionFilters = [...banHistoryFilters]
        .filter(filter =>
            ["add", "remove", "duplicate", "invalid"].includes(filter)
        );

    const sourceFilters =
    [...banHistoryFilters]
        .filter(filter =>
            [
                "oxocraft",
                "player_list",
                "minecraft_sync",
                "rcon",
                "command",
                "system",
            ].includes(filter)
        );

    if (typeFilters.length > 0) {
        rows = rows.filter(item => {
            return typeFilters.includes(item.target_type);
        });
    }

    if (actionFilters.length > 0) {
        rows = rows.filter(item => {
            const action = String(item.action || "").toLowerCase();

            const isDuplicate = action.includes("duplicate");
            const isInvalid = action === "invalid_entry_remove";
            const isDataCleanup = isDuplicate || isInvalid;

            const isRemove =
                !isDataCleanup
                && (
                    action.includes("remove")
                    || action.includes("pardon")
                );

            const isAdd = !isDataCleanup && !isRemove;

            return (
                (actionFilters.includes("add") && isAdd) ||
                (actionFilters.includes("remove") && isRemove) ||
                (actionFilters.includes("duplicate") && isDuplicate) ||
                (actionFilters.includes("invalid") && isInvalid)
            );
        });
    }

    if (sourceFilters.length > 0) {
        rows = rows.filter(item => {
            const source =
                String(item.source || "")
                    .trim()
                    .toLowerCase();

            const isOxocraft =
                source === "ui" ||
                source === "offline_ui_edit" ||
                source === "online_ui_manage" ||
                source === "ui_reload";

            const isMinecraftSync = source === "minecraft_json";

            const isPlayerList = source === "player_list";

            const isSystem =
                source === "system" ||
                source === "scheduler" ||
                source === "player_ban_scheduler";

            const isRcon =
                source === "rcon" ||
                source === "console_rcon" ||
                source === "console_rcon_reload";

            const isCommand =
                source === "player_command" ||
                source === "player_command_reload";

            return (
                (
                    sourceFilters.includes("oxocraft")
                    && isOxocraft
                )||
                (
                    sourceFilters.includes("player_list")
                    && isPlayerList
                )||
                (
                    sourceFilters.includes("minecraft_sync")
                    && isMinecraftSync
                )
                ||
                (
                    sourceFilters.includes("system")
                    && isSystem
                )
                ||
                (
                    sourceFilters.includes("rcon")
                    && isRcon
                )
                ||
                (
                    sourceFilters.includes("command")
                    && isCommand
                )
            );
        });
    }

    if (keyword) {
        rows = rows.filter(item => {
            return (
                String(item.target_name || "").toLowerCase().includes(keyword) ||
                String(item.target_uuid || "").toLowerCase().includes(keyword)
            );
        });
    }

    renderBanModeBadge();

    if (playerCount) {
        playerCount.classList.remove("hidden");
        playerCount.textContent = `共 ${rows.length} 筆封鎖紀錄`;
    }

    content.innerHTML = "";

    if (rows.length === 0) {
        content.innerHTML = `<div class="player-ban-empty">目前沒有符合條件的封鎖紀錄</div>`;
        return;
    }

    rows.forEach(item => {
        content.appendChild(createBanHistoryCard(item));
    });
}

function renderBanHelp() {
    const content = document.getElementById("playerBanContent");
    const summary = document.getElementById("playerBanSummary");

    if (summary) {
        summary.textContent = "";
        summary.classList.add("hidden");
    }

    if (!content) return;

    content.innerHTML = `
        <div class="player-ban-help">
            ${PLAYER_BAN_HELP.map(createBanHelpCard).join("")}
        </div>
    `;
}

function createBanHelpCard(item) {
    return `
        <section class="player-ban-help-card">
            <h3 class="player-ban-help-card-title">
                ${escapeHtml(item.title)}
            </h3>

            ${item.content
                .map(text => `
                    <p class="player-ban-help-card-text">
                        ${escapeHtml(text)}
                    </p>
                `)
                .join("")}
        </section>
    `;
}

function renderBanActionButtons() {
    const transitionLocked = isUiServerTransitionState();
    const locked = transitionLocked || banJsonActionBusy || hasCurrentBanDataIssues();
    document
        .querySelectorAll(".player-ban-unban-btn, #openAddBanBtn, #confirmAddPlayerBanBtn, .player-ban-candidate-select-btn")
        .forEach(button => { button.disabled = locked; });
    document.querySelectorAll(".player-ban-card:not(.player-ban-json-issue)")
        .forEach(card => { card.classList.toggle("disabled", locked); });
    document.querySelectorAll(".player-ban-json-repair-btn").forEach(button => {
        button.disabled = banJsonActionBusy || transitionLocked || getUiServerState() !== "offline";
    });
    document.querySelectorAll(".player-ban-file-link")
        .forEach(button => { button.disabled = banJsonActionBusy; });
}


function hasBanIpDataIssues() {
    return banIpDataState.status !== "valid"
        || banIpDataState.invalid_entries.length > 0
        || banIpDataState.duplicate_entries.length > 0;
}


function hasCurrentBanDataIssues() {
    if (currentBanTab === "players") return hasBanPlayerDataIssues();
    if (currentBanTab === "ips") return hasBanIpDataIssues();
    return false;
}

function hasBanPlayerDataIssues() {
    return banPlayerDataState.status !== "valid"
        || banPlayerDataState.invalid_entries.length > 0
        || banPlayerDataState.unavailable_entries.length > 0
        || banPlayerDataState.duplicate_entries.length > 0;
}


function renderBanFileError(content, target = "player") {
    const isIp = target === "ip";
    const file = isIp ? "banned-ips.json" : "banned-players.json";
    const label = isIp ? "IP 黑名單" : "玩家黑名單";
    const state = isIp ? banIpDataState : banPlayerDataState;
    content.innerHTML = `
        <div class="player-ban-file-error">
            <div class="player-ban-file-error-title">${label}參數檔出錯</div>
            <div>格式或資料錯誤，需要檢查
                <button class="player-ban-file-link" type="button"
                    data-mc-tooltip="使用預設程式開啟目前伺服器的 ${file}">${file}</button>。
            </div>
            <div class="player-ban-file-error-detail">${escapeHtml(state.message)}</div>
            <div class="player-ban-file-error-actions">
                <button class="player-ban-json-repair-btn" data-action="recheck" type="button">重新檢查</button>
                <button class="player-ban-json-repair-btn" data-action="recover" type="button"
                    data-mc-tooltip="使用資料庫中的封鎖資料重建檔案，管理工具的封鎖期限會保留">恢復舊資料</button>
            </div>
        </div>
    `;
    content.querySelector(".player-ban-file-link")?.addEventListener("click", event => {
        void performBanJsonAction(event.currentTarget, `/api/player/ban/${target}/open-file`, {}, false);
    });
    content.querySelector('[data-action="recheck"]')?.addEventListener("click", event => {
        void recheckBannedFile(event.currentTarget, target);
    });
    content.querySelector('[data-action="recover"]')?.addEventListener("click", event => {
        void recoverBannedFile(event.currentTarget, target);
    });
}

function createBanPlayerJsonIssueCard(item, kind) {
    const entry = item?.entry
        && typeof item.entry === "object"
        && !Array.isArray(item.entry)
        ? item.entry
        : {};

    const validation = item?.validation || {};
    const name = String(validation.player_name || entry.name || "未知玩家");
    const uuid = String(validation.player_uuid || entry.uuid || "缺少 UUID");

    if (kind === "duplicate") {
        return createBanPlayerCard({
            target_name: name,
            target_uuid: validation.player_uuid || entry.uuid || "",
            account_type: validation.account_type || null,
            reason: entry.reason,
            created_at: entry.created,
            permanent: entry.expires === "forever" ? 1 : 0,
            expires_at: entry.expires === "forever" ? null : entry.expires,
        }, item);
    }

    const isInvalid = kind === "invalid";

    const createdText = formatDateTime(
        typeof entry.created === "string"
            ? entry.created.trim()
            : ""
    );

    const expiresText = entry.expires === "forever"
        ? "永久封鎖"
        : formatDateTime(
            typeof entry.expires === "string"
                ? entry.expires.trim()
                : ""
        );

    const labels = {
        invalid: "資料錯誤",
        unavailable: "無法驗證",
    };

    const message = validation.message || "目前無法驗證這筆資料";
    const index = Number.isInteger(item?.entry_index)
        ? item.entry_index + 1
        : "未知";

    const card = document.createElement("div");

    card.className = `player-ban-card player-ban-json-issue ${kind}`;

    card.innerHTML = `
        <img
            class="player-ban-avatar"
            src="${UNKNOWN_OPERATOR_ICON}"
            alt="${escapeHtml(name)}"
        >

        <div class="player-ban-card-info">
            <div class="player-ban-name-row">
                <div class="player-ban-name">${escapeHtml(name)}</div>
                <span class="player-ban-json-issue-tag">${labels[kind]}</span>
            </div>

            <div class="player-ban-history-meta">
                UUID：${escapeHtml(uuid)}
            </div>

            <div class="player-ban-json-issue-message">
                ${escapeHtml(message)}
            </div>

            <div class="player-ban-json-issue-hint">
                banned-players.json 第${index}筆資料
            </div>

            ${kind === "unavailable" ? `
                <button class="player-ban-file-link" type="button">
                    開啟 banned-players.json
                </button>
            ` : ""}
        </div>

        ${isInvalid ? `
            <div class="player-ban-time-info">
                <div class="player-ban-history-meta">
                    封鎖時間：${escapeHtml(createdText)}
                </div>

                <div class="player-ban-history-meta">
                    解除時間：${escapeHtml(expiresText)}
                </div>
            </div>
        ` : ""}

        ${isInvalid ? `
            <button
                class="player-ban-json-repair-btn player-ban-json-invalid-remove"
                type="button"
                data-mc-tooltip="刪除此筆錯誤資料"
                aria-label="刪除此筆錯誤資料"
            >✕</button>
        ` : kind === "unavailable" ? `
            <button class="player-ban-json-repair-btn" type="button">
                重新驗證
            </button>
        ` : ""}
    `;

    card.querySelector(".player-ban-file-link")
        ?.addEventListener("click", event => {
            void performBanJsonAction(
                event.currentTarget,
                "/api/player/ban/player/open-file",
                {},
                false
            );
        });

    card.querySelector(".player-ban-json-repair-btn")
        ?.addEventListener("click", event => {
            if (isInvalid) {
                void removeInvalidBanPlayerEntry(item, event.currentTarget);
            } else {
                void recheckBannedFile(event.currentTarget);
            }
        });

    return card;
}


async function removeInvalidBanPlayerEntry(item, button) {
    if (
        button?.disabled
        || banJsonActionBusy
        || isUiServerTransitionState()
        || getUiServerState() !== "offline"
    ) return;

    const confirmed = await showConfirm({
        title: "刪除錯誤封鎖資料",
        message: "確定刪除這筆錯誤的玩家資料嗎？",
        confirmText: "刪除",
        cancelText: "取消",
        variant: "warning",
    });

    if (!confirmed) return;

    const success = await performBanJsonAction(
        button,
        "/api/player/ban/player/invalid-entry/remove",
        {
            entry_index: item.entry_index,
            entry: item.entry,
        }
    );

    if (!success) {
        await loadCurrentBanTab();
    }
}


async function performBanJsonAction(button, url, payload = {}, refresh = true) {
    if (button?.disabled || banJsonActionBusy) return false;
    banJsonActionBusy = true;
    if (button) button.disabled = true;
    renderBanActionButtons();

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            if (data.data_status) await loadCurrentBanTab();
            throw new Error(data.message || "黑名單檔案操作失敗");
        }
        if (refresh) {
            const loaded = await loadCurrentBanTab();
            if (loaded) {
                await showInfo({ title: "黑名單", message: data.message, variant: "success", confirmText: "關閉" });
            }
        }
        return true;
    } catch (error) {
        console.error("黑名單檔案操作失敗:", error);
        await showInfo({ title: "黑名單", message: error.message || "檔案操作失敗", variant: "error", confirmText: "關閉" });
        return false;
    } finally {
        banJsonActionBusy = false;
        if (button) button.disabled = false;
        renderBanActionButtons();
    }
}


async function recheckBannedFile(button, target = "player") {
    if (button?.disabled || banJsonActionBusy) return;
    const tab = target === "ip" ? "ips" : "players";
    const file = target === "ip" ? "banned-ips.json" : "banned-players.json";
    banJsonActionBusy = true;
    if (button) button.disabled = true;
    renderBanActionButtons();
    try {
        if (!await loadCurrentBanTab() || currentBanTab !== tab) return;
        const issues = target === "ip" ? hasBanIpDataIssues() : hasBanPlayerDataIssues();
        await showInfo({
            title: "黑名單資料檢查",
            message: issues ? "重新檢查完成，仍有需要處理的資料問題。" : `目前 ${file} 資料格式與內容皆正常。`,
            variant: issues ? "warning" : "success", confirmText: "關閉",
        });
    } finally {
        banJsonActionBusy = false;
        if (button) button.disabled = false;
        renderBanActionButtons();
    }
}

async function recoverBannedFile(button, target = "player") {
    const file = target === "ip" ? "banned-ips.json" : "banned-players.json";
    const label = target === "ip" ? "IP 黑名單" : "玩家黑名單";
    const confirmed = await showConfirm({
        title: `恢復${label}舊資料`,
        message: `將使用資料庫中的封鎖資料重建 ${file}。\n目前損壞的檔案會被覆蓋，管理工具的封鎖期限會保留。`,
        confirmText: "恢復", cancelText: "取消", variant: "warning",
    });
    if (confirmed) await performBanJsonAction(button, `/api/player/ban/${target}/recover`);
}

async function removeDuplicateBanPlayerEntry(item, button) {
    const confirmed = await showConfirm({
        title: "刪除重複封鎖資料",
        message: `只刪除 banned-players.json第${item.entry_index + 1}筆重複資料，\n保留其他同UUID資料與玩家封鎖狀態。是否繼續？`,
        confirmText: "刪除", cancelText: "取消", variant: "warning",
    });
    if (!confirmed) return;
    await performBanJsonAction(button, "/api/player/ban/player/duplicate-entry/remove", {
        entry_index: item.entry_index,
        entry: item.entry,
    });
}


function getSearchKeyword() {
    return banSearchKeyword;
}


function applyBanSearch() {
    const searchInput =
        document.getElementById(
            "playerBanSearchInput"
        );

    banSearchKeyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    renderCurrentBanTab();
}


function formatDateTime(text) {
    if (!text) {
        return "未知";
    }

    const value = String(text).trim();

    // YYYY-MM-DD HH:mm:ss -> YYYY-MM-DD HH:mm
    if (value.length >= 16) {
        return value.slice(0, 16);
    }

    return value;
}

function formatRemainingTime(text) {
    if (!text) {
        return "";
    }

    const normalized = String(text).trim().replace(" ", "T");
    const expiresAt = new Date(normalized);
    const now = new Date();

    if (Number.isNaN(expiresAt.getTime())) {
        return "";
    }

    const diffMs = expiresAt.getTime() - now.getTime();

    if (diffMs <= 0) {
        return "已到期，等待解除";
    }

    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;

    const parts = [];

    if (days > 0) {
        parts.push(`${days} 天`);
    }

    if (hours > 0) {
        parts.push(`${hours} 小時`);
    }

    if (minutes > 0 || parts.length === 0) {
        parts.push(`${minutes} 分鐘`);
    }

    return `距離解除剩餘 ${parts.join(" ")}`;
}

function formatExpireText(item) {
    if (Number(item.permanent) === 1 || !item.expires_at) {
        return "永久封鎖";
    }

    const expireText = formatDateTime(item.expires_at);
    const remainingText = formatRemainingTime(item.expires_at);

    if (!remainingText) {
        return escapeHtml(expireText);
    }

    return `${escapeHtml(expireText)}（${escapeHtml(remainingText)}）`;
}

function escapeHtml(text) {
    return String(text ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


async function openAddBanModal(lockedPlayer = null) {
    if (hasCurrentBanDataIssues()) {
        await showInfo({ title: "黑名單", message: "請先處理目前黑名單的資料問題，再新增封鎖。", variant: "warning" });
        return;
    }
    lockedBanCandidate = lockedPlayer;
    selectedBanCandidatePlayer = lockedPlayer;
    selectedBanIpCandidate = null;

    const modal = document.getElementById("addPlayerBanModal");
    const title = document.getElementById("addPlayerBanTitle");
    const label = document.getElementById("addPlayerBanTargetLabel");
    const input = document.getElementById("addPlayerBanTargetInput");
    const reason = document.getElementById("addPlayerBanReasonInput");

    if (!modal) return;

    if (title) {
        title.textContent =
            currentBanTab === "ips"
                ? "新增IP到黑名單"
                : "新增玩家到黑名單";
    }

    if (label) {
        label.textContent =
            currentBanTab === "ips"
                ? "IP"
                : "玩家名稱";
    }

    if (input) {
        input.value =
            lockedBanCandidate
                ? (
                    lockedBanCandidate.player_name ||
                    lockedBanCandidate.name ||
                    ""
                )
                : "";

        input.placeholder =
            currentBanTab === "ips"
                ? "例如：192.168.0.87"
                : (
                    lockedBanCandidate
                        ? "已從玩家列表選擇玩家"
                        : "請輸入玩家名稱"
                );
    }

    if (reason) {
        reason.value = "";
    }

    playerBanDateTimePicker?.clear();

    const foreverRadio =
        document.querySelector(
            'input[name="playerBanExpireType"][value="forever"]'
        );

    if (foreverRadio) {
        foreverRadio.checked = true;
    }

    renderExpireFields();
    renderBanCandidateSection();

    modal.classList.toggle(
        "ip-mode",
        currentBanTab === "ips"
    );

    modal.classList.remove("hidden");

    if (currentBanTab === "players") {
        await loadBanCandidates();
    } else if (currentBanTab === "ips") {
        await loadIpBanCandidates();
    }

}


function renderBanCandidateSection() {
    const playerSection =
        document.getElementById(
            "playerBanCandidateSection"
        );

    const ipSection =
        document.getElementById(
            "playerBanIpCandidateSection"
        );

    const input =
        document.getElementById(
            "addPlayerBanTargetInput"
        );

    const label =
        document.getElementById(
            "addPlayerBanTargetLabel"
        );

    const searchBtn =
        document.getElementById(
            "searchPlayerBanBtn"
        );

    const isPlayerTab =
        currentBanTab === "players";

    playerSection?.classList.toggle(
        "hidden",
        !isPlayerTab
    );

    ipSection?.classList.toggle(
        "hidden",
        isPlayerTab
    );

    if (!input) return;

    if (!isPlayerTab) {
        input.disabled = false;

        if (label) {
            label.textContent = "封鎖IP";
        }

        return;
    }

    const offlineOnlineSearchDisabled =!canAddBanPlayerByName;

    const hasLockedCandidate = lockedBanCandidate !== null;

    input.disabled =
        hasLockedCandidate;

    input.placeholder =
        hasLockedCandidate
            ? "已從玩家列表選擇玩家"
            : (
                offlineOnlineSearchDisabled
                    ? "篩選下方已存在的玩家"
                    : "請輸入玩家名稱"
            );

    if (searchBtn) {
        searchBtn.disabled =
            hasLockedCandidate ||
            offlineOnlineSearchDisabled;

        if (hasLockedCandidate) {
            searchBtn.title =
                "已從玩家列表選擇玩家";

        } else {
            searchBtn.title =
                offlineOnlineSearchDisabled
                    ? (
                        "離線版伺服器在線時，"
                        + "無法搜尋新增尚未進入過伺服器的玩家，"
                        + "請從下方清單選擇玩家。"
                    )
                    : "搜尋玩家";
        }
    }

    if (label) {
        label.textContent = "玩家名稱";
    }
}


function findBanCandidateByName(playerName) {
    const keyword =
        String(playerName || "").trim();

    if (!keyword) {
        return null;
    }

    return banCandidatePlayers.find(player => {
        const name =
            String(player.player_name || "").trim();

        if (banOnlineMode) {
            return (
                name.toLowerCase()
                === keyword.toLowerCase()
            );
        }

        return name === keyword;
    }) || null;
}


function scrollSelectedBanCandidateIntoView() {
    window.setTimeout(() => {
        const selectedCard =
            document.querySelector(
                ".player-ban-candidate-card.selected"
            );

        selectedCard?.scrollIntoView({
            behavior: "smooth",
            block: "center",
        });
    }, 0);
}


async function resolveBanCandidateByInput(playerName) {
    const existingPlayer =
        findBanCandidateByName(playerName);

    if (existingPlayer) {
        selectedBanCandidatePlayer = existingPlayer;
        renderBanCandidates();
        scrollSelectedBanCandidateIntoView();
        return true;
    }

    if (!canAddBanPlayerByName) {
        return false;
    }

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

    const exists = banCandidatePlayers.some(item =>
        String(item.player_uuid || "").toLowerCase()
        === String(player.player_uuid || "").toLowerCase()
    );

    if (!exists) {
        banCandidatePlayers.unshift(player);
    }

    selectedBanCandidatePlayer = player;
    renderBanCandidates();
    scrollSelectedBanCandidateIntoView();

    return true;
}


async function handleSearchBanPlayer() {
    if (currentBanTab !== "players") {
        return;
    }

    if (!canAddBanPlayerByName) {
        return;
    }

    const input =
        document.getElementById("addPlayerBanTargetInput");

    const playerName = (input?.value || "").trim();

    if (!playerName) {
        await showInfo({
            title: "黑名單管理",
            message: "請輸入玩家名稱",
            confirmText: "關閉",
            variant: "warning"
        });
        return;
    }

    try {
        const resolved =
            await resolveBanCandidateByInput(playerName);

        if (resolved === "cancelled") {
            return;
        }

        if (!resolved) {
            await showInfo({
                title: "黑名單管理",
                message:
                    "離線模式且伺服器在線時，只能從下方玩家清單選擇玩家。",
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


async function loadBanCandidates() {
    const list =
        document.getElementById("playerBanCandidateList");

    if (!list) return;

    list.innerHTML = `
        <div class="player-ban-empty">
            載入玩家資料中...
        </div>
    `;

    try {
        const response = await fetch(
            "/api/player/ban/candidates",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message || "候選玩家載入失敗"
            );
        }

        banCandidatePlayers =
            data.players || [];

        canAddBanPlayerByName =
            data.can_add_by_name !== false;

        renderBanCandidateSection();
        renderBanCandidates();

    } catch (error) {
        console.error("候選玩家載入失敗:", error);

        list.innerHTML = `
            <div class="player-ban-empty">
                候選玩家載入失敗
            </div>
        `;
    }
}


async function loadIpBanCandidates() {
    const list =
        document.getElementById(
            "playerBanIpCandidateList"
        );

    if (!list) return;

    list.innerHTML = `
        <div class="player-ban-empty">
            載入玩家 IP 紀錄中...
        </div>
    `;

    try {
        const response = await fetch(
            "/api/player/ban/ip-candidates",
            {
                cache: "no-store"
            }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message
                || "玩家 IP 紀錄載入失敗"
            );
        }

        banIpCandidateRecords =
            data.records || [];

        renderIpBanCandidates();

    } catch (error) {
        console.error(
            "玩家 IP 紀錄載入失敗:",
            error
        );

        list.innerHTML = `
            <div class="player-ban-empty">
                玩家 IP 紀錄載入失敗
            </div>
        `;
    }
}


function renderIpBanCandidates() {
    const list =
        document.getElementById(
            "playerBanIpCandidateList"
        );

    const input =
        document.getElementById(
            "addPlayerBanTargetInput"
        );

    if (!list) return;

    const keyword =
        (input?.value || "")
            .trim()
            .toLowerCase();

    let records = [
        ...banIpCandidateRecords
    ];

    if (keyword) {
        records = records.filter(record => {
            const playerName =
                String(
                    record.player_name || ""
                ).toLowerCase();

            const ip =
                String(
                    record.ip || ""
                ).toLowerCase();

            return (
                playerName.includes(keyword)
                || ip.includes(keyword)
            );
        });
    }

    list.innerHTML = "";

    if (records.length === 0) {
        list.innerHTML = `
            <div class="player-ban-empty">
                尚未有符合條件的玩家 IP 紀錄
            </div>
        `;
        return;
    }

    records.forEach(record => {
        list.appendChild(
            createIpBanCandidateCard(record)
        );
    });
}


function renderBanCandidates() {
    const list =
        document.getElementById("playerBanCandidateList");

    if (!list) return;

    const input =
        document.getElementById("addPlayerBanTargetInput");

    const keyword =
        (input?.value || "").trim().toLowerCase();

    let players =
        lockedBanCandidate
            ? [lockedBanCandidate]
            : [...banCandidatePlayers];

    if (keyword) {
        players = players.filter(player =>
            String(player.player_name || "")
                .toLowerCase()
                .includes(keyword)
        );
    }

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-ban-empty">
                尚未有符合條件的玩家紀錄
            </div>
        `;
        return;
    }

    players.forEach(player => {
        list.appendChild(
            createBanCandidateCard(player)
        );
    });
}


function renderBanPlayerStateBadge(player) {
    if (player.online) {
        return `
            <div class="
                player-ban-player-state
                online
            ">
                在線
            </div>
        `;
    }

    return `
        <div class="
            player-ban-player-state
            offline
        ">
            離線
        </div>
    `;
}


function createBanCandidateCard(player) {
    const card = document.createElement("div");

    card.className = "player-ban-candidate-card";

    if (
        selectedBanCandidatePlayer &&
        String(selectedBanCandidatePlayer.player_uuid || "").toLowerCase()
        === String(player.player_uuid || "").toLowerCase()
    ) {
        card.classList.add("selected");
    }

    const avatarUrl = getPlayerAvatarUrl(player);

    const canDeleteCandidate = getUiServerState() === "offline";

    card.innerHTML = `
        <img
            class="player-ban-candidate-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(player.player_name)}"
        >

        <div class="player-ban-candidate-info">
            <div class="player-ban-candidate-name-row">
                <div class="player-ban-candidate-name">
                    ${escapeHtml(player.player_name)}
                </div>

                ${renderBanPlayerStateBadge(player)}
            </div>

            <div class="player-ban-candidate-uuid">
                UUID：${escapeHtml(player.player_uuid)}
            </div>
        </div>

        <div class="player-ban-candidate-actions">
            <button
                class="player-ban-candidate-select-btn"
                type="button"
            >
                ＋
            </button>

            ${
                canDeleteCandidate
                    ? `
                        <button
                            class="player-ban-candidate-delete-btn"
                            type="button"
                            title="刪除玩家紀錄"
                        >
                            ✕
                        </button>
                    `
                    : ""
            }

        </div>
    `;

    const selectBtn = card.querySelector(".player-ban-candidate-select-btn");
    const deleteBtn = card.querySelector(".player-ban-candidate-delete-btn");

    const selectCandidate = () => {
        selectedBanCandidatePlayer = player;
        renderBanCandidates();
    };

    card.addEventListener("click", (event) => {
        if (
            event.target.closest(
                ".player-ban-candidate-delete-btn"
            )
        ) {
            return;
        }

        selectCandidate();
    });

    selectBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCandidate();
    });

    deleteBtn?.addEventListener("click", async () => {
        await deleteBanCandidate(player);
    });

    return card;
}


function createIpBanCandidateCard(record) {
    const card =
        document.createElement("div");

    card.className =
        "player-ban-candidate-card";

    if (
        selectedBanIpCandidate
        && Number(selectedBanIpCandidate.id)
            === Number(record.id)
    ) {
        card.classList.add("selected");
    }

    const avatarUrl =
        getPlayerAvatarUrl({
            player_uuid:
                record.player_uuid,
            player_name:
                record.player_name,
            account_type:
                record.account_type,
        });

    card.innerHTML = `
        <img
            class="player-ban-candidate-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(record.player_name)}"
        >

        <div class="player-ban-candidate-info">
            <div class="player-ban-candidate-name-row">
                <div class="player-ban-candidate-name">
                    ${escapeHtml(record.player_name)}
                </div>

                <div class="
                    player-ban-candidate-type
                    ${getAccountTypeClass(record)}
                ">
                    ${getAccountTypeLabel(record)}
                </div>
            </div>

            <div class="player-ban-candidate-uuid">
                使用 IP：${escapeHtml(record.ip)}
            </div>
        </div>

        <div class="player-ban-candidate-actions">
            <button
                class="player-ban-candidate-select-btn"
                type="button"
                title="選擇此 IP"
            >
                ＋
            </button>
        </div>
    `;

    const selectBtn = card.querySelector(
        ".player-ban-candidate-select-btn"
    );

    const selectCandidate = () => {
        selectedBanIpCandidate = record;
        renderIpBanCandidates();
    };

    card.addEventListener("click", () => {
        selectCandidate();
    });

    selectBtn?.addEventListener("click", (event) => {
        event.stopPropagation();
        selectCandidate();
    });

    return card;
}


async function deleteBanCandidate(player) {
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
            selectedBanCandidatePlayer &&
            selectedBanCandidatePlayer.player_uuid === player.player_uuid
        ) {
            selectedBanCandidatePlayer = null;

            const input =
                document.getElementById("addPlayerBanTargetInput");

            if (
                input &&
                input.value.trim().toLowerCase() ===
                    String(player.player_name || "").trim().toLowerCase()
            ) {
                input.value = "";
            }
        }

        await loadBanCandidates();

        await showInfo({
            title: "黑名單管理",
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


function renderExpireFields() {
    const checked =
        document.querySelector(
            'input[name="playerBanExpireType"]:checked'
        );

    const type = checked?.value || "forever";

    const durationFields =
        document.getElementById("playerBanDurationFields");

    const datetimeFields =
        document.getElementById("playerBanDateTimeFields");

    const durationInputs =
        durationFields?.querySelectorAll("input") || [];

    const datetimeInputs =
        datetimeFields?.querySelectorAll("input") || [];

    durationFields?.classList.toggle(
        "hidden",
        type === "datetime"
    );

    datetimeFields?.classList.toggle(
        "hidden",
        type !== "datetime"
    );

    durationFields?.classList.toggle(
        "disabled",
        type !== "duration"
    );

    durationInputs.forEach(input => {
        input.disabled = type !== "duration";
    });

    datetimeInputs.forEach(input => {
        input.disabled = type !== "datetime";
    });
}


function buildExpirePayload() {
    const checked =
        document.querySelector(
            'input[name="playerBanExpireType"]:checked'
        );

    const expireType = checked?.value || "forever";

    if (expireType === "forever") {
        return {
            expire_type: "forever"
        };
    }

    if (expireType === "duration") {
        return {
            expire_type: "duration",
            days: Number(
                document.getElementById("playerBanDaysInput")?.value || 0
            ),
            hours: Number(
                document.getElementById("playerBanHoursInput")?.value || 0
            ),
            minutes: Number(
                document.getElementById("playerBanMinutesInput")?.value || 0
            ),
        };
    }

    const expiresAt =
        document
            .getElementById(
                "playerBanDateTimeInput"
            )
            ?.value
            .trim()
        || "";

    return {
        expire_type: "datetime",
        expires_at: expiresAt
    };
}


async function submitAddBan() {
    if (hasCurrentBanDataIssues() || banJsonActionBusy || isUiServerTransitionState()) return;
    const targetInput = document.getElementById("addPlayerBanTargetInput");
    const reasonInput = document.getElementById("addPlayerBanReasonInput");
    const confirmBtn = document.getElementById("confirmAddPlayerBanBtn");
    const inputValue = (targetInput?.value || "").trim();
    const reason = (reasonInput?.value || "").trim();

    const selectedIp =
        String(
            selectedBanIpCandidate?.ip || ""
        ).trim();

    const effectiveIp =
        selectedIp || inputValue;

    if (
        currentBanTab === "players"
        && !selectedBanCandidatePlayer
    ) {
        await showInfo({
            title: "黑名單管理",
            message: "請先從下方清單選擇玩家，或使用搜尋按鈕搜尋玩家",
            variant: "warning"
        });
        return;
    }

    if (
        currentBanTab === "ips"
        && !effectiveIp
    ) {
        await showInfo({
            title: "黑名單管理",
            message: "請輸入 IP 或從下方選擇一筆玩家 IP 紀錄",
            variant: "warning"
        });
        return;
    }

    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "…";
    }

    try {
        const payload = {
            reason,
            operator: "OxOcraft",
            selected_from_candidate:
                selectedBanCandidatePlayer !== null,
            ...buildExpirePayload()
        };

        let url = "";

        if (currentBanTab === "ips") {
            url = "/api/player/ban/ip";
            payload.ip = effectiveIp;
        } else {
            url = "/api/player/ban/player";

            payload.name = selectedBanCandidatePlayer.player_name;
            payload.uuid = selectedBanCandidatePlayer.player_uuid;
            payload.account_type = selectedBanCandidatePlayer.account_type;

            if (lockedBanCandidate) {
                payload.source = "player_list";
            }
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
            if (data.data_status) await loadCurrentBanTab();
            throw new Error(
                data.message || "新增黑名單失敗"
            );
        }

        document
            .getElementById("addPlayerBanModal")
            ?.classList.add("hidden");

        await loadCurrentBanTab();

        await showInfo({
            title: "黑名單管理",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("新增黑名單失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "新增黑名單失敗",
            confirmText: "關閉",
            variant: "error"
        });

    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = "新增封鎖";
        }
        renderBanActionButtons();
    }
}


function createBanHistoryCard(item) {
    const card = document.createElement("div");
    card.className = "player-ban-history-card";

    const isPlayer = item.target_type === "player";
    const actionText = getBanActionText(item);
    const sourceText = getBanSourceText(item.source);
    const operator = getDisplayBanHistoryOperator(item);

    const targetAvatarUrl = isPlayer
        ? getPlayerAvatarUrl({
            player_uuid: item.target_uuid,
            player_name: item.target_name,
            account_type: item.account_type
        })
        : "/static/icons/player_ban/barrier.png";

    card.innerHTML = `
        <img
            class="player-ban-history-target-avatar"
            src="${targetAvatarUrl}"
            alt="${escapeHtml(
                isPlayer
                    ? item.target_name || "玩家"
                    : "IP"
            )}"
        >

        <div class="player-ban-history-main">
            <div class="player-ban-history-title-row">
                <span class="player-ban-history-title">
                    ${escapeHtml(actionText)}
                </span>

                <span class="player-ban-history-target">
                    ${escapeHtml(item.target_name || "未知")}
                </span>
            </div>

            <div class="player-ban-history-meta">
                封鎖原因：${escapeHtml(
                    item.reason || "已被管理員封鎖。"
                )}
            </div>

            <div class="player-ban-history-meta">
                封鎖時間：${escapeHtml(
                    formatDateTime(item.created_at)
                )}
            </div>

            <div class="player-ban-history-meta">
                預計解除：${escapeHtml(
                    formatHistoryExpireText(item)
                )}
            </div>
        </div>

        <div class="player-ban-history-right">
            <div class="player-ban-history-source">
                <span class="player-ban-history-source-label">
                    操作來源：
                </span>

                <span class="player-ban-history-source-value">
                    ${escapeHtml(sourceText)}
                </span>
            </div>

            <div class="player-ban-history-operator">
                <span class="player-ban-history-operator-label">
                    操作人：
                </span>

                <img
                    class="player-ban-history-operator-avatar
                        ${
                            operator === "OxOcraft"
                                ? "oxocraft"
                                : (
                                    operator.toLowerCase() === "unknown"
                                        ? "unknown"
                                        : "player"
                                )
                        }"
                    src="${getBanHistoryOperatorAvatarUrl(item)}"
                    alt="${escapeHtml(operator)}"
                >

                <span class="player-ban-history-operator-name">
                    ${escapeHtml(operator)}
                </span>
            </div>
        </div>
    `;

    return card;
}

function getBanActionText(item) {
    const typeText =
        item.target_type === "ip"
            ? "封鎖IP"
            : "封鎖玩家";

    const action = String(item.action || "");

    if (action === "invalid_entry_remove") {
        return "刪除錯誤資料";
    }

    if (action.includes("duplicate")) {
        return "清除重複資料";
    }

    if (
        action.includes("remove") ||
        action.includes("pardon")
    ) {
        return item.target_type === "ip"
            ? "解除封鎖IP"
            : "解除封鎖玩家";
    }

    return typeText;
}

function getBanSourceText(source) {
    const sourceMap = {
        ui: "前端UI操作",
        offline_ui_edit: "前端UI操作",
        minecraft_json: "Minecraft資料同步",
        player_command: "遊戲內指令",

        console_rcon: "UI輸入指令",
        rcon: "UI輸入指令",

        scheduler: "OxOcraft到期解除",
        system: "系統操作",
        player_list: "玩家列表",
    };

    return sourceMap[source] || source || "未知";
}


function getDisplayBanHistoryOperator(item) {
    const operator =
        String(item.operator || "").trim();

    const source =
        String(item.source || "").trim();

    if (
        source === "minecraft_json" ||
        operator === "banned-players.json 同步" ||
        operator === "banned-ips.json 同步"
    ) {
        return "Unknown";
    }

    if (
        source === "console_rcon" ||
        source === "rcon" ||
        operator === "Rcon" ||
        operator === "rcon"
    ) {
        return "OxOcraft";
    }

    return operator || "OxOcraft";
}


function getBanHistoryOperatorAvatarUrl(item) {
    const operator = getDisplayBanHistoryOperator(item);

    if (operator === "OxOcraft") {
        return OXOCRAFT_OPERATOR_ICON;
    }

    if (operator.toLowerCase() === "unknown") {
        return UNKNOWN_OPERATOR_ICON;
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

function formatHistoryExpireText(item) {
    if (!item.expires_at) {
        return "永久封鎖";
    }

    return formatDateTime(item.expires_at);
}
