import {
    isUiServerTransitionState
} from "./server_ui_state.js";


let whitelistState = null;
let refreshPromise = null;
let refreshTimer = null;
let initialized = false;


export function initPlayerWhitelistState() {
    if (initialized) return;

    initialized = true;

    window.addEventListener(
        "player-whitelist-should-refresh",
        schedulePlayerWhitelistStateRefresh
    );
}


export async function getPlayerWhitelistState() {
    if (whitelistState) {
        return whitelistState;
    }

    return refreshPlayerWhitelistState();
}


export async function refreshPlayerWhitelistState() {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = fetchPlayerWhitelistState();

    try {
        const data = await refreshPromise;

        whitelistState = data;

        window.dispatchEvent(
            new CustomEvent(
                "player-whitelist-state-changed",
                {
                    detail: data
                }
            )
        );

        return data;
    } finally {
        refreshPromise = null;
    }
}


async function fetchPlayerWhitelistState() {
    const response = await fetch(
        "/api/player/whitelist",
        { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "玩家白名單資料載入失敗"
        );
    }

    return data;
}


function schedulePlayerWhitelistStateRefresh() {
    if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(async () => {
        refreshTimer = null;

        if (isUiServerTransitionState()) {
            return;
        }

        try {
            await refreshPlayerWhitelistState();
        } catch (error) {
            console.error(
                "玩家白名單狀態重新整理失敗:",
                error
            );
        }
    }, 0);
}


export function findPlayerWhitelist(player, players = null) {
    const sourcePlayers = Array.isArray(players)
        ? players
        : whitelistState?.players || [];

    const playerUuid = String(
        player?.player_uuid || player?.uuid || ""
    ).trim().toLowerCase();

    const playerName = String(
        player?.player_name || player?.name || ""
    ).trim();

    const accountType = String(
        player?.account_type || ""
    ).trim().toLowerCase();

    if (!playerUuid && !playerName) {
        return null;
    }

    return sourcePlayers.find(item => {
        const itemUuid = String(
            item.player_uuid || ""
        ).trim().toLowerCase();

        const itemName = String(
            item.player_name || ""
        ).trim();

        if (playerUuid) {
            return itemUuid === playerUuid;
        }

        if (accountType === "offline") {
            return itemName === playerName;
        }

        return itemName.toLowerCase() === playerName.toLowerCase();
    }) || null;
}