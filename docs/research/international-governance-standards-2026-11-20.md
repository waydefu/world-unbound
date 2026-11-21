# 國際軟體治理標準｜研究筆記（2026-11-20）

> **定位：非約束性的參考研究，不是開發里程碑、合規宣告、待辦清單或發布前置條件。** 本文件整理原 [Issue #37](https://github.com/waydefu/world-unbound/issues/37) 的資料；現階段專案以遊戲本身的畫質、效能與必要的 Agent 可靠性為優先。除非 Owner 重新決定方向，**不應僅因本文存在就開啟額外治理工程**。原始審查與討論保留在 #37；Agent 直接相關的有限注意事項追蹤於 [#36](https://github.com/waydefu/world-unbound/issues/36)。

- 審查時點：2026-11-20
- 原始碼基準：`main` `b5a3c96fedcb957c5e4dcc3a0303cea3d49ec80b`（此 SHA 是歷史快照，**不是**永遠代表最新版本）
- 對象：公開 GitHub 個人倉庫 `waydefu/world-unbound`；以可讀的 GitHub Ruleset、CI、倉庫檔案及 PR 紀錄進行桌面審查。
- 限制：**沒有執行**正式 OpenSSF Scorecard 掃描、完整 OSPS 控制逐條測試、SLSA attestation 驗證、所有後台安全設定核查、滲透測試或手機真機驗證。不具官方認證效力。

## 1. 不同框架在解決什麼問題

| 框架 | 重點 | 本專案此快照的可支持結論 |
| --- | --- | --- |
| OpenSSF [OSPS Baseline v2026.08.28](https://baseline.openssf.org/versions/2026-08-28.html) | 依不同成熟層級提出適用的開源安全控制 | 已有不少控制，但未完成官方控制 ID 的逐條適用性與證據矩陣；**不可宣稱 Level 1 通過** |
| [OpenSSF Scorecard](https://scorecard.dev/) | 自動化檢查倉庫安全實務，按檢查項目評分 | 未取得以該 SHA 為基準的正式結果；**不給 0–10 總分** |
| [SLSA v1.2 Build Track](https://slsa.dev/spec/v1.2/build-track-basics) | 證明建置產物來源、流程及不可偽造的 provenance | 雖有 CI、重新建置與雜湊紀錄，未見完整可驗證 provenance 與部署產物對應；**Build L1 尚未證實** |
| [NIST SSDF SP 800-218 v1.1](https://csrc.nist.gov/pubs/sp/800/218/final) | PO／PS／PW／RV 安全開發與漏洞應對實務 | 有部分措施；未完成逐項映射與執行證據；不宣稱符合全部框架或取得認證 |
| 本專案 AEGIS M0–M4 | **內部工作里程碑**，用於安排治理工程 | M0 完成、M1 Agent 端核心完成但 T01/T20 有缺口、M2–M4 未正式完成；**不能轉換成 OSPS/SLSA 等級** |

原討論中出現的「15/24」沒有逐項可重現的官方 ID 映射，**不是正式 OSPS 得分或達成率**。不同框架的分數與等級也不可互換。

## 2. 此快照已核對的實際證據

| 控制 | 查核結果 | 原始證據 |
| --- | --- | --- |
| 分支保護 | `protect-main` 規則為 active；PR 必經、線性歷史、阻擋刪除與非 fast-forward、無 bypass actors；Required `final-gate` 並另有 CodeQL code-scanning 規則 | [GitHub Ruleset #27424024](https://github.com/waydefu/world-unbound/rules/27424024) |
| CI 品質檢查 | `final-gate`、`app-checks`、`visual-audit` 與 CodeQL 檢查成功；測試含 Biome、TypeScript、Vitest、靜態審計及軟體 GPU 視覺掃描 | [main CI](https://github.com/waydefu/world-unbound/actions/runs/44716156921)、[`ci.yml`](../../.github/workflows/ci.yml) |
| 程式碼審查 | `required_approving_review_count=0`、沒有強制 CODEOWNER Review；PR #35、#32 查無 GitHub 人類 Review 紀錄；這是獨立審核缺口，**不是把 OSPS Level 3 規則誤當 Level 1** | [Ruleset](https://github.com/waydefu/world-unbound/rules/27424024)、[PR #35](https://github.com/waydefu/world-unbound/pull/35)、[PR #32](https://github.com/waydefu/world-unbound/pull/32) |
| 開源基本文件 | 有 MIT LICENSE、CONTRIBUTING、CODE_OF_CONDUCT、SECURITY、CODEOWNERS；有 [AGENTS.md](../../AGENTS.md) 限制 Agent 越權 | [倉庫根目錄](https://github.com/waydefu/world-unbound) |
| 發布 | Pages 只從 main（或允許的手動事件中 main）重新建置、檢查、列印 SHA-256 後部署；並未形成已驗證的 SLSA 完整產物證據鏈；此快照 GitHub Releases 為空 | [`pages.yml`](../../.github/workflows/pages.yml)、[Pages run](https://github.com/waydefu/world-unbound/actions/runs/44716156941) |
| 素材 | Hellesylt 地形 16 個 tiles 有來源 Kartverket、CC BY 4.0、sha256、處理版本的 manifest；其他素材需按需求獨立核對 | [地形 manifest](../../assets/manifests/terrain-hellesylt.json) |

以上的「有文件／CI 通過」**不等於**惡意工作流程篡改、跨 Agent 權限濫用或未來發布事故的完整負面測試均已通過。

## 3. 已知限制與可能的未來研究題目

### 3.1 Agent 信任邊界（與現有 #36 有直接關係）

- PR 本身可改動自帶的 CI workflow，現有 `base-policy` 為 advisory，故仍有蓄意弱化 CI 的 **T01 殘餘風險**。不得因 `final-gate` 綠燈而認為來源可信度已充分證明。
- Agent 不可從 Issue、PR 內容、Web 文件或日誌擷取「新授權」；分離 worktree、身分、憑證與記憶；任何改動 governance、workflow、Ruleset 或部署權限都需個別 Owner 授權，對照 [AGENTS.md](../../AGENTS.md)。
- M1 **T20**（第二帳號 Fork PR、無 Secrets 的實際 CI）仍欠實際演練；不以模擬或理論推測取代。
- 若有 Agent 效能／Token 最佳化，需在隔離的同模型同 SHA A/B、使用真實 provider token usage 衡量，避免把省輸出 bytes 當成省 Token。這項是 [#36](https://github.com/waydefu/world-unbound/issues/36) 的本來範圍。

### 3.2 非現階段工作目標：發布供應鏈與更高成熟度治理

以下僅保留作「未來可能採用的研究方向」，**不構成待辦，也不應併入 Agent Tooling #36 的完成門檻**：

- 若未來正式發布，可考慮 source SHA → builder/run → test conclusion → artifact digest → attestation/provenance → deployment → rollback 的證據鏈，並實作真正的回退演練。
- 若長期增加外部貢獻者，可考慮獨立人類批准；目前單人維護，強制 1 位 reviewer 會阻礙日常 PR，須先解決協作者責任與權限。
- 若需要聲稱 OSPS Level 1 或 Scorecard 分數，應先生成官方控制 ID 矩陣、工具原始 JSON、觀測日期、證據連結與 N/A 理由。
- GitHub 後台 MFA、Secret Scanning、Push Protection、Dependabot alerts、Private Vulnerability Reporting、Pages environment 審核設定：此遠端讀取無法一一確認，**unknown 不代表 disabled**。
- 若未來新增可發行的二進位素材，持續沿用來源、授權、sha256、pipeline 版本與適當大小預算；不要僅憑現有 MIT LICENSE 推論所有第三方素材均為 MIT。
- Android WebGPU 的幀時間、熱穩態與 WebGL2 軟體模擬屬不同驗收；實機證據按遊戲功能 Issue 管理，不由本文件建立發布門檻。

## 4. 若未來重新啟動治理研究

重新評估的觸發條件宜是**具體需求**：正式對外發行／第三方供應鏈規範、增加共同維護者、真實安全事件、CI 信任邊界已阻礙工作，或平台條件變更。重啟時先確認最新 SHA/工具版本與國際標準版本，再決定是否另立 Issue；不得把本歷史快照當現況。

重要的原始背景：[國際標準審查 Issue #37](https://github.com/waydefu/world-unbound/issues/37) · [治理狀態](../governance/status.md) · [AEGIS v2.0](../reference/aegis-v2.md)。

**保存原則：學術／架構參考，不擴大目前產品範圍。**
