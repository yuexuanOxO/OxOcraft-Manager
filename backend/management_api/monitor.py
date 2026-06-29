# backend/management_api/monitor.py

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


def start_management_api_monitor(
    host: str = "127.0.0.1",
    port: int = 25585,
    secret: str = "",
    tls_enabled: bool = False,
) -> None:
    global _monitor_thread
    global _monitor_started

    with _monitor_lock:
        if _monitor_started:
            return

        _monitor_started = True

        client = ManagementApiClient(
            host=host,
            port=port,
            secret=secret,
            tls_enabled=tls_enabled,
        )

        _monitor_thread = threading.Thread(
            target=_run_client_thread,
            args=(client,),
            daemon=True,
        )

        _monitor_thread.start()


def _run_client_thread(client: ManagementApiClient) -> None:
    try:
        asyncio.run(run_management_client_forever(client))
    except Exception as error:
        print(
            "[ManagementAPI] monitor stopped:",
            f"{type(error).__name__}: {error}",
        )