export function initPlayerListMenu() {
    window.addEventListener(
        "player-op-status-changed",
        handlePlayerOpStatusChanged
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


    const opBtn = document.createElement("button");
    opBtn.className = "player-menu-item";
    opBtn.type = "button";
    opBtn.textContent = "檢查權限中...";
    opBtn.disabled = true;
    opBtn.dataset.action = "toggle-op";
    opBtn.dataset.player = playerName;
    opBtn.dataset.accountType =
        player.account_type || "unknown";


    const kickBtn = document.createElement("button");
    kickBtn.className = "player-menu-item";
    kickBtn.type = "button";
    kickBtn.textContent = "踢出伺服器";
    kickBtn.dataset.action = "kick";
    kickBtn.dataset.player = playerName;


    menu.appendChild(opBtn);
    menu.appendChild(kickBtn);

    menuWrap.appendChild(menuBtn);
    menuWrap.appendChild(menu);


    loadPlayerOpStatus(
        player,
        opBtn
    );


    return menuWrap;
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