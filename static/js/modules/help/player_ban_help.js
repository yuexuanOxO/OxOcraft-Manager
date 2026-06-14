export const PLAYER_BAN_HELP = [
    {
        title: "封鎖玩家",
        content: [
            "將玩家加入黑名單後，該玩家將無法加入伺服器。",
            "Minecraft 在開啟或關閉正版驗證（online-mode）時，識別玩家的方式不同。開啟正版驗證時，會使用UUID（可理解為每位玩家專屬的身分證字號） 作為識別；關閉正版驗證時，則使用玩家名稱，因此兩種模式的黑名單彼此獨立，不會共用。",
            "此外，Minecraft 的 /ban 指令預設會將玩家加入正版 UUID 黑名單。因此，若伺服器已關閉正版驗證online-mode=false），直接使用 /ban 封鎖玩家，可能無法阻止相同名稱的離線玩家再次加入伺服器。",
            "(如果在封鎖上有發生問題建議在伺服器離線時使用OxOcraft-Manager封鎖玩家就不會有問題。)"

        ]
    },
    {
        title: "封鎖 IP",
        content: [
            "封鎖指定 IP 後，該 IP 將無法連線至伺服器。",
            "若多人共用同一個網路（例如家中、宿舍、學校），其他玩家也可能受到影響。"
        ]
    },
    {
        title: "限時封鎖",
        content: [
            "Minecraft 原版黑名單不支援限時封鎖。",
            "OxOcraft-Manager 會記錄封鎖期限，並於到期後自動解除封鎖，但若是解鎖期限已到沒有開啟 OxOcraft-Manager 被封鎖的玩家是不會自動解鎖的。"
        ]
    },
    {
        title: "建議操作方式",
        content: [
            "建議優先使用 OxOcraft-Manager 管理黑名單。",
            "避免直接修改 banned-players.json 或 banned-ips.json，以免造成資料不同步。"
        ]
    }
];