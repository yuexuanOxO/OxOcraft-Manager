let whitelistStatusRefreshTimer = null;


export function initPlayerListMenu() {
    window.addEventListener(
        "player-op-status-changed",
        handlePlayerOpStatusChanged
    );

    window.addEventListener(
        "player-whitelist-should-refresh",
        refreshPlayerWhitelistStatuses
    );
}


export function createPlayerListMenu(player) {
    const playerName =
        player.player_name || player.name || "";

    const menuWrap = document.createElement("div");
    menuWrap.className = "player-menu-wrap";


    const menuBtn = document.createElement("button");
    menuBtn.className = "player-menu-btn";
    menuBtn.type = "button";
    menuBtn.textContent = "⋮";
    menuBtn.dataset.player = playerName;


    const menu = document.createElement("div");
    menu.className = "player-menu";
    menu.hidden = true;


    //玩家清單權限管理按鈕
    const opBtn = document.createElement("button");
    opBtn.className = "player-menu-item";
    opBtn.type = "button";
    opBtn.textContent = "檢查權限中...";
    opBtn.disabled = true;
    opBtn.dataset.action = "toggle-op";
    opBtn.dataset.player = playerName;
    opBtn.dataset.accountType = player.account_type || "unknown";

    //玩家清單白名單按鈕
    const whitelistBtn = document.createElement("button");
    whitelistBtn.className = "player-menu-item";
    whitelistBtn.type = "button";
    whitelistBtn.textContent = "檢查白名單中...";
    whitelistBtn.disabled = true;
    whitelistBtn.dataset.action = "toggle-whitelist";
    whitelistBtn.dataset.player = playerName;
    whitelistBtn.dataset.uuid = player.player_uuid || "";
    whitelistBtn.dataset.accountType = player.account_type || "unknown";

    //玩家清單封鎖玩家按鈕
    const banBtn = document.createElement("button");
    banBtn.className = "player-menu-item";
    banBtn.type = "button";
    banBtn.textContent = "封鎖玩家";
    banBtn.dataset.action = "ban-player";
    banBtn.dataset.player = playerName;
    banBtn.dataset.uuid =
        player.player_uuid || "";
    banBtn.dataset.accountType =
        player.account_type || "unknown";

    //玩家清單踢出伺服器按鈕
    const kickBtn = document.createElement("button");
    kickBtn.className = "player-menu-item";
    kickBtn.type = "button";
    kickBtn.textContent = "踢出伺服器";
    kickBtn.dataset.action = "kick";
    kickBtn.dataset.player = playerName;


    menu.appendChild(opBtn);
    menu.appendChild(whitelistBtn);
    menu.appendChild(banBtn);
    menu.appendChild(kickBtn);

    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);


    loadPlayerOpStatus(
        player,
        opBtn
    );

    schedulePlayerWhitelistStatusRefresh();


    return menuWrap;
}


function schedulePlayerWhitelistStatusRefresh() {
    if (whitelistStatusRefreshTimer !== null) {
        window.clearTimeout(
            whitelistStatusRefreshTimer
        );
    }

    whitelistStatusRefreshTimer =
        window.setTimeout(() => {
            whitelistStatusRefreshTimer = null;

            refreshPlayerWhitelistStatuses();
        }, 0);
}


async function refreshPlayerWhitelistStatuses() {
    const whitelistButtons =
        document.querySelectorAll(
            '.player-menu-item[data-action="toggle-whitelist"]'
        );

    if (whitelistButtons.length === 0) {
        return;
    }

    try {
        const response = await fetch(
            "/api/player/whitelist",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message ||
                "讀取玩家白名單狀態失敗"
            );
        }

        const whitelistPlayers =
            data.players || [];

        whitelistButtons.forEach(button => {
            const playerUuid =
                String(
                    button.dataset.uuid || ""
                ).toLowerCase();

            const playerName =
                String(
                    button.dataset.player || ""
                );

            const accountType =
                String(
                    button.dataset.accountType ||
                    "unknown"
                ).toLowerCase();

            const whitelistPlayer =
                whitelistPlayers.find(item => {
                    const itemUuid =
                        String(
                            item.player_uuid || ""
                        ).toLowerCase();

                    const itemName =
                        String(
                            item.player_name || ""
                        );

                    if (
                        playerUuid &&
                        itemUuid === playerUuid
                    ) {
                        return true;
                    }

                    if (playerUuid) {
                        return false;
                    }

                    if (accountType === "offline") {
                        return itemName === playerName;
                    }

                    return (
                        itemName.toLowerCase()
                        ===
                        playerName.toLowerCase()
                    );
                });

            const isWhitelisted =
                Boolean(whitelistPlayer);

            button.textContent =
                isWhitelisted
                    ? "移出白名單"
                    : "加入白名單";

            button.dataset.whitelisted =
                isWhitelisted ? "1" : "0";

            if (whitelistPlayer) {
                button.dataset.uuid =
                    whitelistPlayer.player_uuid ||
                    button.dataset.uuid ||
                    "";

                button.dataset.player =
                    whitelistPlayer.player_name ||
                    button.dataset.player ||
                    "";
            }

            button.disabled = false;
        });

    } catch (error) {
        console.error(
            "讀取玩家白名單狀態失敗:",
            error
        );

        whitelistButtons.forEach(button => {
            button.textContent =
                "白名單狀態讀取失敗";

            button.disabled = true;
        });
    }
}


async function loadPlayerOpStatus(player, opBtn) {
    try {
        const response = await fetch(
            "/api/player/permissions",
            { cache: "no-store" }
        );

        const data = await response.json();

        if (!data.success) {
            throw new Error(
                data.message ||
                "讀取玩家 OP 狀態失敗"
            );
        }

        const playerUuid =
            String(
                player.player_uuid || ""
            ).toLowerCase();

        const playerName =
            String(
                player.player_name || ""
            ).toLowerCase();

        const opPlayer =
            (data.players || []).find(item => {
                const itemUuid =
                    String(
                        item.player_uuid || ""
                    ).toLowerCase();

                const itemName =
                    String(
                        item.player_name || ""
                    ).toLowerCase();

                return (
                    (
                        playerUuid &&
                        itemUuid === playerUuid
                    )
                    ||
                    (
                        !playerUuid &&
                        itemName === playerName
                    )
                );
            });

        const isOp =
            Boolean(opPlayer?.op);

        opBtn.textContent =
            isOp
                ? "收回管理員權限"
                : "設為管理員";

        opBtn.dataset.op =
            isOp ? "1" : "0";

        if (opPlayer) {
            opBtn.dataset.uuid =
                opPlayer.player_uuid ||
                player.player_uuid ||
                "";

            opBtn.dataset.player =
                opPlayer.player_name ||
                player.player_name ||
                "";
        } else {
            opBtn.dataset.uuid =
                player.player_uuid || "";

            opBtn.dataset.player =
                player.player_name || "";
        }

        opBtn.disabled = false;

    } catch (error) {
        console.error(
            "讀取玩家 OP 狀態失敗:",
            error
        );

        opBtn.textContent =
            "設為管理員";

        opBtn.dataset.op = "0";

        opBtn.dataset.uuid =
            player.player_uuid || "";

        opBtn.dataset.player =
            player.player_name || "";

        opBtn.disabled = false;
    }
}


function handlePlayerOpStatusChanged(event) {
    const detail = event.detail;

    if (!detail) return;

    const player =
        String(detail.player || "");

    const uuid =
        String(detail.uuid || "");

    const op =
        Boolean(detail.op);

    const opBtn = document.querySelector(
        `.player-menu-item[data-action="toggle-op"][data-player="${CSS.escape(player)}"]`
    );

    if (!opBtn) return;

    opBtn.textContent =
        op
            ? "收回管理員權限"
            : "設為管理員";

    opBtn.dataset.op =
        op ? "1" : "0";

    opBtn.dataset.player =
        player;

    if (uuid) {
        opBtn.dataset.uuid =
            uuid;
    }
}