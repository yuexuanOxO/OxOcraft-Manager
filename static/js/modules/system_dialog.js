let currentResolver = null;
let allowBackdropClose = true;


export function initSystemDialog() {

    const dialog =
        document.getElementById("systemDialog");

    const cancelBtn =
        document.getElementById("systemDialogCancelBtn");

    const confirmBtn =
        document.getElementById("systemDialogConfirmBtn");

    if (!dialog || !cancelBtn || !confirmBtn) {
        return;
    }

    cancelBtn.addEventListener("click", () => {
        closeDialog(false);
    });

    confirmBtn.addEventListener("click", () => {
        closeDialog(true);
    });

    dialog.addEventListener("click", (event) => {
        if (
            event.target === dialog &&
            allowBackdropClose
        ) {
            closeDialog(false);
        }
    });
}


function cleanupDialogExtras() {

    document.getElementById("systemDialog")?.classList.remove("log-mode");

    document
        .querySelectorAll(".system-dialog-extra")
        .forEach(element => {
            element.remove();
        });
}


function closeDialog(result) {

    const dialog = document.getElementById("systemDialog");

    if (!dialog) return;

    cleanupDialogExtras();
    dialog.classList.add("hidden");
    dialog.classList.remove("single-action");

    const panel = dialog.querySelector(".system-dialog-panel");
    const messageBox = document.getElementById("systemDialogMessage");
    const helpSections = document.getElementById("systemDialogHelpSections");

    panel?.classList.remove("help-mode");

    messageBox?.classList.remove("hidden");

    helpSections?.classList.add("hidden");

    const confirmBtn = document.getElementById("systemDialogConfirmBtn");

    confirmBtn?.classList.remove("hidden");

    if (helpSections) {
        helpSections.innerHTML = "";
    }

    if (currentResolver) {
        currentResolver(result);
        currentResolver = null;
    }

    allowBackdropClose = true;

}


export function showConfirm({
    title = "確認",
    message = "",
    icon = "",
    confirmText = "確定",
    cancelText = "取消",
    showCancel = true,
    variant = "",
    closeOnBackdrop = true
}) {

    return new Promise((resolve) => {

        cleanupDialogExtras();

        allowBackdropClose = closeOnBackdrop;

        currentResolver = resolve;
        const dialog = document.getElementById("systemDialog");
        const titleBox = document.getElementById("systemDialogTitle");
        const titleIcon = document.getElementById("systemDialogTitleIcon");
        const messageBox = document.getElementById("systemDialogMessage");
        const cancelBtn = document.getElementById("systemDialogCancelBtn");
        const confirmBtn = document.getElementById("systemDialogConfirmBtn");

        titleBox.textContent = title;

        if (icon) {
            titleIcon.src = icon;
            titleIcon.classList.remove("hidden");
        } else {
            titleIcon.src = "";
            titleIcon.classList.add("hidden");
        }

        titleBox.classList.remove(
            "success",
            "error",
            "warning"
        );

        if (variant) {
            titleBox.classList.add(variant);
        }

        messageBox.textContent = message;

        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        cancelBtn.classList.toggle(
            "hidden",
            !showCancel
        );

        dialog.classList.toggle(
            "single-action",
            !showCancel
        );

        dialog.classList.remove("hidden");
    });
}


export async function showInfo(options) {

    return showConfirm({
        ...options,
        showCancel: false
    });
}


export async function showHelp({
    title = "說明",
    icon = "",
    sections = [],
    confirmText = "關閉"
}) {

    return new Promise((resolve) => {

        cleanupDialogExtras();

        currentResolver = resolve;

        const dialog = document.getElementById("systemDialog");
        const panel = dialog.querySelector(".system-dialog-panel");
        const titleBox = document.getElementById("systemDialogTitle");
        const titleIcon = document.getElementById("systemDialogTitleIcon");
        const messageBox = document.getElementById("systemDialogMessage");
        const helpSections = document.getElementById("systemDialogHelpSections");
        const cancelBtn = document.getElementById("systemDialogCancelBtn");
        const confirmBtn = document.getElementById("systemDialogConfirmBtn");

        panel.classList.add("help-mode");

        titleBox.textContent = title;

        if (icon) {
            titleIcon.src = icon;
            titleIcon.classList.remove("hidden");
        } else {
            titleIcon.src = "";
            titleIcon.classList.add("hidden");
        }

        messageBox.classList.add("hidden");

        helpSections.classList.remove("hidden");

        helpSections.innerHTML = sections.map(section => `
        <div class="system-dialog-help-section">
            <div class="system-dialog-help-section-title">${section.title || ""}</div>
            <div class="system-dialog-help-section-content">${section.content || ""}</div>
        </div>
        `).join("");

        confirmBtn.textContent = confirmText;

        cancelBtn.classList.add("hidden");
        confirmBtn.classList.add("hidden");

        dialog.classList.remove("hidden");
    });
}


export function showLogInfo({
    title = "伺服器啟動失敗",
    message = "",
    log = "",
    logNote = "",
}) {
    const result = showInfo({
        title,
        message: [message, logNote]
            .filter(Boolean)
            .join("\n\n"),
        confirmText: "關閉",
        variant: "error",
        closeOnBackdrop: false,
    });

    const dialog =
        document.getElementById("systemDialog");

    const panel =
        dialog.querySelector(".system-dialog-panel");

    const actions =
        panel.querySelector(".system-dialog-actions");

    dialog.classList.add("log-mode");

    const output = document.createElement("pre");
    output.className =
        "system-dialog-log system-dialog-extra";
    output.tabIndex = 0;
    output.textContent =
        log || "沒有可顯示的本次啟動日誌。";

    actions.before(output);

    const feedback = document.createElement("div");
    feedback.className =
        "system-dialog-log-feedback system-dialog-extra";
    feedback.setAttribute("role", "status");
    feedback.textContent =
        "可複製或匯出日誌，向 AI 或相關社群尋求協助。";

    actions.before(feedback);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className =
        "system-dialog-btn cancel system-dialog-extra";
    copyBtn.textContent = "複製全部";
    copyBtn.disabled = !log;

    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(log);

            if (feedback.isConnected) {
                feedback.textContent = "已複製全部日誌。";
            }
        } catch {
            if (!output.isConnected) return;

            const range = document.createRange();
            range.selectNodeContents(output);

            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);

            feedback.textContent =
                "無法自動複製，已選取日誌，請按 Ctrl+C 複製。";
        }
    };

    const exportBtn = document.createElement("button");
    exportBtn.type = "button";
    exportBtn.className =
        "system-dialog-btn cancel system-dialog-extra";
    exportBtn.textContent = "匯出 log";
    exportBtn.disabled = !log;

    exportBtn.onclick = () => {
        const url = URL.createObjectURL(
            new Blob(
                [log],
                { type: "text/plain;charset=utf-8" }
            )
        );

        const link = document.createElement("a");
        link.href = url;
        link.download = "server-start-failure.log";

        document.body.append(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    actions.prepend(copyBtn, exportBtn);

    return result;
}