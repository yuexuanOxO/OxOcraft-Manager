
const taskState = {
    local: null,
    cloud: null
};

function isEndStatus(data) {
    const status = String(data?.status || "").toLowerCase();

    return (
        status === "success" ||
        status === "failed" ||
        status === "canceled"
    );
}

export function updateBackupTaskState(type, data) {
    if (type !== "local" && type !== "cloud") return;

    const status = String(data?.status || "").toLowerCase();
    const isRunning =
        data?.running ||
        status === "running" ||
        status === "uploading";

    if (isRunning && fadeTimers[type]) {
        clearTimeout(fadeTimers[type]);
        fadeTimers[type] = null;
    }

    taskState[type] = {
        ...(taskState[type] || {}),
        ...data,
        type
    };

    renderBackupFloatingProgress();
}

function renderBackupFloatingProgress() {
    renderLocalFloatingProgress(taskState.local);
    renderCloudFloatingProgress(taskState.cloud);
}

function renderLocalProgress(data) {
    if (!data) return;

    const percent = data.percent || 0;

    const statusText = document.getElementById("manualBackupStatusText");
    const bar = document.getElementById("manualBackupProgressBar");
    const text = document.getElementById("manualBackupProgressText");
    const currentFile = document.getElementById("manualBackupCurrentFile");

    if (statusText) {
        statusText.textContent = `狀態：${data.message || data.status || "未知"}`;
    }

    if (bar) {
        bar.style.width = `${percent}%`;
    }

    if (text) {
        text.textContent = `${percent}%`;
    }

    if (currentFile) {
        currentFile.textContent = `目前檔案：${data.current_file || "無"}`;
    }

    updateLocalTaskButton(percent, isEndStatus(data));
}

function renderCloudProgress(data) {
    if (!data) return;

    const percent = data.percent || 0;

    const status = document.getElementById("manualCloudUploadStatus");
    const bar = document.getElementById("manualCloudUploadProgressBar");
    const text = document.getElementById("manualCloudUploadProgressText");
    const file = document.getElementById("manualCloudUploadFile");

    if (status) {
        status.textContent = `雲端上傳：${data.message || data.status || "未知"}`;
    }

    if (bar) {
        bar.style.width = `${percent}%`;
    }

    if (text) {
        text.textContent = `${percent}%`;
    }

    if (file) {
        file.textContent = `目前檔案：${data.file_name || "無"}`;
    }

    updateCloudTaskButton(percent, isEndStatus(data));
}

function shouldFadeOut() {
    const local = taskState.local;
    const cloud = taskState.cloud;

    const localDone = !local || isEndStatus(local);
    const cloudDone = !cloud || isEndStatus(cloud);

    return localDone && cloudDone;
}

function updateLocalTaskButton(percent, ended) {
    const btn = document.getElementById("backupTaskBtn");
    const ring = document.getElementById("backupTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

    const frameLength = 100;
    ring.style.strokeDashoffset =
        frameLength - (frameLength * percent / 100);

    if (ended) {
        setTimeout(() => {
            btn.classList.add("hidden");
            ring.style.strokeDashoffset = frameLength;
        }, 3000);
    }
}

function updateCloudTaskButton(percent, ended) {
    const btn = document.getElementById("cloudUploadTaskBtn");
    const ring = document.getElementById("cloudUploadTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

   const frameLength = 100;
    ring.style.strokeDashoffset =
        frameLength - (frameLength * percent / 100);

    if (ended) {
        setTimeout(() => {
            btn.classList.add("hidden");
            ring.style.strokeDashoffset = frameLength;
        }, 3000);
    }

}

const fadeTimers = {
    local: null,
    cloud: null
};

function fadeOutFloatingBox(box, type, delay = 3000) {
    if (!box || !type) return;

    if (fadeTimers[type]) {
        clearTimeout(fadeTimers[type]);
    }

    fadeTimers[type] = setTimeout(() => {
        box.style.opacity = "0";

        setTimeout(() => {
            box.classList.add("hidden");
            box.style.opacity = "1";
            taskState[type] = null;
            fadeTimers[type] = null;
        }, 800);
    }, delay);
}


function renderLocalFloatingProgress(data) {
    const box = document.getElementById("manualBackupProgressBox");
    if (!box || !data) return;

    const shouldShow =
        isRunningStatus(data) ||
        isEndStatus(data);

    if (!shouldShow) return;

    box.classList.remove("hidden");
    box.style.opacity = "1";

    renderLocalProgress(data);

    if (isEndStatus(data)) {
        fadeOutFloatingBox(box, "local", 3000);
    }
}

function renderCloudFloatingProgress(data) {
    const box = document.getElementById("cloudBackupProgressBox");
    if (!box || !data) return;

    const shouldShow =
        isRunningStatus(data) ||
        isEndStatus(data);

    if (!shouldShow) return;

    box.classList.remove("hidden");
    box.style.opacity = "1";

    renderCloudProgress(data);

    if (isEndStatus(data)) {
        fadeOutFloatingBox(box, "cloud", 3000);
    }
}


function isRunningStatus(data) {
    const status = String(data?.status || "").toLowerCase();
    const message = String(data?.message || "");

    return (
        data?.running ||
        status === "running" ||
        status === "uploading" ||
        status === "started" ||
        message.includes("上傳中") ||
        message.includes("備份中")
    );
}
