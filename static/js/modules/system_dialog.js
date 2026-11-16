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

    const dialog = document.getElementById("systemDialog");
    const panel = dialog.querySelector(".system-dialog-panel");
    const actions = panel.querySelector(".system-dialog-actions");
    dialog.classList.add("log-mode");
    const output = document.createElement("pre");
    output.className = "system-dialog-log system-dialog-extra";
    output.tabIndex = 0;
    output.textContent = log || "沒有可顯示的本次啟動日誌。";

    actions.before(output);

    const feedback = document.createElement("div");
    feedback.className = "system-dialog-log-feedback system-dialog-extra";
    feedback.setAttribute("role", "status");
    feedback.textContent = "可複製或匯出日誌，向AI或相關社群尋求協助。";

    actions.before(feedback);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "system-dialog-btn cancel system-dialog-extra";
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
    exportBtn.className = "system-dialog-btn cancel system-dialog-extra";
    exportBtn.textContent = "匯出log";
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


export async function showJavaSelection(loadOptions) {
    const result = showConfirm({
        title: "選擇其他 Java 重試",
        message: "正在掃描本機 Java，請稍候……",
        confirmText: "使用此版本開啟",
        cancelText: "取消",
        closeOnBackdrop: false,
    });
    const confirmBtn = document.getElementById("systemDialogConfirmBtn");
    const message = document.getElementById("systemDialogMessage");
    const actions = document.querySelector("#systemDialog .system-dialog-actions");
    confirmBtn.disabled = true;
    const container = document.createElement("div");
    container.className = "system-dialog-java system-dialog-extra";
    const label = document.createElement("label");
    label.textContent = "Java 版本";
    const select = document.createElement("select");
    select.id = "systemDialogJavaSelect";
    label.htmlFor = select.id;
    const path = document.createElement("div");
    path.className = "system-dialog-java-path";
    container.append(label, select, path);
    actions.before(container);
    let options = [];
    let attemptId = null;
    // 取消後掃描回應不得覆寫下一個視窗。
    let active = true;
    result.then(() => {
        active = false;
        confirmBtn.disabled = false;
    });
    loadOptions().then(data => {
        if (!active) return;
        if (!data.success) throw new Error(data.message || "無法掃描 Java。");
        options = data.options || [];
        attemptId = data.attempt_id;
        const requirement = data.required_java_version
            ? `伺服器需要 Java ${data.required_java_version} 或以上版本，請選擇符合需求的版本。`
            : "請選擇其他 Java 版本重試。";
        const hasSuitable = options.some(item => item.meets_java_requirement === true);
        message.textContent = options.length
            ? requirement + (data.required_java_version && !hasSuitable
                ? "\n尚未找到符合需求的版本，請安裝後再試。" : "")
            : requirement + "\n沒有找到可執行的 Java，請安裝後再試。";
        for (const item of options) {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = `Java ${item.version}`
                + (item.meets_java_requirement === true ? "（符合版本需求）" : "")
                + (item.meets_java_requirement === false ? "（版本不足）" : "")
                + (item.last_failed ? "（上次開啟失敗）" : "")
                + (item.is_default ? "［目前預設］" : "")
                + (item.vendor ? ` — ${item.vendor}` : "");
            select.append(option);
        }
        const suitable = options
            .filter(item => item.meets_java_requirement === true)
            .sort((a, b) => a.java_major - b.java_major);
        select.value = (
            suitable.find(item => !item.last_failed)
            || suitable[0]
            || options.find(item => !item.last_failed)
            || options[0]
        )?.id || "";
        const updatePath = () => {
            path.textContent = options.find(item => item.id === select.value)?.path || "";
        };
        select.addEventListener("change", updatePath);
        updatePath();
        confirmBtn.disabled = !options.length;
    }).catch(error => {
        if (active) message.textContent = error.message || "掃描 Java 失敗。";
    });
    const confirmed = await result;
    // closeDialog 會移除元素，但選取值仍可讀取。
    return confirmed && select.value
        ? { java_candidate_id: select.value, retry_attempt_id: attemptId }
        : null;
}

