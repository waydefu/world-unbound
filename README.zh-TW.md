# WORLD UNBOUND

[English](README.md) | 繁體中文

> 本文件為 README.md 的翻譯；若有出入，以英文版為準。

一個從可驗證的 GitHub 治理基線出發的開源專案。

**要接手工作嗎？** 請先閱讀 [AGENTS.md](AGENTS.md)，再閱讀 [docs/HANDOFF.md](docs/HANDOFF.md) 與 [docs/INDEX.md](docs/INDEX.md)。GitHub 雲端開發工具請參閱 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。

## 目前狀態

- **治理 M0：** 已於 2026-11-17 完成（負向測試通過）。獨立的雙人審查仍是未達成的控制項。
- **治理 M1：** 代理端已完成（[狀態](docs/governance/status.md)）。
- **遊戲 G0（引擎骨架）：** Vite + TypeScript + three.js WebGPURenderer（WebGL2 備援）、Worker 中的區塊串流、遲滯動態解析度、附 JSON 匯出的遙測 HUD、六個固定測試攝影機，以及靜態與無頭稽核。
- **遊戲 G1／G2.1 環境基礎（進行中）：** 物理天空、時間與天氣、串級陰影、真實 Hellesylt 地形、CDLOD、海洋、峽灣風場、植被遮罩與紫羊茅草毯。草叢基準 PR #32 已合併；葉根光影改善追蹤於 [#33](https://github.com/waydefu/world-unbound/issues/33)。尚無城鎮建築、玩家玩法或音訊。

較早的引擎／CDLOD 版本已有部分手機 60 FPS 驗收；**最新草叢 PR #32 尚無手機 WebGPU 幀時間及長時間溫度驗收證據**。無頭 WebGL2 與 CI 不可取代真機量測。

## 執行

```
npm ci --ignore-scripts
npm run dev      # http://localhost:5173/world-unbound/
npm run check    # typecheck, tests, build, audits
```

啟用 Pages 後，網站將提供於 https://waydefu.github.io/world-unbound/。除錯參數：`?cam=0..5 &backend=webgpu|webgl2 &q=low|med|high &scale=0.5..1.5 &hour=0..24 &day=0..32 &wx=clear|cloudy|rain|storm &shadows=0`。按下 `H` 或點選 **HUD** 可顯示遙測；點選 **JSON** 可匯出報告。

## 致謝

- **地形：** © Kartverket，[Nasjonal høydemodell (NHM) DTM 1 m](https://www.kartverket.no/en/api-and-data/terms-of-use)，授權條款為 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。已修改：重新取樣為 2 m、量化為 2 cm，並合成海床。烘焙後的圖磚及其摘要列於 [assets/manifests/terrain-hellesylt.json](assets/manifests/terrain-hellesylt.json)；處理流程為 [scripts/terrain/bake-hellesylt.mjs](scripts/terrain/bake-hellesylt.mjs)。開機畫面與 HUD 會顯示 "Terrain © Kartverket (CC BY 4.0), modified"。
  - 中文說明：地形資料來自挪威 Kartverket 的國家高程模型 DTM 1 m，依 CC BY 4.0 授權使用，並已作修改。

## 治理

- [貢獻指南](CONTRIBUTING.md) · [安全性](SECURITY.md) · [行為準則](CODE_OF_CONDUCT.md)
- [AI 代理合約](AGENTS.md) · [治理字典](governance/)
- [架構與模組層級](docs/architecture/README.md) · [治理狀態](docs/governance/status.md) · [索引](docs/INDEX.md) · [開源授權](LICENSE)

權威來源為 AEGIS ∞ v2.0。此處的設定檔屬於**宣告**，直到對應的 GitHub 設定與受保護的 CI 檢查實際強制執行為止。

## CI / main 保護

每次推送至 main 以及每個以 main 為目標的 PR，CI 都會執行 `m0-files`、`policy-syntax`、`app-checks`、`visual-audit`、`dependency-review`、一個僅供參考的 `base-policy`，以及一個無條件執行的 `final-gate`（針對前五項）；ruleset 也要求 CodeQL 程式碼掃描（[M1](docs/governance/m1.md)）。`final-gate` 會拒絕失敗、已取消、已略過及未知的前置作業結論。唯一的必要檢查仍是 `final-gate`。

推送至 main 也會執行 `.github/workflows/pages.yml`，它會重新建置並重新驗證合併後的 commit，然後部署至 GitHub Pages。

main 上的首次執行已於 2026-11-17 成功（[執行紀錄 44000149061](https://github.com/waydefu/world-unbound/actions/runs/44000149061)，commit `89b10bc`），因此現在可以將 `final-gate` 選為必要檢查。

### M0 擁有者操作（GitHub 設定；AI 代理無法執行）

以下設定由擁有者套用，並於 2026-11-17 讀回確認（由擁有者回報；此處的代理無法讀取儲存庫設定）。**M0 已完成。**

- [x] protect-main Ruleset *Active*：要求 PR 且核准數為 0、過期核准會被撤銷、需解決對話、僅允許 squash、必要檢查 `final-gate`（來源為 GitHub Actions），並要求與最新狀態同步；禁止 force-push 與刪除；bypass 清單為空。
- [x] **負向測試（2026-11-17，由擁有者執行）：** 直接推送一個空 commit 至 main 被拒絕：

  ```
  remote: error: GH013: Repository rule violations
  - Changes must be made through a pull request.
  - Required status check "final-gate" is expected.
  ! [remote rejected] HEAD -> main
  ```

- [x] 標籤由 `.github/workflows/labels.yml` 依 [governance/labels.yml](governance/labels.yml) 同步。GitHub 預設標籤（`bug`、`wontfix` 等）予以保留；若要移除，可手動執行該工作流程並選擇 *prune*。
- [x] Issue Fields（Priority、Severity、Risk、Component 等）固定為 Bug / Feature / Task。Impact 與 Verification Owner 尚未建立。
- [x] 專案 *WORLD UNBOUND · Engineering*：AEGIS 狀態包含 Blocked / Needs Evidence / Not Planned；自動加入 `is:issue,pr is:open`；項目加入 → Submitted，PR 合併 → Integrated，項目重新開啟 → Triage，項目關閉 → Resolved。
- [x] 由已合併 PR 自動關閉 Issue 的功能**已關閉**，因此合併永遠不會跳過 Verified。PR 使用 `Refs #`。
- [x] 私密漏洞回報、依賴關係圖、Dependabot 警示與安全性更新、附推送保護的 secret scanning、CodeQL 預設設定。
- [x] Actions：僅允許 waydefu 與 GitHub 撰寫的 action、要求完整 SHA 固定版本、預設權杖為唯讀、Actions 無法建立或核准 PR，且所有外部貢獻者的 fork 工作流程都需要核准。
- [x] 一般：僅允許 squash 合併、啟用更新分支建議、合併後刪除 head 分支、停用 wiki。
- [x] 從 GitHub Actions 部署 Pages；`github-pages` 環境限於 `main`。

**已知缺口：** 由於只有一位維護者，獨立的雙人審查**未達成**；必要核准數為 0，因此擁有者可以合併自己的 PR。合併把關依據為 CI（`final-gate`）。

## 路線圖

治理里程碑（AEGIS ∞ v2.0）：

- **M0：** 儲存庫與治理骨架 — 已完成
- **M1：** 代理端已完成 — base-policy 重新驗證（僅供參考）、風險等級、依賴審查、例外檢查、快取禁令、lint、負向測試回歸套件；刻意的 CI 編輯仍是未達成的控制項（[狀態與限制](docs/governance/m1.md)）
- **M2：** AI 隔離、架構契約、裝置回歸路徑
- **M3：** 產物完整性、環境／OIDC 部署閘門、回滾
- **M4：** 維護與指標

遊戲里程碑（規格 v1.0，為避免與上述名稱衝突，已重新命名為 G0–G3）：

- **G0：** 引擎骨架、權威地形、遙測基線 — 已實作，裝置驗證待完成
- **G0.5：** 引擎試作已完成 — 保留 three.js，靜態幾何必須使用渲染束（[結果](docs/spikes/engine-spike.md)）；侵蝕原型品質尚不足，延後至 G1 之後（[發現](docs/spikes/terrain-erosion.md)）；建置期烘焙管線（侵蝕後地形）、共用環境與查詢契約、Worker 骨架、遙測修正 — 請見 [ADR-0002](docs/adr/0002-target-architecture.md)
- **G1：** 大氣、PBR 風化材質、多頻段海洋
  - G1.0 GPU 負載爬升（試作頁面），在加入特效前量測餘裕
  - G1.1 物理天空與大氣：北緯 62.083° 的 32 天曆法（自 G1.5 起為 Hellesylt）、太陽／月球星曆、Hillaire 2020 穿透率／多次散射／天空視圖表（CPU 計算，WebGPU 與 WebGL2 結果一致）、CIE 陰天雲層、空間透視霧、附預曝光的自動曝光；`?day=0..32`（預設 6）
  - G1.2 串級太陽陰影（每個等級 2–3 個串級，`?shadows=0` 用於 A/B 比較），以及 WebGPU 上於渲染束中的主應用程式地形
  - G1.5 真實地形：以挪威 Hellesylt 為中心的 4 km 正方形區域，由 Kartverket 的 1 m DTM 烘焙為 16 個已提交的高度圖磚（`assets/terrain/hellesylt/`，清單位於 `assets/manifests/`），以 2 m 串流；海床為合成；太陽位於北緯 62.083°（[規格](docs/specs/g1.5-real-terrain.md)）
- **G2：** 漢薩同盟城鎮建築與時代植被
- **G3：** 遊戲玩法迴圈、程序化音訊、存檔

儲存庫擁有者：[@waydefu](https://github.com/waydefu)。
