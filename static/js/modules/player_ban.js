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

let currentBanTab = "players";
let banPlayers = [];
let banIps = [];
let banHistory = [];
let banCandidatePlayers = [];
let canAddBanPlayerByName = true;
let selectedBanCandidatePlayer = null;

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
    const searchInput = document.getElementById("playerBanSearchInput");
    const addBtn = document.getElementById("openAddBanBtn");

    const titleMap = {
        players: "黑名單管理：封鎖玩家",
        ips: "黑名單管理：封鎖IP",
        history: "黑名單管理：封鎖紀錄",
        help: "黑名單管理：說明",
    };

    if (title) {
        title.textContent = titleMap[currentBanTab] || titleMap.players;
    }

    if (toolbar) {
        toolbar.classList.toggle(
            "hidden",
            currentBanTab === "history" || currentBanTab === "help"
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

            ${
                isInvalidMode
                    ? `
                        <div class="player-ban-mode-warning">
                            ⚠ 此封鎖資料不符合目前伺服器登入模式，可能無效
                        </div>
                    `
                    : ""
            }
            <div class="player-ban-meta">封鎖原因：${escapeHtml(item.reason || "未填寫")}</div>
            <div class="player-ban-meta">封鎖時間：${escapeHtml(item.created_at || "未知")}</div>
            <div class="player-ban-meta">解除時間：${formatExpireText(item)}</div>
            <div class="player-ban-meta">封鎖人：${escapeHtml(item.operator || "OxOcraft")}</div>
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
        <div class="player-ban-card-info">
            <div class="player-ban-name-row">
                <div class="player-ban-name">封鎖IP：${escapeHtml(item.target_name)}</div>
                <div class="player-ban-badge">已封鎖</div>
            </div>

            <div class="player-ban-meta">封鎖原因：${escapeHtml(item.reason || "未填寫")}</div>
            <div class="player-ban-meta">封鎖時間：${escapeHtml(item.created_at || "未知")}</div>
            <div class="player-ban-meta">解除時間：${formatExpireText(item)}</div>
            <div class="player-ban-meta">封鎖人：${escapeHtml(item.operator || "OxOcraft")}</div>
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

    if (!content) return;

    if (summary) {
        summary.textContent = `共 ${banHistory.length} 筆封鎖紀錄`;
    }

    content.innerHTML = "";

    if (banHistory.length === 0) {
        content.innerHTML = `<div class="player-ban-empty">目前沒有封鎖紀錄</div>`;
        return;
    }

    banHistory.forEach(item => {
        const card = document.createElement("div");
        card.className = "player-ban-history-card";

        card.innerHTML = `
            <div class="player-ban-history-action">${escapeHtml(item.action)}</div>
            <div class="player-ban-meta">時間：${escapeHtml(item.created_at || "未知")}</div>
            <div class="player-ban-meta">目標：${escapeHtml(item.target_name || "")}</div>
            <div class="player-ban-meta">操作人：${escapeHtml(item.operator || "OxOcraft")}</div>
            <div class="player-ban-meta">原因：${escapeHtml(item.reason || "未填寫")}</div>
        `;

        content.appendChild(card);
    });
}

function renderBanHelp() {
    const content = document.getElementById("playerBanContent");
    const summary = document.getElementById("playerBanSummary");

    if (summary) {
        summary.textContent = "黑名單功能說明";
    }

    if (!content) return;

    content.innerHTML = `
        <div class="player-ban-help">
            <h3>封鎖玩家</h3>
            <p>禁止指定玩家加入伺服器。</p>

            <h3>封鎖IP</h3>
            <p>禁止指定 IP 連線伺服器。同網路環境下其他玩家可能受到影響。</p>

            <h3>限時封鎖</h3>
            <p>封鎖期限由 OxOcraft-Manager 管理，Minecraft 原生黑名單 JSON 仍會以永久封鎖保存。</p>
        </div>
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

function formatExpireText(item) {
    if (Number(item.permanent) === 1 || !item.expires_at) {
        return "永久封鎖";
    }

    return escapeHtml(item.expires_at);
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

