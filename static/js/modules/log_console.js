export function appendLogLine(line) {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    const wasNearBottom =
        logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

    if (
        logBox.textContent === "伺服器尚未啟動" ||
        logBox.textContent === ""
    ) {
        logBox.textContent = line;
    } else {
        logBox.textContent += "\n" + line;
    }

    const lines = logBox.textContent.split("\n");
    if (lines.length > 500) {
        logBox.textContent = lines.slice(-500).join("\n");
    }

    if (wasNearBottom) {
        logBox.scrollTop = logBox.scrollHeight;
    }
}


export function clearLogBox(){
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.textContent = "伺服器尚未啟動";
}


export function scrollLogToBottom() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.scrollTop = logBox.scrollHeight;
}


export function initLogConsole() {
    const logBox = document.getElementById("logBox");
    if (logBox) {
        logBox.textContent = "伺服器尚未啟動";
    }
}