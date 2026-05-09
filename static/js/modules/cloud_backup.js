import {
    openZipFilePicker,
    getCurrentBackupLevelName,
    setCloudConnectionState
} from "./backup.js";

import {
    setAutoBackupCloudConnectionState,
    updateAutoBackupCloudUploadAvailability
} from "./auto_backup.js";


let selectedCloudBackupFile = "";


export function initCloudBackup() {
    setupCloudBackupFolderPicker();

    document.getElementById("cloudUploadLatestBtn")
        ?.addEventListener("click", uploadLatestBackupToGoogleDrive);

    document.getElementById("cloudConnectBtn")
        ?.addEventListener("click", () => {
            window.location.href = "/api/cloud/google/login";
        });
}


export function updateDefaultCloudBackupFolderText() {
    const text = document.getElementById("cloudBackupFolderText");
    if (!text || selectedCloudBackupFile) return;

    text.textContent = "未選擇 ZIP 備份檔";
}


function setupCloudBackupFolderPicker() {
    const selectBtn = document.getElementById("cloudBackupFolderSelectBtn");
    const clearBtn = document.getElementById("cloudBackupFolderClearBtn");
    const text = document.getElementById("cloudBackupFolderText");

    if (selectBtn) {
        selectBtn.addEventListener("click", async () => {
            selectBtn.disabled = true;

            try {
                const path = await openZipFilePicker();

                if (!path) {
                    return;
                }

                selectedCloudBackupFile = path;

                if (text) {
                    text.textContent = path;
                }

            } catch (error) {
                console.error("選擇 ZIP 備份檔失敗:", error);
                alert("選擇 ZIP 備份檔失敗，請查看 console。");

            } finally {
                selectBtn.disabled = false;
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            selectedCloudBackupFile = "";

            if (text) {
                updateDefaultCloudBackupFolderText();
            }
        });
    }
}


export async function loadCloudStatus() {
    const res = await fetch("/api/cloud/google/status", {
        cache: "no-store"
    });

    const data = await res.json();

    const status = document.getElementById("cloudStatusText");
    const email = document.getElementById("cloudEmailText");
    const connectBtn = document.getElementById("cloudConnectBtn");

    if (!status) return;

    if (data.connected) {
        setCloudConnectionState(true);
        setAutoBackupCloudConnectionState(true);
        updateAutoBackupCloudUploadAvailability(true);
        status.textContent = "Google Drive：已連接";
        renderCloudQuota(data.quota);
        status.classList.remove("cloud-status-disconnected");
        status.classList.add("cloud-status-connected");

        if (email) {
            email.innerHTML = `
                <div class="cloud-account-row">
                    ${
                        data.picture
                            ? `<img class="cloud-account-avatar" src="${data.picture}" alt="Google account avatar">`
                            : ""
                    }
                    <span>${data.email || ""}</span>
                    <button id="cloudDisconnectInlineBtn" class="cloud-disconnect-inline-btn" type="button">
                        解除連結
                    </button>
                </div>
            `;

            document.getElementById("cloudDisconnectInlineBtn")?.addEventListener("click", disconnectGoogleDrive);
        }

        connectBtn?.classList.add("hidden");

        document.getElementById("cloudUploadLatestBtn")?.classList.remove("hidden");

    } else {
        setCloudConnectionState(false);
        updateAutoBackupCloudUploadAvailability(false);
        setAutoBackupCloudConnectionState(false);
        status.textContent = "Google Drive：未連接";
        renderCloudQuota(null);
        status.classList.remove("cloud-status-connected");
        status.classList.add("cloud-status-disconnected");

        if (email) {
            email.innerHTML = "";
        }

        connectBtn?.classList.remove("hidden");

        document.getElementById("cloudUploadLatestBtn")?.classList.add("hidden");
    }
}


async function disconnectGoogleDrive() {
    const ok = confirm("確定要解除 Google Drive 連結嗎？\n解除後將無法上傳雲端備份，直到重新連接。");
    if (!ok) return;

    await fetch("/api/cloud/google/disconnect", {
        method: "POST"
    });

    loadCloudStatus();
}


async function uploadLatestBackupToGoogleDrive() {
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn && btn.dataset.mode === "cancel") {
        await cancelGoogleDriveUpload();
        return;
    }


    if (btn) {
        btn.disabled = true;
    }

    try {
        const response = await fetch("/api/cloud/google/upload-latest", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                backup_file: selectedCloudBackupFile
            })
        });

        const data = await response.json();

        if (!data.success) {
            if (btn) btn.disabled = false;
            return;
        }

    } catch (error) {
        console.error("Google Drive 上傳失敗:", error);
        if (btn) btn.disabled = false;
    }
}


export function setCloudUploadRunning(isRunning) {
    const btn = document.getElementById("cloudUploadLatestBtn");
    if (!btn) return;

    if (isRunning) {
        btn.textContent = "取消上傳";
        btn.dataset.mode = "cancel";
        btn.disabled = false;
    } else {
        btn.textContent = "上傳ZIP備份";
        btn.dataset.mode = "start";
        btn.disabled = false;
    }
}


export function renderCloudUploadProgress(data) {
    const status = document.getElementById("cloudUploadStatus");

    if (status) {
        status.textContent = data.message || data.status || "雲端上傳中";
    }
}


export async function cancelGoogleDriveUpload() {
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        const response = await fetch("/api/cloud/google/cancel-upload", {
            method: "POST"
        });

        const data = await response.json();


    } catch (error) {
        console.error("取消 Google Drive 上傳失敗:", error);

    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}


function formatCloudBytes(bytes) {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Number(bytes);
    let index = 0;

    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }

    return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}


function renderCloudQuota(quota) {
    const box = document.getElementById("cloudQuotaBox");
    const bar = document.getElementById("cloudQuotaBar");
    const usedText = document.getElementById("cloudQuotaUsedText");
    const remainText = document.getElementById("cloudQuotaRemainText");

    if (!box || !bar || !usedText || !remainText) return;

    if (!quota || !quota.limit) {
        box.classList.add("hidden");
        return;
    }

    const percent = Math.min(Number(quota.usage_percent || 0), 100);

    box.classList.remove("hidden");
    bar.style.width = `${percent}%`;

    usedText.textContent =
        `${formatCloudBytes(quota.usage)} / ${formatCloudBytes(quota.limit)} (${percent}%)`;

    remainText.textContent =
        `剩餘 ${formatCloudBytes(quota.remaining)}`;

    bar.classList.toggle("warning", percent >= 70 && percent < 90);
    bar.classList.toggle("danger", percent >= 90);
}