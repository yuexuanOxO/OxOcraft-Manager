# backend/management_api/dto/server_status.py

from __future__ import annotations

from dataclasses import dataclass

from .player import PlayerDto
from .version import ServerVersionDto


@dataclass(slots=True)
class ServerStatusDto:
    started: bool
    version: ServerVersionDto | None = None
    players: list[PlayerDto] | None = None