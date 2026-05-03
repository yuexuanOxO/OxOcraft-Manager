from __future__ import annotations

import json
import math
import re
import threading
import time
from calendar import monthrange
from datetime import datetime, timedelta
from pathlib import Path

from backend.paths import MC_ROOT
from backend.backup_service import start_backup, is_backup_running, get_backup_status
from backend.server_monitor import (
    get_cached_server_status,
    publish_event,
    register_event_handler,
    unregister_event_handler,
)
from backend.server_runtime import start_server, stop_server


CONFIG_PATH = Path("static/data/config.json")

_scheduler_started = False
_auto_backup_running = False
_auto_backup_control_locked = False
_missed_backup_pending = False
_missed_backup_at = ""


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        return {}

    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def save_config(config: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
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


def send_tellraw(text: str, color: str = "red") -> bool:
    # 走現有 /api/command 會繞一圈，不如之後接 rcon_service。
    # 第二階段先用 server_runtime 的狀態流程，公告指令下一步可接 rcon_service。
    try:
        from backend.rcon_service import send_rcon_command

        command = f'tellraw @a {{"text":"{text}","color":"{color}"}}'
        send_rcon_command(command)
        return True

    except Exception as error:
        print(f"[AutoBackup] 發送公告失敗：{error}")
        return False


def format_remaining_backup_time(scheduled_time: datetime) -> str:
    remaining_seconds = int((scheduled_time - datetime.now()).total_seconds())

    if remaining_seconds <= 60:
        return "不到1分鐘"

    remaining_minutes = max(1, math.ceil(remaining_seconds / 60))
    return f"{remaining_minutes}分鐘"


def get_configured_next_run() -> datetime | None:
    try:
        next_run_at = load_config().get("auto_backup_next_run_at")
        if not next_run_at:
            return None

        return datetime.fromisoformat(next_run_at)

    except Exception as error:
        print(f"[AutoBackup] 讀取下一次備份時間失敗：{error}")
        return None


def is_current_scheduled_time(scheduled_time: datetime) -> bool:
    configured_next_run = get_configured_next_run()

    if configured_next_run is None:
        return False

    return configured_next_run.replace(second=0, microsecond=0) == scheduled_time.replace(second=0, microsecond=0)


def send_private_backup_notice(player_name: str, scheduled_time: datetime) -> bool:
    try:
        from backend.rcon_service import send_rcon_command

        remaining_text = format_remaining_backup_time(scheduled_time)
        payload = json.dumps(
            {
                "text": f"[OxO]伺服器還有{remaining_text}就要關閉進行備份了喔!",
                "color": "light_purple",
            },
            ensure_ascii=False,
        )
        send_rcon_command(f"tellraw {player_name} {payload}")
        return True

    except Exception as error:
        print(f"[AutoBackup] 發送玩家備份提醒失敗：{player_name}：{error}")
        return False


def get_player_event_from_log(line: str) -> tuple[str, str] | None:
    join_match = re.search(r"\]:\s*(.+?) joined the game$", line)
    if join_match:
        return "joined", join_match.group(1).strip()

    left_match = re.search(r"\]:\s*(.+?) left the game$", line)
    if left_match:
        return "left", left_match.group(1).strip()

    return None


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


def is_server_online() -> bool:
    status = get_cached_server_status()
    data = status.get("data", status)
    return bool(data.get("online"))


def start_cloud_upload_after_success(backup_result: dict) -> None:
    if backup_result.get("status") != "success":
        return

    config = load_config()
    if not config.get("auto_backup_upload_cloud"):
        return

    try:
        from backend.routes.cloud_routes import start_cloud_upload_latest

        success, message = start_cloud_upload_latest()
        if not success:
            publish_event("auto_backup_warning", {
                "message": message
            })

    except Exception as error:
        publish_event("auto_backup_warning", {
            "message": f"自動雲端上傳啟動失敗：{error}"
        })


def run_auto_backup_flow(scheduled_time: datetime) -> None:
    global _auto_backup_running

    if _auto_backup_running:
        return

    _auto_backup_running = True

    try:
        publish_event("auto_backup_warning", {
            "message": "自動備份公告階段"
        })

        flow_started_at = datetime.now()
        milestones = [
            (scheduled_time - timedelta(minutes=60), "[公告] 伺服器即將在60分鐘後重啟進行備份，伺服器將在備份完成後重啟！"),
            (scheduled_time - timedelta(minutes=30), "[公告] 伺服器即將在30分鐘後重啟進行備份，伺服器將在備份完成後重啟！"),
            (scheduled_time - timedelta(minutes=10), "[公告] 伺服器即將在10分鐘後重啟進行備份，伺服器將在備份完成後重啟！"),
            (scheduled_time - timedelta(minutes=5), "[公告] 伺服器即將在5分鐘後重啟進行備份，伺服器將在備份完成後重啟！"),
            (scheduled_time - timedelta(minutes=1), "[公告] 伺服器即將在1分鐘後重啟進行備份，伺服器將在備份完成後重啟！"),
        ]
        milestones.extend(
            (scheduled_time - timedelta(seconds=seconds), f"[公告] 伺服器將在 {seconds} 秒後重啟進行備份！")
            for seconds in range(10, 0, -1)
        )
        pending_milestones = [
            {
                "time": milestone_time,
                "message": message,
                "last_attempt": None,
            }
            for milestone_time, message in milestones
            if milestone_time >= flow_started_at - timedelta(seconds=1)
        ]
        active_players = set()

        def handle_player_status_change(event_type: str, event_data: dict) -> None:
            nonlocal active_players

            if event_type != "log_append":
                return

            player_event = get_player_event_from_log(event_data.get("line", ""))
            if not player_event:
                return

            action, player_name = player_event
            if action == "joined":
                if player_name not in active_players:
                    send_private_backup_notice(player_name, scheduled_time)
                active_players.add(player_name)
                return

            active_players.discard(player_name)

        register_event_handler(handle_player_status_change)

        while datetime.now() < scheduled_time:
            now = datetime.now()

            if not is_current_scheduled_time(scheduled_time):
                publish_event("auto_backup_warning", {
                    "message": "自動備份排程已更新，已停止舊的公告流程"
                })
                return

            remaining_milestones = []
            for milestone in pending_milestones:
                milestone_time = milestone["time"]

                if now < milestone_time:
                    remaining_milestones.append(milestone)
                    continue

                if now > milestone_time + timedelta(seconds=60):
                    continue

                last_attempt = milestone["last_attempt"]
                if (
                    last_attempt is None
                    or now >= last_attempt + timedelta(seconds=5)
                ):
                    milestone["last_attempt"] = now

                    if send_tellraw(milestone["message"]):
                        continue

                remaining_milestones.append(milestone)

            pending_milestones = remaining_milestones

            time.sleep(0.5)

        server_was_online = is_server_online()
        set_auto_backup_control_locked(True)

        publish_event("auto_backup_started", {
            "message": "自動備份進行中"
        })

        if server_was_online:
            stop_server()
            wait_for_server_online(False, timeout=120)

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

        start_cloud_upload_after_success(backup_result)
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
        try:
            unregister_event_handler(handle_player_status_change)
        except Exception:
            pass

        set_auto_backup_control_locked(False)
        _auto_backup_running = False


def scheduler_loop() -> None:
    while True:
        try:
            config = load_config()

            if not config.get("auto_backup_enabled"):
                time.sleep(1)
                continue

            next_run_at = config.get("auto_backup_next_run_at")

            if not next_run_at:
                set_next_run_after_now()
                time.sleep(1)
                continue

            next_run = datetime.fromisoformat(next_run_at)

            now = datetime.now()

            if now >= next_run and not _auto_backup_running:
                notify_missed_backup(next_run)

                time.sleep(5)
                continue


            # 提前 60 分鐘進入公告流程
            if (
                now >= next_run - timedelta(minutes=60)
                and now < next_run
                and not _auto_backup_running
            ):
                threading.Thread(
                    target=run_auto_backup_flow,
                    args=(next_run,),
                    daemon=True
                ).start()

                time.sleep(1)
                continue

        except Exception as error:
            print(f"[AutoBackup] Scheduler 錯誤：{error}")

        time.sleep(1)


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


def is_auto_backup_control_locked() -> bool:
    return _auto_backup_control_locked


def set_auto_backup_control_locked(locked: bool) -> None:
    global _auto_backup_control_locked
    _auto_backup_control_locked = locked


def notify_missed_backup(next_run: datetime) -> None:
    global _missed_backup_at, _missed_backup_pending

    if _missed_backup_pending:
        return

    _missed_backup_pending = True
    _missed_backup_at = next_run.strftime("%Y-%m-%dT%H:%M")

    publish_event("auto_backup_missed", {
        "message": "偵測到上次自動備份未執行",
        "missed_run_at": _missed_backup_at
    })


def skip_missed_backup() -> None:
    global _missed_backup_at, _missed_backup_pending

    set_next_run_after_now()
    _missed_backup_pending = False
    _missed_backup_at = ""


def run_missed_backup_now() -> tuple[bool, str]:
    global _missed_backup_at, _missed_backup_pending

    if _auto_backup_running:
        return False, "自動備份正在執行中"

    _missed_backup_pending = False
    _missed_backup_at = ""

    threading.Thread(
        target=run_auto_backup_flow,
        args=(datetime.now(),),
        daemon=True
    ).start()

    return True, "已開始補做上次未執行的自動備份"


def get_missed_backup_status() -> dict:
    return {
        "pending": _missed_backup_pending,
        "missed_run_at": _missed_backup_at,
    }
