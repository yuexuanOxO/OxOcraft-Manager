from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path

from backend.paths import MC_ROOT
from backend.server_monitor import publish_event, get_cached_server_status
from backend.server_runtime import get_current_world_path, get_current_level_name

_backup_thread = None
_cancel_requested = False
_is_running = False
_backup_status = {
    "running": False,
    "status": "idle",
    "percent": 0,
    "message": "待機",
}


def get_backup_status() -> dict:
    return dict(_backup_status)


def is_backup_running() -> bool:
    return _is_running


def cancel_backup() -> None:
    global _cancel_requested
    _cancel_requested = True


def start_backup(source_root: str | None = None, backup_root: str | None = None) -> tuple[bool, str]:
    global _backup_thread, _is_running

    if _is_running:
        return False, "已有備份進行中"

    source_root_path = Path(source_root).expanduser() if source_root else MC_ROOT
    backup_root_path = Path(backup_root).expanduser() if backup_root else (MC_ROOT / "world_backup")

    _backup_thread = threading.Thread(
        target=backup_worker,
        args=(source_root_path, backup_root_path),
        daemon=True,
    )
    _backup_thread.start()

    return True, "已開始備份"


def backup_worker(source_root: Path, backup_root: Path) -> None:
    global _cancel_requested, _is_running, _backup_status

    _cancel_requested = False
    _is_running = True

    target_dir = None

    try:
        locked_world_path = get_current_world_path()
        level_name = get_current_level_name()

        if source_root:
            source_world = Path(source_root).expanduser() / level_name
        else:
            source_world = locked_world_path

        map_name = source_world.name

        if not source_world.exists():
            raise FileNotFoundError(f"找不到世界資料夾：{source_world}")

        if not source_world.is_dir():
            raise NotADirectoryError(f"來源不是資料夾：{source_world}")

        backup_root.mkdir(parents=True, exist_ok=True)

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        world_backup_root = backup_root / map_name
        world_backup_root.mkdir(parents=True, exist_ok=True)

        target_dir = world_backup_root / f"{map_name}_backup_{timestamp}"

        files = [p for p in source_world.rglob("*") if p.is_file()]
        total_files = len(files)
        total_bytes = sum(p.stat().st_size for p in files)

        copied_files = 0
        copied_bytes = 0

        _backup_status = {
            "running": True,
            "status": "running",
            "percent": 0,
            "message": "備份中",
            "map_name": map_name,
            "source_path": str(source_world),
            "backup_path": str(target_dir),
            "total_files": total_files,
            "copied_files": 0,
            "total_bytes": total_bytes,
            "copied_bytes": 0,
            "current_file": "",
        }

        publish_event("backup_started", _backup_status)

        if total_files == 0:
            target_dir.mkdir(parents=True, exist_ok=True)

        for file in files:
            if _cancel_requested:
                if target_dir:
                    shutil.rmtree(target_dir, ignore_errors=True)

                _backup_status = {
                    **_backup_status,
                    "running": False,
                    "status": "canceled",
                    "message": "使用者取消備份",
                }

                publish_event("backup_canceled", _backup_status)
                return

            rel_path = file.relative_to(source_world)
            dest = target_dir / rel_path
            dest.parent.mkdir(parents=True, exist_ok=True)

            shutil.copy2(file, dest)

            copied_files += 1
            copied_bytes += file.stat().st_size

            percent = int((copied_bytes / total_bytes) * 100) if total_bytes > 0 else 100

            _backup_status = {
                **_backup_status,
                "percent": percent,
                "copied_files": copied_files,
                "copied_bytes": copied_bytes,
                "current_file": str(rel_path),
            }

            publish_event("backup_progress", _backup_status)

        _backup_status = {
            **_backup_status,
            "running": False,
            "status": "success",
            "percent": 100,
            "message": "備份完成",
        }

        publish_event("backup_finished", _backup_status)

    except Exception as error:
        if target_dir:
            shutil.rmtree(target_dir, ignore_errors=True)

        _backup_status = {
            "running": False,
            "status": "failed",
            "percent": 0,
            "message": str(error),
            "source_path": str(source_root),
            "backup_path": str(backup_root),
        }

        publish_event("backup_failed", _backup_status)

    finally:
        _is_running = False
        _cancel_requested = False