import { scrollLogToBottom } from "./log_console.js";

let commandHistory = [];
let commandHistoryIndex = -1;

async function sendCommand() {
    const input = document.getElementById("commandInput");
    const button = document.getElementById("sendCommandBtn");
    const command = input.value.trim();

    if (!command) return;

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

        if (commandHistory[commandHistory.length - 1] !== command) {
            commandHistory.push(command);
        }

        commandHistoryIndex = commandHistory.length;
        input.value = "";
        scrollLogToBottom();

    } catch (error) {
        console.error("送出指令失敗:", error);
        alert("送出指令失敗，請查看 console。");
    } finally {
        input.disabled = false;
        button.disabled = false;
        input.focus();
    }
}

export function initCommandConsole() {
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
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();

                if (commandHistory.length === 0) return;

                if (commandHistoryIndex > 0) {
                    commandHistoryIndex--;
                } else {
                    commandHistoryIndex = 0;
                }

                input.value = commandHistory[commandHistoryIndex] || "";
                input.setSelectionRange(input.value.length, input.value.length);
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();

                if (commandHistory.length === 0) return;

                if (commandHistoryIndex < commandHistory.length - 1) {
                    commandHistoryIndex++;
                    input.value = commandHistory[commandHistoryIndex] || "";
                } else {
                    commandHistoryIndex = commandHistory.length;
                    input.value = "";
                }

                input.setSelectionRange(input.value.length, input.value.length);
            }
        });
    }
}