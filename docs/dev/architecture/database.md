# Database 架構（Database Architecture）

> 最後更新：v0.9.0

---

# 這份文件的目的

OxOcraft-Manager 使用 SQLite 作為主要資料庫。

本文件主要介紹 Database 在整個系統中的角色、設計理念以及資料存放方式。

詳細的資料表結構請參考各功能文件，或未來的 Database Schema 文件。

---

# 為什麼使用 Database？

Minecraft Server 本身的資料分散在不同地方，例如：

* Log
* JSON 檔案
* server.properties
* RCON

如果前端直接讀取這些資料，不但需要重複解析，也容易造成不同來源之間的資料不一致。

因此 OxOcraft-Manager 會先將資料整理並同步至 Database，再統一提供給前端使用。

---


# 為什麼選擇 SQLite？

OxOcraft-Manager 選擇 SQLite，是因為它最符合本專案的定位。

本專案主要負責管理 Minecraft Server 的玩家資料、伺服器狀態與操作紀錄，並不需要處理大量資料或高併發的存取情境。同時，部分歷史資料也會依照設定自動清理，避免資料庫持續成長，因此 SQLite 已能提供足夠的效能與穩定性。

此外，SQLite 不需要額外安裝資料庫服務或進行繁瑣的設定，所有資料皆儲存在單一檔案中，讓使用者下載 OxOcraft-Manager 後即可直接使用，也更符合本專案希望降低使用門檻的理念。


---

# Database 的角色

Database 的主要用途，是將來自 Minecraft Server 的資料整理成統一的格式，提供 OxOcraft-Manager 查詢、管理與顯示。

它的主要用途包括：

* 統一資料來源
* 快速查詢
* 保存歷史紀錄
* 提供 Frontend 顯示資料
* 降低重複解析 Minecraft 原始資料的成本

---

# Database 在系統中的位置

```text
Minecraft Server
        │
        ▼
Backend Services
        │
        ▼
SQLite Database
        │
        ▼
Flask API
        │
        ▼
Frontend UI
```

Backend 負責更新 Database。

Frontend 則透過 API 讀取 Database，而不是直接操作 Minecraft Server。

---

# 主要資料類型

目前 Database 主要保存以下幾類資料：

* 玩家資料
* 玩家權限
* 白名單
* 黑名單
* IP 資料
* 操作歷史
* 系統狀態

實際資料表可能會隨著版本持續調整。

---

# 設計理念

Database 設計主要遵循以下原則：

* Minecraft Server 仍然是最終資料來源。
* Database 作為 OxOcraft-Manager 的資料中心。
* 避免 Frontend 重複解析 Minecraft 原始資料。
* 保留必要的歷史紀錄。
* 降低不同模組之間的耦合。

---

# 未來規劃

未來將補充：

* Database Schema
* ER Diagram
* 各資料表詳細說明
* 各功能與資料表之間的關聯
