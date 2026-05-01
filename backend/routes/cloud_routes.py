import json
import os
import requests
import threading

from flask import Blueprint, jsonify, redirect, request, session
from pathlib import Path
from backend.server_monitor import publish_event
from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload
from backend.db import get_latest_success_backup


cloud_bp = Blueprint("cloud", __name__)

BASE_DIR = Path(__file__).resolve().parents[1]
CREDENTIAL_DIR = BASE_DIR / "credentials"

CLIENT_SECRET_FILE = CREDENTIAL_DIR / "google_credentials.json"
TOKEN_FILE = CREDENTIAL_DIR / "google_token.json"
os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"
DEFAULT_CLOUD_KEEP_COUNT = 2

SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/drive.file",
]

REDIRECT_URI = "http://127.0.0.1:5000/api/cloud/google/callback"


def save_token(creds):
    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")


def load_token():
    if not TOKEN_FILE.exists():
        return None

    return Credentials.from_authorized_user_file(
        str(TOKEN_FILE),
        SCOPES
    )


def get_drive_service():
    creds = load_token()

    if not creds:
        return None

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_token(creds)

    return build("drive", "v3", credentials=creds)


def get_or_create_drive_folder(service, folder_name, parent_id=None):
    query = (
        f"name = '{folder_name}' "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )

    if parent_id:
        query += f" and '{parent_id}' in parents"

    result = service.files().list(
        q=query,
        spaces="drive",
        fields="files(id, name)"
    ).execute()

    folders = result.get("files", [])

    if folders:
        return folders[0]["id"]

    metadata = {
        "name": folder_name,
        "mimeType": "application/vnd.google-apps.folder"
    }

    if parent_id:
        metadata["parents"] = [parent_id]

    folder = service.files().create(
        body=metadata,
        fields="id"
    ).execute()

    return folder["id"]

def cleanup_old_cloud_backups(service, folder_id, keep_count=DEFAULT_CLOUD_KEEP_COUNT):
    if keep_count <= 0:
        return

    result = service.files().list(
        q=f"'{folder_id}' in parents and trashed = false",
        spaces="drive",
        fields="files(id, name, createdTime)",
        orderBy="createdTime desc"
    ).execute()

    files = result.get("files", [])

    old_files = files[keep_count:]

    for file in old_files:
        file_id = file["id"]

        # 直接永久刪除，不丟垃圾桶
        service.files().delete(
            fileId=file_id
        ).execute()

    if old_files:
        print(f"雲端舊備份清理完成，刪除 {len(old_files)} 筆")




@cloud_bp.route("/api/cloud/google/login")
def api_google_login():

    if not CLIENT_SECRET_FILE.exists() or CLIENT_SECRET_FILE.stat().st_size == 0:
        return jsonify({
            "success": False,
            "message": "尚未設定 Google OAuth 憑證"
        }), 400

    flow = Flow.from_client_secrets_file(
        str(CLIENT_SECRET_FILE),
        scopes=SCOPES
    )

    flow.redirect_uri = REDIRECT_URI

    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent"
    )

    session["google_oauth_state"] = state
    session["google_code_verifier"] = flow.code_verifier

    return redirect(auth_url)


@cloud_bp.route("/api/cloud/google/callback")
def api_google_callback():

    flow = Flow.from_client_secrets_file(
        str(CLIENT_SECRET_FILE),
        scopes=SCOPES,
        state=session.get("google_oauth_state")
    )

    flow.redirect_uri = REDIRECT_URI
    flow.code_verifier = session.get("google_code_verifier")

    flow.fetch_token(
        authorization_response=request.url,
        include_client_id=True
    )

    creds = flow.credentials
    save_token(creds)

    return redirect("/")


@cloud_bp.route("/api/cloud/google/status")
def api_google_status():
    creds = load_token()

    if not creds:
        return jsonify({
            "connected": False
        })

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        save_token(creds)

    headers = {
        "Authorization": f"Bearer {creds.token}"
    }

    r = requests.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers=headers
    )

    email = "已連接 Google 帳號"

    if r.status_code == 200:
        user = r.json()
        email = user.get("email", email)

    return jsonify({
        "connected": True,
        "email": email
    })


@cloud_bp.route("/api/cloud/google/disconnect", methods=["POST"])
def api_google_disconnect():
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()

    return jsonify({
        "success": True
    })


_cloud_upload_running = False


@cloud_bp.route("/api/cloud/google/upload-latest", methods=["POST"])
def api_google_upload_latest():
    global _cloud_upload_running

    if _cloud_upload_running:
        return jsonify({
            "success": False,
            "message": "已有雲端上傳進行中"
        }), 409

    thread = threading.Thread(target=cloud_upload_latest_worker, daemon=True)
    thread.start()

    return jsonify({
        "success": True,
        "message": "已開始雲端上傳"
    })


def cloud_upload_latest_worker():
    global _cloud_upload_running

    _cloud_upload_running = True

    try:
        service = get_drive_service()

        if not service:
            raise Exception("尚未連接 Google Drive")

        record = get_latest_success_backup()

        if not record:
            raise Exception("找不到成功的本機備份紀錄")

        backup_path = Path(record["backup_path"])

        if not backup_path.exists():
            raise FileNotFoundError(f"找不到備份檔案：{backup_path}")

        file_size = backup_path.stat().st_size

        publish_event("cloud_upload_started", {
            "status": "running",
            "percent": 0,
            "message": "雲端上傳中",
            "file_name": backup_path.name,
            "file_size": file_size,
        })

        root_folder_id = get_or_create_drive_folder(service, "OxOcraft-Backup")

        map_name = record.get("map_name") or "unknown_world"

        world_folder_id = get_or_create_drive_folder(
            service,
            map_name,
            parent_id=root_folder_id
        )

        file_metadata = {
            "name": backup_path.name,
            "parents": [world_folder_id]
        }

        media = MediaFileUpload(
            str(backup_path),
            mimetype="application/zip",
            resumable=True,
            chunksize=1024 * 1024
        )

        request_upload = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id, name, webViewLink"
        )

        response = None
        last_percent = -1

        while response is None:
            status, response = request_upload.next_chunk()

            if status:
                percent = int(status.progress() * 100)

                if percent != last_percent:
                    last_percent = percent

                    publish_event("cloud_upload_progress", {
                        "status": "running",
                        "percent": percent,
                        "message": "雲端上傳中",
                        "file_name": backup_path.name,
                        "file_size": file_size,
                    })

        cleanup_old_cloud_backups(
            service,
            world_folder_id,
            keep_count=DEFAULT_CLOUD_KEEP_COUNT
        )

        publish_event("cloud_upload_finished", {
            "status": "success",
            "percent": 100,
            "message": "雲端上傳完成",
            "file_name": response.get("name"),
            "file_id": response.get("id"),
            "webViewLink": response.get("webViewLink"),
        })

    except Exception as error:
        publish_event("cloud_upload_failed", {
            "status": "failed",
            "percent": 0,
            "message": str(error),
        })

    finally:
        _cloud_upload_running = False