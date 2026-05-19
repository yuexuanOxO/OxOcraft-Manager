let deathRecords = [];
let currentDeathPage = 0;

const mobIconMap = {
    bee: "/static/img/mobs/bee.png",
    blaze: "/static/img/mobs/blaze.png",
    bogged: "/static/img/mobs/bogged.png",
    breeze: "/static/img/mobs/breeze.png",
    "cave spider" :"/static/img/mobs/cave_spider.png",
    creaking : "/static/img/mobs/creaking.png",
    creeper: "/static/img/mobs/creeper.png",
    drowned: "/static/img/mobs/drowned.png",
    "elder guardian":"/static/img/mobs/elder_guardian.png",
    "ender dragon":"/static/img/mobs/ender_dragon.png",
    enderman: "/static/img/mobs/enderman.png",
    endermite : "/static/img/mobs/endermite.png",
    evoker: "/static/img/mobs/evoker.png",
    fox:"/static/img/mobs/fox.png",
    ghast: "/static/img/mobs/ghast.png",
    goat:"/static/img/mobs/goat.png",
    hoglin: "/static/img/mobs/hoglin.png",
    "hoglin baby": "/static/img/mobs/hoglin_baby.png",
    husk: "/static/img/mobs/husk.png",
    illusioner: "/static/img/mobs/illusioner.png",
    "iron golem":"/static/img/mobs/iron_golem.png",
    "killer bunny":"/static/img/mobs/killer_bunny.png",
    "llama": "/static/img/mobs/llama.png",
    "magma cube":"/static/img/mobs/magma_cube.png",
    nautilus:"/static/img/mobs/nautilus.png",
    panda:"/static/img/mobs/panda.png",
    parched:"/static/img/mobs/parched.png",
    phantom: "/static/img/mobs/phantom.png",
    piglin:"/static/img/mobs/piglin.png",
    "piglin brute": "/static/img/mobs/piglin_brute.png",
    pillager:"/static/img/mobs/pillager.png",
    "polar bear":"/static/img/mobs/polar_bear.png",
    pufferfish:"/static/img/mobs/pufferfish.png",
    ravager:"/static/img/mobs/ravager.png",
    shulker: "/static/img/mobs/shulker.png",
    silverfish: "/static/img/mobs/silverfish.png",
    skeleton: "/static/img/mobs/skeleton.png",
    slime: "/static/img/mobs/slime.png",
    spider: "/static/img/mobs/spider.png",
    stray: "/static/img/mobs/stray.png",
    "trader llama": "/static/img/mobs/trader_llama.png",
    vex: "/static/img/mobs/vex.png",
    villager: "/static/img/mobs/villager.png",
    vindicator: "/static/img/mobs/vindicator.png",
    warden: "/static/img/mobs/warden.png",
    witch: "/static/img/mobs/witch.png",
    wither: "/static/img/mobs/wither.png",
    "wither skeleton":"/static/img/mobs/wither_skeleton.png",
    wolf: "/static/img/mobs/wolf.png",
    zoglin: "/static/img/mobs/zoglin.png",
    zombie: "/static/img/mobs/zombie.png",
    "zombie nautilus":"/static/img/mobs/zombie_nautilus.png",
    "zombified piglin":"/static/img/mobs/zombified_piglin.png"

};


const mobNameZhMap = {
    bee: "蜜蜂",
    blaze: "烈焰使者",
    bogged: "沼骸",
    breeze: "旋風使者",
    "cave spider": "洞穴蜘蛛",
    creaking: "嘎枝",
    creeper: "苦力怕",
    drowned: "沉屍",
    "elder guardian": "遠古深海守衛",
    "ender dragon": "終界龍",
    enderman: "終界使者",
    endermite: "終界蟎",
    evoker: "喚魔者",
    fox: "狐狸",
    ghast: "地獄幽靈",
    goat: "山羊",
    hoglin: "豬布獸",
    "hoglin baby": "幼年豬布獸",
    husk: "屍殼",
    illusioner: "幻術師",
    "iron golem": "鐵魔像",
    "killer bunny": "殺手兔",
    llama: "駱馬",
    "magma cube": "岩漿立方怪",
    nautilus: "鸚鵡螺",
    panda: "貓熊",
    parched: "枯骸",
    phantom: "夜魅",
    piglin: "豬布林",
    "piglin brute": "豬布林蠻兵",
    pillager: "掠奪者",
    "polar bear": "北極熊",
    pufferfish: "河豚",
    ravager: "劫毀獸",
    shulker: "界伏蚌",
    silverfish: "蠹魚",
    skeleton: "骷髏",
    slime: "史萊姆",
    spider: "蜘蛛",
    stray: "流髑",
    "trader llama": "商駝",
    vex: "惱鬼",
    villager: "村民",
    vindicator: "衛道士",
    warden: "伏守者",
    witch: "女巫",
    wither: "凋零怪",
    "wither skeleton": "凋零骷髏",
    wolf: "狼",
    zoglin: "豬屍獸",
    zombie: "殭屍",
    "zombie nautilus": "殭屍鸚鵡螺",
    "zombified piglin": "殭屍化豬布林"
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
            text: mobNameZhMap[normalized] || killer,
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
        document.getElementById("deathPlayerAvatar").src = "/static/icons/death_record/steve_avatar.png";
        document.getElementById("deathPlayerName").textContent = "目前沒有死亡紀錄";
        document.getElementById("deathPageInfo").textContent = "第 0 頁 / 第 0 頁";
        document.getElementById("deathText").textContent = "目前沒有資料";
        document.getElementById("deathLocation").textContent = "";
        document.getElementById("deathTime").textContent = "";
        document.getElementById("deathKillerSection").classList.add("hidden");
        document.getElementById("deathWeaponSection").classList.add("hidden");
        document.getElementById("deathPrevBtn").classList.add("hidden");
        document.getElementById("deathNextBtn").classList.add("hidden");
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

    const prevBtn = document.getElementById("deathPrevBtn");
    const nextBtn = document.getElementById("deathNextBtn");

    prevBtn.classList.toggle("death-book-page-btn-hidden", currentDeathPage <= 0);
    nextBtn.classList.toggle("death-book-page-btn-hidden", currentDeathPage >= deathRecords.length -1);


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

export function initDeathBook() {
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