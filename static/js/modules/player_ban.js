import {
    showInfo
} from "./system_dialog.js";

import {
    isUiServerTransitionState
} from "./server_ui_state.js";

import {
    getPlayerAvatarUrl,
    getAccountTypeLabel,
    getAccountTypeClass,
} from "./player_avatar.js";

import { PLAYER_BAN_HELP } from "./help/player_ban_help.js";

let currentBanTab = "players";
let banPlayers = [];
let banIps = [];
let banHistory = [];
let banCandidatePlayers = [];
let canAddBanPlayerByName = true;
let selectedBanCandidatePlayer = null;
const banHistoryFilters = new Set();

const OXOCRAFT_OPERATOR_ICON =
    "/static/icons/player_ban/OxOcraft_origin.png";

export function initPlayerBan() {
    const openBtn = document.getElementById("playerBanBtn");
    const modal = document.getElementById("playerBanModal");
    const closeBtn = document.getElementById("closePlayerBanBtn");
    const searchInput = document.getElementById("playerBanSearchInput");
    const openAddBtn = document.getElementById("openAddBanBtn");
    const addModal = document.getElementById("addPlayerBanModal");
    const closeAddBtn = document.getElementById("closeAddPlayerBanBtn");
    const confirmAddBtn = document.getElementById("confirmAddPlayerBanBtn");

    if (!openBtn || !modal) return;

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        await loadCurrentBanTab();
    });

    closeBtn?.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });

    document
        .querySelectorAll(".player-ban-tab")
        .forEach((button) => {
            button.addEventListener("click", async () => {
                currentBanTab = button.dataset.tab || "players";
                updateBanTabs();
                await loadCurrentBanTab();
            });
        });

    searchInput?.addEventListener("input", () => {
        renderCurrentBanTab();
    });

    const historySearchInput =
        document.getElementById("playerBanHistorySearchInput");

    const historyFilterBtn =
        document.getElementById("playerBanHistoryFilterBtn");

    const historyFilterMenu =
        document.getElementById("playerBanHistoryFilterMenu");

    historySearchInput?.addEventListener("input", () => {
        renderBanHistory();
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

    document.addEventListener("click", () => {
        historyFilterMenu?.classList.add("hidden");
    });

    window.addEventListener("server-ui-state-changed", () => {
        renderBanActionButtons();
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

    if (searchInput) {
        searchInput.value = "";
        searchInput.placeholder =
            currentBanTab === "ips"
                ? "搜尋IP"
                : "搜尋玩家名稱或 UUID";
    }

    if (addBtn) {
        addBtn.textContent =
            currentBanTab === "ips"
                ? "+ 新增IP黑名單"
                : "+ 新增玩家黑名單";
    }
}

async function loadCurrentBanTab() {
    try {
        updateBanTabs();

        if (currentBanTab === "players") {
            const response = await fetch("/api/player/ban/players", { cache: "no-store" });
            const data = await response.json();

            if (!data.success) throw new Error(data.message || "讀取封鎖玩家失敗");

            banPlayers = data.players || [];
        }

        if (currentBanTab === "ips") {
            const response = await fetch("/api/player/ban/ips", { cache: "no-store" });
            const data = await response.json();

            if (!data.success) throw new Error(data.message || "讀取封鎖IP失敗");

            banIps = data.ips || [];
        }

        if (currentBanTab === "history") {
            const response = await fetch("/api/player/ban/history", { cache: "no-store" });
            const data = await response.json();

            if (!data.success) throw new Error(data.message || "讀取封鎖紀錄失敗");

            banHistory = data.records || [];
        }

        renderCurrentBanTab();

    } catch (error) {
        console.error(error);

        await showInfo({
            title: "黑名單管理",
            message: error.message || "讀取黑名單資料失敗",
            variant: "error"
        });
    }
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
    const summary = document.getElementById("playerBanSummary");
    const keyword = getSearchKeyword();

    if (!content) return;

    let rows = [...banPlayers];

    if (keyword) {
        rows = rows.filter(item => {
            return (
                String(item.target_name || "").toLowerCase().includes(keyword) ||
                String(item.target_uuid || "").toLowerCase().includes(keyword)
            );
        });
    }

    if (summary) {
        summary.textContent = `共 ${rows.length} 位封鎖玩家`;
    }

    content.innerHTML = "";

    if (rows.length === 0) {
        content.innerHTML = `<div class="player-ban-empty">目前沒有封鎖玩家</div>`;
        return;
    }

    rows.forEach(item => {
        content.appendChild(createBanPlayerCard(item));
    });

    renderBanActionButtons();
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

function createBanPlayerCard(item) {
    const card = document.createElement("div");

    const isInvalidMode =
        item.valid_for_current_mode === false;

    card.className = "player-ban-card";

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
                <div class="player-ban-name">${escapeHtml(item.target_name)}</div>
                <div class="player-ban-badge">已封鎖</div>
            </div>

            <div class="player-ban-meta">UUID：${escapeHtml(item.target_uuid || "未知")}</div>
            <div class="player-ban-meta">封鎖原因：${escapeHtml(item.reason || "已被管理員封鎖。")}</div>
        </div>

        <div class="player-ban-time-info">
            <div class="player-ban-meta">
                封鎖時間：${escapeHtml(formatDateTime(item.created_at))}
            </div>

            <div class="player-ban-meta">
                解除時間：${formatExpireText(item)}
            </div>
        </div>

        <button class="player-ban-unban-btn" type="button">
            解除封鎖
        </button>
    `;

    const unbanBtn =
        card.querySelector(".player-ban-unban-btn");

    unbanBtn?.addEventListener("click", async () => {
        await unbanPlayer(item);
    });

    return card;
}

function renderBanIps() {
    const content = document.getElementById("playerBanContent");
    const summary = document.getElementById("playerBanSummary");
    const keyword = getSearchKeyword();

    if (!content) return;

    let rows = [...banIps];

    if (keyword) {
        rows = rows.filter(item => {
            return String(item.target_name || "").toLowerCase().includes(keyword);
        });
    }

    if (summary) {
        summary.textContent = `共 ${rows.length} 個封鎖IP`;
    }

    content.innerHTML = "";

    if (rows.length === 0) {
        content.innerHTML = `<div class="player-ban-empty">目前沒有封鎖IP</div>`;
        return;
    }

    rows.forEach(item => {
        content.appendChild(createBanIpCard(item));
    });

    renderBanActionButtons();
}

function createBanIpCard(item) {
    const card = document.createElement("div");
    card.className = "player-ban-card";
    card.dataset.id = item.id;

    card.innerHTML = `
        <div class="player-ban-ip-icon">
            <img
                class="player-ban-avatar"
                src="/static/icons/player_ban/barrier.png"
                alt="IP"
            >
        </div>

        <div class="player-ban-card-info">
            <div class="player-ban-name-row">
                <div class="player-ban-name">
                    封鎖IP：${escapeHtml(item.target_name)}
                </div>
                <div class="player-ban-badge">已封鎖</div>
            </div>

            <div class="player-ban-meta">
                封鎖原因：${escapeHtml(item.reason || "已被管理員封鎖。")}
            </div>
        </div>

        <div class="player-ban-time-info">
            <div class="player-ban-meta">
                封鎖時間：${escapeHtml(formatDateTime(item.created_at))}
            </div>

            <div class="player-ban-meta">
                解除時間：${formatExpireText(item)}
            </div>
        </div>

        <button class="player-ban-unban-btn" type="button">
            解除封鎖
        </button>
    `;

    const unbanBtn =
        card.querySelector(".player-ban-unban-btn");

    unbanBtn?.addEventListener("click", async () => {
        await unbanIp(item);
    });

    return card;
}


async function unbanPlayer(item) {
    const confirmed = window.confirm(
        `確定要解除「${item.target_name}」的封鎖嗎？`
    );

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
    const confirmed = window.confirm(
        `確定要解除 IP「${item.target_name}」的封鎖嗎？`
    );

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


function renderBanHistory() {
    const content = document.getElementById("playerBanContent");
    const summary = document.getElementById("playerBanSummary");

    const historySearchInput =
        document.getElementById("playerBanHistorySearchInput");

    const keyword =
        (historySearchInput?.value || "")
            .trim()
            .toLowerCase();

    if (!content) return;

    let rows = [...banHistory];

    const typeFilters = [...banHistoryFilters]
        .filter(filter => filter === "player" || filter === "ip");

    const actionFilters = [...banHistoryFilters]
        .filter(filter => filter === "add" || filter === "remove");

    if (typeFilters.length > 0) {
        rows = rows.filter(item => {
            return typeFilters.includes(item.target_type);
        });
    }

    if (actionFilters.length > 0) {
        rows = rows.filter(item => {
            const action = String(item.action || "");

            const isRemove =
                action.includes("remove") ||
                action.includes("pardon");

            const isAdd = !isRemove;

            return (
                (actionFilters.includes("add") && isAdd) ||
                (actionFilters.includes("remove") && isRemove)
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

    if (summary) {
        summary.textContent = `共 ${rows.length} 筆封鎖紀錄`;
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
    const locked = isUiServerTransitionState();

    document
        .querySelectorAll(".player-ban-unban-btn, #openAddBanBtn")
        .forEach((button) => {
            button.disabled = locked;
        });

    document
        .querySelectorAll(".player-ban-card")
        .forEach((card) => {
            card.classList.toggle("disabled", locked);
        });
}

function getSearchKeyword() {
    const input = document.getElementById("playerBanSearchInput");
    return (input?.value || "").trim().toLowerCase();
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


async function openAddBanModal() {
    selectedBanCandidatePlayer = null;

    const modal = document.getElementById("addPlayerBanModal");
    const title = document.getElementById("addPlayerBanTitle");
    const label = document.getElementById("addPlayerBanTargetLabel");
    const input = document.getElementById("addPlayerBanTargetInput");
    const reason = document.getElementById("addPlayerBanReasonInput");

    if (!modal) return;

    if (title) {
        title.textContent =
            currentBanTab === "ips"
                ? "新增 IP 黑名單"
                : "新增玩家黑名單";
    }

    if (label) {
        label.textContent =
            currentBanTab === "ips"
                ? "IP"
                : "玩家名稱";
    }

    if (input) {
        input.value = "";
        input.placeholder =
            currentBanTab === "ips"
                ? "例如：192.168.0.87"
                : "請輸入玩家名稱";
    }

    if (reason) {
        reason.value = "";
    }

    const foreverRadio =
        document.querySelector(
            'input[name="playerBanExpireType"][value="forever"]'
        );

    if (foreverRadio) {
        foreverRadio.checked = true;
    }

    renderExpireFields();
    renderBanCandidateSection();

    modal.classList.remove("hidden");

    if (currentBanTab === "players") {
        await loadBanCandidates();
    }
}


function renderBanCandidateSection() {
    const section =
        document.getElementById("playerBanCandidateSection");

    const input =
        document.getElementById("addPlayerBanTargetInput");

    const label =
        document.getElementById("addPlayerBanTargetLabel");

    if (!section) return;

    const isPlayerTab =
        currentBanTab === "players";

    section.classList.toggle(
        "hidden",
        !isPlayerTab
    );

    if (!input) return;

    if (!isPlayerTab) {
        input.disabled = false;
        return;
    }

    input.disabled =
        !canAddBanPlayerByName;

    input.placeholder =
        canAddBanPlayerByName
            ? "請輸入玩家名稱"
            : "離線模式且伺服器在線時，請從下方玩家清單選擇";

    if (label) {
        label.textContent =
            canAddBanPlayerByName
                ? "玩家名稱"
                : "玩家名稱（請從下方選擇）";
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


function renderBanCandidates() {
    const list =
        document.getElementById("playerBanCandidateList");

    if (!list) return;

    list.innerHTML = "";

    if (banCandidatePlayers.length === 0) {
        list.innerHTML = `
            <div class="player-ban-empty">
                尚未有可加入的玩家紀錄
            </div>
        `;
        return;
    }

    banCandidatePlayers.forEach(player => {
        list.appendChild(
            createBanCandidateCard(player)
        );
    });
}


function createBanCandidateCard(player) {
    const card =
        document.createElement("div");

    card.className =
        "player-ban-candidate-card";

    const avatarUrl = getPlayerAvatarUrl(player);

    card.innerHTML = `
        <img
            class="player-ban-candidate-avatar"
            src="${avatarUrl}"
            alt="${escapeHtml(player.player_name)}"
        >

        <div class="player-ban-candidate-info">
            <div class="player-ban-candidate-name">
                ${escapeHtml(player.player_name)}
            </div>

            <div class="player-ban-candidate-uuid">
                UUID：${escapeHtml(player.player_uuid)}
            </div>

            <div class="player-ban-candidate-type">
                ${getAccountTypeLabel(player)}
            </div>

        </div>

        <button
            class="player-ban-candidate-select-btn"
            type="button"
        >
            選擇
        </button>
    `;

    const selectBtn =
        card.querySelector(".player-ban-candidate-select-btn");

    selectBtn?.addEventListener("click", () => {
        selectedBanCandidatePlayer = player;

        const input =
            document.getElementById("addPlayerBanTargetInput");

        if (input) {
            input.value = player.player_name;
        }
    });

    return card;
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

    durationFields?.classList.toggle(
        "hidden",
        type !== "duration"
    );

    datetimeFields?.classList.toggle(
        "hidden",
        type !== "datetime"
    );
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

    const date =
        document.getElementById("playerBanDateInput")?.value || "";

    const time =
        document.getElementById("playerBanTimeInput")?.value || "";

    return {
        expire_type: "datetime",
        expires_at: `${date} ${time}:00`
    };
}


async function submitAddBan() {
    const targetInput =
        document.getElementById("addPlayerBanTargetInput");

    const reasonInput =
        document.getElementById("addPlayerBanReasonInput");

    const confirmBtn =
        document.getElementById("confirmAddPlayerBanBtn");

    const target = (targetInput?.value || "").trim();
    const reason = (reasonInput?.value || "").trim();

    if (
        currentBanTab === "players"
        && !canAddBanPlayerByName
        && !selectedBanCandidatePlayer
    ) {
        await showInfo({
            title: "黑名單管理",
            message: "離線模式且伺服器在線時，請從下方玩家清單選擇玩家",
            variant: "warning"
        });
        return;
    }

    if (!target) {
        await showInfo({
            title: "黑名單管理",
            message: currentBanTab === "ips"
                ? "請輸入 IP"
                : "請輸入玩家名稱",
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
            payload.ip = target;
        } else {
            url = "/api/player/ban/player";
            payload.name = target;

            if (selectedBanCandidatePlayer) {
                payload.uuid =
                    selectedBanCandidatePlayer.player_uuid;

                payload.account_type = selectedBanCandidatePlayer.account_type
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
    }
}


function createBanHistoryCard(item) {
    const card = document.createElement("div");
    card.className = "player-ban-history-card";

    const isPlayer = item.target_type === "player";
    const actionText = getBanActionText(item);
    const sourceText = getBanSourceText(item.source);
    const operator = getDisplayBanHistoryOperator(item);

    const targetAvatarHtml = isPlayer
        ? `
            <img
                class="player-ban-history-target-avatar"
                src="${getPlayerAvatarUrl({
                    player_uuid: item.target_uuid,
                    player_name: item.target_name,
                    account_type: item.account_type
                })}"
                alt="${escapeHtml(item.target_name)}"
            >
        `
        : "";

        
    const titleHtml = isPlayer
    ? `
        <span class="player-ban-history-title">
            ${actionText}
        </span>

        <span class="player-ban-history-separator">|</span>

        ${targetAvatarHtml}

        <span class="player-ban-history-target">
            ${escapeHtml(item.target_name || "未知")}
        </span>
    `
    : `
        <span class="player-ban-history-title">
            ${actionText}:
        </span>

        <span class="player-ban-history-target">
            ${escapeHtml(item.target_name || "未知")}
        </span>
    `;


    card.innerHTML = `
        <div class="player-ban-history-left">
            <div class="player-ban-history-title-row">
                ${titleHtml}
            </div>

            <div class="player-ban-meta">
                封鎖原因：${escapeHtml(item.reason || "已被管理員封鎖。")}
            </div>

            <div class="player-ban-meta">
                封鎖時間：${escapeHtml(formatDateTime(item.created_at))}
            </div>

            <div class="player-ban-meta">
                預計解除：${escapeHtml(formatHistoryExpireText(item))}
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
                        ${operator === "OxOcraft" ? "oxocraft" : "player"}"
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
        ui: "OxOcraft-Manager介面操作",
        offline_ui_edit: "OxOcraft-Manager",
        minecraft_json: "OxOcraft同步",
        player_command: "遊戲內指令",

        console_rcon: "UI輸入指令",
        rcon: "UI輸入指令",

        scheduler: "OxOcraft封鎖到期解除",
        system: "系統操作",
    };

    return sourceMap[source] || source || "未知";
}

function getDisplayBanHistoryOperator(item) {
    const operator = String(item.operator || "OxOcraft").trim();
    const source = String(item.source || "").trim();

    if (
        source === "minecraft_json" ||
        source === "console_rcon" ||
        source === "rcon" ||

        operator === "Rcon" ||
        operator === "rcon" ||

        operator === "banned-players.json 同步" ||
        operator === "banned-ips.json 同步"
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