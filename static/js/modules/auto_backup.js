let autoBackupMissedPromptOpen = false;

let autoBackupState = {
    enabled: false,
    frequency: "daily",
    startAt: "",
    nextRunAt: "",
    uploadCloud: false
};


export function initAutoBackup() {
    setupAutoBackupSettings();
    loadAutoBackupConfig();
}


function setBoolButton(btn, value) {
    if (!btn) return;

    btn.dataset.value = value ? "true" : "false";
    btn.textContent = value ? "True" : "False";

    btn.classList.toggle("true", value);
    btn.classList.toggle("false", !value);
}


function formatAutoBackupTime(value) {
    if (!value) return "未啟用";

    return value.replace("T", " ");
}


export async function loadAutoBackupConfig() {
    try {
        const response = await fetch("/api/backup/auto-config", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        const config = data.config || {};

        autoBackupState.enabled = !!config.auto_backup_enabled;
        autoBackupState.frequency = config.auto_backup_frequency || "daily";
        autoBackupState.startAt = config.auto_backup_start_at || "";
        autoBackupState.nextRunAt = config.auto_backup_next_run_at || "";
        autoBackupState.uploadCloud = !!config.auto_backup_upload_cloud;

        const enabledBtn = document.getElementById("autoBackupEnabledBtn");
        const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
        const frequency = document.getElementById("autoBackupFrequency");
        const startAt = document.getElementById("autoBackupStartAt");
        const nextText = document.getElementById("autoBackupNextRunText");

        setBoolButton(enabledBtn, autoBackupState.enabled);
        setBoolButton(uploadBtn, autoBackupState.uploadCloud);

        if (frequency) frequency.value = autoBackupState.frequency;
        if (startAt) startAt.value = autoBackupState.startAt;
        if (nextText) nextText.textContent = formatAutoBackupTime(autoBackupState.nextRunAt);

        if (config.auto_backup_missed_pending) {
            await handleAutoBackupMissed({
                data: JSON.stringify({
                    missed_run_at: config.auto_backup_missed_run_at || ""
                })
            });
        }

    } catch (error) {
        console.error("讀取自動備份設定失敗:", error);
    }
}


async function saveAutoBackupConfig() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const frequency = document.getElementById("autoBackupFrequency");
    const startAt = document.getElementById("autoBackupStartAt");

    const enabled = enabledBtn?.dataset.value === "true";
    const uploadCloud = uploadBtn?.dataset.value === "true";

    if (enabled && !startAt?.value) {
        alert("請先選擇自動備份開始時間。");
        return;
    }

    try {
        const response = await fetch("/api/backup/auto-config", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                auto_backup_enabled: enabled,
                auto_backup_frequency: frequency ? frequency.value : "daily",
                auto_backup_start_at: startAt ? startAt.value : "",
                auto_backup_upload_cloud: uploadCloud
            })
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "儲存自動備份設定失敗");
            return;
        }

        alert(data.message || "自動備份設定已儲存");
        await loadAutoBackupConfig();

    } catch (error) {
        console.error("儲存自動備份設定失敗:", error);
        alert("儲存自動備份設定失敗，請查看 console。");
    }
}


function setupAutoBackupSettings() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const saveBtn = document.getElementById("autoBackupSaveBtn");

    if (enabledBtn) {
        enabledBtn.addEventListener("click", () => {
            const nextValue = enabledBtn.dataset.value !== "true";
            setBoolButton(enabledBtn, nextValue);

            if (nextValue) {
                alert(
                    "若要自動備份，請確保 OxOcraft-Manager 在預定備份時間是執行中的。\n\n" +
                    "若預定時間未執行，系統會在下次啟動時詢問是否補做該次備份。"
                );
            }
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            const nextValue = uploadBtn.dataset.value !== "true";
            setBoolButton(uploadBtn, nextValue);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", saveAutoBackupConfig);
    }
}


export async function handleAutoBackupMissed(event) {
    if (autoBackupMissedPromptOpen) return;

    autoBackupMissedPromptOpen = true;

    try {
        const data = JSON.parse(event.data || "{}");
        const missedRunAt = data.missed_run_at
            ? data.missed_run_at.replace("T", " ")
            : "";
        const promptText = missedRunAt
            ? `偵測到上次自動備份排程 (${missedRunAt}) 沒有執行。\n\n是否要跳過這次排程？\n\n按「確定」：跳過並更新下次備份時間。\n按「取消」：現在補做備份。`
            : "偵測到上次自動備份排程沒有執行。\n\n是否要跳過這次排程？\n\n按「確定」：跳過並更新下次備份時間。\n按「取消」：現在補做備份。";
        const skipMissedBackup = confirm(promptText);
        const endpoint = skipMissedBackup
            ? "/api/backup/auto-missed/skip"
            : "/api/backup/auto-missed/run-now";

        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        });
        const result = await response.json();

        if (!result.success) {
            alert(result.message || "處理上次未執行的自動備份排程失敗");
            return;
        }

        await loadAutoBackupConfig();

    } catch (error) {
        console.error("處理未執行自動備份排程失敗:", error);
        alert("處理未執行自動備份排程失敗，請查看 console。");

    } finally {
        autoBackupMissedPromptOpen = false;
    }
}
