let currentResolver = null;

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

        if (event.target === dialog) {
            closeDialog(false);
        }
    });
}


function cleanupDialogExtras() {
    document
        .querySelectorAll(".system-dialog-extra")
        .forEach(element => {
            element.remove();
        });
}


function closeDialog(result) {

    const dialog =
        document.getElementById("systemDialog");

    if (!dialog) return;

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
}


export function showConfirm({
    title = "確認",
    message = "",
    icon = "",
    confirmText = "確定",
    cancelText = "取消",
    showCancel = true,
    variant = ""
}) {

    return new Promise((resolve) => {

        cleanupDialogExtras();

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