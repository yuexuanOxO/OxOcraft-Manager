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


function renderCurrentWorld(world) {
    const list =
        document.getElementById("worldSettingsList");

    if (!list) {
        return;
    }

    list.innerHTML = "";

    const card =
        document.createElement("div");

    card.className = "world-settings-card";

    const icon =
        document.createElement("img");

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
    badge.textContent = "目前使用中";

    nameRow.append(name, badge);
    info.appendChild(nameRow);
    card.append(icon, info);
    list.appendChild(card);
}