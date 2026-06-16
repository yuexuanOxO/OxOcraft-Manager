# Frontend 架構（Frontend Architecture）

> 最後更新：v0.9.0

---

# 這份文件的目的

Frontend 負責 OxOcraft-Manager 的使用者介面（UI）與互動邏輯。

本文件主要介紹前端的整體架構、模組分工以及設計理念，協助開發者快速了解 Frontend 的組織方式。

詳細功能請參考各功能文件。

---

# Frontend 目錄

```text
static/
│
├── css/
├── js/
├── icons/
├── fonts/
├── img/
├── sounds/
└── data/

templates/
│
├── index.html
└── components/
```

Frontend 採用 **HTML + CSS + JavaScript** 的方式開發。

大部分功能都集中於單一頁面，並透過 Modal 的方式開啟不同功能，而不是切換到新的網頁。

---

# templates/

`templates/` 負責 HTML 結構。

目前包含：

* 首頁 (`index.html`)
* 各功能 Modal
* 共用 Dialog

新的功能通常會先建立對應的 Modal，再由 JavaScript 控制顯示與互動。

---

# static/js/

JavaScript 負責：

* UI 互動
* API 呼叫
* 畫面更新
* Modal 控制
* 玩家操作
* Server 狀態同步

目前主要功能集中於：

```text
static/js/modules/
```

每個模組盡可能只負責一項功能。

例如：

* Server
* Backup
* Player Ban
* Whitelist
* Server Settings

---

# static/css/

CSS 採用模組化方式管理。

目前分為：

* Base
* Layout
* Components
* Pages

共同樣式集中管理，各功能頁再建立自己的樣式，避免不同功能互相影響。

---

# static/icons/

存放介面所使用的圖示。

大部分素材皆依照功能分類，例如：

* backup/
* player_ban/
* server_settings/

方便管理與後續維護。

---

# static/img/

存放圖片素材。

例如：

* 玩家預設 Skin
* Mob 圖片
* 其他展示圖片

與 icons 不同，img 主要放較大的圖片素材。

---

# static/data/

存放前端所需的 JSON 設定。

例如：

* config.json
* server_effective_settings.json
* server_properties_fields.json

避免將大量靜態資料直接寫在 JavaScript 中。

---

# Frontend 設計理念

Frontend 主要遵循以下原則：

* 一個模組負責一項功能。
* UI 與功能盡可能分離。
* 共用元件集中管理。
* 保持一致的操作體驗。
* 優先維持 Minecraft 風格。

---

# 下一份文件

閱讀完 Frontend 後，建議繼續閱讀：

* database.md

之後再依需求閱讀各功能文件。
