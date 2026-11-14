"""Java 掃描、選擇及嘗試紀錄；預設路徑統一保存於 config.json。"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import uuid

from backend.config_files import load_or_create_config, update_config

_lock = threading.RLock()
_scan_lock = threading.Lock()
_attempt: dict = {}
_failed_paths: set[str] = set()
_candidates: dict[str, dict] = {}


def path_key(path: str) -> str:
    return os.path.normcase(str(Path(path).expanduser().resolve()))


def get_default_java() -> str:
    value = load_or_create_config().get("java_executable", "java")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("預設 Java 路徑格式錯誤。")
    return value


def validate_default_java(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("預設 Java 路徑格式錯誤。")
    if value == "java" or value == get_default_java():
        return value
    with _lock:
        for candidate in _candidates.values():
            if candidate["path"] == value and Path(value).is_file():
                return value
    raise ValueError("所選 Java 未經掃描確認或已不存在，請重新掃描。")


def get_java_for_snapshot() -> str:
    # 運行中修改預設，不代表當前 JVM 已切換。
    from backend.server_runtime import is_server_running
    attempt = get_attempt()
    if is_server_running() and attempt:
        return attempt.get("launch_java", attempt["java_path"])
    return get_default_java()


def begin_attempt(java_path: str, selected: bool) -> dict:
    global _attempt
    # 不執行 Java 探測，僅解析本次指令所使用的路徑。
    resolved = shutil.which(java_path) or java_path
    with _lock:
        _attempt = {
            "attempt_id": uuid.uuid4().hex,
            "java_path": resolved,
            "launch_java": java_path,
            "path_key": path_key(resolved),
            "selected": selected,
            "ready": False,
            "failed": False,
        }
        return dict(_attempt)


def get_attempt() -> dict:
    with _lock:
        return dict(_attempt)


def fail_attempt(attempt_id: str) -> dict:
    with _lock:
        if _attempt.get("attempt_id") != attempt_id:
            return {}
        _attempt["failed"] = True
        _failed_paths.add(_attempt["path_key"])
        return {
            "attempt_id": attempt_id,
            "java_path": _attempt["java_path"],
        }


def ready_attempt(attempt_id: str) -> None:
    with _lock:
        if _attempt.get("attempt_id") == attempt_id:
            _attempt.update(ready=True, failed=False)
            # 成功後不再標記此路徑為上次失敗。
            _failed_paths.discard(_attempt["path_key"])
            for candidate in _candidates.values():
                if _attempt["path_key"] in candidate["aliases"]:
                    _failed_paths.difference_update(candidate["aliases"])


def _registry_homes() -> list[str]:
    if os.name != "nt":
        return []
    import winreg
    result = []
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
            for branch in (
                r"SOFTWARE\JavaSoft\JDK", r"SOFTWARE\JavaSoft\JRE",
                r"SOFTWARE\JavaSoft\Java Development Kit",
                r"SOFTWARE\JavaSoft\Java Runtime Environment",
            ):
                try:
                    with winreg.OpenKey(hive, branch, 0, winreg.KEY_READ | view) as root:
                        for i in range(winreg.QueryInfoKey(root)[0]):
                            try:
                                with winreg.OpenKey(root, winreg.EnumKey(root, i)) as key:
                                    result.append(winreg.QueryValueEx(key, "JavaHome")[0])
                            except OSError:
                                pass
                except OSError:
                    pass
    return result


def _candidate_paths() -> list[str]:
    executable = "java.exe" if os.name == "nt" else "java"
    paths = []

    def add(path):
        candidate = Path(path).expanduser()
        if candidate.is_file():
            paths.append(str(candidate))

    current = get_attempt()
    if current:
        add(current["java_path"])
    try:
        default = get_default_java()
        add(shutil.which(default) or default)
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    for folder in os.get_exec_path():
        add(Path(folder) / executable)
    for home in [os.environ.get("JAVA_HOME"), os.environ.get("JDK_HOME"), *_registry_homes()]:
        if home:
            add(Path(home) / "bin" / executable)

    home = Path.home()
    roots = [home / ".jdks", home / ".jabba/jdk", home / ".sdkman/candidates/java"]
    if os.name == "nt":
        vendors = ("Java", "Eclipse Adoptium", "Microsoft", "Amazon Corretto",
                   "Zulu", "BellSoft", "Semeru", "RedHat")
        for env in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            parent = os.environ.get(env)
            if parent:
                roots.extend(Path(parent) / vendor for vendor in vendors)
                roots.append(Path(parent) / "Programs/Eclipse Adoptium")
        roots.extend((home / "scoop/apps/temurin/current", home / "scoop/apps/openjdk/current"))
    else:
        roots.extend((Path("/usr/lib/jvm"), Path("/usr/java"), Path("/opt/java"),
                      Path("/Library/Java/JavaVirtualMachines")))
    for root in roots:
        add(root / "bin" / executable)
        try:
            for child in sorted(root.iterdir()):
                if child.is_dir():
                    add(child / "bin" / executable)
                    add(child / "Contents/Home/bin" / executable)
        except OSError:
            pass
    unique = {}
    for path in paths:
        unique.setdefault(path_key(path), path)
    return list(unique.values())[:64]


def _probe_java(path: str) -> dict | None:
    try:
        result = subprocess.run(
            [path, "-XshowSettings:properties", "-version"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            timeout=3, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if result.returncode != 0:
            return None
        output = result.stdout
        version = re.search(r'^\s*(?:openjdk|java) version "([^"]+)"', output, re.M)
        if not version:
            version = re.search(r'^\s*java.version\s*=\s*(.+)$', output, re.M)
        if not version:
            return None
        java_home = re.search(r'^\s*java.home\s*=\s*(.+)$', output, re.M)
        actual = Path(java_home.group(1).strip()) / "bin" / Path(path).name if java_home else Path(path)
        actual_path = str(actual.resolve()) if actual.is_file() else str(Path(path).resolve())
        key = path_key(actual_path)
        vendor = re.search(r'^\s*java.vendor\s*=\s*(.+)$', output, re.M)
        return {
            "id": hashlib.sha256(key.encode()).hexdigest(),
            "path": actual_path,
            "version": version.group(1).strip(),
            "vendor": vendor.group(1).strip() if vendor else "",
            "aliases": {key, path_key(path)},
        }
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def scan_java_versions() -> list[dict]:
    global _candidates
    with _scan_lock:
        paths = _candidate_paths()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(_probe_java, paths))
        merged = {}
        for item in results:
            if not item:
                continue
            if item["id"] in merged:
                merged[item["id"]]["aliases"].update(item["aliases"])
            else:
                merged[item["id"]] = item
        with _lock:
            _candidates = merged
            default = get_default_java()
            default_key = path_key(shutil.which(default) or default)
            options = [
                {**{k: v for k, v in item.items() if k != "aliases"},
                 "last_failed": bool(item["aliases"] & _failed_paths),
                 "is_default": default_key in item["aliases"]}
                for item in merged.values()
            ]
        def order(item):
            return tuple(int(v) for v in re.findall(r'\d+', item["version"]))
        return sorted(options, key=order, reverse=True)


def resolve_retry_java(candidate_id: str, attempt_id: str) -> str:
    with _lock:
        if _attempt.get("attempt_id") != attempt_id or not _attempt.get("failed"):
            raise ValueError("啟動狀態已改變，請重新開啟伺服器。")
        candidate = _candidates.get(candidate_id)
        if not candidate or not Path(candidate["path"]).is_file():
            raise ValueError("所選 Java 已不存在，請重新掃描。")
        return candidate["path"]


def save_successful_java(attempt_id: str) -> str:
    with _lock:
        if (_attempt.get("attempt_id") != attempt_id
                or not _attempt.get("ready") or not _attempt.get("selected")):
            raise ValueError("只能將本次已成功啟動的 Java 設為預設。")
        path = _attempt["java_path"]
        if not Path(path).is_file():
            raise ValueError("本次使用的 Java 路徑已不存在。")
        update_config({"java_executable": path})
        return path
