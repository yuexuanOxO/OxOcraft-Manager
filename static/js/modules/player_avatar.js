import {
    getOfflineDefaultSkinAvatar
} from "./offline_default_skins.js";

export function getPlayerAvatarUrl(player) {
    const accountType =
        String(player?.account_type || "")
            .toLowerCase();

    const uuid =
        String(
            player?.player_uuid
            || player?.uuid
            || ""
        ).trim();

    const name =
        String(
            player?.player_name
            || player?.name
            || ""
        ).trim();

    if (accountType === "premium") {
        return `https://mc-heads.net/avatar/${
            encodeURIComponent(uuid || name)
        }`;
    }

    if (accountType === "offline") {
        return getOfflineDefaultSkinAvatar(uuid);
    }

    return "/static/img/player/default_skins/steve.png";
}

export function getAccountTypeLabel(player) {
    const accountType =
        String(player?.account_type || "")
            .toLowerCase();

    if (accountType === "premium") {
        return "正版驗證";
    }

    if (accountType === "offline") {
        return "離線模式";
    }

    return "未知類型";
}

export function getAccountTypeClass(player) {
    const accountType =
        String(player?.account_type || "")
            .toLowerCase();

    if (accountType === "premium") {
        return "online";
    }

    if (accountType === "offline") {
        return "offline";
    }

    return "unknown";
}