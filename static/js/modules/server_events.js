import {
    applyServerStatusPayload,
    handleBackendDisconnected
} from "./server_status.js";

import {
    appendLogLine,
    clearLogTextOnly
} from "./log_console.js";

import {
    renderBackupProgress,
    setBackupRunning,
    prependBackupRecord,
    updateBackupRecordItem,
    updateManualCloudUploadButtons
} from "./backup.js";

import {
    renderCloudUploadProgress,
    setCloudUploadRunning
} from "./cloud_backup.js";

import {
    loadAutoBackupConfig,
    handleAutoBackupMissed
} from "./auto_backup.js";

import {
    updateBackupTaskState
} from "./backup_tasks.js";

import {
    updateServerSettingsFooterModeByState
} from "./server_settings.js";

import {
    updateUiServerState
} from "./server_ui_state.js";

let serverEvents = null;
let isBackendDead = false;



export function initServerEvents() {
    if (serverEvents !== null) {
        return;
    }

    serverEvents = new EventSource("/api/events");

    serverEvents.addEventListener("server_status_changed", (event) => {
        const payload = JSON.parse(event.data);

        updateUiServerState(payload.data);

        applyServerStatusPayload(payload);
        updateServerSettingsFooterModeByState(payload.data);
    });

    serverEvents.onerror = () => {
        if (isBackendDead) return;

        console.warn("SSE 暫時中斷，檢查後端連線...");

        setTimeout(async () => {
            if (isBackendDead) return;

            try {
                const response = await fetch("/api/server/query-status", {
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error("後端回應異常");
                }

            } catch (error) {
                isBackendDead = true;

                if (serverEvents) {
                    serverEvents.close();
                    serverEvents = null;
                }

                handleBackendDisconnected();

                window.location.reload();
            }
        }, 1500);
    };

    serverEvents.addEventListener("log_append", (event) => {
        const payload = JSON.parse(event.data);
        const line = payload.line || "";

        appendLogLine(line);

    });

    serverEvents.addEventListener("log_clear", () => {
        clearLogTextOnly();
    });

    serverEvents.addEventListener(
        "player_ban_should_refresh",
        () => {
            console.log("[PlayerBan] SSE refresh received");

            window.dispatchEvent(
                new CustomEvent(
                    "player-ban-should-refresh"
                )
            );

        }
    );

    serverEvents.addEventListener(
        "player_whitelist_should_refresh",
        () => {
            console.log("[PlayerWhitelist] SSE refresh received");

            window.dispatchEvent(
                new CustomEvent(
                    "player-whitelist-should-refresh"
                )
            );
        }
    );

    serverEvents.addEventListener(
        "player_permission_should_refresh",
        () => {
            console.log("[PlayerPermission] SSE refresh received");

            window.dispatchEvent(
                new CustomEvent(
                    "player-permissions-should-refresh"
                )
            );
        }
    );

    serverEvents.addEventListener("backup_started", (event) => {
        const data = JSON.parse(event.data);

        renderBackupProgress(data);
        updateBackupTaskState("local", data);
        setBackupRunning(true);
    });

    serverEvents.addEventListener("backup_progress", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        updateBackupTaskState("local", data);
    });

    serverEvents.addEventListener("backup_finished", async (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        updateBackupTaskState("local", data);
        setBackupRunning(false);

    });

    serverEvents.addEventListener("backup_failed", async (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        updateBackupTaskState("local", data);
        setBackupRunning(false);

    });

    serverEvents.addEventListener("backup_canceled", async (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        updateBackupTaskState("local", data);
        setBackupRunning(false);

    });

    serverEvents.addEventListener("backup_record_added", (event) => {
        const record = JSON.parse(event.data);
        prependBackupRecord(record);
    });

    serverEvents.addEventListener("cloud_upload_started", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        updateBackupTaskState("cloud", data);
        setCloudUploadRunning(true);
        updateManualCloudUploadButtons(data);
    });

    serverEvents.addEventListener("cloud_upload_progress", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        updateBackupTaskState("cloud", data);
    });

    serverEvents.addEventListener("cloud_upload_finished", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        updateBackupTaskState("cloud", data);
        setCloudUploadRunning(false);
        updateManualCloudUploadButtons(data);

        const btn = document.getElementById("cloudUploadLatestBtn");
        if (btn) btn.disabled = false;
    });

    serverEvents.addEventListener("cloud_upload_failed", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        updateBackupTaskState("cloud", data);
        setCloudUploadRunning(false);
        updateManualCloudUploadButtons(data);

        const btn = document.getElementById("cloudUploadLatestBtn");
        if (btn) btn.disabled = false;
    });

    serverEvents.addEventListener("backup_record_updated", (event) => {
        const record = JSON.parse(event.data);
        updateBackupRecordItem(record);
    });

    serverEvents.addEventListener("cloud_upload_canceled", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        updateBackupTaskState("cloud", data);
        setCloudUploadRunning(false);
        updateManualCloudUploadButtons(data);
    });


    serverEvents.addEventListener("auto_backup_finished", async (event) => {
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_failed", async (event) => {
        const data = JSON.parse(event.data);

        alert("自動備份失敗：" + (data.message || "未知錯誤"));

        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_config_updated", async () => {
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_warning", (event) => {
        const data = JSON.parse(event.data);
        console.log(data.message || "自動備份公告階段");
    });

    serverEvents.addEventListener("auto_backup_missed", handleAutoBackupMissed);

}