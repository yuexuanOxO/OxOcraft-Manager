import { showConfirm, showInfo } from "./system_dialog.js";


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
            try {
                const response = await fetch("/api/player/action", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        action: "toggle-op",
                        player: player
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

                const playerOpBtn = document.querySelector(
                    `.player-menu-item[data-action="toggle-op"][data-player="${CSS.escape(player)}"]`
                );

                if (playerOpBtn) {
                    playerOpBtn.textContent = data.op
                        ? "收回管理員權限"
                        : "設為管理員";
                }

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