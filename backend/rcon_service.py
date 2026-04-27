import re

from mcrcon import MCRcon

from backend.config_files import load_or_create_config


def send_rcon_command(command: str) -> str:
    """透過 RCON 發送 Minecraft 指令。"""
    config = load_or_create_config()

    with MCRcon(
        host=config["rcon_host"],
        password=config["rcon_password"],
        port=int(config["rcon_port"]),
    ) as mcr:
        result = mcr.command(command)

    return result


def get_online_players() -> list[str]:
    result = send_rcon_command("list")

    if not result:
        return []

    match = re.search(r"There are (\d+) of a max of (\d+) players online", result)
    if not match:
        return []

    player_count = int(match.group(1))

    if player_count == 0:
        return []

    if ":" not in result:
        return []

    players_part = result.split(":", 1)[1].strip()

    if not players_part:
        return []

    return [name.strip() for name in players_part.split(",") if name.strip()]