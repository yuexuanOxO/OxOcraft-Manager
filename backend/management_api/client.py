# backend/management_api/client.py

from __future__ import annotations

import asyncio
import ssl

import websockets

from backend.management_api.dto.player import parse_player_dto
from backend.management_api.state import add_player, remove_player

from backend.management_api.protocol import (
    JsonRpcRequest,
    is_jsonrpc_notification,
    is_jsonrpc_response,
    parse_json_message,
    parse_server_status_result,
)
from backend.management_api.state import (
    mark_connected,
    mark_disconnected,
    mark_notification,
    mark_server_started,
    mark_max_players,
)


STATUS_METHOD = "minecraft:server/status"

SERVER_STOPPING_NOTIFICATION = "minecraft:notification/server/stopping"
SERVER_SAVING_NOTIFICATION = "minecraft:notification/server/saving"
SERVER_SAVED_NOTIFICATION = "minecraft:notification/server/saved"
PLAYER_JOINED_NOTIFICATION = "minecraft:notification/players/joined"
PLAYER_LEFT_NOTIFICATION = "minecraft:notification/players/left"
MAX_PLAYERS_METHOD = "minecraft:serversettings/max_players"


class ManagementApiClient:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 25585,
        secret: str = "",
        tls_enabled: bool = False,
        open_timeout_seconds: int = 5,
    ) -> None:
        self.host = host
        self.port = port
        self.secret = secret
        self.tls_enabled = tls_enabled
        self.open_timeout_seconds = open_timeout_seconds
        self._request_id = 0
        self._ws = None

    def build_url(self) -> str:
        scheme = "wss" if self.tls_enabled else "ws"
        return f"{scheme}://{self.host}:{self.port}"

    def build_headers(self) -> dict[str, str]:
        if not self.secret:
            return {}

        return {
            "Authorization": f"Bearer {self.secret}",
        }

    def build_ssl_context(self):
        if not self.tls_enabled:
            return None

        return ssl._create_unverified_context()

    def next_request_id(self) -> int:
        self._request_id += 1
        return self._request_id

    async def send_rpc(
        self,
        ws,
        method: str,
        params: dict | None = None,
    ) -> int:
        request_id = self.next_request_id()

        request = JsonRpcRequest(
            id=request_id,
            method=method,
            params=params,
        )

        await ws.send(request.to_json())

        return request_id

    async def listen_once(self) -> None:
        url = self.build_url()

        async with websockets.connect(
            url,
            additional_headers=self.build_headers(),
            ssl=self.build_ssl_context(),
            open_timeout=self.open_timeout_seconds,
            ping_interval=None,
        ) as ws:
            mark_connected()

            self._ws = ws

            await self.send_rpc(ws, STATUS_METHOD)

            while True:
                raw = await ws.recv()
                data = parse_json_message(raw)

                if data is None:
                    continue

                self.handle_message(data)

    def handle_message(self, data: dict) -> None:
        if is_jsonrpc_response(data):
            self.handle_response(data)
            return

        if is_jsonrpc_notification(data):
            self.handle_notification(data)
            return

    def handle_response(self, data: dict) -> None:

        if "error" in data:
            mark_disconnected(str(data["error"]))
            return

        result = data.get("result")

        if isinstance(result, int):
            mark_max_players(result)
            return

        if not isinstance(result, dict):
            return

        status = parse_server_status_result(result)

        if not status.started:
            try:
                asyncio.create_task(
                    self._retry_status_later()
                )
            except Exception:
                pass
            return

        version_name = None
        version_protocol = None

        if status.version is not None:
            version_name = status.version.name
            version_protocol = status.version.protocol

        mark_server_started(
            version_name=version_name,
            version_protocol=version_protocol,
            players=status.players,
        )

        try:
            asyncio.create_task(
                self.send_rpc(self._ws, MAX_PLAYERS_METHOD)
            )
        except Exception:
            pass

        try:
            from backend.server_runtime import (
                get_server_runtime_state,
                set_server_runtime_state,
            )

            if get_server_runtime_state() != "ready":
                set_server_runtime_state("ready")

        except Exception:
            pass

    def handle_notification(self, data: dict) -> None:

        method = str(data.get("method", ""))

        if not method:
            return

        mark_notification(method)

        params = data.get("params")

        player = None

        if isinstance(params, list) and params:
            player = parse_player_dto(params[0])

        elif isinstance(params, dict):
            player = parse_player_dto(params.get("player"))

        if method == PLAYER_JOINED_NOTIFICATION:
            add_player(player)

            from backend.server_monitor import (
                refresh_server_status_now,
            )

            refresh_server_status_now()
            return

        if method == PLAYER_LEFT_NOTIFICATION:
            remove_player(player)

            from backend.server_monitor import (
                refresh_server_status_now,
            )

            refresh_server_status_now()
            return

        if method == SERVER_STOPPING_NOTIFICATION:
            try:
                from backend.server_runtime import set_server_runtime_state
                set_server_runtime_state("stopping")
            except Exception:
                pass

    
    async def _retry_status_later(self) -> None:
        await asyncio.sleep(1)

        if self._ws is None:
            return

        try:
            await self.send_rpc(self._ws, STATUS_METHOD)
        except Exception:
            pass


async def run_management_client_forever(
    client: ManagementApiClient,
    retry_seconds: int = 2,
) -> None:
    while True:
        try:
            await client.listen_once()

        except ConnectionRefusedError:
            mark_disconnected()

        except TimeoutError:
            mark_disconnected("Management Server 連線逾時")

        except websockets.exceptions.InvalidStatus as error:
            mark_disconnected(
                "Management Server 握手失敗，可能是 secret / TLS / port 設定不一致："
                f"{error}"
            )

        except websockets.exceptions.InvalidHandshake as error:
            mark_disconnected(f"Management Server WebSocket 握手失敗：{error}")

        except websockets.exceptions.ConnectionClosed as error:
            mark_disconnected(f"Management Server 連線關閉：{error}")

        except OSError as error:
            mark_disconnected(f"Management Server OS 錯誤：{error}")

        except Exception as error:
            mark_disconnected(
                f"Management Server 未知錯誤：{type(error).__name__}: {error}"
            )

        await asyncio.sleep(retry_seconds)