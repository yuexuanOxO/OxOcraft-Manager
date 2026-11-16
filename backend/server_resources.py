"""Read metrics from the agent belonging to the current managed Java process."""
from __future__ import annotations

import json
import math
import threading
import time
import zipfile
from pathlib import Path

from backend.paths import APP_DATA_DIR

_lock = threading.Lock()
_sample_path: Path | None = None
_process = None


def prepare_resource_agent(attempt_id: str) -> list[str]:
    global _sample_path, _process
    agent = Path(__file__).resolve().parent / "resource_agent" / "oxo-resource-agent.jar"
    with _lock:
        previous = _sample_path
        _sample_path = None
        _process = None
    if previous is not None:
        for old in (previous, previous.with_name(previous.name + ".tmp")):
            try:
                old.unlink(missing_ok=True)
            except OSError:
                pass
    try:
        # Missing/corrupt bundled resources must not block Minecraft startup.
        with zipfile.ZipFile(agent) as archive:
            if archive.testzip() is not None:
                raise ValueError("corrupt resource agent")
            if "Premain-Class: oxocraft.OxoResourceAgent" not in archive.read("META-INF/MANIFEST.MF").decode("utf-8"):
                raise ValueError("invalid resource agent manifest")
            if "oxocraft/OxoResourceAgent.class" not in archive.namelist():
                raise ValueError("missing resource agent class")
        if "=" in str(agent):
            raise ValueError("resource agent path contains '='")
        folder = APP_DATA_DIR / "resource-monitor"
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / (attempt_id + ".json")
        for old in folder.glob("*.json*"):
            try:
                if time.time() - old.stat().st_mtime > 86400:
                    old.unlink()
            except OSError:
                pass
        with _lock:
            _sample_path = path
        return [f"-javaagent:{agent}={path}"]
    except (OSError, ValueError, zipfile.BadZipFile, KeyError) as error:
        print(f"[ServerResources] monitoring unavailable: {error}")
        return []


def bind_resource_process(process) -> None:
    global _process
    with _lock:
        _process = process


def get_server_resources() -> dict:
    empty = {
        "active": False, "cpu_percent": None,
        "heap_used_bytes": None, "heap_max_bytes": None,
        "heap_percent": None,
    }
    from backend.server_monitor import get_cached_server_status
    from backend import server_runtime

    status = get_cached_server_status()["data"]
    process = server_runtime.server_process
    if (status.get("state") != "ready" or not status.get("online")
            or process is None or process.poll() is not None
            or server_runtime.get_server_runtime_state() == "stopping"
            or server_runtime.get_server_start_failure()):
        return empty

    result = {**empty, "active": True}
    with _lock:
        path, bound = _sample_path, _process
    if path is None or bound is not process:
        return result
    try:
        with path.open("rb") as stream:
            raw = stream.read(8193)
        if len(raw) > 8192:
            return result
        data = json.loads(raw)
        sampled_at = _number(data.get("sampled_at"))
        if sampled_at is None or not -1 <= time.time() - sampled_at / 1000 <= 10:
            return result
        cpu = _number(data.get("cpu_percent"))
        used = _number(data.get("heap_used_bytes"))
        maximum = _number(data.get("heap_max_bytes"))
        if cpu is not None and 0 <= cpu <= 100:
            result["cpu_percent"] = cpu
        if used is not None and maximum is not None and 0 <= used <= maximum and maximum > 0:
            result.update(heap_used_bytes=used, heap_max_bytes=maximum,
                          heap_percent=round(used / maximum * 100, 1))
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    # Drop a sample if the Java process exited/replaced while the file was read.
    if (server_runtime.server_process is not process or process.poll() is not None
            or server_runtime.get_server_runtime_state() == "stopping"):
        return empty
    return result


def _number(value):
    return value if (isinstance(value, (int, float)) and not isinstance(value, bool)
                     and math.isfinite(value)) else None
