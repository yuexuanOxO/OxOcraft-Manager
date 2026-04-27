from pathlib import Path
from datetime import datetime

DEFAULT_SERVER_PROPERTIES = {
    "enable-jmx-monitoring": "false",
    "rcon.port": "25575",
    "level-seed": "",
    "gamemode": "survival",
    "enable-command-block": "false",
    "enable-query": "false",
    "generator-settings": "{}",
    "enforce-secure-profile": "false",
    "level-name": "world",
    "motd": "A Minecraft Server",
    "query.port": "25565",
    "pvp": "true",
    "generate-structures": "true",
    "max-chained-neighbor-updates": "1000000",
    "difficulty": "easy",
    "network-compression-threshold": "256",
    "max-tick-time": "60000",
    "require-resource-pack": "false",
    "use-native-transport": "true",
    "max-players": "20",
    "online-mode": "true",
    "enable-status": "true",
    "allow-flight": "false",
    "initial-disabled-packs": "",
    "broadcast-rcon-to-ops": "true",
    "view-distance": "10",
    "server-ip": "",
    "resource-pack-prompt": "",
    "allow-nether": "true",
    "server-port": "25565",
    "enable-rcon": "false",
    "sync-chunk-writes": "true",
    "op-permission-level": "4",
    "prevent-proxy-connections": "false",
    "hide-online-players": "false",
    "resource-pack": "",
    "entity-broadcast-range-percentage": "100",
    "simulation-distance": "10",
    "rcon.password": "",
    "player-idle-timeout": "0",
    "force-gamemode": "false",
    "rate-limit": "0",
    "hardcore": "false",
    "white-list": "false",
    "broadcast-console-to-ops": "true",
    "spawn-npcs": "true",
    "spawn-animals": "true",
    "log-ips": "true",
    "function-permission-level": "2",
    "initial-enabled-packs": "vanilla",
    "level-type": "minecraft\\:normal",
    "text-filtering-config": "",
    "spawn-monsters": "true",
    "enforce-whitelist": "false",
    "spawn-protection": "16",
    "resource-pack-sha1": "",
    "max-world-size": "29999984",
}


def read_properties_file(file_path: Path) -> dict:
    if not file_path.exists():
        raise FileNotFoundError(f"找不到 server.properties：{file_path}")

    server_properties = {}

    with file_path.open("r", encoding="utf-8", errors="replace") as file:
        lines = file.readlines()

    for raw_line in lines:
        stripped = raw_line.strip()

        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue

        key, value = stripped.split("=", 1)
        server_properties[key.strip()] = value.strip()

    return server_properties


def get_effective_server_properties(file_path: Path) -> dict:
    current_props = read_properties_file(file_path)

    effective_props = DEFAULT_SERVER_PROPERTIES.copy()
    effective_props.update(current_props)

    return effective_props


def format_properties_for_write(update_server_properties: dict) -> list[str]:
    now_text = datetime.now().strftime("%a %b %d %H:%M:%S CST %Y")

    output_lines = [
        "#Minecraft server properties\n",
        f"#{now_text}\n",
    ]

    for key in DEFAULT_SERVER_PROPERTIES:
        value = update_server_properties.get(key, DEFAULT_SERVER_PROPERTIES[key])
        output_lines.append(f"{key}={value}\n")

    return output_lines


def write_properties_file(file_path: Path, lines: list[str]) -> None:
    with file_path.open("w", encoding="utf-8", errors="replace") as file:
        file.writelines(lines)


def read_properties_modified_comment(file_path: Path) -> str:
    if not file_path.exists():
        return ""

    with file_path.open("r", encoding="utf-8", errors="replace") as file:
        lines = file.readlines()

    if len(lines) >= 2 and lines[1].startswith("#"):
        return lines[1].lstrip("#").strip()

    return ""