import { initDeathBook } from "./modules/death_book.js";
import { initFeatureCards } from "./modules/feature_cards.js";
import { initCommandConsole } from "./modules/command_console.js";
import { initPlayerActions } from "./modules/player_actions.js";
import {initServerStatus} from "./modules/server_status.js";
import {initPlayerPermissionState} from "./modules/player_permission_state.js";
import {initPlayerListMenu} from "./modules/player_list_menu.js";
import {initLogConsole} from "./modules/log_console.js";
import {initServerSettings} from "./modules/server_settings.js";
import {initBackup} from "./modules/backup.js";
import {initCloudBackup,loadCloudStatus} from "./modules/cloud_backup.js";
import {initAutoBackup} from "./modules/auto_backup.js";
import {initServerControl} from "./modules/server_control.js";
import {initServerEvents} from "./modules/server_events.js";
import { initSystemDialog } from "./modules/system_dialog.js";
import { initNotificationUI } from "./modules/notification.js";
import { initPlayerPermissions } from "./modules/player_permissions.js";
import { initPlayerWhitelist } from "./modules/player_whitelist.js";
import { initPlayerBan } from "./modules/player_ban.js";
import {initWorldSettings} from "./modules/world_settings.js";


function setupGlobalImageDragBlocker() {
    document.addEventListener("dragstart", (event) => {
        if (event.target instanceof HTMLImageElement) {
            event.preventDefault();
        }
    });
}


document.addEventListener("DOMContentLoaded", () => {
    initPlayerPermissionState();
    initPlayerListMenu();
    initServerStatus();
    initServerEvents();
    initDeathBook();
    initFeatureCards();
    initLogConsole();
    initServerSettings();
    initBackup();
    initCloudBackup();
    loadCloudStatus();
    initAutoBackup();
    initServerControl();
    initCommandConsole();
    initPlayerActions();
    initSystemDialog();
    initNotificationUI();
    initPlayerPermissions();
    initPlayerWhitelist();
    initPlayerBan();
    initWorldSettings();
    setupGlobalImageDragBlocker();
    
});
