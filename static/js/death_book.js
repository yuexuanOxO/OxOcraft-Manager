let deathRecords = [];
let currentDeathPage = 0;

const mobIconMap = {
    zombie: "/static/icons/mobs/zombie.png",
    skeleton: "/static/icons/mobs/skeleton.png",
    creeper: "/static/icons/mobs/creeper.png",
    spider: "/static/icons/mobs/spider.png",
    enderman: "/static/icons/mobs/enderman.png",
    wither: "/static/icons/mobs/wither.png",
    warden: "/static/icons/mobs/Warden.png",
    Slime: "/static/icons/mobs/slime.png",
    blaze: "/static/icons/mobs/blaze.png",
    ghast: "/static/icons/mobs/ghast.png",
    drowned: "/static/icons/mobs/drowned.png",
    husk: "/static/icons/mobs/husk.png",
    stray: "/static/icons/mobs/stray.png",
    bogged: "/static/icons/mobs/bogged.png",
    phantom: "/static/icons/mobs/phantom.png",
    evoker: "/static/icons/mobs/Evoker.png",
    vex: "/static/icons/mobs/Vex.png",
    shulker: "/static/icons/mobs/Shulker.png",
    zoglin: "/static/icons/mobs/Zoglin.png"
};

function formatDimensionName(dimension) {
    if (!dimension) return "未知維度";

    const map = {
        "minecraft:overworld": "主世界",
        "minecraft:the_nether": "地獄",
        "minecraft:the_end": "終界"
    };

    return map[dimension] ? `${map[dimension]}：` : dimension;
}

function formatDeathTime(value) {
    if (!value) return "死亡時間：未知";

    const dt = new Date(value.replace(" ", "T"));
    if (Number.isNaN(dt.getTime())) {
        return `死亡時間：${value}`;
    }

    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");

    return `死亡時間：${y}/${m}/${d} ${hh}:${mm}`;
}

function getKillerDisplayInfo(killer) {
    if (!killer) {
        return {
            type: "none",
            text: "",
            icon: ""
        };
    }

    const normalized = killer.trim().toLowerCase();

    if (mobIconMap[normalized]) {
        return {
            type: "mob",
            text: killer,
            icon: mobIconMap[normalized]
        };
    }

    return {
        type: "player",
        text: killer,
        icon: `https://mc-heads.net/avatar/${encodeURIComponent(killer)}`
    };
}

function renderDeathRecordPage() {
    if (!deathRecords.length) {
        document.getElementById("deathPlayerAvatar").src = "";
        document.getElementById("deathPlayerName").textContent = "目前沒有死亡紀錄";
        document.getElementById("deathPageInfo").textContent = "第 0 頁 / 第 0 頁";
        document.getElementById("deathText").textContent = "目前沒有資料";
        document.getElementById("deathLocation").textContent = "";
        document.getElementById("deathTime").textContent = "";
        document.getElementById("deathKillerSection").classList.add("hidden");
        document.getElementById("deathWeaponSection").classList.add("hidden");
        return;
    }

    const record = deathRecords[currentDeathPage];

    document.getElementById("deathPlayerAvatar").src =
        `https://mc-heads.net/avatar/${encodeURIComponent(record.player_name)}`;
    document.getElementById("deathPlayerName").textContent = record.player_name;
    document.getElementById("deathPageInfo").textContent =
        `第 ${currentDeathPage + 1} 頁 / 第 ${deathRecords.length} 頁`;

    document.getElementById("deathText").textContent =
        record.death_text || "未知死因";

    const dimensionName = formatDimensionName(record.dimension);
    document.getElementById("deathLocation").textContent =
        `${dimensionName} [${record.x}, ${record.y}, ${record.z}]`;

    document.getElementById("deathTime").textContent =
        formatDeathTime(record.death_time);

    const killerInfo = getKillerDisplayInfo(record.killer);
    const killerSection = document.getElementById("deathKillerSection");
    const killerIcon = document.getElementById("deathKillerIcon");
    const killerText = document.getElementById("deathKillerText");

    if (killerInfo.type === "none") {
        killerSection.classList.add("hidden");
    } else {
        killerSection.classList.remove("hidden");
        killerText.textContent = killerInfo.text;
        killerIcon.src = killerInfo.icon;
        killerIcon.classList.remove("hidden");
    }

    const weaponSection = document.getElementById("deathWeaponSection");
    const weaponText = document.getElementById("deathWeaponText");

    if (!record.item) {
        weaponSection.classList.add("hidden");
    } else {
        weaponSection.classList.remove("hidden");
        weaponText.textContent = record.item;
    }

    document.getElementById("deathPrevBtn").disabled = currentDeathPage <= 0;
    document.getElementById("deathNextBtn").disabled = currentDeathPage >= deathRecords.length - 1;
}

async function openDeathBook() {
    try {
        const response = await fetch("/api/deaths", { cache: "no-store" });
        const data = await response.json();

        if (!data.success) {
            alert(data.message || "讀取死亡紀錄失敗");
            return;
        }

        deathRecords = Array.isArray(data.deaths) ? data.deaths : [];
        currentDeathPage = 0;

        renderDeathRecordPage();
        document.getElementById("deathBookModal").classList.remove("hidden");
    } catch (error) {
        console.error("開啟死亡紀錄失敗:", error);
        alert("開啟死亡紀錄失敗");
    }
}

function closeDeathBook() {
    document.getElementById("deathBookModal").classList.add("hidden");
}

function showPrevDeathPage() {
    if (currentDeathPage > 0) {
        currentDeathPage -= 1;
        renderDeathRecordPage();
    }
}

function showNextDeathPage() {
    if (currentDeathPage < deathRecords.length - 1) {
        currentDeathPage += 1;
        renderDeathRecordPage();
    }
}

function setupDeathBook() {
    const deathRecordBtn = document.getElementById("deathRecordBtn");
    if (deathRecordBtn) {
        deathRecordBtn.addEventListener("click", openDeathBook);
    }

    const deathBookCloseBtn = document.getElementById("deathBookCloseBtn");
    if (deathBookCloseBtn) {
        deathBookCloseBtn.addEventListener("click", closeDeathBook);
    }

    const deathPrevBtn = document.getElementById("deathPrevBtn");
    if (deathPrevBtn) {
        deathPrevBtn.addEventListener("click", showPrevDeathPage);
    }

    const deathNextBtn = document.getElementById("deathNextBtn");
    if (deathNextBtn) {
        deathNextBtn.addEventListener("click", showNextDeathPage);
    }

    const deathBookModal = document.getElementById("deathBookModal");
    if (deathBookModal) {
        deathBookModal.addEventListener("click", (event) => {
            if (event.target === deathBookModal) {
                closeDeathBook();
            }
        });
    }
}