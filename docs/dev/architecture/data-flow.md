# 資料流（Data Flow）

> 最後更新：v0.9.0

---

# 這份文件的目的

OxOcraft-Manager 並不是直接操作 Minecraft Server。

而是透過不同來源取得資料，再經過整理、同步與儲存，最後提供給前端 UI 顯示。

本文件主要介紹資料在 OxOcraft-Manager 中的流向，以及各模組之間的關係。

---

# 整體資料流

```text
Minecraft Server
        │
        │
        ├─────────────┐
        │             │
        ▼             ▼
     Log          JSON Files
        │             │
        └──────┬──────┘
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

大部分資料都會經過 Backend 整理後，再統一由 Database 提供給 Frontend。

Frontend 盡可能不直接解析 Minecraft 原始資料。

---

# Minecraft Server

Minecraft Server 是所有資料的來源。

例如：

* Server Log
* JSON 檔案
* RCON 指令
* Server Properties

不同資料會由不同模組負責讀取。

---

# Backend Services

Backend 負責：

* 解析資料
* 驗證資料
* 同步資料
* 更新 Database
* 提供 API

Backend 是所有資料流的核心。

---

# SQLite Database

Database 作為目前主要的資料來源。

Frontend 顯示的大部分資料皆來自 Database，而不是直接讀取 Minecraft Server。

這樣可以：

* 降低重複解析成本
* 統一資料格式
* 保留歷史紀錄
* 提供更快的查詢速度

---

# Flask API

Frontend 不直接存取 Database。

所有資料皆透過 Flask API 提供。

API 負責：

* 查詢資料
* 更新資料
* 呼叫 Backend 功能

---

# Frontend UI

Frontend 負責：

* 顯示資料
* 接收使用者操作
* 呼叫 API
* 更新畫面

Frontend 本身盡可能不處理 Minecraft 的商業邏輯。

---

# 為什麼需要 Database？

Minecraft Server 的資料來源非常分散。

例如：

* Log
* JSON
* RCON
* Server Properties

如果 Frontend 每次都直接讀取這些資料，不但會增加實作複雜度，也容易因不同來源造成資料不一致。

因此 OxOcraft-Manager 會先將資料同步到 Database，再統一提供給 Frontend 使用。

---

# 設計理念

資料流主要遵循以下原則：

* Minecraft Server 為資料來源。
* Backend 負責整理資料。
* Database 作為主要資料來源。
* API 負責資料交換。
* Frontend 專注於畫面呈現。

透過這樣的分工，可以降低模組之間的耦合程度，也讓功能更容易維護與擴充。
