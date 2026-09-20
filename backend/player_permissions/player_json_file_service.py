import json
from pathlib import Path


def build_json_file_result(
    *,
    status: str,
    entries: list | None = None,
    error_code: str | None = None,
    message: str = "",
) -> dict:
    return {
        "status": status,
        "entries": entries,
        "error_code": error_code,
        "message": message,
    }


def load_player_json_file(
    file_path: Path,
) -> dict:
    if not file_path.exists():
        return build_json_file_result(
            status="valid",
            entries=[],
        )

    try:
        content = file_path.read_text(
            encoding="utf-8"
        )
    except OSError:
        return build_json_file_result(
            status="invalid",
            entries=None,
            error_code="file_read_error",
            message="無法讀取 JSON 檔案",
        )

    if not content.strip():
        return build_json_file_result(
            status="invalid",
            entries=None,
            error_code="empty_file",
            message="JSON 檔案內容為空",
        )

    try:
        data = json.loads(content)
    except json.JSONDecodeError:
        return build_json_file_result(
            status="invalid",
            entries=None,
            error_code="invalid_json",
            message="JSON 格式錯誤",
        )

    if not isinstance(data, list):
        return build_json_file_result(
            status="invalid",
            entries=None,
            error_code="invalid_root_type",
            message="JSON 最外層格式必須為陣列",
        )

    return build_json_file_result(
        status="valid",
        entries=data,
    )