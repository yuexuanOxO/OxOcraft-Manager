import threading
import time

from backend.player_ban.player_ban_service import (
    process_expired_bans,
)

_scheduler_started = False
_scheduler_lock = threading.Lock()


def _ban_expire_worker() -> None:
    while True:
        try:
            results = process_expired_bans()

            changed = [
                item for item in results
                if item.get("success")
            ]

            if changed:
                print(
                    "[PlayerBanScheduler] 已處理到期黑名單："
                    f"{len(changed)} 筆"
                )

                try:
                    from backend.server_monitor import publish_event

                    publish_event("player_ban_should_refresh", {
                        "reason": "expired_ban_removed",
                        "source": "scheduler",
                        "count": len(changed),
                        "results": changed,
                    })

                except Exception as error:
                    print(
                        "[PlayerBanScheduler] 發送黑名單刷新事件失敗：",
                        error
                    )

        except Exception as error:
            print(
                "[PlayerBanScheduler] 到期黑名單檢查失敗：",
                error
            )

        time.sleep(10)


def start_player_ban_scheduler() -> None:
    global _scheduler_started

    with _scheduler_lock:
        if _scheduler_started:
            return

        _scheduler_started = True

        thread = threading.Thread(
            target=_ban_expire_worker,
            daemon=True,
        )

        thread.start()