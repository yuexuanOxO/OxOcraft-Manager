import re

from backend.db import add_player_access_history
from backend.player_permissions.player_identity_service import (
    resolve_player_identity,
)


SYSTEM_OPERATORS = {
    "",
    "OxOcraft",
    "Rcon",
    "Minecraft",
    "Console",
}

MINECRAFT_PLAYER_NAME_PATTERN = re.compile(
    r"^[A-Za-z0-9_]{3,16}$"
)


def is_valid_minecraft_player_name(name: str) -> bool:
    name = str(name or "").strip()

    return bool(
        MINECRAFT_PLAYER_NAME_PATTERN.fullmatch(name)
    )


def should_resolve_operator_identity(source: str) -> bool:
    return str(source or "").strip() == "player_command"


def record_player_access(
    category: str,
    action: str,

    target_name: str,
    operator_name: str | None = None,

    source: str = "unknown",
    detail: str = "",
    expires_at: str | None = None,

    target_uuid: str | None = None,
    account_type: str | None = None,
    operator_uuid: str | None = None,
) -> None:
    category = str(category or "").strip()
    action = str(action or "").strip()
    target_name = str(target_name or "").strip()
    operator_name = str(operator_name or "").strip() if operator_name else None

    if not category or not action or not target_name:
        return

    if not target_uuid or not account_type:
        target_identity = resolve_player_identity(target_name)

        target_uuid = target_uuid or target_identity.get("player_uuid")
        target_name = target_identity.get("player_name") or target_name
        account_type = account_type or target_identity.get("account_type")

    if (
        should_resolve_operator_identity(source)
        and operator_name
        and operator_name not in SYSTEM_OPERATORS
        and is_valid_minecraft_player_name(operator_name)
        and not operator_uuid
    ):
        operator_identity = resolve_player_identity(operator_name)

        operator_uuid = operator_identity.get("player_uuid")
        operator_name = operator_identity.get("player_name") or operator_name

    add_player_access_history(
        category=category,
        action=action,

        target_uuid=target_uuid,
        target_name=target_name,
        account_type=account_type,

        operator_uuid=operator_uuid,
        operator_name=operator_name,

        source=source,
        detail=detail,
        expires_at=expires_at,
    )