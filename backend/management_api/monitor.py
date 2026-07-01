from __future__ import annotations

import asyncio
import threading

from backend.management_api.client import (
    ManagementApiClient,
    run_management_client_forever,
)


_monitor_thread: threading.Thread | None = None
_monitor_started = False
_monitor_lock = threading.Lock()
_current_client: ManagementApiClient | None = None


def get_management_client() -> ManagementApiClient:
    if _current_client is None:
        raise RuntimeError(
            "Management API Client 尚未初始化"
        )

    return _current_client


def start_management_api_monitor(
    host: str = "127.0.0.1",
    port: int = 25585,
    secret: str = "",
    tls_enabled: bool = False,
) -> None:
    global _monitor_thread
    global _monitor_started
    global _current_client

    with _monitor_lock:
        if _monitor_started:
            return

        _monitor_started = True

        _current_client = ManagementApiClient(
            host=host,
            port=port,
            secret=secret,
            tls_enabled=tls_enabled,
        )

        _monitor_thread = threading.Thread(
            target=_run_client_thread,
            args=(_current_client,),
            daemon=True,
        )

        _monitor_thread.start()


def update_management_secret(secret: str) -> None:
    with _monitor_lock:
        if _current_client is not None:
            _current_client.secret = secret


def _run_client_thread(client: ManagementApiClient) -> None:
    try:
        asyncio.run(run_management_client_forever(client))
    except Exception as error:
        print(
            "[ManagementAPI] monitor stopped:",
            f"{type(error).__name__}: {error}",
        )