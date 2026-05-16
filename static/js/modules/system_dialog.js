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


function closeDialog(result) {

    const dialog =
        document.getElementById("systemDialog");

    if (!dialog) return;

    dialog.classList.add("hidden");

    if (currentResolver) {
        currentResolver(result);
        currentResolver = null;
    }
}


export function showConfirm({
    title = "確認",
    message = "",
    confirmText = "確定",
    cancelText = "取消",
    showCancel = true
}) {

    return new Promise((resolve) => {

        currentResolver = resolve;

        const dialog =
            document.getElementById("systemDialog");

        const titleBox =
            document.getElementById("systemDialogTitle");

        const messageBox =
            document.getElementById("systemDialogMessage");

        const cancelBtn =
            document.getElementById("systemDialogCancelBtn");

        const confirmBtn =
            document.getElementById("systemDialogConfirmBtn");

        titleBox.textContent = title;
        messageBox.textContent = message;

        confirmBtn.textContent = confirmText;
        cancelBtn.textContent = cancelText;

        cancelBtn.classList.toggle(
            "hidden",
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