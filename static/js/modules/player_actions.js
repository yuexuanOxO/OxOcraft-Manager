import { showConfirm, showInfo } from "./system_dialog.js";
import {
    openAddOpPlayerModalWithLockedPlayer
} from "./player_permissions.js";


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
                    account_type: menuItem.dataset.accountType || "unknown",
                    online: true,
                });

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
                        name: playerName
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

        return;
    }

    if (!event.target.closest(".player-menu-wrap")) {
        closeAllPlayerMenus();
    }
}

export function initPlayerActions() {
    document.addEventListener("click", handlePlayerMenuClick);
}