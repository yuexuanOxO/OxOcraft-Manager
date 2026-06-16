# Backend 架構（Backend Architecture）

> 最後更新：v0.9.0

---

# 這份文件的目的

Backend 是 OxOcraft-Manager 的核心。

本文件主要介紹 Backend 的整體架構、各模組職責以及資料流方向，協助開發者快速了解 Backend 的設計方式。

本文件不會介紹各功能的詳細實作，詳細內容請參考各功能文件。

---

# Backend 目錄

```text
backend/
│
├── routes/
├── player_permissions/
├── player_ban/
├── server_settings/
├── datapacks/
│
├── db.py
├── rcon_service.py
├── server_monitor.py
├── server_runtime.py
├── server_status.py
├── server_setup.py
├── log_reader.py
└── ...
```

Backend 採用 **功能模組（Feature-based）** 的方式組織，而不是依照資料型態分類。

每個模組盡可能負責一項明確的功能，降低模組之間的耦合程度。

---

# routes/

`routes/` 負責提供前端呼叫的 API。

例如：

* Server
* Backup
* Player Ban
* Player
* Notification
* Server Settings

Routes 本身不應包含大量商業邏輯。

主要職責為：

* 接收 Request
* 驗證資料
* 呼叫 Service
* 回傳 Response

---

# player_permissions/

負責玩家權限相關功能。

目前包含：

* OP 管理
* 白名單
* Player Identity
* 玩家登入紀錄
* 權限歷史紀錄

此模組主要負責與 Minecraft 玩家資料相關的管理。

---

# player_ban/

負責玩家封鎖功能。

目前包含：

* 玩家封鎖
* IP 封鎖
* 到期解除排程
* 黑名單同步

所有 Ban 相關功能皆集中於此模組。

---

# server_settings/

負責 Minecraft Server Settings。

包含：

* server.properties
* 設定同步
* 設定驗證

目的為統一管理 Minecraft Server 的各項設定。

---

# datapacks/

負責 OxOcraft 官方 Datapack。

目前包含：

* Core Datapack
* Death Record Datapack

---

# 共用服務（Shared Services）

Backend 也包含許多共用服務。

例如：

| 檔案                  | 主要用途              |
| ------------------- | ----------------- |
| `db.py`             | Database 管理       |
| `rcon_service.py`   | Minecraft RCON 通訊 |
| `log_reader.py`     | Minecraft Log 解析  |
| `server_monitor.py` | Server 狀態監控       |
| `server_runtime.py` | Server 執行狀態       |
| `server_status.py`  | Server 狀態管理       |
| `server_setup.py`   | Server 初始化        |

這些模組會被多個功能共同使用，因此集中管理，而不是歸屬於單一功能。

---

# Backend 設計理念

Backend 主要遵循以下原則：

* 一個模組負責一項主要功能。
* 共用功能集中管理。
* Routes 不負責商業邏輯。
* Service 負責主要功能實作。
* Database 作為主要資料來源。

---

# 下一份文件

閱讀完 Backend 後，建議繼續閱讀：

* frontend.md
* database.md

之後再依需求閱讀各功能文件。
