
let isTransitioning = false;

async function updateLog() {
    try {
        const response = await fetch("/log", { cache: "no-store" });
        const data = await response.json();

        const logBox = document.getElementById("logBox");
        const wasNearBottom =
            logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

        logBox.textContent = data.logs;

        if (wasNearBottom) {
            logBox.scrollTop = logBox.scrollHeight;
        }
    } catch (error) {
        console.error("更新 log 失敗:", error);
    }
}

async function updateStatus() {
    try {
        const response = await fetch("/status", { cache: "no-store" });
        const data = await response.json();

        const statusLight = document.getElementById("statusLight");
        const statusText = document.getElementById("statusText");
        const powerBtn = document.getElementById("powerBtn");

        // 切換中時，不讓輪詢覆蓋畫面
        if (isTransitioning) {
            return;
        }

        if (data.online) {
            statusLight.classList.remove("offline");
            statusLight.classList.add("online");
            statusText.textContent = "在線";
        } else {
            statusLight.classList.remove("online");
            statusLight.classList.add("offline");
            statusText.textContent = "離線";
        }

        if (powerBtn) {
            if (data.online) {
                powerBtn.classList.remove("offline");
                powerBtn.classList.add("online");
            } else {
                powerBtn.classList.remove("online");
                powerBtn.classList.add("offline");
            }
        }

    } catch (error) {
        console.error("更新狀態失敗:", error);
    }
}

async function sendCommand() {
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");
    const command = input.value.trim();

    if (!command) {
        return;
    }

    input.disabled = true;
    button.disabled = true;

    try {
        const response = await fetch("/api/command", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ command })
        });

        const data = await response.json();

        if (!data.success) {
            alert("指令送出失敗：" + (data.message || "未知錯誤"));
            return;
        }

        input.value = "";

        // 送出指令後稍微等一下，再更新 log / status
        setTimeout(() => {
            updateLog();
            updateStatus();
        }, 300);

    } catch (error) {
        console.error("送出指令失敗:", error);
        alert("送出指令失敗，請查看 console。");
    } finally {
        input.disabled = false;
        button.disabled = false;
        input.focus();
    }
}


async function toggleServer() {
    const powerBtn = document.getElementById("powerBtn");

    if (isTransitioning || (powerBtn && powerBtn.disabled)) {
        return;
    }

    try {
        const statusRes = await fetch("/status", { cache: "no-store" });
        const statusData = await statusRes.json();

        let url = "";
        let targetOnline = false;
        let actionText = "";

        if (statusData.online) {
            url = "/api/server/stop";
            targetOnline = false;
            actionText = "關閉中...";
        } else {
            url = "/api/server/start";
            targetOnline = true;
            actionText = "啟動中...";
        }

        isTransitioning = true;
        setPowerButtonLoading(true, actionText);

        const response = await fetch(url, {
            method: "POST"
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message || "操作失敗");
            isTransitioning = false;
            setPowerButtonLoading(false);
            updateStatus();
            return;
        }

        const reachedTarget = await waitForServerStatus(targetOnline, 30000, 1000);

        isTransitioning = false;
        setPowerButtonLoading(false);

        await updateStatus();
        await updateLog();

        if (!reachedTarget) {
            alert(targetOnline ? "伺服器啟動逾時，請查看 log。" : "伺服器關閉逾時，請查看 log。");
        }

    } catch (error) {
        console.error("切換 server 失敗:", error);
        isTransitioning = false;
        setPowerButtonLoading(false);
        updateStatus();
    }
}

function setPowerButtonLoading(isLoading, actionText = "") {
    const powerBtn = document.getElementById("powerBtn");
    const statusText = document.getElementById("statusText");

    if (!powerBtn || !statusText) return;

    if (isLoading) {
        powerBtn.disabled = true;
        powerBtn.classList.add("loading");
        if (actionText) {
            statusText.textContent = actionText;
        }
    } else {
        powerBtn.disabled = false;
        powerBtn.classList.remove("loading");
    }
}

async function waitForServerStatus(targetOnline, timeoutMs = 30000, intervalMs = 1000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        try {
            const response = await fetch("/status", { cache: "no-store" });
            const data = await response.json();

            if (data.online === targetOnline) {
                return true;
            }
        } catch (error) {
            console.error("等待 server 狀態時發生錯誤:", error);
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    return false;
}


document.addEventListener("DOMContentLoaded", () => {
    // ===== 啟動server按鈕 =====
    const powerBtn = document.getElementById("powerBtn");
    if (powerBtn) {
        powerBtn.addEventListener("click", toggleServer);
    }


    // ===== 指令輸入 =====
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");

    if (button) {
        button.addEventListener("click", sendCommand);
    }

    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                sendCommand();
            }
        });
    }

    

    // ===== 定時更新 =====
    setInterval(updateLog, 2000);
    setInterval(updateStatus, 2000);

    // ===== 初始化 =====
    updateLog();
    updateStatus();
});