from __future__ import annotations

import re
import subprocess
import threading
import json
import socket
from pathlib import Path
from backend import java_runtime
from backend.death_record.death_rules import parse_death_message, location_pattern
from backend.server_monitor import append_log_line, clear_log_cache
from backend.paths import SERVER_JAR_PATH, CONFIG_PATH, MC_ROOT, SERVER_PROPERTIES_PATH
from backend.server_settings.server_properties import read_properties_file
from backend.server_effective_settings import save_effective_settings_snapshot

from backend.server_status import (
    lock_current_server_port,
    lock_current_server_host,
    lock_current_rcon_settings,
)

from backend.server_config_sync import init_rcon_config

from backend.management_api.config import (
    load_management_config,
)

from backend.management_api.monitor import (
    start_management_api_monitor,
)

from backend.db import (
    insert_player_death,
    get_player_by_name_and_account_type,
    get_player_by_name_and_account_type_exact,
)


SERVER_ROOT = MC_ROOT

server_process: subprocess.Popen | None = None
_launch_lock = threading.RLock()
_output_finished = threading.Event()
_output_finished.set()

# 暫存等待座標回來的死亡事件
pending_deaths: dict[str, dict] = {}

CURRENT_LEVEL_NAME: str | None = None
CURRENT_WORLD_PATH: Path | None = None

SERVER_RUNTIME_STATE = "offline"
_runtime_state_lock = threading.Lock()

# Minecraft 啟動失敗紀錄
_start_failure_lock = threading.Lock()
_last_start_failure = None
_start_output_lock = threading.Lock()
_current_start_output: list[str] = []


# Minecraft 啟動警告紀錄
_start_warning_lock = threading.Lock()
_last_start_warning = None


def get_server_start_warning() -> dict | None:
    with _start_warning_lock:
        return (
            dict(_last_start_warning)
            if _last_start_warning
            else None
        )


def clear_server_start_warning() -> None:
    global _last_start_warning

    with _start_warning_lock:
        _last_start_warning = None


def record_server_start_warning(
    warning: dict,
) -> None:
    global _last_start_warning

    with _start_warning_lock:
        _last_start_warning = dict(warning)


def get_server_start_failure() -> dict | None:
    with _start_failure_lock:
        return (
            dict(_last_start_failure)
            if _last_start_failure
            else None
        )


def clear_server_start_failure() -> None:
    global _last_start_failure

    with _start_failure_lock:
        _last_start_failure = None


def record_server_start_failure(
    failure: dict,
) -> None:
    global _last_start_failure

    with _start_failure_lock:
        _last_start_failure = dict(failure)


def read_start_failure_log(process_output: list[str] | None = None) -> dict:
    # 僅使用本次 Java 程序的 stdout / stderr，不讀取 latest.log。
    with _start_output_lock:
        lines = list(
            _current_start_output
            if process_output is None
            else process_output
        )

    content = "\n".join(lines)
    return {
        "log": content,
        "log_note": (
            "以下為本次 Java 啟動程序的直接輸出（stdout／stderr）。"
            if content.strip()
            else "本次 Java 啟動程序沒有可用的輸出。"
        ),
        "log_source": "process_output",
    }


def get_server_start_diagnostics() -> dict:
    failure = get_server_start_failure()
    if failure:
        return failure

    running = is_server_running()
    return {
        "title": "伺服器啟動逾時" if running else "伺服器未完成啟動",
        "message": (
            "等待啟動完成已逾時，但 Minecraft 程序仍在執行。"
            "以下為目前日誌；逾時不代表程序已停止。"
            if running else
            "Minecraft 程序已停止，以下為本次啟動日誌。"
        ),
        **read_start_failure_log(),
    }


def classify_java_version_failure(log_text: str, exit_code: int | None) -> dict | None:
    error = re.search(
        r"(?:java\.lang\.)?UnsupportedClassVersionError\b[^\r\n]*",
        log_text,
    )
    if not error:
        return None

    detail = error.group(0)
    required = re.search(
        r"class file version\s+(\d+)(?:\.(\d+))?", detail, re.I
    )
    if not required:
        required = re.search(
            r"Unsupported major\.minor version\s+(\d+)(?:\.(\d+))?",
            detail, re.I,
        )
    current = re.search(
        r"only recognizes class file versions up to\s+(\d+)(?:\.(\d+))?",
        detail, re.I,
    )

    def java_version(match):
        # 現代 Java：class file major = Java 版本 + 44。
        # 早期 JDK 的命名不同，無法套用時不猜測。
        if match and int(match.group(1)) >= 49:
            return int(match.group(1)) - 44
        return None

    required_java = java_version(required)
    current_java = java_version(current)
    preview = bool(
        required and required.group(2) == "65535"
        or "preview features" in detail.lower()
    )
    if preview:
        # Preview class 必須使用同一發行版且啟用預覽功能；換更新版本不一定有用。
        message = "此程式使用 Java 預覽功能，不能套用一般的最低版本建議。"
        if required_java:
            message += f"\n需要對應的 Java {required_java}，並確認啟動參數包含 --enable-preview。"
        else:
            message += "\n請確認對應 Java 發行版與 --enable-preview 啟動參數。"
        message += "\n請查看下方日誌；本次不自動開啟版本切換視窗。"
    else:
        message = (
            "此次啟動失敗的原因為 "
            "Java版本與伺服器要求不符。"
        )

        if current_java:
            message += f"\n目前使用：Java {current_java}"

        if required_java:
            message += (
                f"\n伺服器需求：Java {required_java} 或以上版本"
            )

        message += "\n請選擇符合需求的 Java 版本重新啟動。"
    return {
        "error_code": "java_preview_features" if preview else "java_version_incompatible",
        "title": "Java 預覽功能不相容" if preview else "Java 版本不相容",
        "message": message,
        "file": None,
        "exit_code": exit_code,
        "java_retry_allowed": not preview,
        "required_java_version": required_java,
        "current_java_version": current_java,
        "java_preview": preview,
    }


def classify_server_start_failure(
    log_lines: list[str],
    exit_code: int | None,
) -> dict:
    log_text = "\n".join(log_lines)
    java_failure = classify_java_version_failure(log_text, exit_code)
    if java_failure:
        return java_failure

    # JSON 載入錯誤類型
    json_error_types = [
        {
            "marker": "DedicatedPlayerList.loadUserBanList",
            "error_code": "banned_players_json_invalid",
            "name": "玩家黑名單",
            "file": "banned-players.json",
        },
        {
            "marker": "DedicatedPlayerList.loadIpBanList",
            "error_code": "banned_ips_json_invalid",
            "name": "IP黑名單",
            "file": "banned-ips.json",
        },
    ]

    # 判斷是否為 JSON 解析錯誤
    has_json_error = (
        "Encountered an unexpected exception" in log_text
        and (
            "JsonSyntaxException" in log_text
            or "MalformedJsonException" in log_text
        )
    )

    if has_json_error:
        for error_type in json_error_types:
            if error_type["marker"] not in log_text:
                continue

            name = error_type["name"]
            filename = error_type["file"]

            return {
                "error_code": error_type["error_code"],
                "title": f"{name}資料錯誤",
                "message": (
                    f"Minecraft無法正確解析{filename}，"
                    "導致伺服器啟動失敗。\n"
                    f"請檢查並修正{name}資料，"
                    "再重新啟動伺服器。"
                ),
                "file": filename,
                "exit_code": exit_code,
            }

    # 無法辨識的啟動失敗
    return {
        "error_code": "server_exited_before_ready",
        "title": "伺服器啟動失敗",
        "message": (
            ("Minecraft 尚未完成啟動就已停止。\n"
             f"程序退出代碼：{exit_code}\n"
             if exit_code is not None else
             "Minecraft 啟動時發生致命錯誤，程序可能仍在結束中。\n")
            +
            "目前無法確認具體原因，請查看伺服器 Log。"
        ),
        "file": None,
        "exit_code": exit_code,
    }


def classify_server_start_warning(
    log_lines: list[str],
) -> dict | None:
    log_text = "\n".join(log_lines)

    has_ops_error = (
        "Failed to load operators list"
        in log_text
        and "DedicatedPlayerList.loadOps"
        in log_text
        and (
            "JsonSyntaxException" in log_text
            or "MalformedJsonException" in log_text
        )
    )

    if has_ops_error:
        return {
            "error_code": "ops_json_load_failed",
            "title": "管理員資料載入異常",
            "message": (
                "伺服器已成功啟動，但Minecraft"
                "無法正確載入ops.json。\n"
                "管理員權限資料已經由伺服器自動清空。"
            ),
            "file": "ops.json",
        }

    return None


def resolve_death_player_uuid(
    player_name: str | None,
    account_type: str,
) -> str | None:
    player_name = str(
        player_name or ""
    ).strip()

    if not player_name:
        return None

    if account_type == "premium":
        player = get_player_by_name_and_account_type(
            player_name,
            account_type,
        )
    else:
        player = (
            get_player_by_name_and_account_type_exact(
                player_name,
                account_type,
            )
        )

    if not player:
        return None

    player_uuid = str(
        player.get("player_uuid") or ""
    ).strip()

    return player_uuid or None


def set_server_runtime_state(state: str) -> None:
    global SERVER_RUNTIME_STATE

    with _runtime_state_lock:
        SERVER_RUNTIME_STATE = state

    try:
        from backend.server_monitor import refresh_server_status_now
        refresh_server_status_now()
    except Exception:
        pass


def get_server_runtime_state() -> str:
    with _runtime_state_lock:
        return SERVER_RUNTIME_STATE


def is_server_running() -> bool:
    global server_process
    return server_process is not None and server_process.poll() is None


def send_command(cmd: str) -> None:
    global server_process

    if server_process and server_process.stdin:
        server_process.stdin.write(cmd + "\n")
        server_process.stdin.flush()


def _read_server_output(process, startup_logs, attempt) -> None:
    try:
        handle_server_output(process, startup_logs, attempt)
    except Exception as error:
        # 繼續讀取，避免解析器異常使 Java 的輸出管線塞滿。
        print("[ServerStartup] 輸出處理異常：", error)
        for line in process.stdout:
            with _start_output_lock:
                startup_logs.append(line.rstrip("\r\n"))
        code = process.wait()
        if server_process is process:
            if not java_runtime.get_attempt().get("ready"):
                failure = classify_server_start_failure(startup_logs, code)
                failure.update(read_start_failure_log(startup_logs))
                failure.update(java_runtime.fail_attempt(attempt["attempt_id"]))
                record_server_start_failure(failure)
            set_server_runtime_state("offline")
    finally:
        if process.stdout:
            process.stdout.close()
        if process.stdin and process.poll() is not None:
            process.stdin.close()
        _output_finished.set()


def handle_server_output(process=None, startup_logs=None, attempt=None) -> None:
    global server_process, pending_deaths

    process = process if process is not None else server_process

    if not process or not process.stdout:
        return

    attempt = attempt or java_runtime.get_attempt()

    if startup_logs is None:
        startup_logs = _current_start_output
    reached_ready = False
    startup_warning_recorded = False
    startup_failed = False

    for line in process.stdout:
        line = line.rstrip("\r\n")
        print(line)
        append_log_line(line)

        if not reached_ready:
            with _start_output_lock:
                startup_logs.append(line)

            # 致命啟動錯誤不必等到 JVM 完全退出才通知前端。
            if any(marker in line for marker in (
                "FAILED TO BIND TO PORT",
                "Encountered an unexpected exception",
                "Failed to start the minecraft server",
            )):
                startup_failed = True

            if (
                startup_failed
                and get_server_runtime_state() != "stopping"
                and server_process is process
            ):
                failure = classify_server_start_failure(
                    startup_logs,
                    process.poll(),
                )
                failure.update(read_start_failure_log(startup_logs))
                failure.update(java_runtime.fail_attempt(attempt["attempt_id"]))
                record_server_start_failure(failure)

            # 偵測 ops.json 載入異常
            if (
                not startup_warning_recorded
                and "DedicatedPlayerList.loadOps" in line
            ):
                warning = classify_server_start_warning(
                    startup_logs
                )

                if warning:
                    record_server_start_warning(warning)
                    startup_warning_recorded = True

        if "Done (" in line and "For help, type" in line:
            reached_ready = True
            java_runtime.ready_attempt(attempt["attempt_id"])
            clear_server_start_failure()
            print("[Runtime Debug] Detected server ready from log.")

            try:
                from backend.player_permissions.player_permission_service import (
                    sync_ops_json_to_players,
                )

                sync_ops_json_to_players(
                    operator_name="Unknown",
                    source="minecraft_json",
                    detail="server ready ops.json sync",
                )

                from backend.server_monitor import publish_event
                publish_event("player_permission_should_refresh", {
                    "reason": "server_ready_sync_ops_json",
                })

                print("[PlayerPermission] server ready OP sync completed")

            except Exception as error:
                print("[PlayerPermission] server ready OP sync failed:", error)

            try:
                from backend.player_ban.player_ban_service import (
                    sync_banned_json_to_db,
                    sync_removed_bans_from_json,
                )

                sync_banned_json_to_db()
                sync_removed_bans_from_json()

                from backend.server_monitor import publish_event
                publish_event("player_ban_should_refresh", {
                    "reason": "server_ready_sync_ban_json",
                })

                print("[PlayerBan] server ready sync completed")

            except Exception as error:
                print("[PlayerBan] server ready sync failed:", error)

        
        if "Query running on" in line:
            print("[Runtime Debug] Query listener ready from log.")
            try:
                from backend.server_monitor import refresh_server_status_now
                refresh_server_status_now()
            except Exception:
                pass


        death_result = parse_death_message(line)

        if death_result:
            player = death_result["player"]

            if player:
                from backend.player_permissions.player_permission_service import (
                    get_effective_online_mode,
                )

                account_type = (
                    "premium"
                    if get_effective_online_mode()
                    else "offline"
                )

                death_result["player_uuid"] = (
                    resolve_death_player_uuid(
                        player,
                        account_type,
                    )
                )

                death_result["killer_uuid"] = (
                    resolve_death_player_uuid(
                        death_result.get("killer"),
                        account_type,
                    )
                )

                pending_deaths[player] = death_result

                send_command(
                    f"data get entity "
                    f"{player} LastDeathLocation"
                )

            continue

        location_match = location_pattern.search(line)
        if location_match:
            player = location_match.group("player")

            if player not in pending_deaths:
                continue

            death_data = pending_deaths.pop(player)

            x = int(location_match.group("x"))
            y = int(location_match.group("y"))
            z = int(location_match.group("z"))
            dimension = location_match.group("dimension")

            insert_player_death(
                player_name=player,
                player_uuid=death_data.get(
                    "player_uuid"
                ),
                death_type=death_data["type"],
                death_text=death_data["death_text"],
                killer=death_data["killer"],
                killer_uuid=death_data.get(
                    "killer_uuid"
                ),
                item=death_data["item"],
                x=x,
                y=y,
                z=z,
                dimension=dimension,
                raw_log=death_data["message"],
            )

            from backend.server_monitor import publish_event

            publish_event("death_record_added", {
                "player_name": player,
                "player_uuid": death_data.get("player_uuid"),
            })


    # stdout 結束後，等待 Minecraft 程序完全退出
    exit_code = process.wait()

    # 只有尚未 Ready 就退出才記錄啟動失敗
    if (
        not reached_ready
        and get_server_runtime_state() != "stopping"
        and server_process is process
    ):
        failure = classify_server_start_failure(
            startup_logs,
            exit_code,
        )

        failure.update(read_start_failure_log(startup_logs))

        failure.update(java_runtime.fail_attempt(attempt["attempt_id"]))
        record_server_start_failure(failure)

        print(
            "[ServerStartup] Minecraft 啟動失敗:",
            failure["error_code"],
        )


    try:
        from backend.db import mark_all_players_offline
        mark_all_players_offline()
    except Exception as error:
        print("[PlayerIdentity] mark all offline failed:", error)

    if server_process is process:
        set_server_runtime_state("offline")


def get_local_ipv4_addresses() -> set[str]:
    ips = {
        "127.0.0.1",
        "0.0.0.0",
        "localhost",
    }

    try:
        hostname = socket.gethostname()

        for item in socket.getaddrinfo(hostname, None):
            ip = item[4][0]

            if ":" not in ip:
                ips.add(ip)

    except Exception:
        pass

    return ips


def validate_server_bind_ip(server_ip: str) -> tuple[bool, str]:

    try:
        server_ip = server_ip.strip()
        if not server_ip:
            return True, ""

        if not server_ip:
            return True, ""

        local_ips = get_local_ipv4_addresses()

        if server_ip in local_ips:
            return True, ""

        available_ips = "\n".join(sorted(local_ips))

        return False, (
            "server-ip 綁定失敗!\n\n"
            "server-ip 只能填這台電腦目前擁有的 IP。\n"
            "如果不確定，建議將 server-ip 留空。\n\n"
            f"目前設定的 server-ip：\n{server_ip}\n\n"
            f"目前可用 IP：\n{available_ips}"
        )

    except Exception as error:
        return False, f"檢查 server-ip 時發生錯誤：{error}"


def can_retry_java() -> bool:
    return not is_server_running() and _output_finished.is_set()


def wait_for_start_output(timeout: float = 3) -> bool:
    return _output_finished.wait(timeout)


def start_server(
    allow_invalid_ops: bool = False,
    java_candidate_id: str | None = None,
    retry_attempt_id: str | None = None,
) -> tuple[bool, str]:
    # 包含自動備份等其他呼叫端，皆由相同鎖防止重複啟動。
    with _launch_lock:
        if not can_retry_java():
            return False, "原程序仍在執行或整理輸出，請稍後再試。"
        try:
            java_path = (
                java_runtime.resolve_retry_java(java_candidate_id, retry_attempt_id)
                if java_candidate_id else java_runtime.get_default_java()
            )
        except (OSError, ValueError, TypeError, AttributeError) as error:
            return False, f"無法取得 Java 啟動設定：{error}"
        return _start_server_impl(allow_invalid_ops, java_path, bool(java_candidate_id))


def _start_server_impl(
    allow_invalid_ops: bool,
    java_path: str,
    selected_java: bool,
) -> tuple[bool, str]:
    global server_process, _current_start_output

    if is_server_running():
        return False, "伺服器已經在執行中"

    from backend.external_server import port_is_open
    from backend.server_status import load_server_host_from_properties, load_server_port_from_properties
    if port_is_open(load_server_host_from_properties(), load_server_port_from_properties()):
        return False, "伺服器連接埠已被使用。若已手動啟動 Minecraft，請先關閉，再從 OxOcraft-Manager 啟動。"

    clear_server_start_failure()

    if not SERVER_JAR_PATH.exists():
        return False, f"找不到 server.jar：{SERVER_JAR_PATH}"

    # 正式啟動 Minecraft 前，最後確認 OP 資料
    try:
        from backend.player_permissions.player_permission_service import (
            get_ops_start_block,
        )

        ops_start_block = get_ops_start_block()

        if (
            ops_start_block
            and not allow_invalid_ops
        ):
            return False, ops_start_block["message"]

    except Exception as error:
        return False, (
            "無法完成管理員資料啟動檢查："
            f"{error}"
        )

    
    # Minecraft 啟動前的最後一道黑名單檢查
    # 黑名單錯誤不允許強制略過
    try:
        from backend.player_ban.player_ban_service import (
            get_ban_start_blocks,
        )

        ban_blocks = get_ban_start_blocks()

        if ban_blocks:
            details = "\n".join(
                f"• {item['label']}（{item['file']}）"
                f"：{item['reason']}"
                for item in ban_blocks
            )

            return False, (
                "黑名單資料檢查未通過：\n"
                f"{details}\n\n"
                "請先修復黑名單資料，"
                "再重新啟動伺服器。"
            )

    except Exception as error:
        return False, (
            "無法完成黑名單啟動檢查："
            f"{error}"
        )


    if SERVER_PROPERTIES_PATH.exists():
        try:
            # 正式啟動 Server 前確認管理設定已同步。
            init_rcon_config()

            management_config = load_management_config()

            start_management_api_monitor(
                host=management_config["host"],
                port=management_config["port"],
                secret=management_config["secret"],
                tls_enabled=management_config["tls_enabled"],
            )

            print(
                "[ManagementAPI] monitor ensured before server start:",
                f"host={management_config['host']}",
                f"port={management_config['port']}",
                f"tls={management_config['tls_enabled']}",
            )

        except Exception as error:
            return False, (
                "Management API 初始化失敗："
                f"{type(error).__name__}: {error}"
            )

    else:
        # Minecraft 第一次啟動時，server.properties 尚未生成。
        # 這次只啟動 server.jar，讓 Minecraft 產生必要檔案。
        print(
            "[ManagementAPI] server.properties 尚未生成，"
            "略過 Management API 初始化"
        )

    props = {}

    if SERVER_PROPERTIES_PATH.exists():
        props = read_properties_file(SERVER_PROPERTIES_PATH)

    if SERVER_PROPERTIES_PATH.exists():
        level_name = str(
            props.get(
                "level-name",
                "world",
            )
        ).strip()

        if not level_name:
            return False, (
                "目前尚未選擇世界。"
                "請先至世界管理建立新世界，"
                "或切換至現有世界後再啟動伺服器。"
            )

    server_ip = props.get("server-ip", "")

    bind_ip_ok, bind_ip_message = (
        validate_server_bind_ip(server_ip)
    )

    if not bind_ip_ok:
        return False, bind_ip_message

    try:
        runtime_config = load_runtime_config()
        memory_args = []
        for key, flag, default in (("java_xms", "-Xms", "1G"), ("java_xmx", "-Xmx", "4G")):
            value = str(runtime_config.get(key, default)).strip()
            if not re.fullmatch(r"[1-9][0-9]*[kKmMgG]?", value):
                return False, f"Java 記憶體設定格式錯誤：{key}={value}"
            memory_args.append(flag + value)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        return False, f"無法讀取 Java 記憶體設定：{error}"

    clear_server_start_failure()
    clear_server_start_warning()

    set_server_runtime_state("starting")
    
    lock_current_server_port()
    lock_current_server_host()
    lock_current_rcon_settings()
    lock_current_world_path()


    attempt = java_runtime.begin_attempt(java_path, selected_java)
    from backend.server_resources import prepare_resource_agent, bind_resource_process
    command = [
        java_path,
        *memory_args,
        *prepare_resource_agent(attempt["attempt_id"]),
        "-jar",
        "server.jar",
        "nogui",
    ]

    try:
        with _start_output_lock:
            _current_start_output = []
        startup_logs = _current_start_output

        clear_log_cache()
        server_process = subprocess.Popen(
            command,
            cwd=SERVER_ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        bind_resource_process(server_process)
        _output_finished.clear()
        print("[Runtime Debug] server process started:", server_process.pid)

        if SERVER_PROPERTIES_PATH.exists():
            try:
                save_effective_settings_snapshot()
            except Exception as error:
                print("[ServerStartup] 無法保存設定快照：", error)

        threading.Thread(
            target=_read_server_output,
            args=(server_process, startup_logs, attempt),
            daemon=True,
        ).start()
        return True, "伺服器啟動成功"
    except Exception as error:
        error_output = (
            f"執行指令：{subprocess.list2cmdline(command)}\n"
            f"工作目錄：{SERVER_ROOT}\n\n"
            f"{type(error).__name__}: {error}"
        )
        with _start_output_lock:
            startup_logs.append(error_output)
        failure = {
            "error_code": "server_launch_error",
            "title": "伺服器啟動指令執行失敗",
            "message": "啟動程序時發生錯誤，請查看下方輸出。",
            "exit_code": None,
            **read_start_failure_log(startup_logs),
        }
        failure.update(java_runtime.fail_attempt(attempt["attempt_id"]))
        record_server_start_failure(failure)
        _output_finished.set()
        set_server_runtime_state("offline")
        return False, f"伺服器啟動失敗：{error}"


def stop_server() -> tuple[bool, str]:
    global server_process

    if not is_server_running():
        return False, "伺服器未運行"

    try:
        set_server_runtime_state("stopping")
        send_command("stop")
        return True, "正在關閉伺服器"
    except Exception as error:
        return False, str(error)
    
def load_runtime_config() -> dict:
    if not CONFIG_PATH.exists():
        return {
            "java_xms": "1G",
            "java_xmx": "4G",
        }

    with CONFIG_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)
    

def lock_current_world_path() -> Path | None:
    global CURRENT_LEVEL_NAME, CURRENT_WORLD_PATH

    level_name = "world"

    try:
        if SERVER_PROPERTIES_PATH.exists():
            props = read_properties_file(
                SERVER_PROPERTIES_PATH
            )

            level_name = str(
                props.get(
                    "level-name",
                    "world",
                )
            ).strip()

    except Exception:
        level_name = "world"

    CURRENT_LEVEL_NAME = level_name

    CURRENT_WORLD_PATH = (
        MC_ROOT / level_name
        if level_name
        else None
    )

    return CURRENT_WORLD_PATH


def get_current_world_path() -> Path | None:
    # CURRENT_LEVEL_NAME 已初始化，
    # 但 CURRENT_WORLD_PATH 為 None，
    # 代表合法的「沒有選擇世界」狀態。
    if CURRENT_LEVEL_NAME is not None:
        return CURRENT_WORLD_PATH

    return lock_current_world_path()


def get_current_level_name() -> str:
    if CURRENT_LEVEL_NAME is not None:
        return CURRENT_LEVEL_NAME

    lock_current_world_path()

    return CURRENT_LEVEL_NAME or ""





