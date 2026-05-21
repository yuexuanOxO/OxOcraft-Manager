import { showInfo } from "./system_dialog.js";


let allPlayers = [];
let candidatePlayers = [];


export function initPlayerWhitelist() {
    const openBtn =
        document.getElementById("playerWhitelistBtn");

    const modal =
        document.getElementById("playerWhitelistModal");

    const closeBtn =
        document.getElementById("closePlayerWhitelistBtn");

    const refreshBtn =
        document.getElementById("refreshPlayerWhitelistBtn");

    const searchInput =
        document.getElementById("playerWhitelistSearchInput");

    const openAddBtn =
        document.getElementById("openAddWhitelistPlayerBtn");

    const addModal =
        document.getElementById("addWhitelistPlayerModal");

    const closeAddBtn =
        document.getElementById("closeAddWhitelistPlayerBtn");

    const confirmAddBtn =
        document.getElementById("confirmAddWhitelistPlayerBtn");

    const addInput =
        document.getElementById("addWhitelistPlayerInput");

    if (!openBtn || !modal) {
        return;
    }

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        await loadPlayerWhitelist();
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
        await loadPlayerWhitelist();
    });

    searchInput?.addEventListener("input", () => {
        renderPlayerWhitelistList();
    });

    openAddBtn?.addEventListener("click", async () => {
        addModal?.classList.remove("hidden");
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
                    ? "✓ 已開啟正版驗證"
                    : "⚠ 未開啟正版驗證"
            }
        </span>
    `;
}


function renderPlayerWhitelistList() {
    const list =
        document.getElementById("playerWhitelistList");

    const searchInput =
        document.getElementById("playerWhitelistSearchInput");

    if (!list) return;

    const keyword =
        (searchInput?.value || "")
            .trim()
            .toLowerCase();

    let players = [...allPlayers];

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
}


function createPlayerWhitelistCard(player) {
    const card = document.createElement("div");

    card.className = "player-whitelist-card";

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
                    ${player.uuid_type === "online" ? "online" : "offline"}
                ">
                    ${getUuidTypeLabel(player)}
                </div>

            </div>

            <div class="player-whitelist-uuid">
                UUID: ${escapeHtml(player.player_uuid)}
            </div>

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


async function handleAddWhitelistPlayer() {
    const input =
        document.getElementById("addWhitelistPlayerInput");

    const playerName =
        (input?.value || "").trim();

    if (!playerName) {
        await showInfo({
            title: "玩家白名單",
            message: "請輸入玩家名稱",
            confirmText: "關閉",
            variant: "warning"
        });

        return;
    }

    try {
        const data =
            await addWhitelistPlayerByName(playerName);

        input.value = "";

        await showInfo({
            title: "玩家白名單",
            message: data.message,
            confirmText: "關閉",
            variant: "success"
        });

    } catch (error) {
        console.error("加入白名單失敗:", error);

        await showInfo({
            title: "錯誤",
            message: error.message || "加入白名單失敗",
            confirmText: "關閉",
            variant: "error"
        });
    }
}


async function addWhitelistPlayerByName(playerName) {
    const response = await fetch(
        "/api/player/whitelist/add",
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
            data.message || "加入白名單失敗"
        );
    }

    await loadPlayerWhitelist();
    await loadWhitelistCandidates();

    return data;
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
        document.getElementById("whitelistCandidateList");

    if (!list) return;

    const players = [...candidatePlayers];

    list.innerHTML = "";

    if (players.length === 0) {
        list.innerHTML = `
            <div class="player-whitelist-empty">
                尚未有玩家紀錄
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
                    ${player.uuid_type === "online" ? "online" : "offline"}
                ">
                    ${getUuidTypeLabel(player)}
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
        if (player.whitelisted) return;

        try {
            const data =
                await addWhitelistPlayerByName(
                    player.player_name
                );

            await showInfo({
                title: "玩家白名單",
                message: data.message,
                confirmText: "關閉",
                variant: "success"
            });

        } catch (error) {
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

    const confirmed = window.confirm(
        `確定要刪除「${player.player_name}」的玩家紀錄嗎？\n\n這會從之前加入過的玩家清單中移除。`
    );

    if (!confirmed) {
        return;
    }

    try {

        const response = await fetch(
            "/api/player/whitelist/candidate/delete",
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


function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}