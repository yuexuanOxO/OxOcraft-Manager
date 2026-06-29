# backend/management_api/protocol.py

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any


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


@dataclass
class ServerVersionDto:
    name: str
    protocol: int | None = None


@dataclass
class ServerStatusDto:
    started: bool
    version: ServerVersionDto | None = None


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

    return ServerStatusDto(
        started=bool(result.get("started")),
        version=version,
    )