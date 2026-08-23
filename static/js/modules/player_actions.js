import { showConfirm, showInfo } from "./system_dialog.js";

import {
    getPlayerAvatarUrl
} from "./player_avatar.js";

import {
    openAddOpPlayerModalWithLockedPlayer
} from "./player_permissions.js";

import {
    openAddBanPlayerModalWithLockedPlayer
} from "./player_ban.js";


async function getWhitelistEnabled() {
    try {
        const response = await fetch(
            "/api/player/whitelist/settings",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message ||
                "讀取白名單設定失敗"
            );
        }

        return data.white_list === true;

    } catch (error) {
        console.error(
            "讀取白名單設定失敗:",
            error
        );

        return null;
    }
}


function closeAllPlayerMenus() {
    document.querySelectorAll(".player-menu").forEach(menu => {
        menu.hidden = true;
    });
}

async function handlePlayerMenuClick(event) {
    const menuBtn = event.target.closest(".player-menu-btn");
    const menuItem = event.target.closest(".player-menu-item");

    if (menuBtn) {
        const wrap = menuBtn.closest(".player-menu-wrap");
        const menu = wrap.querySelector(".player-menu");
        const isHidden = menu.hidden;

        closeAllPlayerMenus();
        menu.hidden = !isHidden;
        return;
    }

    if (menuItem) {
        const action = menuItem.dataset.action;
        const player = menuItem.dataset.player;

        closeAllPlayerMenus();

        if (action === "kick") {
            const ok = await showConfirm({
                title: "踢出玩家",
                message: `確定要踢出玩家 ${player} 嗎？`,
                confirmText: "踢出",
                cancelText: "取消",
                variant: "warning"
            });

            if (!ok) return;

            try {
                const response = await fetch("/api/player/action", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        action: "kick",
                        player: player
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    await showInfo({
                        title: "操作失敗",
                        message: data.message || "操作失敗",
                        confirmText: "關閉",
                        variant: "error"
                    });
                }

            } catch (error) {
                console.error("玩家操作失敗:", error);
                await showInfo({
                    title: "錯誤",
                    message: "玩家操作失敗",
                    confirmText: "關閉",
                    variant: "error"
                });
            }
        }

        if (action === "toggle-op") {
            const isOp = menuItem.dataset.op === "1";
            const playerUuid = menuItem.dataset.uuid || "";
            const playerName = menuItem.dataset.player || player;

            if (!playerUuid || !playerName) {
                await showInfo({
                    title: "操作失敗",
                    message: "缺少玩家 UUID 或名稱，無法修改管理員權限",
                    confirmText: "關閉",
                    variant: "error"
                });
                return;
            }

            if (!isOp) {
                await openAddOpPlayerModalWithLockedPlayer({
                    player_uuid: playerUuid,
                    player_name: playerName,
                    name: playerName,
                    account_type:
                        menuItem.dataset.accountType || "unknown",
                    online: true,
                    operation_source: "player_list",
                });

                return;
            }

            const playerData = {
                player_uuid: playerUuid,
                player_name: playerName,
                name: playerName,
                account_type: menuItem.dataset.accountType || "unknown",
            };

            const confirmed = await showConfirm({
                title: "移除管理員",
                message: `是否要移除「${playerName}」的管理員權限？`,
                icon: getPlayerAvatarUrl(playerData),
                confirmText: "移除",
                cancelText: "取消",
                variant: "warning",
            });

            if (!confirmed) {
                return;
            }

            try {
                const response = await fetch("/api/player/permission/toggle-op", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        uuid: playerUuid,
                        name: playerName,
                        source: "player_list"
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    await showInfo({
                        title: "操作失敗",
                        message: data.message || "管理員權限操作失敗",
                        confirmText: "關閉",
                        variant: "error"
                    });
                    return;
                }

                await showInfo({
                    title: "玩家權限",
                    message: data.message,
                    confirmText: "關閉",
                    variant: "success"
                });

                window.dispatchEvent(new CustomEvent(
                    "player-op-status-changed",
                    {
                        detail: {
                            player,
                            uuid: playerUuid,
                            op: data.op
                        }
                    }
                ));


            } catch (error) {
                console.error("管理員權限操作失敗:", error);

                await showInfo({
                    title: "錯誤",
                    message: "管理員權限操作失敗",
                    confirmText: "關閉",
                    variant: "error"
                });
            }
        }

        if (action === "toggle-whitelist") {
            const isWhitelisted =
                menuItem.dataset.whitelisted === "1";

            const playerUuid =
                menuItem.dataset.uuid || "";

            const playerName =
                menuItem.dataset.player || player;

            if (!playerUuid || !playerName) {
                await showInfo({
                    title: "操作失敗",
                    message:
                        "缺少玩家 UUID 或名稱，無法修改白名單",
                    confirmText: "關閉",
                    variant: "error"
                });

                return;
            }

            const playerData = {
                player_uuid: playerUuid,
                player_name: playerName,
                name: playerName,
                account_type:
                    menuItem.dataset.accountType ||
                    "unknown",
            };


            let whitelistEnabled = null;

            if (!isWhitelisted) {
                whitelistEnabled =
                    await getWhitelistEnabled();
            }


            let confirmMessage;

            if (isWhitelisted) {
                confirmMessage =
                    `確定要將「${playerName}」移出白名單嗎？`;

            } else if (whitelistEnabled === false) {
                confirmMessage =
                    `白名單目前尚未啟用。\n` +
                    `仍可先將「${playerName}」加入白名單，` +
                    `啟用白名單時即可直接生效。\n` +
                    `是否繼續加入？`;

            } else {
                confirmMessage =
                    `確定要將「${playerName}」加入白名單嗎？`;
            }


            const confirmed = await showConfirm({
                title:
                    isWhitelisted
                        ? "移出白名單"
                        : "加入白名單",

                message: confirmMessage,

                icon: getPlayerAvatarUrl(playerData),

                confirmText:
                    isWhitelisted
                        ? "移出"
                        : "加入",

                cancelText: "取消",

                variant:
                    isWhitelisted
                        ? "warning"
                        : "info",
            });

            if (!confirmed) {
                return;
            }

            menuItem.disabled = true;

            try {
                const response = await fetch(
                    "/api/player/whitelist/toggle",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            uuid: playerUuid,
                            name: playerName,
                            source: "player_list"
                        })
                    }
                );

                const data =
                    await response.json();

                if (!data.success) {
                    await showInfo({
                        title: "操作失敗",
                        message:
                            data.message ||
                            "白名單操作失敗",
                        confirmText: "關閉",
                        variant: "error"
                    });

                    return;
                }

                menuItem.dataset.whitelisted =
                    data.whitelisted ? "1" : "0";

                menuItem.textContent =
                    data.whitelisted
                        ? "移出白名單"
                        : "加入白名單";

                await showInfo({
                    title: "玩家白名單",
                    message: data.message,
                    confirmText: "關閉",
                    variant: "success"
                });

                window.dispatchEvent(
                    new CustomEvent(
                        "player-whitelist-should-refresh"
                    )
                );

            } catch (error) {
                console.error(
                    "白名單操作失敗:",
                    error
                );

                await showInfo({
                    title: "錯誤",
                    message: "白名單操作失敗",
                    confirmText: "關閉",
                    variant: "error"
                });

            } finally {
                menuItem.disabled = false;
            }
        }

        if (action === "ban-player") {
            const playerUuid =
                menuItem.dataset.uuid || "";

            const playerName =
                menuItem.dataset.player || player;

            if (!playerUuid || !playerName) {
                await showInfo({
                    title: "操作失敗",
                    message:
                        "缺少玩家 UUID 或名稱，無法封鎖玩家",
                    confirmText: "關閉",
                    variant: "error"
                });

                return;
            }

            await openAddBanPlayerModalWithLockedPlayer({
                player_uuid: playerUuid,
                player_name: playerName,
                name: playerName,
                account_type:
                    menuItem.dataset.accountType ||
                    "unknown",
                online: true,
            });

            return;
        }


        return;
    }

    if (!event.target.closest(".player-menu-wrap")) {
        closeAllPlayerMenus();
    }
}

export function initPlayerActions() {
    document.addEventListener("click", handlePlayerMenuClick);
}