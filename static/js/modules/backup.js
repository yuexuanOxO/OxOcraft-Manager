let backupRecordsCache = [];
let backupRecordKeyword = "";
let backupProviderFilters = new Set();
let backupStatusFilters = new Set();
let currentBackupLevelName = "world";
let manualBackupSelectedWorld = null;
let currentServerWorldPath = "";
let manualBackupUploadCloud = false;

import {
    updateDefaultCloudBackupFolderText,
    loadCloudStatus
} from "./cloud_backup.js";

import {
    loadAutoBackupConfig
} from "./auto_backup.js";


export function initBackup() {
    setupBackupModal();
    setupBackupActionButton();
    setupBackupPathEditButtons();
    setupBackgroundTaskButtons();
    setupBackupRecordFilters();
    setupManualBackupButtons();
    setupManualProgressCancelButtons();
}

export function getCurrentBackupLevelName() {
    return currentBackupLevelName;
}

function setupBackupModal() {
    const modal = document.getElementById("backupModal");
    const openBtn = document.getElementById("backupBtn");
    const tabs = document.querySelectorAll(".backup-tab");
    const manualPage = document.getElementById("backupManualPage");
    const settingsPage = document.getElementById("backupSettingsPage");
    const recordsPage = document.getElementById("backupRecordsPage");

    if (!modal || !openBtn) return;

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        tabs.forEach(item => {
            item.classList.toggle("active", item.dataset.tab === "manual");
        });

        if (manualPage) {
            manualPage.classList.remove("hidden");
        }
        settingsPage.classList.add("hidden");
        recordsPage.classList.add("hidden");

        const cloudPage = document.getElementById("backupCloudPage");
        if (cloudPage) {
            cloudPage.classList.add("hidden");
        }

        await loadBackupConfig();
        await loadAutoBackupConfig();
    });


    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {

            tabs.forEach(item => item.classList.remove("active"));
            tab.classList.add("active");

            const target = tab.dataset.tab;

            const cloudPage = document.getElementById("backupCloudPage");

            if (manualPage) {
                manualPage.classList.add("hidden");
            }
            settingsPage.classList.add("hidden");
            recordsPage.classList.add("hidden");

            if (cloudPage) {
                cloudPage.classList.add("hidden");
            }

            if (target === "manual") {

                if (manualPage) {
                    manualPage.classList.remove("hidden");
                }

            } else if (target === "settings") {

                settingsPage.classList.remove("hidden");

            } else if (target === "records") {

                recordsPage.classList.remove("hidden");
                loadBackupRecords();

            } else if (target === "cloud") {

                if (cloudPage) {
                    cloudPage.classList.remove("hidden");
                }

                loadCloudStatus();
            }
        });
    });
}


async function startManualBackup() {
    const btn = document.getElementById("backupMainActionBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        const sourceInput = document.getElementById("backupSourceRootInput");
        const backupInput = document.getElementById("backupRootInput");

        const response = await fetch("/api/backup/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                source_root: sourceInput ? sourceInput.value.trim() : "",
                backup_root: backupInput ? backupInput.value.trim() : ""
            })
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "開始備份失敗");

            if (btn) {
                btn.disabled = false;
            }

            return;
        }


        if (btn) {
            btn.disabled = false;
        }

    } catch (error) {
        console.error("開始備份失敗:", error);
        alert("開始備份失敗，請查看 console。");

        setBackupRunning(false);

        if (btn) {
            btn.disabled = false;
        }
    }
}


export async function cancelManualBackup() {
    const btn = document.getElementById("backupMainActionBtn");

    if (btn) {
        btn.disabled = true;
    }

    try {
        await fetch("/api/backup/cancel", {
            method: "POST"
        });
    } finally {
        if (btn) {
            btn.disabled = false;
        }
    }
}


export function setBackupRunning(isRunning) {
    const btn = document.getElementById("backupMainActionBtn");
    if (!btn) return;

    if (isRunning) {
        btn.textContent = "取消備份";
        btn.dataset.mode = "cancel";
    } else {
        btn.textContent = "立即備份";
        btn.dataset.mode = "start";
    }
}


function setupBackupActionButton() {
    const btn = document.getElementById("backupMainActionBtn");
    if (!btn) return;

    btn.addEventListener("click", async () => {
        if (btn.dataset.mode === "cancel") {
            await cancelManualBackup();
            return;
        }

        await startManualBackup();
    });
}


function setupBackupRecordFilters() {
    const searchInput = document.getElementById("backupRecordSearchInput");
    const searchBtn = document.getElementById("backupRecordSearchBtn");
    const filterBtn = document.getElementById("backupRecordFilterBtn");
    const filterPanel = document.getElementById("backupRecordFilterPanel");
    const clearBtn = document.getElementById("backupClearFiltersBtn");

    function applySearch() {
        backupRecordKeyword = searchInput ? searchInput.value.trim() : "";
        renderFilteredBackupRecords();
    }

    if (searchBtn) {
        searchBtn.addEventListener("click", applySearch);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                applySearch();
            }
        });

        searchInput.addEventListener("input", () => {
            backupRecordKeyword = searchInput.value.trim();
            renderFilteredBackupRecords();
        });
    }

    if (filterBtn && filterPanel) {
        filterBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            filterPanel.classList.toggle("hidden");
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            backupProviderFilters.clear();
            backupStatusFilters.clear();

            document.querySelectorAll("[data-filter-provider], [data-filter-status]").forEach((btn) => {
                btn.classList.remove("active");
            });

            renderFilteredBackupRecords();
        });
    }

    document.querySelectorAll("[data-filter-provider]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const provider = btn.dataset.filterProvider;

            if (backupProviderFilters.has(provider)) {
                backupProviderFilters.delete(provider);
                btn.classList.remove("active");
            } else {
                backupProviderFilters.add(provider);
                btn.classList.add("active");
            }

            renderFilteredBackupRecords();
        });
    });

    document.querySelectorAll("[data-filter-status]").forEach((btn) => {
        btn.addEventListener("click", () => {
            const status = btn.dataset.filterStatus;

            if (backupStatusFilters.has(status)) {
                backupStatusFilters.delete(status);
                btn.classList.remove("active");
            } else {
                backupStatusFilters.add(status);
                btn.classList.add("active");
            }

            renderFilteredBackupRecords();
        });
    });

    document.addEventListener("click", (event) => {
        if (!filterPanel || filterPanel.classList.contains("hidden")) return;

        const clickedInsidePanel = filterPanel.contains(event.target);
        const clickedFilterButton = filterBtn && filterBtn.contains(event.target);

        if (!clickedInsidePanel && !clickedFilterButton) {
            filterPanel.classList.add("hidden");
        }
    });

}


export function renderBackupProgress(data) {
    const statusText = document.getElementById("backupStatusText");
    const progressBar = document.getElementById("backupProgressBar");
    const progressText = document.getElementById("backupProgressText");
    const currentFile = document.getElementById("backupCurrentFile");
    const manualStatusText = document.getElementById("manualBackupStatusText");
    const manualProgressBar = document.getElementById("manualBackupProgressBar");
    const manualProgressText = document.getElementById("manualBackupProgressText");
    const manualCurrentFile = document.getElementById("manualBackupCurrentFile");
    const mapName = document.getElementById("backupMapName");

    const percent = data.percent || 0;

    if (statusText) {
        statusText.textContent = `狀態：${data.message || data.status || "未知"}`;
    }

    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }

    if (progressText) {
        progressText.textContent = `${percent}%`;
    }

    if (currentFile) {
        currentFile.textContent = `目前檔案：${data.current_file || "無"}`;
    }

    if (manualStatusText) {
        manualStatusText.textContent = `狀態：${data.message || data.status || "未知"}`;
    }

    if (manualProgressBar) {
        manualProgressBar.style.width = `${percent}%`;
    }

    if (manualProgressText) {
        manualProgressText.textContent = `${percent}%`;
    }

    if (manualCurrentFile) {
        manualCurrentFile.textContent = `目前檔案：${data.current_file || "無"}`;
    }

    if (mapName && data.map_name) {
        mapName.textContent = data.map_name;
    }

    if (data.running || data.status === "running") {
        document.getElementById("manualLocalBackupBtn")?.setAttribute("disabled", "disabled");
        document.getElementById("manualLocalCloudBackupBtn")?.setAttribute("disabled", "disabled");
        showBackupTaskButton(percent);
    } else if (isBackupEndStatus(data)) {
        showBackupTaskButton(100);

        setTimeout(() => {
            hideBackupTaskButton();
        }, 3000);

        const status = String(data.status || "").toLowerCase();
        const message = String(data.message || "");

        const isLocalSuccess = status === "success";
        const isCanceledOrFailed =
            status === "failed" ||
            status === "canceled" ||
            status === "cancelled" ||
            status.includes("cancel") ||
            message.includes("取消");

        if (!manualBackupUploadCloud || isCanceledOrFailed) {
            fadeOutAndHide(document.getElementById("manualBackupProgressBox"), 3000);
        }

        document.getElementById("manualLocalBackupBtn")?.removeAttribute("disabled");
        document.getElementById("manualLocalCloudBackupBtn")?.removeAttribute("disabled");
    }
}


function setupBackgroundTaskButtons() {
    const backupTaskBtn = document.getElementById("backupTaskBtn");
    const backupModal = document.getElementById("backupModal");
    const cloudUploadTaskBtn = document.getElementById("cloudUploadTaskBtn");

    if (!backupTaskBtn || !backupModal) return;

    backupTaskBtn.addEventListener("click", async () => {
        backupModal.classList.remove("hidden");
        await loadBackupConfig();

        document.querySelectorAll(".backup-tab").forEach(tab => {
            tab.classList.toggle("active", tab.dataset.tab === "manual");
        });

        document.getElementById("backupManualPage")?.classList.remove("hidden");
        document.getElementById("backupSettingsPage")?.classList.add("hidden");
        document.getElementById("backupRecordsPage")?.classList.add("hidden");
        document.getElementById("backupCloudPage")?.classList.add("hidden");
    });

    if (cloudUploadTaskBtn && backupModal) {
        cloudUploadTaskBtn.addEventListener("click", async () => {
            backupModal.classList.remove("hidden");
            await loadBackupConfig();

            document.querySelectorAll(".backup-tab").forEach(tab => {
                tab.classList.toggle("active", tab.dataset.tab === "manual");
            });

            document.getElementById("backupManualPage")?.classList.remove("hidden");
            document.getElementById("backupSettingsPage")?.classList.add("hidden");
            document.getElementById("backupRecordsPage")?.classList.add("hidden");
            document.getElementById("backupCloudPage")?.classList.add("hidden");
        });
    }

}


export async function loadBackupConfig() {
    try {
        const response = await fetch("/api/backup/config", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        const sourceInput = document.getElementById("backupSourceRootInput");
        const backupInput = document.getElementById("backupRootInput");
        const manualSourceInput = document.getElementById("manualBackupSourceInput");
        const manualBackupInput = document.getElementById("manualBackupRootInput");
        const mapName = document.getElementById("backupMapName");
        const sourceText = document.getElementById("backupSourceRootText");
        const backupText = document.getElementById("backupRootText");
        const manualSourceText = document.getElementById("manualBackupSourceText");
        const manualBackupText = document.getElementById("manualBackupRootText");

        currentServerWorldPath = data.world_path || "";

        if (sourceInput && sourceText) {
            sourceInput.value = data.source_root || "";
            sourceText.textContent = data.source_root || "";
        }

        if (backupInput && backupText && !backupInput.value.trim()) {
            backupInput.value = data.backup_root || "";
            backupText.textContent = data.backup_root || "";
        }

        if (manualSourceInput && manualSourceText) {
            const manualScanRoot = data.manual_scan_root || data.source_root || "";
            manualSourceInput.value = manualScanRoot;
            manualSourceText.textContent = manualScanRoot;
            await loadManualBackupWorlds(manualScanRoot, data.world_path || "");
        }

        if (manualBackupInput && manualBackupText && !manualBackupInput.value.trim()) {
            manualBackupInput.value = data.manual_backup_root || data.backup_root || "";
            manualBackupText.textContent = manualBackupInput.value;
        }

        currentBackupLevelName = data.level_name || "world";

        if (mapName) {
            const worldPath = data.world_path || "";
            mapName.textContent = worldPath
                ? worldPath.split(/[\\/]/).filter(Boolean).pop()
                : currentBackupLevelName;
        }

        updateDefaultCloudBackupFolderText();

    } catch (error) {
        console.error("讀取備份設定失敗:", error);
    }
}


async function startSafeManualBackup(uploadCloud) {
    const sourceInput = document.getElementById("manualBackupSourceInput");
    const backupInput = document.getElementById("manualBackupRootInput");
    const localBtn = document.getElementById("manualLocalBackupBtn");
    const cloudBtn = document.getElementById("manualLocalCloudBackupBtn");
    const selectedWorldPath = manualBackupSelectedWorld?.path || "";
    manualBackupUploadCloud = uploadCloud;

    if (!sourceInput?.value.trim()) {
        alert("請先選擇世界資料夾");
        return;
    }

    if (!selectedWorldPath) {
        alert("請先選擇要備份的世界資料夾");
        return;
    }

    if (!backupInput?.value.trim()) {
        alert("請先選擇備份輸出路徑");
        return;
    }

    try {
        const statusRes = await fetch("/api/server/query-status", { cache: "no-store" });
        const statusPayload = await statusRes.json();
        const statusData = statusPayload.data || statusPayload;
        const isSelectedCurrentWorld =
            normalizePath(manualBackupSelectedWorld?.path || "") ===
            normalizePath(currentServerWorldPath);

        if (statusData.online && isSelectedCurrentWorld) {
            const ok = confirm("你要備份的是目前伺服器使用中的世界。\n\n手動備份需要先關閉伺服器，備份完成後會重新啟動。是否繼續？");
            if (!ok) return;
        }

        if (localBtn) localBtn.disabled = true;
        if (cloudBtn) cloudBtn.disabled = true;

        document.getElementById("manualBackupProgressBox")?.classList.remove("hidden");

        const cloudBox = document.getElementById("manualCloudUploadBox");
        const cloudBar = document.getElementById("manualCloudUploadProgressBar");
        const cloudText = document.getElementById("manualCloudUploadProgressText");
        const cloudStatus = document.getElementById("manualCloudUploadStatus");
        const cloudFile = document.getElementById("manualCloudUploadFile");

        if (cloudBox) {
            cloudBox.classList.add("hidden");
            cloudBox.style.opacity = "1";
        }

        if (cloudBar) cloudBar.style.width = "0%";
        if (cloudText) cloudText.textContent = "0%";
        if (cloudStatus) cloudStatus.textContent = "雲端上傳：待機";
        if (cloudFile) cloudFile.textContent = "目前檔案：無";

        document.getElementById("manualCancelBackupBtn")?.removeAttribute("disabled");
        document.getElementById("manualCancelCloudUploadBtn")?.removeAttribute("disabled");

        const response = await fetch("/api/backup/manual-safe-start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                manual_scan_root: sourceInput.value.trim(),
                selected_world_path: selectedWorldPath,
                backup_root: backupInput.value.trim(),
                upload_cloud: uploadCloud
            })
        });
        const data = await response.json();

        if (!data.success) {
            alert(data.message || "開始手動備份失敗");
            if (localBtn) localBtn.disabled = false;
            if (cloudBtn) cloudBtn.disabled = false;
        }

    } catch (error) {
        console.error("開始手動備份失敗:", error);
        alert("開始手動備份失敗，請查看 console。");
        if (localBtn) localBtn.disabled = false;
        if (cloudBtn) cloudBtn.disabled = false;
    }
}


function setupManualBackupButtons() {
    document.getElementById("manualLocalBackupBtn")?.addEventListener("click", () => {
        startSafeManualBackup(false);
    });

    document.getElementById("manualLocalCloudBackupBtn")?.addEventListener("click", () => {
        startSafeManualBackup(true);
    });
}


async function loadManualBackupWorlds(rootPath, currentWorldPath = "") {
    if (!rootPath) return;

    const response = await fetch("/api/backup/worlds", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            root: rootPath
        })
    });

    const data = await response.json();

    if (!data.success) {
        alert(data.message || "找不到有效的世界資料夾");
        return;
    }

    renderManualBackupWorlds(data.worlds || [], currentWorldPath);
}


function normalizePath(path) {
    return String(path || "")
        .replaceAll("\\\\", "/")
        .replaceAll("\\", "/")
        .toLowerCase();
}


function renderManualBackupWorlds(worlds, currentWorldPath = "") {
    const list = document.getElementById("manualBackupWorldList");
    const info = document.getElementById("manualBackupWorldInfo");

    if (!list) return;

    list.innerHTML = "";

    if (!worlds.length) {
        manualBackupSelectedWorld = null;
        if (info) info.textContent = "找不到有效的世界資料夾";
        return;
    }

    const matchedWorld = worlds.find(world => {
        return normalizePath(world.path) === normalizePath(currentWorldPath);
    });

    manualBackupSelectedWorld = matchedWorld || worlds[0];

    worlds.forEach((world) => {
        const isCurrentWorld =
            normalizePath(world.path) === normalizePath(currentWorldPath);

        const isSelected =
            normalizePath(world.path) === normalizePath(manualBackupSelectedWorld.path);

        const row = document.createElement("button");
        row.type = "button";
        row.className = "manual-world-row";

        if (isSelected) {
            row.classList.add("active");
        }

        row.innerHTML = `
            <div class="manual-world-name">${world.name}</div>
            <div class="manual-world-size">${formatBytes(world.total_bytes || 0)}</div>
            <div class="manual-world-status ${isCurrentWorld ? "using" : "ready"}">
                ${isCurrentWorld ? "使用中" : "可備份"}
            </div>
        `;

        row.addEventListener("click", () => {
            document.querySelectorAll(".manual-world-row").forEach(item => {
                item.classList.remove("active");
            });

            row.classList.add("active");
            manualBackupSelectedWorld = world;

            const sourceInput = document.getElementById("manualBackupSourceInput");
            const sourceText = document.getElementById("manualBackupSourceText");
            const parentPath = (world.path || "").replace(/[\\/][^\\/]+$/, "");

            if (sourceInput) sourceInput.value = parentPath || world.path || "";
            if (sourceText) sourceText.textContent = parentPath || world.path || "";

            if (info) {
                info.textContent = `${world.name} | ${formatBytes(world.total_bytes || 0)}`;
            }
        });

        list.appendChild(row);
    });

    const sourceInput = document.getElementById("manualBackupSourceInput");
    const sourceText = document.getElementById("manualBackupSourceText");
    const selectedParentPath =
        (manualBackupSelectedWorld.path || "").replace(/[\\/][^\\/]+$/, "");

    if (sourceInput) {
        sourceInput.value = selectedParentPath || manualBackupSelectedWorld.path || "";
    }

    if (sourceText) {
        sourceText.textContent = selectedParentPath || manualBackupSelectedWorld.path || "";
    }

    if (info) {
        info.textContent =
            `${manualBackupSelectedWorld.name} | ${formatBytes(manualBackupSelectedWorld.total_bytes || 0)}`;
    }
}


export async function openFolderPicker() {
    const response = await fetch("/api/backup/select-folder", {
        method: "POST"
    });

    const data = await response.json();

    if (!data.success || !data.path) {
        return "";
    }

    return data.path;
}


function setupBackupPathEditButtons() {
    document.querySelectorAll(".backup-path-edit-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const target = btn.dataset.target;

            const textEl = target === "source"
                ? document.getElementById("backupSourceRootText")
                : target === "manual-source"
                    ? document.getElementById("manualBackupSourceText")
                    : target === "manual-backup"
                        ? document.getElementById("manualBackupRootText")
                        : document.getElementById("backupRootText");

            const inputEl = target === "source"
                ? document.getElementById("backupSourceRootInput")
                : target === "manual-source"
                    ? document.getElementById("manualBackupSourceInput")
                    : target === "manual-backup"
                        ? document.getElementById("manualBackupRootInput")
                        : document.getElementById("backupRootInput");

            if (!textEl || !inputEl) return;

            btn.disabled = true;

            try {
                const path = await openFolderPicker();

                if (!path) {
                    return;
                }

                inputEl.value = path;
                textEl.textContent = path;

                if (target === "manual-source") {
                    await loadManualBackupWorlds(path);
                }

            } catch (error) {
                console.error("選擇資料夾失敗:", error);
                alert("選擇資料夾失敗，請查看 console。");
            } finally {
                btn.disabled = false;
            }
        });
    });
}


export async function loadBackupRecords() {
    try {
        const response = await fetch("/api/backup/records", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) return;

        backupRecordsCache = data.records || [];
        renderFilteredBackupRecords();

    } catch (error) {
        console.error("讀取備份紀錄失敗:", error);
    }
}


function renderBackupRecords(records) {
    const list = document.getElementById("backupRecordsList");
    if (!list) return;

    list.innerHTML = "";

    if (!records.length) {
        list.innerHTML = "<div class='backup-empty'>沒有符合條件的備份紀錄</div>";
        return;
    }

    records.forEach(record => {
        list.appendChild(createBackupRecordItem(record));
    });
}


function renderFilteredBackupRecords() {
    const keyword = backupRecordKeyword.trim().toLowerCase();

    const filtered = backupRecordsCache.filter((record) => {
        const providerKey = getBackupProviderKey(record);
        const statusKey = record.status || "unknown";

        if (backupProviderFilters.size > 0 && !backupProviderFilters.has(providerKey)) {
            return false;
        }

        if (backupStatusFilters.size > 0 && !backupStatusFilters.has(statusKey)) {
            return false;
        }

        if (!keyword) {
            return true;
        }

        const searchText = [
            record.status,
            getBackupStatusLabel(record.status),
            record.backup_type,
            providerKey,
            getCloudProviderLabel(record.cloud_provider),
            record.map_name,
            record.message,
            record.source_path,
            record.backup_path,
            record.cloud_account,
            record.cloud_file_id,
            record.cloud_link,
            record.cloud_file_status,
        ].join(" ").toLowerCase();

        return searchText.includes(keyword);
    });

    renderBackupRecords(filtered);
}


function getBackupProviderKey(record) {
    if ((record.backup_type || "local") === "local") {
        return "local";
    }

    return record.cloud_provider || "cloud";
}


export function prependBackupRecord(record) {
    if (!record) return;

    backupRecordsCache = [
        record,
        ...backupRecordsCache.filter(item => item.id !== record.id)
    ];

    renderFilteredBackupRecords();
}


function createBackupRecordItem(record) {
    const item = document.createElement("div");
    item.className = `backup-record-item ${record.status || ""}`;
    item.dataset.recordId = record.id;

    const statusText = getBackupStatusLabel(record.status);
    const sizeText = formatBytes(record.total_bytes || 0);
    const backupType = record.backup_type || "local";
    const providerIconHtml = getBackupProviderIconHtml(record);

    if (backupType === "cloud") {
        const providerText = getCloudProviderLabel(record.cloud_provider);
        const fileName = record.backup_path
            ? record.backup_path.split(/[\\/]/).pop()
            : "未知檔案";

        const linkHtml =
            record.cloud_file_status === "deleted"
                ? `<span class="cloud-link-deleted">已刪除的雲端備份</span>`
                : record.cloud_link
                    ? `<a class="cloud-link-active" href="${record.cloud_link}" target="_blank" rel="noopener noreferrer">開啟雲端備份</a>`
                    : `<span class="cloud-link-missing">沒有連結</span>`;

        item.innerHTML = `
            <div class="backup-record-main">
                <div class="backup-record-title">
                    ${statusText}｜${providerIconHtml} ${providerText}｜${record.map_name || "未知世界"}
                </div>
                <div class="backup-record-time">
                    ${record.created_at || ""}
                </div>
            </div>
            <div class="backup-record-message">
                ${record.message || ""}
            </div>
            <div class="backup-record-meta">
                帳號：${record.cloud_account || "未知"}
            </div>
            <div class="backup-record-meta">
                檔案：${fileName}
            </div>
            <div class="backup-record-meta">
                大小：${sizeText}
            </div>
            <div class="backup-record-path">
                連結：${linkHtml}
            </div>
        `;

        return item;
    }

    item.innerHTML = `
        <div class="backup-record-main">
            <div class="backup-record-title">
                ${statusText}｜${providerIconHtml} 本機｜${record.map_name || "未知世界"}
            </div>
            <div class="backup-record-time">
                ${record.created_at || ""}
            </div>
        </div>
        <div class="backup-record-message">
            ${record.message || ""}
        </div>
        <div class="backup-record-path">
            ${record.backup_path || ""}
        </div>
        <div class="backup-record-meta">
            檔案數：${record.total_files || 0}　大小：${sizeText}
        </div>
    `;

    return item;
}


function getBackupStatusLabel(status) {
    if (status === "success") return "成功";
    if (status === "failed") return "失敗";
    if (status === "canceled") return "已取消";
    if (status === "running") return "備份中";
    return "未知";
}


function getCloudProviderLabel(provider) {
    if (provider === "google_drive") return "Google Drive";
    return provider || "雲端";
}


function getBackupProviderIconHtml(record) {
    const providerKey = getBackupProviderKey(record);

    if (providerKey === "local") {
        return `
        <img class="backup-provider-img-icon" src="/static/icons/backup/grass_block.ico" alt="本機備份">`;
    }

    if (providerKey === "google_drive") {
        return `<img class="backup-provider-img-icon" src="/static/icons/backup/google_drive.ico" alt="Google Drive">`;
    }

    return `<span class="backup-provider-text-icon">☁</span>`;
}


export function formatBytes(bytes) {
    if (!bytes) return "0 B";

    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = Number(bytes);
    let index = 0;

    while (size >= 1024 && index < units.length - 1) {
        size /= 1024;
        index++;
    }

    return `${size.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}


function showBackupTaskButton(percent = 0) {
    const btn = document.getElementById("backupTaskBtn");
    const ring = document.getElementById("backupTaskProgressRing");

    if (!btn || !ring) return;

    btn.classList.remove("hidden");

    const circumference = 106.8;
    const offset = circumference - (circumference * percent / 100);
    ring.style.strokeDashoffset = offset;
}


function hideBackupTaskButton() {
    const btn = document.getElementById("backupTaskBtn");
    if (btn) btn.classList.add("hidden");
}


export function fadeOutAndHide(element, delay = 3000) {
    if (!element) return;

    element.style.opacity = "1";
    element.style.transition = "opacity 0.8s ease";

    setTimeout(() => {
        element.style.opacity = "0";

        setTimeout(() => {
            element.classList.add("hidden");
            element.style.opacity = "1";
        }, 800);

    }, delay);
}


export function isBackupEndStatus(data) {
    const status = String(data.status || "").toLowerCase();
    const message = String(data.message || "");

    return (
        status === "success" ||
        status === "failed" ||
        status === "canceled" ||
        status === "cancelled" ||
        status.includes("cancel") ||
        message.includes("取消")
    );
}


function setupManualProgressCancelButtons() {
    const localCancelBtn = document.getElementById("manualCancelBackupBtn");
    const cloudCancelBtn = document.getElementById("manualCancelCloudUploadBtn");

    if (localCancelBtn) {
        localCancelBtn.addEventListener("click", async () => {
            const ok = confirm("確定要取消目前的本機備份嗎？");
            if (!ok) return;

            localCancelBtn.disabled = true;
            await cancelManualBackup();
        });
    }

    if (cloudCancelBtn) {
        cloudCancelBtn.addEventListener("click", async () => {
            const ok = confirm("確定要取消目前的雲端上傳嗎？");
            if (!ok) return;

            cloudCancelBtn.disabled = true;
            await cancelGoogleDriveUpload();
        });
    }
}


export function updateBackupRecordItem(record) {
    if (!record || !record.id) return;

    backupRecordsCache = backupRecordsCache.map(item => {
        return item.id === record.id ? record : item;
    });

    if (!backupRecordsCache.some(item => item.id === record.id)) {
        backupRecordsCache.unshift(record);
    }

    renderFilteredBackupRecords();
}