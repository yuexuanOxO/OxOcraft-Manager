export function initWorldSettings() {
    const openBtn =
        document.getElementById("worldSettingsBtn");

    const modal =
        document.getElementById("worldSettingsModal");

    if (!openBtn || !modal) {
        return;
    }

    openBtn.addEventListener("click", async () => {
        modal.classList.remove("hidden");
        await loadCurrentWorld();
    });

    modal.addEventListener("click", event => {
        if (event.target === modal) {
            modal.classList.add("hidden");
        }
    });
}


async function loadCurrentWorld() {
    const list =
        document.getElementById("worldSettingsList");

    if (!list) {
        return;
    }

    list.innerHTML = `
        <div class="world-settings-empty">
            載入中...
        </div>
    `;

    try {
        const response = await fetch(
            "/api/worlds/current",
            {
                cache: "no-store",
            }
        );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.message || "讀取目前世界失敗"
            );
        }

        renderCurrentWorld(data.world);

    } catch (error) {
        console.error("讀取目前世界失敗：", error);

        list.innerHTML = "";

        const empty =
            document.createElement("div");

        empty.className = "world-settings-empty";
        empty.textContent =
            error.message || "讀取目前世界失敗";

        list.appendChild(empty);
    }
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
        Math.floor(Math.log(bytes) / Math.log(1024)),
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

    return `${value.toFixed(decimals)} ${units[unitIndex]}`;
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


function getGameModeLabel(
    gameMode,
    isHardcore
) {
    if (isHardcore) {
        return "極限模式";
    }

    const labels = {
        survival: "生存模式",
        creative: "創造模式",
        adventure: "冒險模式",
        spectator: "旁觀者模式",
        unknown: "未知模式",
    };

    return labels[gameMode] || null;
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


function renderCurrentWorld(world) {
    const list =
        document.getElementById("worldSettingsList");

    if (!list) {
        return;
    }

    list.innerHTML = "";

    const metadata =
        world.metadata &&
        typeof world.metadata === "object"
            ? world.metadata
            : {};

    const card = document.createElement("div");

    card.className = "world-settings-card";

    const icon = document.createElement("img");

    icon.className = "world-settings-icon";
    icon.src =
        "/static/icons/feature_button/grass_block _btn.png";
    icon.alt = "";

    const info =
        document.createElement("div");

    info.className = "world-settings-info";

    const nameRow =
        document.createElement("div");

    nameRow.className = "world-settings-name-row";

    const name =
        document.createElement("div");

    name.className = "world-settings-name";
    name.textContent =
        world.folder_name || "world";

    const badge =
        document.createElement("div");

    badge.className = "world-settings-badge";
    badge.textContent = world.is_valid_world
        ? "目前使用中"
        : "目前設定";

    const status =
        document.createElement("div");

    status.className = world.is_valid_world
        ? "world-settings-status exists"
        : "world-settings-status missing";

    if (world.is_valid_world) {
        status.textContent = "已找到世界存檔";

    } else if (world.folder_exists) {
        status.textContent =
            "找到資料夾，但無法辨識為世界存檔";

    } else {
        status.textContent = "找不到世界存檔";
    }

    nameRow.append(name, badge);

    if (metadata.is_hardcore) {
        const hardcoreBadge =
            document.createElement("div");

        hardcoreBadge.className =
            "world-settings-badge hardcore";
        hardcoreBadge.textContent = "極限模式";

        nameRow.appendChild(hardcoreBadge);
    }

    info.append(nameRow, status);

    const versionName =
        typeof metadata.version_name === "string"
            ? metadata.version_name.trim()
            : "";

    const gameModeLabel =
        getGameModeLabel(
            metadata.game_mode,
            metadata.is_hardcore
        );

    const formattedLastSaved =
        formatLastSaved(
            metadata.last_saved_at
        );

    appendWorldInfo(
        info,
        "版本",
        versionName
    );

    appendWorldInfo(
        info,
        "遊戲模式",
        gameModeLabel
    );

    appendWorldInfo(
        info,
        "最後儲存",
        formattedLastSaved
    );

    const formattedSize =
        formatFileSize(world.size_bytes);

    if (formattedSize !== null) {
        const size =
            document.createElement("div");

        size.className = "world-settings-path";
        size.textContent =
            `存檔容量：${formattedSize}`;

        info.appendChild(size);
    }

    if (world.is_all_save && world.display_path) {
        const path =
            document.createElement("div");

        path.className = "world-settings-path";
        path.textContent =
            `存檔路徑：${world.display_path}`;

        info.appendChild(path);
    }

    card.append(icon, info);
    list.appendChild(card);
}