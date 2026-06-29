# backend/management_api/dto/player.py

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class PlayerDto:
    id: str
    name: str


def parse_player_dto(data: dict[str, Any]) -> PlayerDto | None:
    if not isinstance(data, dict):
        return None

    player_id = str(data.get("id", "")).strip()
    player_name = str(data.get("name", "")).strip()

    if not player_name:
        return None

    return PlayerDto(
        id=player_id,
        name=player_name,
    )