import {
    isUiServerTransitionState
} from "./server_ui_state.js";


let permissionState = null;
let refreshPromise = null;
let refreshTimer = null;
let initialized = false;


export function initPlayerPermissionState() {
    if (initialized) return;

    initialized = true;

    window.addEventListener(
        "player-permissions-should-refresh",
        schedulePlayerPermissionStateRefresh
    );
}


export async function getPlayerPermissionState() {
    if (permissionState) {
        return permissionState;
    }

    return refreshPlayerPermissionState();
}


export async function refreshPlayerPermissionState() {
    if (refreshPromise) {
        return refreshPromise;
    }

    refreshPromise = fetchPlayerPermissionState();

    try {
        const data = await refreshPromise;

        permissionState = data;

        window.dispatchEvent(
            new CustomEvent(
                "player-permission-state-changed",
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


async function fetchPlayerPermissionState() {
    const response = await fetch(
        "/api/player/permissions",
        { cache: "no-store" }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.message || "玩家權限資料載入失敗"
        );
    }

    return data;
}


function schedulePlayerPermissionStateRefresh() {
    if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(async () => {
        refreshTimer = null;

        if (isUiServerTransitionState()) {
            return;
        }

        try {
            await refreshPlayerPermissionState();
        } catch (error) {
            console.error(
                "玩家權限狀態重新整理失敗:",
                error
            );
        }
    }, 0);
}


export function findPlayerPermission(player, players = null) {
    const sourcePlayers = Array.isArray(players)
        ? players
        : permissionState?.players || [];

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