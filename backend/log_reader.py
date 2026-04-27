from pathlib import Path


def read_last_lines(file_path: Path, max_lines: int = 100) -> list[str]:
    """讀取文字檔最後幾行。"""
    if not file_path.exists():
        return [f"[OxO_MCServerManager] 找不到 log 檔案: {file_path}"]

    try:
        with file_path.open("r", encoding="utf-8", errors="replace") as file:
            lines = file.readlines()
        return lines[-max_lines:]

    except Exception as error:
        return [f"[OxO_MCServerManager] 讀取 log 失敗: {error}"]