from __future__ import annotations

import shutil
import threading
import time
from pathlib import Path
import zipfile

from collections import deque
from uuid import uuid4
from backend.paths import MC_ROOT
from backend.server_monitor import publish_event, get_cached_server_status
from backend.server_runtime import get_current_world_path, get_current_level_name
from backend.db import insert_backup_record, update_backup_record_status

_backup_thread = None
_cancel_requested = False
_is_running = False
_backup_status = {
    "running": False,
    "status": "idle",
    "percent": 0,
    "message": "待機",
}

_current_backup_record_id = None
_backup_queue = deque()
_current_backup_task = None
_queue_lock = threading.Lock()

class BackupCanceled(Exception):
    pass


def is_world_folder(path: Path) -> bool:
    if not path.is_dir():
        return False

    if not (path / "level.dat").is_file():
        return False

    markers = ("data", "region", "DIM1", "DIM-1", "dimensions", "players", "datapacks")
    return any((path / marker).exists() for marker in markers)


def get_backup_status() -> dict:
    return dict(_backup_status)


def is_backup_running() -> bool:
    return _is_running


def cancel_backup() -> None:
    global _cancel_requested
    _cancel_requested = True


def remove_partial_backup_file(target_zip: Path | None) -> None:
    if not target_zip or not target_zip.exists():
        return

    try:
        target_zip.unlink()
    except OSError as error:
        print(f"[Backup] 無法刪除未完成備份檔案：{error}")


def publish_or_update_backup_record(status_data: dict) -> None:
    global _current_backup_record_id

    if _current_backup_record_id is None:
        record = insert_backup_record(
            status=status_data.get("status"),
            map_name=status_data.get("map_name"),
            source_path=status_data.get("source_path"),
            backup_path=status_data.get("backup_path"),
            total_files=status_data.get("total_files"),
            total_bytes=status_data.get("total_bytes"),
            message=status_data.get("message"),
        )
        _current_backup_record_id = record["id"]
    else:
        record = update_backup_record_status(
            record_id=_current_backup_record_id,
            status=status_data.get("status"),
            message=status_data.get("message"),
        )

    if record:
        publish_event("backup_record_added", record)


def mark_backup_canceled(target_zip: Path | None = None) -> None:
    global _backup_status

    remove_partial_backup_file(target_zip)

    _backup_status = {
        **_backup_status,
        "running": False,
        "status": "canceled",
        "message": "手動取消",
        "backup_path": str(target_zip) if target_zip else _backup_status.get("backup_path"),
    }

    publish_event("backup_canceled", _backup_status)
    publish_or_update_backup_record(_backup_status)


def start_backup(source_root: str | None = None, backup_root: str | None = None) -> tuple[bool, str]:
    global _backup_thread, _is_running

    if _is_running:
        return False, "已有備份進行中"

    source_root_path = Path(source_root).expanduser() if source_root else None
    backup_root_path = Path(backup_root).expanduser() if backup_root else (MC_ROOT / "world_backup")

    _backup_thread = threading.Thread(
        target=backup_worker,
        args=(source_root_path, backup_root_path),
        daemon=True,
    )
    _backup_thread.start()

    return True, "已開始備份"


def enqueue_backup(
    source_root: str | None = None,
    backup_root: str | None = None,
    upload_cloud: bool = False,
) -> tuple[bool, str]:
    global _current_backup_task

    source_root_path = Path(source_root).expanduser() if source_root else None
    backup_root_path = Path(backup_root).expanduser() if backup_root else (MC_ROOT / "world_backup")

    task = {
        "id": str(uuid4()),
        "source_root": str(source_root_path) if source_root_path else "",
        "backup_root": str(backup_root_path),
        "upload_cloud": bool(upload_cloud),
        "status": "waiting",
        "percent": 0,
        "map_name": source_root_path.name if source_root_path else get_current_level_name(),
    }

    with _queue_lock:
        if _is_running:
            _backup_queue.append(task)

            publish_event("backup_queue_updated", get_backup_queue_status())

            return True, "已加入備份佇列"

        _current_backup_task = task

    _start_backup_task(task)

    return True, "已開始備份"


def backup_worker(source_root: Path | None, backup_root: Path, task: dict | None = None) -> None:
    global _cancel_requested, _current_backup_record_id, _is_running, _backup_status

    _cancel_requested = False
    _current_backup_record_id = None
    _is_running = True

    target_zip = None

    try:
        locked_world_path = get_current_world_path()
        level_name = get_current_level_name()

        if source_root:
            source_root_path = Path(source_root).expanduser()
            if is_world_folder(source_root_path):
                source_world = source_root_path
            else:
                source_world = source_root_path / locked_world_path.name
        else:
            source_world = locked_world_path

        map_name = source_world.name

        if not source_world.exists():
            raise FileNotFoundError(
                f"找不到世界 {level_name}\n請確認 Server 根路徑是否正確"
            )

        if not source_world.is_dir():
            raise NotADirectoryError(f"來源不是資料夾：{source_world}")

        backup_root.mkdir(parents=True, exist_ok=True)

        timestamp = time.strftime("%Y%m%d_%H%M%S")
        world_backup_root = backup_root / map_name
        world_backup_root.mkdir(parents=True, exist_ok=True)

        target_zip = world_backup_root / f"{map_name}_backup_{timestamp}.zip"

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
            "task_id": task.get("id") if task else "",
            "upload_cloud": bool(task.get("upload_cloud")) if task else False,
            "map_name": map_name,
            "source_path": str(source_world),
            "backup_path": str(target_zip),
            "total_files": total_files,
            "copied_files": 0,
            "total_bytes": total_bytes,
            "copied_bytes": 0,
            "current_file": "",
            
        }

        publish_event("backup_started", _backup_status)
        publish_or_update_backup_record(_backup_status)



        with zipfile.ZipFile(target_zip, "w", compression=zipfile.ZIP_DEFLATED) as zipf:

            for file in files:

                if _cancel_requested:
                    raise BackupCanceled()

                rel_path = file.relative_to(source_world)

                zipf.write(file, arcname=rel_path)

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
            "message": "本機備份完成",
            "task_id": task.get("id") if task else "",
            "upload_cloud": bool(task.get("upload_cloud")) if task else False,
        }

        if task and task.get("upload_cloud"):
            from backend.routes.cloud_routes import start_cloud_upload_latest

            backup_path = _backup_status.get("backup_path")
            backup_folder = str(Path(backup_path).parent) if backup_path else ""

            start_cloud_upload_latest(backup_folder)

        publish_event("backup_finished", _backup_status)
        publish_or_update_backup_record(_backup_status)

    except BackupCanceled:
        mark_backup_canceled(target_zip)

    except Exception as error:
        if _cancel_requested:
            mark_backup_canceled(target_zip)
            return

        remove_partial_backup_file(target_zip)

        _backup_status = {
            "running": False,
            "status": "failed",
            "percent": 0,
            "message": f"{error}",
            "task_id": task.get("id") if task else "",
            "upload_cloud": bool(task.get("upload_cloud")) if task else False,
            "map_name": source_world.name if "source_world" in locals() else None,
            "source_path": str(source_world) if "source_world" in locals() else str(source_root),
            "backup_path": str(target_zip) if target_zip else str(backup_root),
            "total_files": total_files if "total_files" in locals() else 0,
            "total_bytes": total_bytes if "total_bytes" in locals() else 0,
        }

        publish_event("backup_failed", _backup_status)
        publish_or_update_backup_record(_backup_status)

    finally:
        _is_running = False
        _cancel_requested = False
        _current_backup_record_id = None
        _start_next_backup_task()


def _start_next_backup_task() -> None:
    global _current_backup_task

    next_task = None

    with _queue_lock:
        if _backup_queue:
            next_task = _backup_queue.popleft()
            _current_backup_task = next_task
        else:
            _current_backup_task = None

    publish_event("backup_queue_updated", get_backup_queue_status())

    if next_task:
        _start_backup_task(next_task)

def get_backup_queue_status() -> dict:
    with _queue_lock:
        return {
            "current": dict(_current_backup_task) if _current_backup_task else None,
            "queue": [dict(task) for task in _backup_queue],
        }


def save_backup_record_and_publish(status_data: dict) -> None:
    record = insert_backup_record(
        status=status_data.get("status"),
        map_name=status_data.get("map_name"),
        source_path=status_data.get("source_path"),
        backup_path=status_data.get("backup_path"),
        total_files=status_data.get("total_files"),
        total_bytes=status_data.get("total_bytes"),
        message=status_data.get("message"),
    )

    publish_event("backup_record_added", record)


def _start_backup_task(task: dict) -> None:
    global _backup_thread, _is_running

    source_root_path = Path(task["source_root"]).expanduser() if task.get("source_root") else None
    backup_root_path = Path(task["backup_root"]).expanduser()

    _backup_thread = threading.Thread(
        target=backup_worker,
        args=(source_root_path, backup_root_path, task),
        daemon=True,
    )
    _backup_thread.start()