from flask import Blueprint, render_template

from backend.paths import LOG_FILE_PATH
from backend.log_reader import read_last_lines
from backend.server_status import is_server_online


page_bp = Blueprint("page", __name__)


@page_bp.route("/")
def index():
    logs = "".join(read_last_lines(LOG_FILE_PATH, max_lines=100))
    server_online = is_server_online()
    return render_template("index_zh.html", logs=logs, server_online=server_online)