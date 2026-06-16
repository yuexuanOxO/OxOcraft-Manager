# 功能文件模板（Feature Documentation Template）

> 定義 OxOcraft-Manager 所有功能文件的撰寫格式，確保各功能文件保持一致的結構與閱讀體驗。

---

# 文件資訊

| 項目   | 內容                 |
| ---- | ------------------ |
| 文件版本 | v1.0.0             |
| 狀態   | 正式啟用               |
| 適用範圍 | docs/dev/features/ |
| 最後更新 | YYYY/MM/DD         |

---

# 功能名稱

簡短介紹此功能的用途，以及它主要解決什麼問題。

---

# 功能目的

說明：

* 為什麼需要這個功能？
* 它解決了哪些問題？
* 使用者什麼情況下會使用它？

重點放在「為什麼」。

---

# 設計理念

介紹此功能的設計思路。

例如：

* 為什麼這樣設計？
* 是否遵循 Minecraft 原生機制？
* 是否有刻意保留某些限制？

---

# 使用情境

列出常見的使用方式。

例如：

* Server 在線
* Server 離線
* Online Mode
* Offline Mode

以及不同情境下的差異。

---

# UI 介紹

搭配圖片介紹介面。

建議每張圖片只說明一個重點。

例如：

* 主畫面
* 設定視窗
* 操作流程

避免大量文字描述圖片內容。

---

# 功能流程

使用流程圖或文字描述功能的執行流程。

例如：

```text
使用者操作
        │
        ▼
Frontend
        │
        ▼
Backend
        │
        ▼
Minecraft Server
```

若功能有不同流程，可分別說明。

---

# 資料流程

介紹資料如何流動。

例如：

```text
Minecraft
    ↓
Backend
    ↓
Database
    ↓
Frontend
```

若沒有特殊資料流，可簡單說明即可。

---

# Backend

介紹此功能涉及的 Backend 模組。

例如：

* Route
* Service
* Scheduler
* Monitor

不需要詳細解釋程式碼，而是說明各模組的職責。

---

# Frontend

介紹此功能涉及的 Frontend。

例如：

* JavaScript Module
* CSS
* HTML
* Dialog

說明各部分負責什麼。

---

# Database

介紹此功能使用的資料表或主要資料。

例如：

* players
* player_access_history
* ip_records

若沒有使用 Database，可註明。

---

# 注意事項

列出此功能需要特別注意的地方。

例如：

* Server 必須重新啟動
* Online Mode 限制
* Minecraft 原生限制
* 已知限制

---

# 未來規劃（選填）

若此功能已有明確規劃，可簡單記錄。

若尚未規劃，可省略此章節。

---

# 文件撰寫原則

所有功能文件皆應遵循以下原則：

* 一份文件介紹一個功能。
* 一個章節回答一個問題。
* 先說「為什麼」，再說「怎麼做」。
* 優先使用圖片說明。
* 不重複介紹其他文件已說明的內容。
* 若需引用架構內容，請連結至對應文件，而不是重複撰寫。
