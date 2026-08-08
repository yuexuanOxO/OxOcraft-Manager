import {
    showConfirm,
    showInfo,
} from "./system_dialog.js";

import {
    latestServerStatusData,
} from "./server_status.js";


const DEFAULT_WORLD_ICON_URL = "/static/icons/server_settings/default_server_icon.png";

let loadedWorlds = [];
let selectedWorldFolderName = null;
let worldIconCacheKey = Date.now();

let worldListLoaded = false;
let worldSettingsServerState = null;

let createWorldSubmitting = false;


export function initWorldSettings() {
    const openBtn =
        document.getElementById(
            "worldSettingsBtn"
        );

    const modal =
        document.getElementById(
            "worldSettingsModal"
        );

    if (!openBtn || !modal) {
        return;
    }

    setupWorldListSelection();
    setupWorldArchiveSearch();
    setupCreateWorldModal();

    window.addEventListener(
        "server-status-changed",
        handleWorldSettingsServerStateChanged
    );

    window.addEventListener(
        "server-ui-state-changed",
        handleWorldSettingsServerStateChanged
    );

    if (latestServerStatusData?.state) {
        worldSettingsServerState =
            latestServerStatusData.state;
    }

    updateWorldCreateAvailability();

    openBtn.addEventListener(
        "click",
        async () => {
            modal.classList.remove(
                "hidden"
            );

            if (
                latestServerStatusData?.state
            ) {
                worldSettingsServerState =
                    latestServerStatusData.state;
            }

            updateWorldCreateAvailability();

            await loadWorlds();
        }
    );

    modal.addEventListener(
        "click",
        event => {
            if (event.target !== modal) {
                return;
            }

            closeCreateWorldModal();

            modal.classList.add(
                "hidden"
            );
        }
    );
}


function handleWorldSettingsServerStateChanged(
    event
) {
    const state =
        typeof event.detail?.state === "string"
            ? event.detail.state
            : null;

    if (!state) {
        return;
    }

    worldSettingsServerState = state;

    updateWorldCreateAvailability();
    updateCreateWorldSubmitAvailability();
}


function updateWorldCreateAvailability() {
    const createButton =
        document.getElementById(
            "worldSettingsCreateBtn"
        );

    if (!createButton) {
        return;
    }

    const pendingWorld =
        loadedWorlds.find(
            world =>
                world.is_pending_generation
                === true
        ) || null;

    const isOffline =
        worldSettingsServerState
        === "offline";

    const canCreate =
        worldListLoaded
        && isOffline
        && !pendingWorld;

    createButton.disabled = !canCreate;

    if (!worldListLoaded) {
        createButton.title =
            "請等待世界清單載入完成";

    } else if (!isOffline) {
        createButton.title =
            "只有伺服器完全離線時才能建立新世界";

    } else if (pendingWorld) {
        createButton.title =
            `目前已有待生成世界：`
            + `${pendingWorld.folder_name}`;

    } else {
        createButton.removeAttribute(
            "title"
        );
    }
}


function setupCreateWorldModal() {
    const openButton =
        document.getElementById(
            "worldSettingsCreateBtn"
        );

    const createModal =
        document.getElementById(
            "worldSettingsCreateModal"
        );

    const closeButton =
        document.getElementById(
            "worldSettingsCreateCloseBtn"
        );

    const cancelButton =
        document.getElementById(
            "worldSettingsCreateCancelBtn"
        );

    const form =
        document.getElementById(
            "worldSettingsCreateForm"
        );

    const advancedToggle =
        document.getElementById(
            "worldSettingsCreateAdvancedToggle"
        );

    const advancedContent =
        document.getElementById(
            "worldSettingsCreateAdvanced"
        );

    if (
        !openButton
        || !createModal
        || !closeButton
        || !cancelButton
        || !form
        || !advancedToggle
        || !advancedContent
    ) {
        return;
    }

    openButton.addEventListener(
        "click",
        () => {
            if (openButton.disabled) {
                return;
            }

            openCreateWorldModal();
        }
    );

    closeButton.addEventListener(
        "click",
        closeCreateWorldModal
    );

    cancelButton.addEventListener(
        "click",
        closeCreateWorldModal
    );

    createModal.addEventListener(
        "click",
        event => {
            if (event.target === createModal) {
                closeCreateWorldModal();
            }
        }
    );

    advancedToggle.addEventListener(
        "click",
        () => {
            const shouldOpen =
                advancedContent.classList
                    .contains("hidden");

            advancedContent.classList.toggle(
                "hidden",
                !shouldOpen
            );

            advancedToggle.setAttribute(
                "aria-expanded",
                String(shouldOpen)
            );
        }
    );

    document
        .querySelectorAll(
            ".world-settings-create-switch"
        )
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const nextValue =
                        button.getAttribute(
                            "aria-pressed"
                        ) !== "true";

                    setCreateWorldSwitch(
                        button,
                        nextValue
                    );

                    updateCreateWorldSubmitAvailability();
                }
            );
        });

    form.addEventListener(
        "input",
        () => {
            clearCreateWorldError();
            updateCreateWorldSubmitAvailability();
        }
    );

    form.addEventListener(
        "change",
        () => {
            clearCreateWorldError();
            updateCreateWorldSubmitAvailability();
        }
    );

    form.addEventListener(
        "submit",
        async event => {
            event.preventDefault();

            await submitCreateWorldForm();
        }
    );

    document.addEventListener(
        "keydown",
        event => {
            if (
                event.key !== "Escape"
                || createModal.classList
                    .contains("hidden")
            ) {
                return;
            }

            event.preventDefault();
            closeCreateWorldModal();
        }
    );
}


function openCreateWorldModal() {
    const createModal =
        document.getElementById(
            "worldSettingsCreateModal"
        );

    const nameInput =
        document.getElementById(
            "worldSettingsCreateName"
        );

    if (!createModal) {
        return;
    }

    resetCreateWorldForm();

    updateCreateWorldSubmitAvailability();

    createModal.classList.remove(
        "hidden"
    );

    createModal.setAttribute(
        "aria-hidden",
        "false"
    );

    window.requestAnimationFrame(() => {
        nameInput?.focus();
    });
}


function closeCreateWorldModal() {
    const createModal =
        document.getElementById(
            "worldSettingsCreateModal"
        );

    if (!createModal) {
        return;
    }

    createModal.classList.add(
        "hidden"
    );

    createModal.setAttribute(
        "aria-hidden",
        "true"
    );
}


function resetCreateWorldForm() {
    const form =
        document.getElementById(
            "worldSettingsCreateForm"
        );

    const structuresSwitch =
        document.getElementById(
            "worldSettingsCreateStructuresSwitch"
        );

    const hardcoreSwitch =
        document.getElementById(
            "worldSettingsCreateHardcoreSwitch"
        );

    const advancedToggle =
        document.getElementById(
            "worldSettingsCreateAdvancedToggle"
        );

    const advancedContent =
        document.getElementById(
            "worldSettingsCreateAdvanced"
        );

    const errorBox =
        document.getElementById(
            "worldSettingsCreateError"
        );

    createWorldSubmitting = false;

    form?.reset();

    setCreateWorldSwitch(
        structuresSwitch,
        true
    );

    setCreateWorldSwitch(
        hardcoreSwitch,
        false
    );

    advancedContent?.classList.add(
        "hidden"
    );

    advancedToggle?.setAttribute(
        "aria-expanded",
        "false"
    );

    if (errorBox) {
        errorBox.textContent = "";
        errorBox.classList.add(
            "hidden"
        );
    }
}


function validateCreateWorldForm() {
    const form =
        document.getElementById(
            "worldSettingsCreateForm"
        );

    if (!form) {
        return {
            valid: false,
            message: "找不到建立世界表單",
        };
    }

    if (!worldListLoaded) {
        return {
            valid: false,
            message: "世界清單尚未載入完成",
        };
    }

    if (
        worldSettingsServerState
        !== "offline"
    ) {
        return {
            valid: false,
            message:
                "只有伺服器完全離線時"
                + "才能建立新世界",
        };
    }

    const pendingWorld =
        loadedWorlds.find(
            world =>
                world.is_pending_generation
                === true
        );

    if (pendingWorld) {
        return {
            valid: false,
            message:
                `目前已有待生成世界：`
                + `${pendingWorld.folder_name}`,
        };
    }

    const formData =
        new FormData(form);

    const worldName =
        normalizeText(
            String(
                formData.get(
                    "level-name"
                ) || ""
            )
        );

    if (!worldName) {
        return {
            valid: false,
            message: "請輸入世界名稱",
        };
    }

    if (worldName.length > 128) {
        return {
            valid: false,
            message:
                "世界名稱不能超過 "
                + "128 個字元",
        };
    }

    const seed =
        String(
            formData.get(
                "level-seed"
            ) || ""
        );

    if (seed.length > 128) {
        return {
            valid: false,
            message:
                "世界種子碼不能超過 "
                + "128 個字元",
        };
    }

    const generatorSettingsText =
        String(
            formData.get(
                "generator-settings"
            ) || ""
        ).trim();

    let generatorSettings;

    try {
        generatorSettings =
            JSON.parse(
                generatorSettingsText
                || "{}"
            );

    } catch {
        return {
            valid: false,
            message:
                "世界生成設定不是合法 JSON",
        };
    }

    if (
        typeof generatorSettings
            !== "object"
        || generatorSettings === null
        || Array.isArray(
            generatorSettings
        )
    ) {
        return {
            valid: false,
            message:
                "世界生成設定必須是 JSON 物件",
        };
    }

    return {
        valid: true,
        message: "",
    };
}


function buildCreateWorldPayload() {
    const form =
        document.getElementById(
            "worldSettingsCreateForm"
        );

    if (!form) {
        return null;
    }

    const formData =
        new FormData(form);

    const generatorSettingsText =
        String(
            formData.get(
                "generator-settings"
            ) || ""
        ).trim();

    return {
        "level-name":
            normalizeText(
                String(
                    formData.get(
                        "level-name"
                    ) || ""
                )
            ),

        "level-seed":
            String(
                formData.get(
                    "level-seed"
                ) || ""
            ),

        "level-type":
            String(
                formData.get(
                    "level-type"
                ) || "minecraft:normal"
            ),

        "generator-settings":
            JSON.parse(
                generatorSettingsText
                || "{}"
            ),

        "generate-structures":
            String(
                formData.get(
                    "generate-structures"
                )
            ) === "true",

        "hardcore":
            String(
                formData.get(
                    "hardcore"
                )
            ) === "true",

        "initial-enabled-packs":
            String(
                formData.get(
                    "initial-enabled-packs"
                ) || ""
            ).trim(),

        "initial-disabled-packs":
            String(
                formData.get(
                    "initial-disabled-packs"
                ) || ""
            ).trim(),
    };
}


function updateCreateWorldSubmitAvailability() {
    const submitButton =
        document.getElementById(
            "worldSettingsCreateSubmitBtn"
        );

    if (!submitButton) {
        return;
    }

    if (createWorldSubmitting) {
        submitButton.disabled = true;
        return;
    }

    const validation =
        validateCreateWorldForm();

    submitButton.disabled =
        !validation.valid;
}


function showCreateWorldError(
    message
) {
    const errorBox =
        document.getElementById(
            "worldSettingsCreateError"
        );

    if (!errorBox) {
        return;
    }

    errorBox.textContent =
        message || "建立世界失敗";

    errorBox.classList.remove(
        "hidden"
    );
}


function clearCreateWorldError() {
    const errorBox =
        document.getElementById(
            "worldSettingsCreateError"
        );

    if (!errorBox) {
        return;
    }

    errorBox.textContent = "";

    errorBox.classList.add(
        "hidden"
    );
}


function setCreateWorldSubmitting(
    submitting
) {
    createWorldSubmitting =
        submitting;

    const submitButton =
        document.getElementById(
            "worldSettingsCreateSubmitBtn"
        );

    if (!submitButton) {
        return;
    }

    submitButton.textContent =
        submitting
            ? "建立中..."
            : "建立世界";

    updateCreateWorldSubmitAvailability();
}


async function submitCreateWorldForm() {
    if (createWorldSubmitting) {
        return;
    }

    clearCreateWorldError();

    const validation =
        validateCreateWorldForm();

    if (!validation.valid) {
        showCreateWorldError(
            validation.message
        );

        updateCreateWorldSubmitAvailability();
        return;
    }

    const payload =
        buildCreateWorldPayload();

    if (!payload) {
        showCreateWorldError(
            "無法讀取建立世界表單"
        );

        return;
    }

    setCreateWorldSubmitting(
        true
    );

    try {
        const response =
            await fetch(
                "/api/worlds",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                    },

                    body:
                        JSON.stringify(
                            payload
                        ),

                    cache: "no-store",
                }
            );

        let data = null;

        try {
            data =
                await response.json();

        } catch {
            data = null;
        }

        if (
            !response.ok
            || !data?.success
        ) {
            throw new Error(
                data?.message
                || "建立新世界失敗"
            );
        }

        closeCreateWorldModal();

        await loadWorlds();

        await showInfo({
            title: "世界建立完成",
            message:
                data.message
                || (
                    `已建立待生成世界：`
                    + `${payload["level-name"]}`
                ),
            variant: "success",
            confirmText: "確定",
        });

    } catch (error) {
        console.error(
            "建立新世界失敗：",
            error
        );

        clearCreateWorldError();

        await showInfo({
            title: "建立世界失敗",
            message:
                error.message
                || "無法建立新世界",
            variant: "error",
            confirmText: "確定",
        });

    } finally {
        setCreateWorldSubmitting(
            false
        );
    }
}


function setCreateWorldSwitch(
    button,
    enabled
) {
    if (!button) {
        return;
    }

    const inputId =
        button.dataset.inputId;

    const input =
        inputId
            ? document.getElementById(
                inputId
            )
            : null;

    const text =
        button.querySelector(
            ".setting-switch-text"
        );

    button.classList.toggle(
        "on",
        enabled
    );

    button.classList.toggle(
        "off",
        !enabled
    );

    button.setAttribute(
        "aria-pressed",
        String(enabled)
    );

    if (input) {
        input.value =
            enabled
                ? "true"
                : "false";
    }

    if (text) {
        text.textContent =
            enabled
                ? button.dataset.onLabel
                : button.dataset.offLabel;
    }
}


function setupWorldListSelection() {
    const archiveList =
        document.getElementById(
            "worldSettingsArchiveList"
        );

    if (!archiveList) {
        return;
    }

    archiveList.addEventListener(
        "click",
        event => {
            const selectedItem =
                event.target.closest(
                    ".world-settings-world-item"
                );

            if (
                !selectedItem ||
                !archiveList.contains(selectedItem)
            ) {
                return;
            }

            selectWorld(
                selectedItem.dataset.worldFolderName
            );
        }
    );

    archiveList.addEventListener(
        "keydown",
        event => {
            if (
                event.key !== "Enter"
                && event.key !== " "
            ) {
                return;
            }

            if (
                event.target.closest(
                    ".world-settings-world-item-actions"
                )
            ) {
                return;
            }

            const selectedItem =
                event.target.closest(
                    ".world-settings-world-item"
                );

            if (!selectedItem) {
                return;
            }

            event.preventDefault();

            selectWorld(
                selectedItem.dataset.worldFolderName
            );
        }
    );

}


function setupWorldArchiveSearch() {
    const searchInput =
        document.getElementById(
            "worldSettingsSearchInput"
        );

    const searchButton =
        document.getElementById(
            "worldSettingsSearchBtn"
        );

    if (
        !searchInput ||
        !searchButton
    ) {
        return;
    }

    const executeSearch = () => {
        filterWorldArchiveList(
            searchInput.value
        );
    };

    searchButton.addEventListener(
        "click",
        executeSearch
    );

    searchInput.addEventListener(
        "keydown",
        event => {
            if (event.key !== "Enter") {
                return;
            }

            event.preventDefault();
            executeSearch();
        }
    );
}


function filterWorldArchiveList(
    searchValue
) {
    const query =
        normalizeText(
            searchValue
        ).toLocaleLowerCase();

    const filteredWorlds = query
        ? loadedWorlds.filter(world => {
            const folderName =
                normalizeText(
                    world.folder_name
                ).toLocaleLowerCase();

            return folderName.includes(query);
        })
        : loadedWorlds;

    renderWorldArchiveList(
        filteredWorlds,
        query.length > 0
    );

    if (filteredWorlds.length === 0) {
        const detail =
            document.getElementById(
                "worldSettingsDetail"
            );

        if (detail) {
            showContainerMessage(
                detail,
                "找不到符合搜尋條件的世界存檔"
            );
        }

        return;
    }

    const selectedWorld =
        filteredWorlds.find(
            world =>
                world.folder_name
                === selectedWorldFolderName
        );

    selectWorld(
        (
            selectedWorld
            || filteredWorlds[0]
        ).folder_name
    );
}


async function loadWorlds() {
    worldListLoaded = false;
    updateWorldCreateAvailability();

    const currentList =
        document.getElementById(
            "worldSettingsList"
        );

    const archiveList =
        document.getElementById(
            "worldSettingsArchiveList"
        );

    const detail =
        document.getElementById(
            "worldSettingsDetail"
        );

    if (
        !currentList ||
        !archiveList ||
        !detail
    ) {
        return;
    }

    const searchInput = document.getElementById("worldSettingsSearchInput");

    if (searchInput) {
        searchInput.value = "";
    }

    selectedWorldFolderName = null;

    showContainerMessage(
        currentList,
        "載入中..."
    );

    showContainerMessage(
        archiveList,
        "載入中..."
    );

    showContainerMessage(
        detail,
        "載入中..."
    );

    try {
        const response = await fetch(
            "/api/worlds",
            {
                cache: "no-store",
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "讀取世界清單失敗"
            );
        }

        loadedWorlds = Array.isArray(data.worlds)
            ? data.worlds.filter(world => (
                world &&
                typeof world.folder_name === "string"
            ))
            : [];

        worldListLoaded = true;

        updateWorldCreateAvailability();
        updateCreateWorldSubmitAvailability();

        worldIconCacheKey = Date.now();

        const currentWorld =
            loadedWorlds.find(
                world => world.is_current
            ) || null;

        renderCurrentWorld(
            currentWorld,
            data.current_level_name
        );

        renderWorldArchiveList(
            loadedWorlds
        );

        const initialWorld =
            currentWorld || loadedWorlds[0];

        if (initialWorld) {
            selectWorld(
                initialWorld.folder_name
            );
        } else {
            showContainerMessage(
                detail,
                "找不到可顯示的世界存檔"
            );
        }

    } catch (error) {
        console.error(
            "讀取世界清單失敗：",
            error
        );

        loadedWorlds = [];
        worldListLoaded = false;

        updateWorldCreateAvailability();

        updateCreateWorldSubmitAvailability();

        const message =
            error.message || "讀取世界清單失敗";

        showContainerMessage(
            currentList,
            message
        );

        showContainerMessage(
            archiveList,
            message
        );

        showContainerMessage(
            detail,
            message
        );
    }
}


function showContainerMessage(
    container,
    message
) {
    container.innerHTML = "";

    const empty =
        document.createElement("div");

    empty.className = "world-settings-empty";
    empty.textContent = message;

    container.appendChild(empty);
}


function renderWorldArchiveList(
    worlds,
    isSearchResult = false
) {
    const archiveList =
        document.getElementById(
            "worldSettingsArchiveList"
        );

    if (!archiveList) {
        return;
    }

    archiveList.innerHTML = "";

    if (worlds.length === 0) {
        showContainerMessage(
            archiveList,
            isSearchResult
                ? "找不到符合搜尋條件的世界存檔"
                : "找不到世界存檔"
        );

        return;
    }

    worlds.forEach(world => {
        const metadata = getWorldMetadata(world);
        const isPendingGeneration = world.is_pending_generation === true;
        const item =
            document.createElement("div");

        item.className =
            "world-settings-world-item";

        item.dataset.worldFolderName =
            world.folder_name;

        item.setAttribute(
            "role",
            "button"
        );

        item.setAttribute(
            "tabindex",
            "0"
        );

        item.setAttribute(
            "aria-pressed",
            "false"
        );

        if (world.is_current) {
            item.classList.add("is-current");
        }

        const icon =
            createWorldIcon(
                "world-settings-world-item-icon",
                world
            );

        const content =
            document.createElement("span");

        content.className =
            "world-settings-world-item-content";

        const nameRow =
            document.createElement("span");

        nameRow.className =
            "world-settings-world-item-name-row";

        const name =
            document.createElement("span");

        name.className =
            "world-settings-world-item-name";

        name.textContent =
            world.folder_name || "未命名世界";

        nameRow.appendChild(name);

        if (
            world.is_current ||
            isPendingGeneration
        ) {
            const badge =
                document.createElement("span");

            badge.className =
                "world-settings-world-current-badge";

            if (isPendingGeneration) {
                badge.classList.add(
                    "is-pending"
                );
            }

            badge.textContent =
                isPendingGeneration
                    ? "待生成"
                    : "使用中";

            nameRow.appendChild(badge);
        }

        const meta =
            document.createElement("span");

        meta.className =
            "world-settings-world-item-meta";

        const versionName =
            normalizeText(
                metadata.version_name
            ) || "未知版本";

        const fileSize =
            formatFileSize(
                world.size_bytes
            ) || "容量未知";

        const lastSaved =
            formatLastSaved(
                metadata.last_saved_at
            ) || "時間未知";

        const metaEntries =
            isPendingGeneration
                ? [
                    [
                        "狀態",
                        "待生成",
                    ],
                    [
                        "容量",
                        fileSize,
                    ],
                    [
                        "最後儲存",
                        "尚未生成",
                    ],
                ]
                : [
                    [
                        "版本",
                        versionName,
                    ],
                    [
                        "容量",
                        fileSize,
                    ],
                    [
                        "最後儲存",
                        lastSaved,
                    ],
                ];

        metaEntries.forEach(
            ([labelText, valueText]) => {
                const entry =
                    document.createElement("span");

                entry.className =
                    "world-settings-world-item-meta-entry";

                const label =
                    document.createElement("span");

                label.className =
                    "world-settings-world-item-meta-label";

                label.textContent =
                    `${labelText}：`;

                const value =
                    document.createElement("span");

                value.className =
                    "world-settings-world-item-meta-value";

                value.textContent = valueText;

                entry.append(
                    label,
                    value
                );

                meta.appendChild(entry);
            }
        );

        content.append(
            nameRow,
            meta
        );

        const actions =
            document.createElement("div");

        actions.className =
            "world-settings-world-item-actions";

        const moreButton =
            document.createElement("button");

        moreButton.type = "button";

        moreButton.className =
            "world-settings-world-item-more-button";

        moreButton.setAttribute(
            "aria-label",
            `更多世界操作：${world.folder_name}`
        );

        moreButton.setAttribute(
            "aria-haspopup",
            "menu"
        );

        moreButton.setAttribute(
            "aria-expanded",
            "false"
        );

        moreButton.textContent = "⋮";

        const menu =
            document.createElement("div");

        menu.className =
            "world-settings-world-item-menu hidden";

        menu.setAttribute(
            "role",
            "menu"
        );


        const openFolderButton = document.createElement("button");

        openFolderButton.type = "button";
        openFolderButton.className = "world-settings-world-item-menu-button";

        openFolderButton.textContent = "開啟世界資料夾";

        const deleteButton = document.createElement("button");

        deleteButton.type = "button";
        deleteButton.className ="world-settings-world-item-menu-button danger";
        deleteButton.textContent = "刪除世界";

        menu.append(
            openFolderButton,
            deleteButton
        );

        actions.append(
            moreButton,
            menu
        );

        moreButton.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                const shouldOpen =
                    menu.classList.contains(
                        "hidden"
                    );

                document
                    .querySelectorAll(
                        ".world-settings-world-item-menu"
                    )
                    .forEach(otherMenu => {
                        if (
                            otherMenu
                            !== menu
                        ) {
                            otherMenu.classList.add(
                                "hidden"
                            );
                        }
                    });

                document
                    .querySelectorAll(
                        ".world-settings-world-item-more-button"
                    )
                    .forEach(otherButton => {
                        if (
                            otherButton
                            !== moreButton
                        ) {
                            otherButton.setAttribute(
                                "aria-expanded",
                                "false"
                            );
                        }
                    });

                menu.classList.toggle(
                    "hidden",
                    !shouldOpen
                );

                moreButton.setAttribute(
                    "aria-expanded",
                    String(shouldOpen)
                );
            }
        );

        openFolderButton.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                menu.classList.add(
                    "hidden"
                );

                moreButton.setAttribute(
                    "aria-expanded",
                    "false"
                );

                await openWorldFolder(
                    world,
                    openFolderButton
                );
            }
        );

        deleteButton.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                menu.classList.add(
                    "hidden"
                );

                moreButton.setAttribute(
                    "aria-expanded",
                    "false"
                );

                await deleteWorld(
                    world,
                    deleteButton
                );
            }
        );

        item.append(
            icon,
            content,
            actions
        );

        archiveList.appendChild(item);
    });
}


function selectWorld(folderName) {
    const archiveList =
        document.getElementById(
            "worldSettingsArchiveList"
        );

    if (!archiveList) {
        return;
    }

    const selectedWorld =
        loadedWorlds.find(
            world =>
                world.folder_name === folderName
        );

    if (!selectedWorld) {
        return;
    }

    selectedWorldFolderName = selectedWorld.folder_name;

    const worldItems =
        archiveList.querySelectorAll(
            ".world-settings-world-item"
        );

    worldItems.forEach(item => {
        const isSelected =
            item.dataset.worldFolderName
            === folderName;

        item.classList.toggle(
            "is-selected",
            isSelected
        );

        item.setAttribute(
            "aria-pressed",
            String(isSelected)
        );
    });

    renderSelectedWorldPreview(
        selectedWorld
    );
}


function renderSelectedWorldPreview(world) {
    const detail =
        document.getElementById(
            "worldSettingsDetail"
        );

    if (!detail || !world) {
        return;
    }

    const metadata = getWorldMetadata(world);
    const isPendingGeneration = world.is_pending_generation === true;

    detail.innerHTML = "";

    const preview = document.createElement("div");

    preview.className = "world-settings-detail-preview";

    const identity = document.createElement("div");

    identity.className = "world-settings-detail-identity";

    const icon =
        createWorldIcon(
            "world-settings-detail-icon",
            world
        );

    const identityContent =
        document.createElement("div");

    identityContent.className =
        "world-settings-detail-identity-content";

    const titleRow =
        document.createElement("div");

    titleRow.className =
        "world-settings-detail-preview-title-row";

    const name =
        document.createElement("div");

    name.className =
        "world-settings-detail-preview-name";

    name.textContent =
        world.folder_name || "未命名世界";

    titleRow.appendChild(name);

    if (
        world.is_current ||
        isPendingGeneration
    ) {
        const badge =
            document.createElement("span");

        badge.className =
            "world-settings-world-current-badge";

        if (isPendingGeneration) {
            badge.classList.add(
                "is-pending"
            );
        }

        badge.textContent =
            isPendingGeneration
                ? "待生成"
                : "使用中";

        titleRow.appendChild(badge);
    }

    const subtitle =
        document.createElement("div");

    subtitle.className =
        "world-settings-detail-subtitle";

    subtitle.textContent =
        isPendingGeneration
            ? "等待伺服器首次啟動生成"
            : world.is_current
                ? "伺服器目前使用的世界"
                : "已選取的世界存檔";

    identityContent.append(
        titleRow,
        subtitle
    );

    identity.append(
        icon,
        identityContent
    );

    const content =
        document.createElement("div");

    content.className =
        "world-settings-detail-content";

    const info =
        document.createElement("div");

    info.className =
        "world-settings-detail-info";

    if (isPendingGeneration) {
        const warning =
            document.createElement("div");

        warning.className =
            "world-settings-detail-warning";

        warning.textContent =
            "此世界尚未生成，啟動 Minecraft Server 後才會建立 level.dat";

        info.appendChild(warning);

    } else if (
        world.is_valid_world &&
        metadata.metadata_readable === false
    ) {
        const warning =
            document.createElement("div");

        warning.className =
            "world-settings-detail-warning";

        warning.textContent =
            "level.dat 存在，但詳細資料無法解析";

        info.appendChild(warning);
    }

    appendWorldDetail(
        info,
        "存檔路徑",
        normalizeText(
            world.folder_path
        ) || world.folder_name,
        true
    );

    if (isPendingGeneration) {
        appendWorldDetail(
            info,
            "世界狀態",
            "待生成"
        );

        appendWorldDetail(
            info,
            "目前容量",
            formatFileSize(
                world.size_bytes
            ) || "0 B"
        );

    } else {
        appendWorldDetail(
            info,
            "遊戲版本",
            normalizeText(
                metadata.version_name
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "遊戲模式",
            getGameModeLabel(
                metadata.game_mode
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "遊戲難度",
            getDifficultyLabel(
                metadata.difficulty
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "極限模式",
            metadata.metadata_readable
                ? (
                    metadata.is_hardcore
                        ? "開啟"
                        : "關閉"
                )
                : "無法讀取"
        );

        appendWorldDetail(
            info,
            "世界生成類型",
            getWorldTypeLabel(
                metadata.world_type
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "生成結構",
            typeof metadata.generate_structures
                === "boolean"
                ? (
                    metadata.generate_structures
                        ? "開啟"
                        : "關閉"
                )
                : "無法讀取"
        );

        appendSeedDetail(
            info,
            metadata.seed
        );

        appendWorldDetail(
            info,
            "玩家數",
            formatPlayerCount(
                world.player_count
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "存檔容量",
            formatFileSize(
                world.size_bytes
            ) || "無法讀取"
        );

        appendWorldDetail(
            info,
            "最後儲存",
            formatLastSaved(
                metadata.last_saved_at
            ) || "無法讀取",
            true
        );
    }


    content.appendChild(info);

    const actions =
        document.createElement("div");

    actions.className =
        "world-settings-detail-actions";

    const switchButton =
        document.createElement("button");

    switchButton.className =
        "world-settings-switch-button";

    switchButton.type = "button";

    const pendingWorld =
        loadedWorlds.find(
            item =>
                item.is_pending_generation
                === true
        ) || null;

    const isSwitchBlockedByPending =
        Boolean(pendingWorld)
        && !world.is_pending_generation;

    switchButton.disabled =
        world.is_current
        || isSwitchBlockedByPending;

    switchButton.textContent =
        world.is_current
            ? (
                isPendingGeneration
                    ? "待生成"
                    : "目前使用中"
            )
            : isSwitchBlockedByPending
                ? "有世界等待生成"
                : "切換至此世界";

    if (
        !world.is_current
        && !isSwitchBlockedByPending
    ) {
        switchButton.addEventListener(
            "click",
            () => {
                switchWorld(
                    world,
                    switchButton
                );
            }
        );
    }

    actions.appendChild(switchButton);

    preview.append(
        identity,
        content,
        actions
    );

    detail.appendChild(preview);
}


async function deleteWorld(
    world,
    deleteButton
) {
    const folderName =
        normalizeText(
            world?.folder_name
        );

    if (!folderName) {
        return;
    }

    const firstConfirmed =
        await showConfirm({
            title: "刪除世界",
            message: (
                `確定要刪除世界`
                + `「${folderName}」嗎？\n\n`
                + "刪除後世界會移至資源回收桶。"
            ),
            confirmText: "刪除",
            cancelText: "取消",
            variant: "warning",
        });

    if (!firstConfirmed) {
        return;
    }

    if (world.is_current === true) {
        const secondConfirmed =
            await showConfirm({
                title: "刪除目前使用中的世界",
                message: (
                    "你確定要刪除目前正在使用中的世界"
                    + `「${folderName}」嗎？\n\n`
                    + "刪除後將不會自動選擇其他世界，"
                    + "必須重新建立或切換世界"
                    + "才能啟動伺服器。"
                ),
                confirmText: "確定刪除",
                cancelText: "取消",
                variant: "danger",
            });

        if (!secondConfirmed) {
            return;
        }
    }

    deleteButton.disabled = true;
    deleteButton.textContent =
        "刪除中...";

    try {
        const encodedFolderName =
            encodeURIComponent(
                folderName
            );

        const response =
            await fetch(
                (
                    `/api/worlds/`
                    + encodedFolderName
                ),
                {
                    method: "DELETE",
                    cache: "no-store",
                }
            );

        let data = null;

        try {
            data =
                await response.json();

        } catch {
            data = null;
        }

        if (
            !response.ok
            || !data?.success
        ) {
            throw new Error(
                data?.message
                || "刪除世界失敗"
            );
        }

        await loadWorlds();

        let successMessage =
            data.message
            || (
                `世界「${folderName}」`
                + "已移至資源回收桶"
            );

        if (
            data.auto_backup_disabled
            === true
        ) {
            successMessage += (
                "\n\n因目前使用中的世界已刪除，"
                + "自動備份已關閉。"
            );
        }

        await showInfo({
            title: "世界刪除完成",
            message: successMessage,
            variant: "success",
            confirmText: "確定",
        });

    } catch (error) {
        console.error(
            "刪除世界失敗：",
            error
        );

        await showInfo({
            title: "刪除世界失敗",
            message:
                error.message
                || "無法刪除世界",
            variant: "error",
            confirmText: "確定",
        });

        if (
            deleteButton.isConnected
        ) {
            deleteButton.disabled = false;
            deleteButton.textContent =
                "刪除世界";
        }
    }
}


async function openWorldFolder(
    world,
    openFolderButton
) {
    const folderName =
        normalizeText(
            world?.folder_name
        );

    if (!folderName) {
        return;
    }

    openFolderButton.disabled = true;
    openFolderButton.textContent =
        "開啟中...";

    try {
        const encodedFolderName =
            encodeURIComponent(
                folderName
            );

        const response =
            await fetch(
                (
                    `/api/worlds/`
                    + `${encodedFolderName}`
                    + "/open-folder"
                ),
                {
                    method: "POST",
                    cache: "no-store",
                }
            );

        let data = null;

        try {
            data =
                await response.json();

        } catch {
            data = null;
        }

        if (
            !response.ok
            || !data?.success
        ) {
            throw new Error(
                data?.message
                || "開啟世界資料夾失敗"
            );
        }

    } catch (error) {
        console.error(
            "開啟世界資料夾失敗：",
            error
        );

        await showInfo({
            title: "開啟資料夾失敗",
            message:
                error.message
                || "無法開啟世界資料夾",
            variant: "error",
            confirmText: "確定",
        });

    } finally {
        if (
            openFolderButton.isConnected
        ) {
            openFolderButton.disabled = false;
            openFolderButton.textContent =
                "開啟世界資料夾";
        }
    }
}


async function switchWorld(
    world,
    switchButton
) {
    const folderName =
        normalizeText(
            world?.folder_name
        );

    if (!folderName) {
        return;
    }

    const confirmed =
        await showConfirm({
            title: "切換世界",
            message: (
                `確定要將目前世界切換成`
                + `「${folderName}」嗎？\n\n`
                + "切換後會在下次啟動"
                + " Minecraft Server 時生效。"
            ),
            confirmText: "切換",
            cancelText: "取消",
            variant: "warning",
        });

    if (!confirmed) {
        return;
    }

    switchButton.disabled = true;
    switchButton.textContent = "切換中...";

    try {
        const encodedFolderName =
            encodeURIComponent(
                folderName
            );

        const response = await fetch(
            (
                `/api/worlds/`
                + `${encodedFolderName}/switch`
            ),
            {
                method: "POST",
                cache: "no-store",
            }
        );

        const data =
            await response.json();

        if (
            !response.ok
            || !data.success
        ) {
            throw new Error(
                data.message
                || "切換世界失敗"
            );
        }

        await loadWorlds();

        let successMessage =
            data.message
            || `已切換至世界：${folderName}`;

        if (
            data.auto_backup_disabled
            === true
        ) {
            successMessage += (
                "\n\n因世界已變更，"
                + "自動備份已關閉。"
                + "請確認目前世界後重新設定自動備份。"
            );
        }

        await showInfo({
            title: "世界切換完成",
            message: successMessage,
            variant: "success",
            confirmText: "確定",
        });

    } catch (error) {
        console.error(
            "切換世界失敗：",
            error
        );

        await showInfo({
            title: "世界切換失敗",
            message:
                error.message
                || "無法切換世界",
            variant: "error",
            confirmText: "確定",
        });

        if (switchButton.isConnected) {
            switchButton.disabled = false;
            switchButton.textContent =
                "切換至此世界";
        }
    }
}


function appendWorldDetail(
    container,
    label,
    value,
    fullWidth = false
) {
    const item =
        document.createElement("div");

    item.className =
        "world-settings-detail-info-item";

    if (fullWidth) {
        item.classList.add("is-full-width");
    }

    const labelElement =
        document.createElement("div");

    labelElement.className =
        "world-settings-detail-info-label";

    labelElement.textContent = label;

    const valueElement =
        document.createElement("div");

    valueElement.className =
        "world-settings-detail-info-value";

    valueElement.textContent =
        value || "無法讀取";

    item.append(
        labelElement,
        valueElement
    );

    container.appendChild(item);
}


function appendSeedDetail(
    container,
    seed
) {
    const seedValue =
        typeof seed === "string"
            ? seed
            : "";

    const item =
        document.createElement("div");

    item.className =
        "world-settings-detail-info-item "
        + "is-full-width";

    const label =
        document.createElement("div");

    label.className =
        "world-settings-detail-info-label";

    label.textContent = "種子碼";

    const row =
        document.createElement("div");

    row.className =
        "world-settings-seed-row";

    const value =
        document.createElement("div");

    value.className =
        "world-settings-seed-value";

    const toggleButton =
        document.createElement("button");

    toggleButton.type = "button";
    toggleButton.className =
        "world-settings-seed-action "
        + "world-settings-seed-toggle";

    toggleButton.innerHTML =
        `<img
            src="/static/icons/server_settings/eye_16.png"
            alt=""
        >`;

    toggleButton.title = "顯示種子碼";
    toggleButton.setAttribute(
        "aria-label",
        "顯示種子碼"
    );

    const copyButton =
        document.createElement("button");

    copyButton.type = "button";
    copyButton.className =
        "world-settings-seed-action "
        + "world-settings-seed-copy";

    copyButton.textContent = "複製";
    copyButton.title = "複製種子碼";

    if (!seedValue) {
        value.textContent = "無法讀取";
        toggleButton.disabled = true;
        copyButton.disabled = true;

    } else {
        let isRevealed = false;

        const updateSeedDisplay = () => {
            value.textContent =
                isRevealed
                    ? seedValue
                    : "*******************";

            toggleButton.classList.toggle(
                "is-active",
                isRevealed
            );

            toggleButton.title =
                isRevealed
                    ? "隱藏種子碼"
                    : "顯示種子碼";

            toggleButton.setAttribute(
                "aria-label",
                toggleButton.title
            );
        };

        updateSeedDisplay();

        toggleButton.addEventListener(
            "click",
            () => {
                isRevealed = !isRevealed;
                updateSeedDisplay();
            }
        );

        copyButton.addEventListener(
            "click",
            async () => {
                try {
                    await copyTextToClipboard(
                        seedValue
                    );

                    copyButton.textContent =
                        "已複製";

                    window.setTimeout(
                        () => {
                            copyButton.textContent =
                                "複製";
                        },
                        1200
                    );

                } catch (error) {
                    console.error(
                        "複製種子碼失敗：",
                        error
                    );

                    copyButton.textContent =
                        "失敗";

                    window.setTimeout(
                        () => {
                            copyButton.textContent =
                                "複製";
                        },
                        1200
                    );
                }
            }
        );
    }

    row.append(
        value,
        toggleButton,
        copyButton
    );

    item.append(
        label,
        row
    );

    container.appendChild(item);
}


async function copyTextToClipboard(
    text
) {
    if (
        navigator.clipboard &&
        window.isSecureContext
    ) {
        await navigator.clipboard.writeText(
            text
        );

        return;
    }

    const textArea =
        document.createElement("textarea");

    textArea.value = text;
    textArea.setAttribute(
        "readonly",
        ""
    );

    textArea.style.position = "fixed";
    textArea.style.opacity = "0";

    document.body.appendChild(
        textArea
    );

    textArea.select();

    try {
        const copied =
            document.execCommand("copy");

        if (!copied) {
            throw new Error(
                "瀏覽器拒絕複製"
            );
        }

    } finally {
        textArea.remove();
    }
}


function createWorldIcon(
    className,
    world
) {
    const icon =
        document.createElement("img");

    icon.className = className;
    icon.alt = "";

    icon.src = getWorldIconUrl(world);

    icon.addEventListener(
        "error",
        () => {
            icon.src =
                DEFAULT_WORLD_ICON_URL;
        },
        {
            once: true,
        }
    );

    return icon;
}


function getWorldIconUrl(world) {
    if (
        !world ||
        !world.has_icon ||
        typeof world.folder_name !== "string"
    ) {
        return DEFAULT_WORLD_ICON_URL;
    }

    const folderName =
        encodeURIComponent(
            world.folder_name
        );

    return (
        `/api/worlds/${folderName}/icon`
        + `?v=${worldIconCacheKey}`
    );
}


function getWorldMetadata(world) {
    if (
        world &&
        world.metadata &&
        typeof world.metadata === "object"
    ) {
        return world.metadata;
    }

    return {};
}


function normalizeText(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}


function formatPlayerCount(
    playerCount
) {
    if (
        !Number.isInteger(playerCount)
        || playerCount < 0
    ) {
        return null;
    }

    return `${playerCount} 位`;
}


function formatFileSize(bytes) {
    if (
        typeof bytes !== "number" ||
        !Number.isFinite(bytes) ||
        bytes < 0
    ) {
        return null;
    }

    if (bytes === 0) {
        return "0 B";
    }

    const units = [
        "B",
        "KB",
        "MB",
        "GB",
        "TB",
    ];

    const unitIndex = Math.min(
        Math.floor(
            Math.log(bytes) / Math.log(1024)
        ),
        units.length - 1
    );

    const value =
        bytes / Math.pow(1024, unitIndex);

    const decimals =
        unitIndex === 0 || value >= 100
            ? 0
            : value >= 10
                ? 1
                : 2;

    return (
        `${value.toFixed(decimals)} `
        + units[unitIndex]
    );
}


function formatLastSaved(timestamp) {
    if (
        typeof timestamp !== "number" ||
        !Number.isFinite(timestamp) ||
        timestamp <= 0
    ) {
        return null;
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat(
        "zh-TW",
        {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }
    ).format(date);
}


function getGameModeLabel(gameMode) {
    const labels = {
        survival: "生存模式",
        creative: "創造模式",
        adventure: "冒險模式",
        spectator: "旁觀者模式",
        unknown: "未知模式",
    };

    return labels[gameMode] || null;
}


function getDifficultyLabel(
    difficulty
) {
    const labels = {
        peaceful: "和平",
        easy: "簡單",
        normal: "普通",
        hard: "困難",
    };

    return labels[difficulty] || null;
}


function getWorldTypeLabel(
    worldType
) {
    const labels = {
        default: "預設",
        flat: "超平坦",
        large_biomes: "大型生態域",
        amplified: "巨大化世界",
        debug: "除錯模式",
        custom: "自訂世界生成",
    };

    return labels[worldType] || null;
}


function getWorldModeSummary(metadata) {
    if (metadata.is_hardcore) {
        return "極限模式";
    }

    return getGameModeLabel(
        metadata.game_mode
    );
}


function appendWorldInfo(
    container,
    label,
    value
) {
    if (
        typeof value !== "string" ||
        value.length === 0
    ) {
        return;
    }

    const item =
        document.createElement("div");

    item.className = "world-settings-path";
    item.textContent = `${label}：${value}`;

    container.appendChild(item);
}


function renderCurrentWorld(
    currentWorld,
    configuredLevelName
) {
    const list =
        document.getElementById(
            "worldSettingsList"
        );

    if (!list) {
        return;
    }

    list.innerHTML = "";

    const world = currentWorld || {
        folder_name:
            configuredLevelName || "world",
        is_current: true,
        folder_exists: false,
        is_valid_world: false,
        is_pending_generation: false,
        size_bytes: null,
        has_icon: false,
        metadata: null,
    };

    const metadata =
        getWorldMetadata(world);

    const card =
        document.createElement("div");

    card.className = "world-settings-card";

    const icon =
        createWorldIcon(
            "world-settings-icon",
            world
        );

    const info =
        document.createElement("div");

    info.className = "world-settings-info";

    const nameRow =
        document.createElement("div");

    nameRow.className =
        "world-settings-name-row";

    const name =
        document.createElement("div");

    name.className = "world-settings-name";

    name.textContent =
        world.folder_name || "world";

    const badge =
        document.createElement("div");

    badge.className = "world-settings-badge";

    badge.textContent =
        world.is_valid_world
            ? "目前使用中"
            : "目前設定";

    const status =
        document.createElement("div");

    status.className =
        world.is_valid_world
            ? "world-settings-status exists"
            : world.is_pending_generation
                ? "world-settings-status pending"
                : "world-settings-status missing";

    if (world.is_valid_world) {
        status.textContent =
            "已找到世界存檔";

    } else if (world.is_pending_generation) {
        status.textContent =
            "待生成";

    } else if (world.folder_exists) {
        status.textContent =
            "找到資料夾，但無法辨識為世界存檔";

    } else {
        status.textContent =
            "找不到世界存檔";
    }

    nameRow.append(
        name,
        badge
    );

    if (metadata.is_hardcore) {
        const hardcoreBadge =
            document.createElement("div");

        hardcoreBadge.className =
            "world-settings-badge hardcore";

        hardcoreBadge.textContent =
            "極限模式";

        nameRow.appendChild(
            hardcoreBadge
        );
    }

    info.append(
        nameRow,
        status
    );

    appendWorldInfo(
        info,
        "版本",
        normalizeText(
            metadata.version_name
        )
    );

    appendWorldInfo(
        info,
        "遊戲模式",
        getWorldModeSummary(metadata)
    );

    appendWorldInfo(
        info,
        "最後儲存",
        formatLastSaved(
            metadata.last_saved_at
        )
    );

    const formattedSize =
        formatFileSize(
            world.size_bytes
        );

    if (formattedSize) {
        appendWorldInfo(
            info,
            "存檔容量",
            formattedSize
        );
    }

    card.append(
        icon,
        info
    );

    list.appendChild(card);
}