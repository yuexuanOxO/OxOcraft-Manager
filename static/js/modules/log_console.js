export function appendLogLine(line) {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    const wasNearBottom =
        logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

    if (
        isOfflineCatVisible(logBox) ||
        logBox.textContent === "伺服器尚未啟動" ||
        logBox.textContent.trim() === ""
    ) {
        logBox.textContent = line;
    } else {
        logBox.textContent = logBox.textContent.trimEnd() + "\n" + line;
    }

    const lines = logBox.textContent.split("\n");
    if (lines.length > 500) {
        logBox.textContent = lines.slice(-500).join("\n");
    }

    if (wasNearBottom) {
        logBox.scrollTop = logBox.scrollHeight;
    }
}



export function scrollLogToBottom() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.scrollTop = logBox.scrollHeight;
}


export function initLogConsole() {
}


function getRandomCatSrc() {
    const index = Math.floor(Math.random() * 11) + 1;
    return `/static/img/cats/cat_sleep${index}.png`;
}

export function showOfflineCat() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.innerHTML = `
        <div class="offline-log-placeholder">
            <img class="offline-cat-img" src="${getRandomCatSrc()}" alt="sleeping cat">
            <div class="offline-log-text">伺服器正在休息中...</div>
        </div>
    `;
}

function isOfflineCatVisible(logBox) {
    return logBox.querySelector(".offline-log-placeholder") !== null;
}

export function clearLogTextOnly() {
    const logBox = document.getElementById("logBox");
    if (!logBox) return;

    logBox.textContent = "";
}