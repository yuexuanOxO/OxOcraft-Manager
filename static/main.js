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

        // 如果正在 loading，就不要覆蓋文字
        if (powerBtn && powerBtn.classList.contains("loading")) {
            return;
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

    if (powerBtn && powerBtn.disabled) {
        return;
    }

    try {
        const statusRes = await fetch("/status", { cache: "no-store" });
        const statusData = await statusRes.json();

        let url = "";

        if (statusData.online) {
            url = "/api/server/stop";
            setPowerButtonLoading(true, "關閉中...");
        } else {
            url = "/api/server/start";
            setPowerButtonLoading(true, "啟動中...");
        }

        const response = await fetch(url, {
            method: "POST"
        });

        const data = await response.json();

        if (!data.success) {
            alert(data.message);
            setPowerButtonLoading(false);
            updateStatus();
            return;
        }

        // 等一下讓 server 狀態有時間更新
        setTimeout(() => {
            updateStatus();
            updateLog();
            setPowerButtonLoading(false);
        }, 1000);

    } catch (error) {
        console.error("切換 server 失敗:", error);
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