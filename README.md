# OxOcraft-Manager

一款以 Minecraft 像素風格打造的 Minecraft Server 管理工具。  
使用 Flask 與 Python 開發，提供本機備份、Google Drive 雲端備份、伺服器管理與 Minecraft 風格 UI。

---

# 專案介紹

OxOcraft-Manager 是一款偏向桌面工具體驗的 Minecraft Server 管理平台。

相較於傳統以功能為主的 Server Panel，本專案更重視：

- Minecraft 風格 UI
- 視覺化操作體驗
- 備份管理
- 本機化部署
- 輕量化管理

整體介面以 Minecraft Achievement、像素風格與遊戲 UI 作為設計靈感。

---

# 主要功能

## Minecraft Server 管理

- 啟動 / 關閉 Minecraft Server
- 即時 Server 狀態監控
- Minecraft Query 狀態偵測
- RCON 指令執行
- 玩家列表顯示

---

## 備份系統

- Minecraft 世界本機備份
- 自動備份排程
- ZIP 壓縮
- 備份紀錄管理
- 自動刪除舊備份
- 多世界備份支援

---

## Google Drive 雲端備份

- Google OAuth 登入
- Google Drive 雲端備份
- 雲端備份紀錄
- 自動清理舊雲端備份
- 備份保留數量設定

---

## Minecraft 風格 UI

- 像素風介面
- Minecraft Achievement 風格功能卡片
- Minecraft 風格按鈕與動畫
- Death Record 死亡紀錄系統
- 自訂像素 Icon

---

# 技術架構

| 類型 | 技術 |
|---|---|
| Backend | Python / Flask |
| Frontend | HTML / CSS / JavaScript |
| Database | SQLite |
| Packaging | PyInstaller |
| Cloud Backup | Google Drive API |
| Version Control | Git / GitHub |

---

# 專案結構

```txt
OxOcraft-Manager/
├── backend/
├── static/
│   ├── css/
│   ├── js/
│   ├── icons/
│   └── data/
├── templates/
├── docs/
├── app.py
└── README.md
```

---

# Google Drive OAuth

OxOcraft-Manager 使用 Google Drive API 提供 Minecraft 世界雲端備份功能。

本工具僅會存取：

- 由 OxOcraft-Manager 建立或管理的備份檔案
- Google 帳號基本資訊

不會讀取或存取使用者其他 Google Drive 檔案。

---

# OAuth 相關頁面

## 首頁

https://yuexuanoxo.github.io/OxOcraft-Manager/

## 隱私權政策

https://yuexuanoxo.github.io/OxOcraft-Manager/privacy.html

## 使用條款

https://yuexuanoxo.github.io/OxOcraft-Manager/terms.html

---

# 開發狀態

目前專案仍持續開發中。

目前正在進行：

- UI 模組化整理
- CSS 架構拆分
- 備份系統優化
- Google Drive OAuth 整合
- 打包流程優化
- 效能與載入優化

---

# 未來規劃

- 更完整的資源預載系統
- 更流暢的 UI 動畫
- 插件管理功能
- 多伺服器管理
- 遠端管理功能
- Discord 整合
- 更完整的備份管理 UI

---

# 免責聲明

OxOcraft-Manager 為非官方 Minecraft 工具。

Minecraft 為 Mojang Studios 的商標。

本專案與 Mojang 或 Microsoft 無任何關聯。

---

# 作者

GitHub：

https://github.com/yuexuanOxO
