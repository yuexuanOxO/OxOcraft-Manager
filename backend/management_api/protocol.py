# backend/management_api/protocol.py

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from backend.management_api.dto import (
    ServerStatusDto,
    ServerVersionDto,
)
from backend.management_api.dto.player import parse_player_dto


@dataclass
class JsonRpcRequest:
    id: int
    method: str
    params: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        payload = {
            "jsonrpc": "2.0",
            "id": self.id,
            "method": self.method,
        }

        if self.params is not None:
            payload["params"] = self.params

        return payload

    def to_json(self) -> str:
        return json.dumps(
            self.to_dict(),
            ensure_ascii=False,
        )


def parse_json_message(raw: str) -> dict[str, Any] | None:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    if not isinstance(data, dict):
        return None

    return data


def is_jsonrpc_response(data: dict[str, Any]) -> bool:
    return "id" in data and (
        "result" in data or "error" in data
    )


def is_jsonrpc_notification(data: dict[str, Any]) -> bool:
    return (
        "method" in data
        and "id" not in data
    )


def parse_server_status_result(
    result: dict[str, Any],
) -> ServerStatusDto:
    version_data = result.get("version")

    version = None
    if isinstance(version_data, dict):
        version = ServerVersionDto(
            name=str(version_data.get("name", "")),
            protocol=version_data.get("protocol"),
        )

    players = []

    players_data = result.get("players")
    if isinstance(players_data, list):
        for item in players_data:
            player = parse_player_dto(item)

            if player is not None:
                players.append(player)

    return ServerStatusDto(
        started=bool(result.get("started")),
        version=version,
        players=players,
    )