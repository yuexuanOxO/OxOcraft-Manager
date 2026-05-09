let autoBackupMissedPromptOpen = false;
let isCloudConnected = false;

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


export function setAutoBackupCloudConnectionState(connected) {
    isCloudConnected = !!connected;
}


function setBoolButton(btn, value) {
    if (!btn) return;

    btn.dataset.value = value ? "true" : "false";
    btn.classList.toggle("on", value);
    btn.classList.toggle("off", !value);

    btn.innerHTML = `
        <span class="setting-switch-visual">
            <span class="setting-switch-track"></span>
            <span class="setting-switch-thumb"></span>
        </span>
        <span class="setting-switch-text">${value ? "true" : "false"}</span>
    `;
}


function updateAutoBackupAdvancedVisible() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const advanced = document.getElementById("autoBackupAdvancedSettings");

    if (!enabledBtn || !advanced) return;

    const editingEnabled =
        enabledBtn.dataset.value === "true";

    const appliedEnabled =
        autoBackupState.enabled;

    const shouldShow =
        editingEnabled || appliedEnabled;

    advanced.classList.toggle("hidden", !shouldShow);
}


function formatAutoBackupTime(value) {
    if (!value) return "尚未設定";

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
        updateAutoBackupAdvancedVisible();

        if (frequency) frequency.value = autoBackupState.frequency;
        if (startAt) startAt.value = autoBackupState.startAt;
        if (nextText) nextText.textContent = formatAutoBackupTime(autoBackupState.nextRunAt);
        updateAutoBackupTaskButton();

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


async function saveAutoBackupConfig(showAlert = true) {
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

        if (showAlert) {
            alert(data.message || "自動備份設定已儲存");
        }
        await loadAutoBackupConfig();

    } catch (error) {
        console.error("儲存自動備份設定失敗:", error);
        alert("儲存自動備份設定失敗，請查看 console。");
    }
}


export function updateAutoBackupCloudUploadAvailability(connected) {
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const warningText = document.getElementById("autoBackupCloudWarningText");

    if (!uploadBtn) return;

    // 未連接時強制關閉雲端同步備份
    if (!connected) {
        setBoolButton(uploadBtn, false);
    }

    uploadBtn.disabled = !connected;

    uploadBtn.title = connected
        ? ""
        : "需先連接 Google Drive";

    warningText?.classList.toggle("hidden", connected);
}


function updateAutoBackupTaskButton() {
    const btn = document.getElementById("autoBackupTaskBtn");

    if (!btn) return;

    if (autoBackupState.enabled && autoBackupState.nextRunAt) {
        btn.classList.remove("hidden");
        btn.title = `自動備份已啟用\n下次備份時間：${formatAutoBackupTime(autoBackupState.nextRunAt)}`;
    } else {
        btn.classList.add("hidden");
        btn.title = "自動備份未啟用";
    }
}


function setupAutoBackupSettings() {
    const enabledBtn = document.getElementById("autoBackupEnabledBtn");
    const uploadBtn = document.getElementById("autoBackupUploadCloudBtn");
    const saveBtn = document.getElementById("autoBackupSaveBtn");
    const cloudWarningText = document.getElementById("autoBackupCloudWarningText");
    const autoBackupTaskBtn = document.getElementById("autoBackupTaskBtn");

    if (autoBackupTaskBtn) {
        autoBackupTaskBtn.addEventListener("click", async () => {
            document.getElementById("backupModal")?.classList.remove("hidden");

            document.querySelectorAll(".backup-tab").forEach(tab => {
                tab.classList.toggle("active", tab.dataset.tab === "settings");
            });

            document.getElementById("backupManualPage")?.classList.add("hidden");
            document.getElementById("backupSettingsPage")?.classList.remove("hidden");
            document.getElementById("backupRecordsPage")?.classList.add("hidden");
            document.getElementById("backupCloudPage")?.classList.add("hidden");

            await loadAutoBackupConfig();
        });
    }

    if (cloudWarningText) {
        cloudWarningText.addEventListener("click", () => {
            document.querySelectorAll(".backup-tab").forEach(tab => {
                tab.classList.toggle("active", tab.dataset.tab === "cloud");
            });

            document.getElementById("backupManualPage")?.classList.add("hidden");
            document.getElementById("backupSettingsPage")?.classList.add("hidden");
            document.getElementById("backupRecordsPage")?.classList.add("hidden");
            document.getElementById("backupCloudPage")?.classList.remove("hidden");
        });
    }

    if (enabledBtn) {
        enabledBtn.addEventListener("click", async () => {
            const currentValue = enabledBtn.dataset.value === "true";
            const nextValue = !currentValue;

            // 關閉自動備份：直接詢問並立即套用
            if (!nextValue) {
                const ok = confirm("確定要關閉自動備份嗎？\n\n關閉後將會取消目前的自動備份排程。");

                if (!ok) {
                    setBoolButton(enabledBtn, true);
                    updateAutoBackupAdvancedVisible();
                    return;
                }

                setBoolButton(enabledBtn, false);
                updateAutoBackupAdvancedVisible();

                await saveAutoBackupConfig(false);
                return;
            }

            // 開啟自動備份：只展開設定，不立即生效
            setBoolButton(enabledBtn, true);
            updateAutoBackupAdvancedVisible();

            alert(
                "若要自動備份，請確保 OxOcraft-Manager 在預定備份時間是執行中的。\n\n" +
                "若預定時間未執行，系統會在下次啟動時詢問是否補做該次備份。"
            );
        });
    }

    if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
            const nextValue = uploadBtn.dataset.value !== "true";

            // 要開啟雲端同步時先檢查 Google 是否已連接
            if (nextValue && !isCloudConnected) {
                alert("需先綁定雲端備份帳號後才能啟用此功能。");
                return;
            }

            setBoolButton(uploadBtn, nextValue);
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", saveAutoBackupConfig);
    }


    


    updateAutoBackupCloudUploadAvailability(false);

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
