let deathPlayers = [];

let currentPlayerIndex = 0;
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


const deathTextZhMap = [
    // item 版要放前面，避免先被普通版吃掉
    { pattern: /^was shot by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 射殺" },
    { pattern: /^went off with a bang due to a firework fired from (.+) by (.+)$/, text: "{player} 在 {killer} 用 {item} 發射的煙火所產生的爆炸中犧牲了" },
    { pattern: /^was fireballed by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 打出的火球殺死" },
    { pattern: /^was killed by (.+) using magic$/, text: "{player} 被 {killer} 用魔法殺死" },
    { pattern: /^was killed by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 殺死" },
    { pattern: /^was slain by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 殺死" },
    { pattern: /^was blown up by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 炸死" },
    { pattern: /^was smashed by (.+) with (.+)$/, text: "{player} 被 {killer} 用 {item} 重擊致死" },
    { pattern: /^was speared by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 刺穿了" },
    { pattern: /^was burned to a crisp while fighting (.+) wielding (.+)$/, text: "{player} 在與手持 {item} 的 {killer} 戰鬥時被火焰燒成灰燼" },
    { pattern: /^was obliterated by a sonically-charged shriek while trying to escape (.+) wielding (.+)$/, text: "{player} 在試圖逃離手持 {item} 的 {killer} 時被一道聲波尖嘯抹殺了" },
    { pattern: /^was stung to death by (.+) using (.+)$/, text: "{player} 被 {killer} 以 {item} 螫死了" },
    { pattern: /^was killed by (.+) while trying to hurt (.+)$/, text: "{player} 試圖攻擊 {killer} 時死於 {item}" },
    { pattern: /^was pummeled by (.+) using (.+)$/, text: "{player} 被 {killer} 用 {item} 揍死" },
    { pattern: /^was impaled by (.+) with (.+)$/, text: "{player} 被 {killer} 用 {item} 刺穿了" },
    { pattern: /^was shot by a skull from (.+) using (.+)$/, text: "{player} 被 {killer} 以 {item} 發射的頭顱射死了" },
    { pattern: /^fell too far and was finished by (.+) using (.+)$/, text: "{player} 摔傷後被 {killer} 以 {item} 擊殺" },
    { pattern: /^was doomed to fall by (.+) using (.+)$/, text: "{player} 被 {killer} 以 {item} 擊落" },

    // 有 killer
    { pattern: /^was shot by (.+)$/, text: "{player} 被 {killer} 射殺了" },
    { pattern: /^walked into a cactus while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時被仙人掌刺死了" },
    { pattern: /^walked into fire while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時踏入了火中" },
    { pattern: /^was squashed by (.+)$/, text: "{player} 遭到 {killer} 擠壓致死" },
    { pattern: /^was roasted in dragon's breath by (.+)$/, text: "{player} 被 {killer} 的龍之吐息烤熟了" },
    { pattern: /^drowned while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時在水中溺斃" },
    { pattern: /^died from dehydration while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時脫水而死" },
    { pattern: /^hit the ground too hard while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時失足墜地" },
    { pattern: /^was blown up by (.+)$/, text: "{player} 被 {killer} 炸死了" },
    { pattern: /^was squashed by a falling anvil while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被落下的鐵砧壓扁" },
    { pattern: /^was squashed by a falling block while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被落下的方塊壓扁" },
    { pattern: /^was skewered by a falling stalactite while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被落下的鐘乳石刺穿" },
    { pattern: /^was fireballed by (.+)$/, text: "{player} 被 {killer} 的火球殺死了" },
    { pattern: /^went off with a bang while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時隨著爆炸逝去" },
    { pattern: /^experienced kinetic energy while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時體驗了動能" },
    { pattern: /^was frozen to death by (.+)$/, text: "{player} 被 {killer} 凍死了" },
    { pattern: /^died because of (.+)$/, text: "{player} 因 {killer} 而死" },
    { pattern: /^was killed while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被殺死了" },
    { pattern: /^walked into the danger zone due to (.+)$/, text: "{player} 因為 {killer} 而走進了危險地帶" },
    { pattern: /^suffocated in a wall while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時卡進牆裡窒息" },
    { pattern: /^tried to swim in lava to escape (.+)$/, text: "{player} 跳入熔岩試圖逃離 {killer} 的追殺" },
    { pattern: /^was struck by lightning while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被閃電擊斃" },
    { pattern: /^was killed by magic while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時被魔法殺死了" },
    { pattern: /^was killed by (.+)$/, text: "{player} 被 {killer} 殺死了" },
    { pattern: /^was slain by (.+)$/, text: "{player} 被 {killer} 殺死了" },
    { pattern: /^was smashed by (.+)$/, text: "{player} 被 {killer} 重擊致死" },
    { pattern: /^didn't want to live in the same world as (.+)$/, text: "{player} 不想和 {killer} 活在同一個世界" },
    { pattern: /^left the confines of this world while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時脫離了這個世界" },
    { pattern: /^was obliterated by a sonically-charged shriek while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時被一道聲波尖嘯抹殺了" },
    { pattern: /^was speared by (.+)$/, text: "{player} 被 {killer} 刺穿了" },
    { pattern: /^was impaled on a stalagmite while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時在石筍上被刺穿" },
    { pattern: /^starved to death while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時餓死了" },
    { pattern: /^was stung to death by (.+)$/, text: "{player} 被 {killer} 螫死了" },
    { pattern: /^was poked to death by a sweet berry bush while trying to escape (.+)$/, text: "{player} 在試圖逃離 {killer} 時被甜莓灌木叢刺死了" },
    { pattern: /^was killed while trying to hurt (.+)$/, text: "{player} 試圖襲擊 {killer} 時被反將一軍" },
    { pattern: /^was pummeled by (.+)$/, text: "{player} 被 {killer} 活生生揍死了" },
    { pattern: /^was impaled by (.+)$/, text: "{player} 被 {killer} 刺穿了" },
    { pattern: /^was burned to a crisp while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時被火焰燒成灰燼" },
    { pattern: /^withered away while fighting (.+)$/, text: "{player} 在與 {killer} 戰鬥時凋零了" },
    { pattern: /^was shot by a skull from (.+)$/, text: "{player} 被 {killer} 發射的頭顱射死了" },
    { pattern: /^fell too far and was finished by (.+)$/, text: "{player} 摔傷後被 {killer} 殺了" },
    { pattern: /^was doomed to fall by (.+)$/, text: "{player} 被 {killer} 擊落" },

    // 無 killer
    { pattern: /^was pricked to death$/, text: "{player} 被仙人掌刺死了" },
    { pattern: /^went up in flames$/, text: "{player} 在火焰中昇天" },
    { pattern: /^was squished too much$/, text: "{player} 遭到擠壓致死" },
    { pattern: /^was roasted in dragon's breath$/, text: "{player} 被龍之吐息烤熟了" },
    { pattern: /^drowned$/, text: "{player} 溺死了" },
    { pattern: /^died from dehydration$/, text: "{player} 脫水而死" },
    { pattern: /^hit the ground too hard$/, text: "{player} 以為能安然無恙的著地" },
    { pattern: /^blew up$/, text: "{player} 被炸飛了" },
    { pattern: /^was squashed by a falling anvil$/, text: "{player} 被墜落下來的鐵砧壓扁了" },
    { pattern: /^was squashed by a falling block$/, text: "{player} 被墜落下來的方塊壓扁了" },
    { pattern: /^was skewered by a falling stalactite$/, text: "{player} 被墜落的鐘乳石刺穿了" },
    { pattern: /^went off with a bang$/, text: "{player} 在爆炸中犧牲了" },
    { pattern: /^experienced kinetic energy$/, text: "{player} 體驗了動能" },
    { pattern: /^froze to death$/, text: "{player} 凍死了" },
    { pattern: /^died$/, text: "{player} 死亡" },
    { pattern: /^was killed$/, text: "{player} 被殺死了" },
    { pattern: /^discovered the floor was lava$/, text: "{player} 察覺地面是片熔岩" },
    { pattern: /^suffocated in a wall$/, text: "{player} 在牆壁裡窒息" },
    { pattern: /^tried to swim in lava$/, text: "{player} 試圖在熔岩中游泳" },
    { pattern: /^was struck by lightning$/, text: "{player} 被閃電擊斃" },
    { pattern: /^was killed by magic$/, text: "{player} 被魔法殺死了" },
    { pattern: /^burned to death$/, text: "{player} 被燒死了" },
    { pattern: /^fell out of the world$/, text: "{player} 掉到世界外面了" },
    { pattern: /^left the confines of this world$/, text: "{player} 脫離了這個世界" },
    { pattern: /^was obliterated by a sonically-charged shriek$/, text: "{player} 被一道聲波尖嘯抹殺了" },
    { pattern: /^was impaled on a stalagmite$/, text: "{player} 在石筍上被刺穿" },
    { pattern: /^starved to death$/, text: "{player} 餓死了" },
    { pattern: /^was stung to death$/, text: "{player} 被螫死了" },
    { pattern: /^was poked to death by a sweet berry bush$/, text: "{player} 被甜莓灌木叢刺死了" },
    { pattern: /^withered away$/, text: "{player} 凋零了" },
    { pattern: /^fell from a high place$/, text: "{player} 從高處跌落" },
];


function translateMobOrPlayerName(name) {
    if (!name) return "";

    const normalized = name.trim().toLowerCase();
    return mobNameZhMap[normalized] || name;
}

function translateDeathText(deathText, playerName) {
    if (!deathText) return "未知死因";

    let message = deathText.trim();
    const player = playerName || "";

    if (player && message.startsWith(player + " ")) {
        message = message.slice(player.length + 1);
    }

    for (const rule of deathTextZhMap) {
        const match = message.match(rule.pattern);

        if (!match) {
            continue;
        }

        let result = rule.text.replaceAll("{player}", player || "玩家");

        if (match[1]) {
            result = result.replaceAll("{killer}", translateMobOrPlayerName(match[1]));
            result = result.replaceAll("{item}", match[1]);
        }

        if (match[2]) {
            result = result.replaceAll("{item}", match[2]);
        }

        return result;
    }

    return deathText;
}


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

    
    const deathRecords = getCurrentDeathRecords();

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
        translateDeathText(record.death_text, record.player_name);

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

        deathPlayers = Array.isArray(data.players)
            ? data.players
            : [];

        currentPlayerIndex = 0;
        currentDeathPage = 0;

        renderPlayerDropdown();
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
    const deathRecords = getCurrentDeathRecords();

    if (currentDeathPage > 0) {
        currentDeathPage -= 1;
        renderDeathRecordPage();
    }
}

function showNextDeathPage() {
    const deathRecords = getCurrentDeathRecords();

    if (currentDeathPage < deathRecords.length - 1) {
        currentDeathPage += 1;
        renderDeathRecordPage();
    }
}

export function initDeathBook() {

    const deathPlayerDropdownBtn =
        document.getElementById("deathPlayerDropdownBtn");

    const deathPlayerDropdown =
        document.getElementById("deathPlayerDropdown");

    if (deathPlayerDropdownBtn && deathPlayerDropdown) {

        deathPlayerDropdownBtn.addEventListener("click", () => {

            deathPlayerDropdown.classList.toggle("hidden");
        });
    }

    const deathPlayerPrevBtn = document.getElementById("deathPlayerPrevBtn");

    if (deathPlayerPrevBtn) {
        deathPlayerPrevBtn.addEventListener("click", showPrevPlayer);
    }

    const deathPlayerNextBtn = document.getElementById("deathPlayerNextBtn");

    if (deathPlayerNextBtn) {
        deathPlayerNextBtn.addEventListener("click", showNextPlayer);
    }

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


function getCurrentPlayerData() {
    return deathPlayers[currentPlayerIndex] || null;
}

function getCurrentDeathRecords() {
    const playerData = getCurrentPlayerData();

    return playerData?.deaths || [];
}


function showPrevPlayer() {
    if (currentPlayerIndex <= 0) {
        return;
    }

    currentPlayerIndex -= 1;

    currentDeathPage = 0;

    renderDeathRecordPage();
}

function showNextPlayer() {
    if (currentPlayerIndex >= deathPlayers.length - 1) {
        return;
    }

    currentPlayerIndex += 1;

    currentDeathPage = 0;

    renderDeathRecordPage();
}


function renderPlayerDropdown() {

    const dropdown = document.getElementById("deathPlayerDropdown");

    if (!dropdown) {
        return;
    }

    dropdown.innerHTML = "";

    deathPlayers.forEach((playerData, index) => {

        const item = document.createElement("button");

        item.type = "button";

        item.className =
            "death-book-player-dropdown-item";

        item.innerHTML = `
            <img
                class="death-book-player-dropdown-avatar"
                src="https://mc-heads.net/avatar/${encodeURIComponent(playerData.player_name)}">

            <div class="death-book-player-dropdown-name">
                ${playerData.player_name}
            </div>
        `;

        item.addEventListener("click", () => {

            currentPlayerIndex = index;

            currentDeathPage = 0;

            dropdown.classList.add("hidden");

            renderDeathRecordPage();
        });

        dropdown.appendChild(item);
    });
}