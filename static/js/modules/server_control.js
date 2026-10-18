import {
    updateStatus
} from "./server_status.js";

import {
    saveServerSettings,
    updateServerSettingsFooterMode,
    loadServerSettings
} from "./server_settings.js";

import {
    showConfirm,
    showInfo
} from "./system_dialog.js";

import {
    updateUiServerState
} from "./server_ui_state.js";

let isTransitioning = false;


export function initServerControl() {
    const powerBtn = document.getElementById("powerBtn");
    if (powerBtn) {
        powerBtn.addEventListener("click", toggleServer);
    }

    setupEulaModal();
    checkEulaStatus();
    setupServerInitModal();
    checkFirstRunGuide();
}



async function confirmServerStartWarning(warnings) {
    if (!warnings?.length) {
        return true;
    }

    const isMultiple = warnings.length > 1;

    const title = isMultiple
        ? "偵測到多項資料錯誤"
        : `偵測到${warnings[0].label}資料錯誤`;

    const message = isMultiple
        ? (
            "目前偵測到多個錯誤：\n"
            + warnings.map(item =>
                `• ${item.label}（${item.file}）`
            ).join("\n")
            + "\n\n若繼續開啟，Minecraft "
            + "可能清空或重置異常資料。\n"
            + "確定仍要開啟伺服器？"
        )
        : warnings[0].message;

    return await showConfirm({
        title,
        message,
        confirmText: "仍要開啟",
        cancelText: "取消",
        variant: "warning",
    });
}



async function showServerStartWarning(warning) {
    if (!warning) return;

    await showInfo({
        title:
            warning.title
            || "伺服器啟動警告",

        message:
            warning.message
            || "伺服器啟動時偵測到資料異常。",

        confirmText: "關閉",
        variant: "warning",
    });
}



async function requestServerStart() {

    async function sendStartRequest({
        confirmOpsError = false,
        confirmWhitelistError = false,
    } = {}) {
        const response = await fetch(
            "/api/server/start",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    confirm_ops_error: confirmOpsError,
                    confirm_whitelist_error:
                        confirmWhitelistError,
                }),
            }
        );

        return await response.json();
    }

    // 第一次請求：取得全部啟動警告或阻擋資訊
    const data = await sendStartRequest();

    if (!data.requires_confirmation) {
        return data;
    }

    const warnings = data.warnings || [];

    if (
        !warnings.length
        || warnings.some(item =>
            !["ops", "whitelist"].includes(
                item.source
            )
        )
    ) {
        return {
            success: false,
            message: "伺服器啟動警告資料格式錯誤。",
        };
    }

    // 不論警告數量，一次確認
    const confirmed =
        await confirmServerStartWarning(warnings);

    if (!confirmed) {
        return {
            success: false,
            cancelled: true,
        };
    }

    // 第二次請求：只確認剛才顯示過的項目
    const result = await sendStartRequest({
        confirmOpsError:
            warnings.some(item =>
                item.source === "ops"
            ),

        confirmWhitelistError:
            warnings.some(item =>
                item.source === "whitelist"
            ),
    });

    // 如果確認期間出現新的警告，不直接略過
    if (result.requires_confirmation) {
        return {
            success: false,
            message: (
                "啟動檢查期間資料狀態發生變化，"
                + "請重新執行開啟伺服器。"
            ),
        };
    }

    return result;
}


async function toggleServer() {
    const powerBtn = document.getElementById("powerBtn");

    if (isTransitioning || (powerBtn && powerBtn.disabled)) {
        return;
    }

    try {
        const statusRes = await fetch("/api/server/query-status", { cache: "no-store" });
        const statusPayload = await statusRes.json();
        const statusData = statusPayload.data || statusPayload;

        let url = "";
        let targetOnline = false;
        let actionText = "";
        let setupStage = "";

        if (statusData.online) {

            const ok = await showConfirm({
                title: "關閉伺服器",
                message: "你是否要關閉伺服器？",
                confirmText: "關閉",
                cancelText: "取消"
            });

            if (!ok) {
                return;
            }

            url = "/api/server/stop";
            targetOnline = false;
            actionText = "關閉中...";

            window.dispatchEvent(new CustomEvent("server-status-changed", {
                detail: {
                    state: "stopping",
                    online: true,
                }
            }));

            updateUiServerState({
                state: "stopping",
                online: true,
            });

        } else {
            const setupStatus = await getServerSetupStatus();
            setupStage = setupStatus.stage;

            const eulaOk = await ensureEulaAcceptedBeforeStart();
            if (!eulaOk) {
                return;
            }

            url = "/api/server/start";
            targetOnline = true;
            actionText = "啟動中...";
        }

        isTransitioning = true;
        setPowerButtonLoading(true);

        let data;

        if (targetOnline) {
            data = await requestServerStart();

            if (data.cancelled) {
                isTransitioning = false;
                setPowerButtonLoading(false);
                return;
            }

        } else {
            const response = await fetch(
                url,
                {
                    method: "POST"
                }
            );

            data = await response.json();
        }

        if (!data.success) {
            await showInfo({
                title: data.start_blocked ? "無法開啟伺服器": "操作失敗",
                message:data.message || "未知錯誤",
                confirmText: "關閉",
                variant: data.start_blocked ? "error": "warning",
            });

            isTransitioning = false;
            setPowerButtonLoading(false);
            updateStatus();
            return;
        }

        let reachedTarget = false;
        let startupFailure = null;
        let startupWarning = null;

        if (targetOnline && setupStage === "need_first_run") {
            reachedTarget =
                await waitForFirstRunFilesGenerated(
                    30000,
                    1000
                );

        } else if (targetOnline) {
            const result = await waitForServerStartup();

            reachedTarget = result.ready;
            startupFailure = result.failure;
            startupWarning = result.warning || null;

        } else {
            reachedTarget = await waitForServerStatus(
                false,
                30000,
                1000
            );
        }

        isTransitioning = false;


        if (!reachedTarget) {
            setPowerButtonLoading(false);

            await showInfo({
                title:
                    startupFailure?.title
                    || (
                        targetOnline
                            ? "伺服器啟動逾時"
                            : "伺服器關閉逾時"
                    ),

                message:
                    startupFailure?.message
                    || "請查看伺服器 Log。",

                confirmText: "關閉",
                variant:
                    startupFailure
                        ? "error"
                        : "warning",
            });
        } else if (targetOnline && setupStage === "need_first_run") {
            await fetch("/api/server/sync-rcon", {
                method: "POST"
            });

            await showInfo({
                title: "初始化完成",
                message:
            `伺服器必要檔案已產生。\nRCON 設定已同步，請同意 Minecraft EULA 後再啟動伺服器。`
            });
            await checkEulaStatus();
        }else if (targetOnline && startupWarning) {
            await showServerStartWarning(startupWarning);
        }

    } catch (error) {
        console.error("切換 server 失敗:", error);
        isTransitioning = false;
        setPowerButtonLoading(false);
        updateStatus();
    }
}


export function setPowerButtonLoading(isLoading, actionText = "") {
    const powerBtn = document.getElementById("powerBtn");

    if (!powerBtn) return;

    if (isLoading) {
    powerBtn.disabled = true;
    powerBtn.classList.add("loading");

    } else {
        powerBtn.disabled = false;
        powerBtn.classList.remove("loading");
        powerBtn.title = "";
        
    }
}


export async function waitForServerStatus(targetOnline, timeoutMs = 30000, intervalMs = 500) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/api/server/status?force=1", {cache: "no-store"});
            const payload = await response.json();

            const data = payload.data || payload;

            if (targetOnline) {
                if (data.online === true && data.state === "ready") {
                    return true;
                }
            } else {
                if (data.online === false && data.state === "offline") {
                    return true;
                }
            }

        } catch (error) {
            console.error("等待 server 狀態時發生錯誤:", error);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}


async function waitForServerStartup(
    timeoutMs = 30000,
    intervalMs = 1000
) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const statusResponse = await fetch(
                "/api/server/status?force=1",
                { cache: "no-store" }
            );

            if (!statusResponse.ok) {
                throw new Error(
                    "無法取得伺服器狀態"
                );
            }

            const payload =
                await statusResponse.json();

            const status =
                payload.data || payload;

            if (
                status.online === true
                && status.state === "ready"
            ) {
                let warning = null;

                try {
                    const warningResponse = await fetch(
                        "/api/server/start-warning",
                        { cache: "no-store" }
                    );

                    if (warningResponse.ok) {
                        const warningData =
                            await warningResponse.json();

                        warning = warningData.warning || null;
                    }

                } catch (error) {
                    console.error(
                        "讀取伺服器啟動警告失敗:",
                        error
                    );
                }

                return {
                    ready: true,
                    failure: null,
                    warning: warning,
                };
            }

            const failureResponse = await fetch(
                "/api/server/start-failure",
                { cache: "no-store" }
            );

            if (failureResponse.ok) {
                const failureData =
                    await failureResponse.json();

                if (failureData.failure) {
                    return {
                        ready: false,
                        failure: failureData.failure,
                    };
                }
            }

        } catch (error) {
            console.error(
                "等待 Minecraft 啟動時發生錯誤:",
                error
            );
        }

        await new Promise(resolve =>
            setTimeout(resolve, intervalMs)
        );
    }

    return {
        ready: false,
        failure: null,
    };
}


async function checkEulaStatus() {
    try {
        const response = await fetch("/api/server/setup-status", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) {
            console.error("讀取 setup-status 失敗");
            return;
        }

        // 只有需要同意 EULA 時才顯示
        if (data.stage === "need_accept_eula") {

            const eulaRes = await fetch("/api/eula/status", {
                cache: "no-store"
            });

            const eulaData = await eulaRes.json();

            if (eulaData.success) {
                showEulaModal(eulaData);
            }
        }

    } catch (error) {
        console.error("檢查 EULA 失敗:", error);
    }
}


function showEulaModal(data) {
    const modal = document.getElementById("eulaModal");
    const message = document.getElementById("eulaMessage");
    const link = document.getElementById("eulaLink");
    const date = document.getElementById("eulaDate");

    if (!modal) return;

    if (message) {
        message.textContent = data.message_zh || "你必須同意 Minecraft EULA 才能繼續使用伺服器。";
    }

    if (link) {
        link.href = data.url || "https://aka.ms/MinecraftEULA";
        link.textContent = data.url || "https://aka.ms/MinecraftEULA";
    }

    if (date) {
        date.textContent = data.date ? `檔案建立時間：${data.date}` : "";
    }

    modal.classList.remove("hidden");
}


function showServerInitModal() {
    const modal = document.getElementById("serverInitModal");
    if (modal) {
        modal.classList.remove("hidden");
    }
}


function hideServerInitModal() {
    const modal = document.getElementById("serverInitModal");
    if (modal) {
        modal.classList.add("hidden");
    }
}


function setupServerInitModal() {
    const btn = document.getElementById("serverInitBtn");

    if (!btn) return;

    btn.addEventListener("click", async () => {
        hideServerInitModal();
        await toggleServer();
    });
}


function setupEulaModal() {
    const acceptBtn = document.getElementById("eulaAcceptBtn");
    const declineBtn = document.getElementById("eulaDeclineBtn");
    const modal = document.getElementById("eulaModal");

    if (acceptBtn) {
        acceptBtn.addEventListener("click", async () => {
            try {
                const response = await fetch("/api/eula/accept", {
                    method: "POST"
                });

                const data = await response.json();

                if (!data.success) {
                    await showInfo({
                        title: "同意 EULA 失敗",
                        message: data.message || "未知錯誤"
                    });
                    return;
                }

                if (modal) {
                    modal.classList.add("hidden");
                }

                await showInfo({
                    title: "EULA 已同意",
                    message: "現在可以啟動 Minecraft 伺服器。"
                });

            } catch (error) {
                console.error("同意 EULA 失敗:", error);
                alert("同意 EULA 失敗");
            }
        });
    }

    if (declineBtn) {
        declineBtn.addEventListener("click", async () => {
            try {
                await fetch("/api/app/shutdown", {
                    method: "POST"
                });
            } catch (error) {
                console.error("關閉 OxOcraft-Manager 失敗:", error);
            }

            const panel = document.querySelector(".eula-panel");
            if (panel) {
                panel.innerHTML = `
                    <div class="eula-title">OxOcraft-Manager 已關閉</div>
                    <div class="eula-message eula-closed-message">
                        未同意 Minecraft EULA，無法繼續使用管理介面。<br>
                        請手動關閉此瀏覽器分頁。
                    </div>
                `;
            }
        });
    }
}


async function ensureEulaAcceptedBeforeStart() {
    try {
        const response = await fetch("/api/server/setup-status", {
            cache: "no-store"
        });

        const data = await response.json();

        if (!data.success) {
            alert("檢查伺服器狀態失敗");
            return false;
        }

        if (data.stage === "ready") {
            return true;
        }

        if (data.stage === "need_first_run") {
            return true;
        }

        if (data.stage === "need_accept_eula") {
            const eulaRes = await fetch("/api/eula/status", {
                cache: "no-store"
            });

            const eulaData = await eulaRes.json();

            if (eulaData.success) {
                showEulaModal(eulaData);
            }

            await showInfo({
                title: "需要同意 EULA",
                message:
            "請先同意 Minecraft EULA 後再啟動伺服器。"
            });
            return false;
        }

        if (data.stage === "missing_server_jar") {
            alert(data.message);
            return false;
        }

        alert(data.message || "目前無法啟動伺服器");
        return false;

    } catch (error) {
        console.error("檢查啟動條件失敗:", error);
        alert("檢查啟動條件失敗");
        return false;
    }
}


async function getServerSetupStatus() {
    const response = await fetch("/api/server/setup-status", {
        cache: "no-store"
    });

    return await response.json();
}


async function waitForFirstRunFilesGenerated(timeoutMs = 30000, intervalMs = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/api/server/setup-status", {
                cache: "no-store"
            });

            const data = await response.json();

            if (
                data.eula_exists ||
                data.server_properties_exists ||
                data.stage === "need_accept_eula"
            ) {
                return true;
            }

        } catch (error) {
            console.error("等待初次啟動檔案產生時發生錯誤:", error);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}


async function checkFirstRunGuide() {
    try {
        const data = await getServerSetupStatus();

        if (data.stage === "need_first_run") {
            showServerInitModal();
        }

    } catch (error) {
        console.error(error);
    }
}


export async function saveAndRestartServer() {
    const ok = await showConfirm({
        title: "重新啟動伺服器",
        message:
            "若要讓變更立即生效，"
            + "需要重新啟動伺服器。\n\n"
            + "伺服器關閉後將檢查啟動資料。"
            + "若發現錯誤並取消開啟，"
            + "伺服器將保持離線。",

        confirmText: "重新啟動",
        cancelText: "取消",
    });

    if (!ok) {
        return;
    }

    const restartBtn = document.getElementById("serverSettingsRestartBtn");
    const applyBtn = document.getElementById("serverSettingsApplyBtn");

    // if (restartBtn) {
    //     restartBtn.disabled = true;
    //     restartBtn.textContent = "重啟中...";
    // }

    // if (applyBtn) {
    //     applyBtn.disabled = true;
    // }

    try {
        const saved = await saveServerSettings(false);

        if (!saved) {
            return;
        }

        setPowerButtonLoading(true);

        let response = await fetch("/api/server/stop", {
            method: "POST"
        });

        let data = await response.json();

        if (!data.success) {
            alert(data.message || "關閉伺服器失敗");
            return;
        }

        const stopped = await waitForServerStatus(false, 30000, 1000);
        if (!stopped) {
            alert("伺服器關閉逾時，請查看 log。");
            return;
        }

        setPowerButtonLoading(true);

        data = await requestServerStart();

        if (data.cancelled) {
            return;
        }

        if (!data.success) {
            await showInfo({
                title: data.start_blocked
                    ? "無法開啟伺服器"
                    : "啟動伺服器失敗",

                message:
                    data.message || "未知錯誤",

                confirmText: "關閉",
                variant: "error",
            });
            return;
        }

        const startResult = await waitForServerStartup();
        const started = startResult.ready;

        await updateStatus();

        if (started) {
            await loadServerSettings();

            if (startResult.warning) {
                await showServerStartWarning(
                    startResult.warning
                );
            } else {
                await showInfo({
                    title: "重新啟動完成",
                    message:
                        "設定已套用，伺服器已重新啟動。",
                });
            }
        } else {
            await showInfo({
                title:
                    startResult.failure?.title
                    || "伺服器啟動逾時",

                message:
                    startResult.failure?.message
                    || "請查看伺服器 Log。",

                confirmText: "關閉",
                variant: "error",
            });
        }

    } catch (error) {
        console.error("套用並重啟失敗:", error);
        alert("套用並重啟失敗，請查看 console。");

        
    } finally {
        // 重啟流程結束後，依實際狀態恢復電源按鈕
        try {
            const response = await fetch("/api/server/status?force=1",{ cache: "no-store" });

            if (response.ok) {
                const payload = await response.json();
                const status = payload.data || payload;

                if (
                    status.state === "offline"
                    || status.state === "ready"
                ) {
                    setPowerButtonLoading(false);
                }
            }

        } catch (error) {
            console.error("重新啟動後更新電源按鈕失敗:",error);
        }

        await updateServerSettingsFooterMode();
    }


}