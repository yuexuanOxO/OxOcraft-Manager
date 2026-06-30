# backend/server_status_resolver.py

from __future__ import annotations

from typing import Any

from backend.management_api.state import get_management_state


def build_management_status_payload(
    runtime_state: str,
) -> dict[str, Any] | None:
    state = get_management_state()

    if runtime_state == "starting":
        if state.server_started:
            return build_ready_payload(state)

        return {
            "online": False,
            "state": "starting",
            "message": "伺服器啟動中",
            "management_ready": False,
            "status_source": "management_api",
        }

    if runtime_state == "stopping":
        if state.connected and not state.server_started:
            return None

        return {
            "online": False,
            "state": "stopping",
            "message": "伺服器關閉中",
            "management_ready": state.connected,
            "status_source": "management_api",
        }

    if state.error and runtime_state != "stopping":
        return {
            "online": False,
            "state": "error",
            "message": "伺服器狀態偵測錯誤",
            "management_ready": False,
            "status_source": "management_api",
            "error": state.error,
        }

    if state.server_started:
        return build_ready_payload(state)

    return None


def build_ready_payload(state) -> dict[str, Any]:
    from backend.player_permissions.player_permission_service import (
        get_effective_online_mode,
    )

    online_mode = get_effective_online_mode()

    return {
        "online": True,
        "state": "ready",
        "message": "伺服器在線",
        "query_ready": True,
        "management_ready": True,
        "status_source": "management_api",
        "version": state.version_name,
        "players_online": len(state.players),
        "players_max": state.max_players,
        "players": [
            {
                "uuid": player.id,
                "name": player.name,
                "account_type": (
                    "premium"
                    if online_mode
                    else "offline"
                )
            }
            for player in state.players
        ],
    }