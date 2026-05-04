let selectedCloudBackupFolder = "";

import {
    openFolderPicker,
    fadeOutAndHide,
    isBackupEndStatus,
    getCurrentBackupLevelName
} from "./backup.js";


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
    if (!text || selectedCloudBackupFolder) return;

    text.textContent = `未指定，使用伺服器上次開啟的世界${getCurrentBackupLevelName()}備份`;
}


function setupCloudBackupFolderPicker() {
    const selectBtn = document.getElementById("cloudBackupFolderSelectBtn");
    const clearBtn = document.getElementById("cloudBackupFolderClearBtn");
    const text = document.getElementById("cloudBackupFolderText");

    if (selectBtn) {
        selectBtn.addEventListener("click", async () => {
            selectBtn.disabled = true;

            try {
                const path = await openFolderPicker();

                if (!path) {
                    return;
                }

                selectedCloudBackupFolder = path;

                if (text) {
                    text.textContent = path;
                }

            } catch (error) {
                console.error("選擇雲端備份資料夾失敗:", error);
                alert("選擇資料夾失敗，請查看 console。");

            } finally {
                selectBtn.disabled = false;
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            selectedCloudBackupFolder = "";

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
        status.textContent = "Google Drive：已連接";
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
        status.textContent = "Google Drive：未連接";
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
    const status = document.getElementById("cloudUploadStatus");
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn && btn.dataset.mode === "cancel") {
        await cancelGoogleDriveUpload();
        return;
    }

    if (status) {
        status.textContent = "準備雲端上傳...";
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
                backup_folder: selectedCloudBackupFolder
            })
        });

        const data = await response.json();

        if (!data.success) {
            if (status) status.textContent = data.message || "上傳失敗";
            if (btn) btn.disabled = false;
            return;
        }

        if (status) {
            status.textContent = data.message || "已開始雲端上傳";
        }

    } catch (error) {
        console.error("Google Drive 上傳失敗:", error);
        if (status) status.textContent = "上傳失敗，請查看 console。";
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
        btn.textContent = "立即上傳最新備份";
        btn.dataset.mode = "start";
        btn.disabled = false;
    }
}


export function renderCloudUploadProgress(data) {

    const percent = data.percent || 0;
    showCloudUploadTaskButton(percent);

    // 原本雲端頁
    const status = document.getElementById("cloudUploadStatus");
    const file = document.getElementById("cloudUploadFile");
    const bar = document.getElementById("cloudUploadProgressBar");
    const text = document.getElementById("cloudUploadProgressText");

    // 手動備份頁新增
    const manualStatus = document.getElementById("manualCloudUploadStatus");
    const manualFile = document.getElementById("manualCloudUploadFile");
    const manualBar = document.getElementById("manualCloudUploadProgressBar");
    const manualText = document.getElementById("manualCloudUploadProgressText");

    const manualCloudBox = document.getElementById("manualCloudUploadBox");

    if (manualCloudBox && data.status === "running") {
        manualCloudBox.classList.remove("hidden");
    }

    const msg = data.message || "雲端上傳中";
    const fileName = data.file_name || "無";

    if (status) status.textContent = msg;
    if (file) file.textContent = `目前檔案：${fileName}`;
    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${percent}%`;

    if (manualStatus) manualStatus.textContent = `雲端上傳：${msg}`;
    if (manualFile) manualFile.textContent = `目前檔案：${fileName}`;
    if (manualBar) manualBar.style.width = `${percent}%`;
    if (manualText) manualText.textContent = `${percent}%`;

    if (isBackupEndStatus(data)) {
        setTimeout(() => {
            hideCloudUploadTaskButton();
        }, 3000);

        fadeOutAndHide(document.getElementById("manualBackupProgressBox"), 3000);
    }

    
}


function showCloudUploadTaskButton(percent = 0) {
    const btn = document.getElementById("cloudUploadTaskBtn");
    const ring = document.getElementById("cloudUploadTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

    const circumference = 106.8;
    const offset = circumference - (circumference * percent / 100);
    ring.style.strokeDashoffset = offset;
}


function hideCloudUploadTaskButton() {
    const btn = document.getElementById("cloudUploadTaskBtn");
    if (btn) btn.classList.add("hidden");
}





export async function cancelGoogleDriveUpload() {
    const status = document.getElementById("cloudUploadStatus");
    const btn = document.getElementById("cloudUploadLatestBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        const response = await fetch("/api/cloud/google/cancel-upload", {
            method: "POST"
        });

        const data = await response.json();

        if (status) {
            status.textContent = data.message || "已送出取消雲端上傳請求";
        }

    } catch (error) {
        console.error("取消 Google Drive 上傳失敗:", error);
        if (status) status.textContent = "取消上傳失敗，請查看 console。";

    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}