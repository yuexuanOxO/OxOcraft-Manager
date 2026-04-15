from pathlib import Path
from flask import Flask, render_template, jsonify
import socket

app = Flask(__name__)

# 這裡先改成你的 latest.log 實際路徑
LOG_FILE = Path(r"..\logs\latest.log")


def is_server_online(host="127.0.0.1", port=25565, timeout=1):
    try:
        with socket.create_connection((host,port), timeout = timeout):
            return True
    except OSError:
        return False
    


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


@app.route("/")
def index():
    logs = "".join(read_last_lines(LOG_FILE, max_lines=100))
    return render_template("index.html", logs=logs)


@app.route("/status")
def get_status():
    response = jsonify({
        "online": is_server_online()
    })
    response.headers["Cache-Control"] = "no-store"
    return response


@app.route("/log")
def get_log():
    logs = "".join(read_last_lines(LOG_FILE, max_lines=100))
    return jsonify({"logs": logs})


if __name__ == "__main__":
    app.run(debug=True)