import {
    getPlayerPermissionState,
    findPlayerPermission
} from "./player_permission_state.js";

import {
    getPlayerWhitelistState,
    findPlayerWhitelist
} from "./player_whitelist_state.js";


export function initPlayerListMenu() {
    window.addEventListener(
        "player-permission-state-changed",
        handlePlayerPermissionStateChanged
    );

    window.addEventListener(
        "player-whitelist-state-changed",
        handlePlayerWhitelistStateChanged
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
    opBtn.dataset.uuid = player.player_uuid || "";
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


    loadPlayerOpButtonState(player, opBtn);
    loadPlayerWhitelistButtonState(player, whitelistBtn);


    return menuWrap;
}


async function loadPlayerOpButtonState(player, opBtn) {
    try {
        const state = await getPlayerPermissionState();

        updatePlayerOpButtonState(
            opBtn,
            player,
            state
        );
    } catch (error) {
        console.error(
            "讀取玩家 OP 狀態失敗:",
            error
        );

        opBtn.textContent = "權限狀態讀取失敗";
        opBtn.disabled = true;
    }
}


function updatePlayerOpButtonState(opBtn, player, state) {
    const opPlayer = findPlayerPermission(
        player,
        state?.players
    );

    const isOp = Boolean(opPlayer?.op);

    opBtn.textContent = isOp
        ? "收回管理員權限"
        : "設為管理員";

    opBtn.dataset.op = isOp ? "1" : "0";

    opBtn.dataset.uuid =
        opPlayer?.player_uuid ||
        player.player_uuid ||
        player.uuid ||
        opBtn.dataset.uuid ||
        "";

    opBtn.dataset.player =
        opPlayer?.player_name ||
        player.player_name ||
        player.name ||
        opBtn.dataset.player ||
        "";

    opBtn.disabled = false;
}


function handlePlayerPermissionStateChanged(event) {
    const state = event.detail;

    if (!state) return;

    const opButtons = document.querySelectorAll(
        '.player-menu-item[data-action="toggle-op"]'
    );

    opButtons.forEach(opBtn => {
        const player = {
            player_uuid: opBtn.dataset.uuid || "",
            player_name: opBtn.dataset.player || "",
            account_type: opBtn.dataset.accountType || "unknown",
        };

        updatePlayerOpButtonState(
            opBtn,
            player,
            state
        );
    });
}


async function loadPlayerWhitelistButtonState(player, whitelistBtn) {
    try {
        const state = await getPlayerWhitelistState();

        updatePlayerWhitelistButtonState(
            whitelistBtn,
            player,
            state
        );
    } catch (error) {
        console.error(
            "讀取玩家白名單狀態失敗:",
            error
        );

        whitelistBtn.textContent = "白名單狀態讀取失敗";
        whitelistBtn.disabled = true;
    }
}


function updatePlayerWhitelistButtonState(
    whitelistBtn,
    player,
    state
) {
    const whitelistPlayer = findPlayerWhitelist(
        player,
        state?.players
    );

    const isWhitelisted = Boolean(whitelistPlayer);

    whitelistBtn.textContent = isWhitelisted
        ? "移出白名單"
        : "加入白名單";

    whitelistBtn.dataset.whitelisted =
        isWhitelisted ? "1" : "0";

    whitelistBtn.dataset.uuid =
        whitelistPlayer?.player_uuid ||
        player.player_uuid ||
        player.uuid ||
        whitelistBtn.dataset.uuid ||
        "";

    whitelistBtn.dataset.player =
        whitelistPlayer?.player_name ||
        player.player_name ||
        player.name ||
        whitelistBtn.dataset.player ||
        "";

    whitelistBtn.disabled = false;
}


function handlePlayerWhitelistStateChanged(event) {
    const state = event.detail;

    if (!state) return;

    const whitelistButtons = document.querySelectorAll(
        '.player-menu-item[data-action="toggle-whitelist"]'
    );

    whitelistButtons.forEach(whitelistBtn => {
        const player = {
            player_uuid: whitelistBtn.dataset.uuid || "",
            player_name: whitelistBtn.dataset.player || "",
            account_type: whitelistBtn.dataset.accountType || "unknown",
        };

        updatePlayerWhitelistButtonState(
            whitelistBtn,
            player,
            state
        );
    });
}