# backend/management_api/client.py

from __future__ import annotations

import asyncio
import ssl

import websockets

from backend.management_api.dto.player import parse_player_dto
from backend.management_api.state import add_player, remove_player

from backend.player_permissions.player_identity_service import (
    get_account_type,
)

from backend.db import (
    upsert_player_login,
)

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
OPERATORS_ADDED_NOTIFICATION = "minecraft:notification/operators/added"
OPERATORS_REMOVED_NOTIFICATION = "minecraft:notification/operators/removed"



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
        self._pending_status = None
        self._pending_requests = {}
        self._loop = None

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
    

    async def send_rpc_and_wait(
        self,
        method: str,
        params=None,
        timeout: int = 5,
    ):
        if self._ws is None:
            raise RuntimeError("Management Server 尚未連線")

        loop = asyncio.get_running_loop()
        request_id = self.next_request_id()
        future = loop.create_future()

        self._pending_requests[request_id] = future

        request = JsonRpcRequest(
            id=request_id,
            method=method,
            params=params,
        )

        await self._ws.send(request.to_json())

        try:
            return await asyncio.wait_for(future, timeout)
        finally:
            self._pending_requests.pop(request_id, None)


    def call_rpc_threadsafe(
        self,
        method: str,
        params=None,
        timeout: int = 5,
    ):
        if self._loop is None:
            raise RuntimeError("Management Server event loop 尚未建立")

        future = asyncio.run_coroutine_threadsafe(
            self.send_rpc_and_wait(
                method=method,
                params=params,
                timeout=timeout,
            ),
            self._loop,
        )

        return future.result(timeout + 1)


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
            self._loop = asyncio.get_running_loop()

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

        response_id = data.get("id")

        if response_id in self._pending_requests:
            future = self._pending_requests.pop(response_id)

            if future.done():
                return

            if "error" in data:
                future.set_exception(
                    RuntimeError(str(data["error"]))
                )
            else:
                future.set_result(data.get("result"))

            return

        if "error" in data:
            mark_disconnected(str(data["error"]))
            return

        result = data.get("result")

        if isinstance(result, int):
            self._handle_max_players_response(result)
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

        self._pending_status = status

        try:
            asyncio.create_task(
                self.send_rpc(self._ws, MAX_PLAYERS_METHOD)
            )
        except Exception:
            self._mark_ready_from_status(status)


    def _handle_max_players_response(self, max_players: int) -> None:
        mark_max_players(max_players)

        if self._pending_status is None:
            return

        status = self._pending_status
        self._pending_status = None

        self._mark_ready_from_status(status)


    def _mark_ready_from_status(self, status) -> None:
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

            if player is not None:
                try:
                    upsert_player_login(
                        player_uuid=player.id,
                        player_name=player.name,
                        account_type=get_account_type(player.id),
                    )
                except Exception as error:
                    print(
                        "[Management] player join sync failed:",
                        error,
                    )

            from backend.server_monitor import (
                publish_event,
                refresh_server_status_now,
            )

            if player is not None:
                publish_event("management_player_joined", {
                    "id": player.id,
                    "name": player.name,
                })

            refresh_server_status_now()
            return

        if method == PLAYER_LEFT_NOTIFICATION:
            remove_player(player)

            from backend.server_monitor import (
                publish_event,
                refresh_server_status_now,
            )

            if player is not None:
                publish_event("management_player_left", {
                    "id": player.id,
                    "name": player.name,
                })

            refresh_server_status_now()
            return

        if method == OPERATORS_ADDED_NOTIFICATION:
            from backend.server_monitor import publish_event

            publish_event(
                "management_operator_added",
                {
                    "source": "management_api"
                }
            )

            return

        if method == OPERATORS_REMOVED_NOTIFICATION:
            from backend.server_monitor import publish_event

            publish_event(
                "management_operator_removed",
                {
                    "source": "management_api"
                }
            )

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
            try:
                from backend.server_runtime import get_server_runtime_state

                if get_server_runtime_state() == "stopping":
                    mark_disconnected()
                else:
                    mark_disconnected(f"Management Server 連線關閉：{error}")

            except Exception:
                mark_disconnected(f"Management Server 連線關閉：{error}")

        except OSError as error:
            mark_disconnected(f"Management Server OS 錯誤：{error}")

        except Exception as error:
            mark_disconnected(
                f"Management Server 未知錯誤：{type(error).__name__}: {error}"
            )

        await asyncio.sleep(retry_seconds)