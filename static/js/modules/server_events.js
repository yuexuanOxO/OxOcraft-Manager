import {
    applyServerStatusPayload,
    updateStatusForce,
    addPlayerFromLog,
    removePlayerFromLog,
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
    updateBackupRecordItem
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
    setPowerButtonLoading
} from "./server_control.js";

let serverEvents = null;



export function initServerEvents() {
    if (serverEvents !== null) {
        return;
    }

    serverEvents = new EventSource("/api/events");

    serverEvents.addEventListener("server_status_changed", (event) => {
        const payload = JSON.parse(event.data);
        applyServerStatusPayload(payload);
    });

    serverEvents.onerror = () => {
        console.warn("SSE 暫時中斷，檢查後端連線...");

        setTimeout(async () => {
            try {
                const response = await fetch("/api/server/query-status", {
                    cache: "no-store"
                });

                if (!response.ok) {
                    throw new Error("後端回應異常");
                }

            } catch (error) {
                handleBackendDisconnected();
            }
        }, 1500);
    };

    serverEvents.addEventListener("log_append", (event) => {
        const payload = JSON.parse(event.data);
        const line = payload.line || "";

        appendLogLine(line);

        const joinMatch = line.match(/\]:\s*(.+?) joined the game$/);
        const leftMatch = line.match(/\]:\s*(.+?) left the game$/);

        if (joinMatch) {
            addPlayerFromLog(joinMatch[1]);
            setTimeout(updateStatusForce, 3000); // 延後用 Query 校正
        }

        if (leftMatch) {
            removePlayerFromLog(leftMatch[1]);
            setTimeout(updateStatusForce, 3000); // 延後用 Query 校正
        }

    });

    serverEvents.addEventListener("log_clear", () => {
        clearLogTextOnly();
    });

    serverEvents.addEventListener("backup_started", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(true);
    });

    serverEvents.addEventListener("backup_progress", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
    });

    serverEvents.addEventListener("backup_finished", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_failed", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_canceled", (event) => {
        const data = JSON.parse(event.data);
        renderBackupProgress(data);
        setBackupRunning(false);
    });

    serverEvents.addEventListener("backup_record_added", (event) => {
        const record = JSON.parse(event.data);
        prependBackupRecord(record);
    });

    serverEvents.addEventListener("cloud_upload_started", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(true);
    });

    serverEvents.addEventListener("cloud_upload_progress", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
    });

    serverEvents.addEventListener("cloud_upload_finished", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(false);

        const btn = document.getElementById("cloudUploadLatestBtn");
        if (btn) btn.disabled = false;
    });

    serverEvents.addEventListener("cloud_upload_failed", (event) => {
        const data = JSON.parse(event.data);
        renderCloudUploadProgress(data);
        setCloudUploadRunning(false);

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
        setCloudUploadRunning(false);
    });

    serverEvents.addEventListener("auto_backup_started", (event) => {
        const data = JSON.parse(event.data);

        setPowerButtonLoading(true, data.message || "自動備份進行中");
    });

    serverEvents.addEventListener("auto_backup_finished", async (event) => {
        setPowerButtonLoading(false);

        await updateStatus();
        await loadAutoBackupConfig();
    });

    serverEvents.addEventListener("auto_backup_failed", async (event) => {
        const data = JSON.parse(event.data);

        setPowerButtonLoading(false);

        alert("自動備份失敗：" + (data.message || "未知錯誤"));

        await updateStatus();
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