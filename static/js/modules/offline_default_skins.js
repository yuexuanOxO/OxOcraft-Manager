const DEFAULT_SKINS = [
    "alex",
    "ari",
    "efe",
    "kai",
    "makena",
    "noor",
    "steve",
    "sunny",
    "zuri",
];

export function getOfflineDefaultSkinAvatar(playerUuid) {
    const skin = getOfflineDefaultSkinName(playerUuid);

    return `/static/img/player/default_skins/${skin}.png`;
}

function getOfflineDefaultSkinName(playerUuid) {
    const cleanUuid = String(playerUuid || "")
        .replaceAll("-", "")
        .toLowerCase();

    if (cleanUuid.length !== 32) {
        return "steve";
    }

    const most =
        BigInt("0x" + cleanUuid.slice(0, 16));

    const least =
        BigInt("0x" + cleanUuid.slice(16, 32));

    const hilo =
        most ^ least;

    let hashCode =
        Number(((hilo >> 32n) ^ hilo) & 0xffffffffn);

    if (hashCode >= 0x80000000) {
        hashCode -= 0x100000000;
    }

    const index =
        ((hashCode % 9) + 9) % 9;

    return DEFAULT_SKINS[index];
}
