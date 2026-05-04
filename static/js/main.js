import { initDeathBook } from "./modules/death_book.js";
import { initFeatureCards } from "./modules/feature_cards.js";
import { initCommandConsole } from "./modules/command_console.js";
import { initPlayerActions } from "./modules/player_actions.js";
import {initServerStatus} from "./modules/server_status.js";
import {initLogConsole} from "./modules/log_console.js";
import {initServerSettings} from "./modules/server_settings.js";
import {initBackup} from "./modules/backup.js";
import {initCloudBackup} from "./modules/cloud_backup.js";
import {initAutoBackup} from "./modules/auto_backup.js";
import {initServerControl} from "./modules/server_control.js";
import {initServerEvents} from "./modules/server_events.js";



document.addEventListener("DOMContentLoaded", () => {

    initServerStatus();
    initServerEvents();
    initDeathBook();
    initFeatureCards();
    initLogConsole();
    initServerSettings();
    initBackup();
    initCloudBackup();
    initAutoBackup();
    initServerControl();
    initCommandConsole();
    initPlayerActions();
    
});
