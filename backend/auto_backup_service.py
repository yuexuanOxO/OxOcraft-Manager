from __future__ import annotations

import json
import threading
import time
from calendar import monthrange
from datetime import datetime, timedelta
from pathlib import Path

from backend.paths import MC_ROOT
from backend.backup_service import start_backup, is_backup_running, get_backup_status
from backend.server_monitor import get_cached_server_status, publish_event
from backend.server_runtime import start_server, stop_server


CONFIG_PATH = Path("static/data/config.json")

_scheduler_started = False
_auto_backup_running = False


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}

    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def save_config(config: dict) -> None:
    CONFIG_PATH.write_text(
        json.dumps(config, ensure_ascii=False, indent=4),
        encoding="utf-8"
    )


def add_month_safe(dt: datetime) -> datetime:
    year = dt.year
    month = dt.month + 1

    if month > 12:
        year += 1
        month = 1

    day = min(dt.day, monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def add_year_safe(dt: datetime) -> datetime:
    year = dt.year + 1
    day = min(dt.day, monthrange(year, dt.month)[1])
    return dt.replace(year=year, day=day)


def calculate_next_run(start_at_text: str, frequency: str, base_time: datetime | None = None) -> str:
    if not start_at_text:
        return ""

    next_run = datetime.fromisoformat(start_at_text)
    base_time = base_time or datetime.now()

    while next_run <= base_time:
        if frequency == "daily":
            next_run += timedelta(days=1)
        elif frequency == "weekly":
            next_run += timedelta(days=7)
        elif frequency == "monthly":
            next_run = add_month_safe(next_run)
        elif frequency == "yearly":
            next_run = add_year_safe(next_run)
        else:
            next_run += timedelta(days=1)

    return next_run.strftime("%Y-%m-%dT%H:%M")


def set_next_run_after_now() -> None:
    config = load_config()

    next_run = calculate_next_run(
        config.get("auto_backup_start_at", ""),
        config.get("auto_backup_frequency", "daily"),
        datetime.now()
    )

    config["auto_backup_next_run_at"] = next_run
    save_config(config)

    publish_event("auto_backup_config_updated", {
        "auto_backup_next_run_at": next_run
    })


def send_tellraw(text: str, color: str = "red") -> None:
    # 走現有 /api/command 會繞一圈，不如之後接 rcon_service。
    # 第二階段先用 server_runtime 的狀態流程，公告指令下一步可接 rcon_service。
    try:
        from backend.rcon_service import send_rcon_command

        command = f'tellraw @a {{"text":"{text}","color":"{color}"}}'
        send_rcon_command(command)

    except Exception as error:
        print(f"[AutoBackup] 發送公告失敗：{error}")


def wait_until(target_time: datetime) -> None:
    while datetime.now() < target_time:
        time.sleep(1)


def wait_for_server_online(target_online: bool, timeout: int = 90) -> bool:
    start = time.time()

    while time.time() - start < timeout:
        status = get_cached_server_status()
        data = status.get("data", status)

        if bool(data.get("online")) == target_online:
            return True

        time.sleep(1)

    return False


def wait_for_backup_finished() -> dict:
    while is_backup_running():
        time.sleep(1)

    return get_backup_status()


def run_auto_backup_flow(scheduled_time: datetime) -> None:
    global _auto_backup_running

    if _auto_backup_running:
        return

    _auto_backup_running = True

    try:
        publish_event("auto_backup_warning", {
            "message": "自動備份公告階段"
        })

        status = get_cached_server_status()
        data = status.get("data", status)
        server_was_online = bool(data.get("online"))

        if server_was_online:
            warnings = [
                (30 * 60, "[公告] 伺服器即將在30分鐘後重啟進行備份，備份後重啟時間約3分鐘！"),
                (5 * 60, "[公告] 伺服器即將在5分鐘後重啟進行備份，備份後重啟時間約3分鐘！"),
                (1 * 60, "[公告] 伺服器即將在1分鐘後重啟進行備份，備份後重啟時間約3分鐘！"),
            ]

            for seconds_before, message in warnings:
                target = scheduled_time - timedelta(seconds=seconds_before)

                if datetime.now() < target:
                    wait_until(target)
                    send_tellraw(message)

            countdown_start = scheduled_time - timedelta(seconds=10)

            if datetime.now() < countdown_start:
                wait_until(countdown_start)

            remain = int((scheduled_time - datetime.now()).total_seconds())

            for i in range(min(10, remain), 0, -1):
                send_tellraw(f"[公告] 伺服器將在 {i} 秒後重啟進行備份！")
                time.sleep(1)

            publish_event("auto_backup_started", {
                "message": "自動備份進行中"
            })

            stop_server()
            wait_for_server_online(False, timeout=120)

        if not server_was_online:
            publish_event("auto_backup_started", {
                "message": "自動備份進行中"
            })

        while is_backup_running():
            time.sleep(1)

        success, message = start_backup(
            source_root=str(MC_ROOT),
            backup_root=str(MC_ROOT / "world_backup")
        )

        if success:
            backup_result = wait_for_backup_finished()
        else:
            backup_result = {
                "status": "failed",
                "message": message
            }

        if server_was_online:
            start_server()
            wait_for_server_online(True, timeout=120)

        set_next_run_after_now()

        publish_event("auto_backup_finished", {
            "message": "自動備份流程完成",
            "backup_status": backup_result.get("status"),
            "backup_message": backup_result.get("message"),
        })

    except Exception as error:
        print(f"[AutoBackup] 自動備份失敗：{error}")

        try:
            start_server()
        except Exception:
            pass

        publish_event("auto_backup_failed", {
            "message": str(error)
        })

    finally:
        _auto_backup_running = False


def scheduler_loop() -> None:
    while True:
        try:
            config = load_config()

            if not config.get("auto_backup_enabled"):
                time.sleep(30)
                continue

            next_run_at = config.get("auto_backup_next_run_at")

            if not next_run_at:
                set_next_run_after_now()
                time.sleep(30)
                continue

            next_run = datetime.fromisoformat(next_run_at)

            now = datetime.now()

            if now >= next_run:
                threading.Thread(
                    target=run_auto_backup_flow,
                    args=(next_run,),
                    daemon=True
                ).start()

                time.sleep(60)
                continue

            # 提前 30 分鐘進入公告流程
            if now >= next_run - timedelta(minutes=30):
                threading.Thread(
                    target=run_auto_backup_flow,
                    args=(next_run,),
                    daemon=True
                ).start()

                time.sleep(60)
                continue

                time.sleep(60)
                continue

        except Exception as error:
            print(f"[AutoBackup] Scheduler 錯誤：{error}")

        time.sleep(30)


def start_auto_backup_scheduler() -> None:
    global _scheduler_started

    if _scheduler_started:
        return

    _scheduler_started = True

    thread = threading.Thread(
        target=scheduler_loop,
        daemon=True
    )
    thread.start()

    print("自動備份排程器已啟動")