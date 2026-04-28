from backend.paths import SERVER_JAR_PATH, EULA_PATH, SERVER_PROPERTIES_PATH
from backend.config_files import read_eula_file


def get_server_setup_status() -> dict:
    server_jar_exists = SERVER_JAR_PATH.exists()
    eula_exists = EULA_PATH.exists()
    server_properties_exists = SERVER_PROPERTIES_PATH.exists()

    stage = "unknown"
    message = ""

    if not server_jar_exists:
        stage = "missing_server_jar"
        message = "找不到 server.jar，請確認 server.jar 已放在 Minecraft server 資料夾中。"

    elif not eula_exists:
        stage = "need_first_run"
        message = "尚未產生 eula.txt，請先啟動一次伺服器，讓 Minecraft 產生 EULA 檔案。"

    elif not server_properties_exists:
        stage = "need_first_run"
        message = "尚未產生 server.properties，請先啟動一次伺服器，讓 Minecraft 產生必要設定檔。"

    else:
        eula_info = read_eula_file()

        if not eula_info["accepted"]:
            stage = "need_accept_eula"
            message = "請先同意 Minecraft EULA 後再啟動伺服器。"
        else:
            stage = "ready"
            message = "伺服器必要檔案已就緒。"

    return {
        "success": True,
        "stage": stage,
        "message": message,
        "server_jar_exists": server_jar_exists,
        "eula_exists": eula_exists,
        "server_properties_exists": server_properties_exists,
    }