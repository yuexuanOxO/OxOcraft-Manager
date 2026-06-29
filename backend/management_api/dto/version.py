# backend/management_api/dto/version.py

from dataclasses import dataclass


@dataclass(slots=True)
class ServerVersionDto:
    name: str
    protocol: int