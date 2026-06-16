# 專案結構（Project Structure）

> 最後更新：v0.9.0

---

# 這份文件的目的

本文件主要介紹 OxOcraft-Manager 的整體專案架構，協助開發者快速了解各資料夾的用途，以及不同模組之間的職責。

如果你是第一次閱讀 OxOcraft-Manager 原始碼，建議先閱讀本文件，再依序閱讀 Backend、Frontend 與各功能文件。

---

# 專案目錄

```
OxOcraft-Manager/
│
├── backend/
├── docs/
├── static/
├── templates/
│
├── app.py
├── README.md
└── requirements.txt
```

---

# 專案架構概覽

整個專案大致可分成四個主要部分：

| 資料夾          | 用途                          |
| ------------ | --------------------------- |
| `backend/`   | 後端功能與伺服器邏輯                  |
| `static/`    | 前端資源（JavaScript、CSS、圖片、字型等） |
| `templates/` | HTML 模板                     |
| `docs/`      | 專案文件與開發文件                   |

除此之外，根目錄也包含 Flask 啟動程式、README、建置腳本等專案入口。

---

# backend/

Backend 負責 OxOcraft-Manager 的所有核心邏輯。

包含：

* Minecraft Server 控制
* Server 狀態監控
* 玩家資料管理
* Backup
* Server Settings
* Database
* RCON
* Log 解析
* API Routes

Backend 也是整個專案最主要的商業邏輯所在。

詳細架構請參考：

> backend.md

---

# static/

Static 用來存放所有前端資源。

主要包含：

* CSS
* JavaScript
* Icons
* Fonts
* Images
* Sounds
* JSON 設定資料

其中：

* `static/js/modules/` 為主要前端功能模組。
* `static/css/` 為 UI 樣式。
* `static/icons/` 為介面使用素材。

詳細內容請參考：

> frontend.md

---

# templates/

Templates 存放所有 HTML 模板。

目前採用：

* 主頁 (`index.html`)
* Modal Component

大部分功能頁皆以 Modal 方式載入，而不是建立獨立頁面。

---

# docs/

Docs 存放專案相關文件。

主要分為：

* README
* 開發文件
* 架構文件
* 功能文件

目的不是取代程式碼，而是協助理解整體設計理念與實作方式。

---

# app.py

`app.py` 為 OxOcraft-Manager 的主要入口。

負責：

* Flask 初始化
* 註冊 Routes
* 啟動 Backend
* 啟動監控服務
* 初始化系統

---

# 建議閱讀順序

如果是第一次閱讀專案，建議依照以下順序：

1. README.md
2. project-structure.md（本文件）
3. backend.md
4. frontend.md
5. database.md
6. 各功能文件（Features）

依照此順序閱讀，可以更容易理解 OxOcraft-Manager 的整體設計與各模組之間的關係。
