from __future__ import annotations

from dataclasses import dataclass

from backend.management_api.client import ManagementApiClient
from backend.management_api.dto.player import PlayerDto, parse_player_dto


OPERATORS_METHOD = "minecraft:operators"
OPERATORS_ADD_METHOD = "minecraft:operators/add"
OPERATORS_REMOVE_METHOD = "minecraft:operators/remove"


@dataclass
class OperatorDto:
    player: PlayerDto
    permission_level: int
    bypasses_player_limit: bool


def build_player_payload(
    player_uuid: str,
    player_name: str,
) -> dict:
    return {
        "id": str(player_uuid),
        "name": str(player_name),
    }


def build_operator_payload(
    player_uuid: str,
    player_name: str,
    permission_level: int,
    bypasses_player_limit: bool,
) -> dict:
    return {
        "player": build_player_payload(
            player_uuid,
            player_name,
        ),
        "permissionLevel": max(
            1,
            min(int(permission_level or 4), 4),
        ),
        "bypassesPlayerLimit": bool(
            bypasses_player_limit
        ),
    }


def parse_operator_dto(data) -> OperatorDto | None:
    if not isinstance(data, dict):
        return None

    player = parse_player_dto(data.get("player"))

    if player is None:
        return None

    try:
        permission_level = int(
            data.get("permissionLevel", 4)
        )
    except (TypeError, ValueError):
        permission_level = 4

    return OperatorDto(
        player=player,
        permission_level=max(1, min(permission_level, 4)),
        bypasses_player_limit=bool(
            data.get("bypassesPlayerLimit", False)
        ),
    )


def parse_operator_list(data) -> list[OperatorDto]:
    if not isinstance(data, list):
        return []

    result = []

    for item in data:
        operator = parse_operator_dto(item)

        if operator is not None:
            result.append(operator)

    return result


def management_list_operators(
    client: ManagementApiClient,
) -> list[dict]:
    result = client.call_rpc_threadsafe(
        OPERATORS_METHOD,
    )

    return result if isinstance(result, list) else []


def management_add_operator(
    client: ManagementApiClient,
    player_uuid: str,
    player_name: str,
    permission_level: int,
    bypasses_player_limit: bool,
) -> list[dict]:
    result = client.call_rpc_threadsafe(
        OPERATORS_ADD_METHOD,
        params=[[
            build_operator_payload(
                player_uuid=player_uuid,
                player_name=player_name,
                permission_level=permission_level,
                bypasses_player_limit=bypasses_player_limit,
            )
        ]],
    )

    return result if isinstance(result, list) else []


def management_remove_operator(
    client: ManagementApiClient,
    player_uuid: str,
    player_name: str,
) -> list[dict]:
    result = client.call_rpc_threadsafe(
        OPERATORS_REMOVE_METHOD,
        params=[[
            build_player_payload(
                player_uuid,
                player_name,
            )
        ]],
    )

    return result if isinstance(result, list) else []