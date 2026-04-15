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

        if (data.online) {
            statusLight.classList.remove("offline");
            statusLight.classList.add("online");
            statusText.textContent = "在線";
        } else {
            statusLight.classList.remove("online");
            statusLight.classList.add("offline");
            statusText.textContent = "離線";
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

document.addEventListener("DOMContentLoaded", () => {
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");

    button.addEventListener("click", sendCommand);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendCommand();
        }
    });

    setInterval(updateLog, 2000);
    setInterval(updateStatus, 2000);

    updateLog();
    updateStatus();
});