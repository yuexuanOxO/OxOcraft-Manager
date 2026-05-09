# OxOcraft-Manager 打包說明

## 目標

使用 PyInstaller 的 `onedir` 模式打包成 portable 版本。

不打包：

- `server.jar`
- `google_token.enc`
- `backend/instance/oxocraft.db`
- `world/`
- `world_backup/`
- `venv/`
- `__pycache__/`
- `.git/`

會打包：

- `app.py`
- Python 程式碼
- `templates/`
- `static/`
- `backend/credentials/google_credentials.json`

## 使用方式

把這兩個檔案放到專案根目錄：

- `OxOcraft-Manager.spec`
- `build.bat`

然後執行：

```bat
build.bat
```

輸出位置：

```text
dist/OxOcraft-Manager/OxOcraft-Manager.exe
```

## 發佈時的建議結構

```text
OxOcraft-Manager/
├── OxOcraft-Manager.exe
├── server.jar              ← 使用者自己放
├── server.properties       ← server 生成或由工具管理
├── eula.txt
├── world/
├── world_backup/
└── _internal/              ← PyInstaller 產生
```

## Google Drive

`google_credentials.json` 會被包進程式。

`google_token.enc` 不會被包，會在使用者第一次連接 Google Drive 後於本機產生。
