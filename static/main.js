async function updateLog() {
    try {
        const response = await fetch("/log");
        const data = await response.json();

        const logBox = document.getElementById("logBox");
        logBox.textContent = data.logs;

        // 自動捲到最底
        logBox.scrollTop = logBox.scrollHeight;
    } catch (error) {
        console.error("更新 log 失敗:", error);
    }
}

// 頁面載入後每 2 秒更新一次
setInterval(updateLog, 2000);