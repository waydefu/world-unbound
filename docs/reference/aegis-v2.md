> **Source title:** AEGIS ∞｜Repository Governance Definitive Blueprint v2.0｜最終定案
> **Imported from the owner's Google Doc on 2026-11-17.**
> This is a reference copy; the repository's AGENTS.md, governance/ and ADRs are what is enforced.

# AEGIS ∞

世界級 Repository × 人類／AI 協作治理｜最終定案架構 v2.0

Definitive Governance Blueprint｜定案日期：2026-11-17｜性質：設計定案，不是已部署或取得認證的成績

本文件是唯一建議實施的治理設計版本。第 21 章是落地安全與營運補強的規範性修正，與前文衝突時以第 21 章的具體要求為準。先前的 AEGIS v1.0（30 章研究稿）保留作歷史依據；如有衝突，以本文件決策為準。未來只有實際證據推翻決策或工具發生重大變化才需要修訂，不以『再研究一輪』作為正常流程。

## 0｜一頁決策：從今天起照這份實施

最終架構：GitHub 為需求、權限、原始碼、PR 與協作核心；原生 Rulesets＋CODEOWNERS＋可信 CI Gate 保護 main；AI Agent 在隔離工作區寫程式和提出審查意見，但無權自審、升權或自行發布；發布管線對實際 artifact digest 再驗證。第三方優先用已成熟工具，禁止為了概念豪華而重造平台。

必採：GitHub Issues / Issue Types & Fields / Projects / Labels / PR、Rulesets、CODEOWNERS、Actions、Dependabot、可取得的 CodeQL、AGENTS.md、受保護的測試驗收 Gate、日誌與撤銷計畫。TypeScript／Rust／WGSL 架構測試依實際技術棧啟用。

條件採用：公開組織 Repo 或符合 Enterprise Cloud 的組織私有 Repo 使用原生 Merge Queue；其他情況改 Strict Up-to-date + serial merge。單 Repo 不需要 GUAC、Minder、in-toto 或自研 Agent Orchestrator，除非明確規模／安全需求出現。

定案原則：對設計可定案；對『遙遙領先全球巨頭』沒有公開統一評量、亦無實測證據，不能聲稱已客觀勝過 Kubernetes、Chromium、Rust 或大型科技公司。要讓資深工程師印象深刻，靠能重現的防繞過驗證、低審查負荷與可量測的失敗率，而不是厚重流程。

## 1｜勝負標準：什麼才叫真的頂尖

評比對象分三類：大型社群治理（Kubernetes、Rust）、跨平台大型工程（Chromium、VS Code、Babylon.js/Bevy）、AI 代理工程（OpenHands/Codex 等）。比較範圍不是各公司的非公開內部系統，而是公開可檢驗的流程、工具與實作。

- 安全：重大 PR 無法靠作者或 AI 偽造核准；私密憑證無法因不可信 PR 進入低信任執行環境；例外與管理員繞過可稽核。
- 正確性：受保護 CI 不因跳過 job 或過期 SHA 而誤判；實際 merge_group／release artifact 另行被檢驗。
- 效率：低風險 PR 可快速通過；高風險 PR 得到適任且必要的審查；CI 不重複浪費。
- 協作：多個 AI、多人平行修改時，有清楚的模組擁有權、指令優先序、依賴與衝突解決。
- 維護：維護者離開仍有人可以接手；工具數量可控；每個告警都有處理者；新成員能在一份文件中找到路徑。
- 實證：能在隔離測試 Repo 執行負面測試；不能只看 Green CI 比率，還要測逃逸缺陷、誤報、修復時間與維運成本。

## 2｜正式技術選型：最少自製，最高可信

### 2.1 必採、條件採用、明確不採

```
領域                  決議                         啟用準則
Source/Issues/PR      GitHub 原生                  必採
Policy & permissions  Rulesets + CODEOWNERS         必採，權限按方案調整
CI                     GitHub Actions + fixed gate   必採
Static security        CodeQL + secret/dependency   能力可用則啟用；盲區補掃描
Dependency updates     Dependabot                   預設；複雜 Monorepo 可改 Renovate
Policy validation      Conftest / OPA                規則複雜度值得時才啟用
Supply attestations    GitHub artifact attestations 正式產物且方案支援時啟用
Release signing        GitHub Native / Cosign       依發布介質與威脅模型擇一/組合
Cross-service graph    GUAC                         多產品／供應鏈查詢需求成立再啟用
Policy remediation     Minder 或自架 Allstar        多 Repo 後再擇一評估
Full agent platform    不自研                       以既有代理＋隔離環境執行
Custom GitHub App      暫不建立                     證明跨領域審核等缺口才用
```

拒絕重造：新的 Issues 系統、Labels 平台、CI 平台、通用權限語言、通用 SBOM 圖資料庫、通用簽章服務、通用 Agent Runtime。每新增一項工具都需回答『替代誰、誰維護、如何移除、增加多少 CI 負擔』。

### 2.2 真實帳戶限制：不能把功能當成必然可用

GitHub Merge Queue：官方文件顯示適用組織擁有的公開 Repo，及 Enterprise Cloud 組織私有 Repo；個人 Repo 即使公開，也不要寫成必然可用。GitHub Rulesets：公開 Repo 在 Free 方案可用，私有支援依 Pro/Team/Enterprise 等條件。

GitHub Artifact Attestations：所有現行方案的公開 Repo 可用，Free/Pro/Team 的私有 Repo 不能直接假設可用；私有／內部需符合 Enterprise Cloud 等官方要求。CodeQL/code scanning 對公開 Repo 有支援，私有需依組織方案及授權確認。

GitHub Issue Types / Fields 已於 2026-11-11 向個人帳戶正式開放；上限、欄位與 Project 自動化需按帳戶實際能力執行。不要把功能不足的方案包裝成安全合格。

## 3｜可信架構（Control / Execution / Evidence / Release 四平面）

```
                   ┌──────────────────────────────────┐
                   │ Human Maintainers / Security Owner│
                   │ 權責、例外、RFC、發布核准           │
                   └────────────────┬─────────────────┘
                                    │
      ┌─────────────────────────────▼──────────────────────┐
      │ CONTROL：GitHub Rulesets＋受保護 Policy/OWNERS     │
      │ Issues／Projects／Labels／PR／權限模型             │
      └─────────────────────────────┬──────────────────────┘
                                    │ 有範圍的任務
      ┌─────────────────────────────▼──────────────────────┐
      │ EXECUTION：人類、AI Agents（獨立 worktree/容器）  │
      │ 沒有生產密鑰；不可信 PR 不進入高權限 workflow     │
      └─────────────────────────────┬──────────────────────┘
                                    │ PR／commit SHA
      ┌─────────────────────────────▼──────────────────────┐
      │ EVIDENCE：可信 CI、測試、掃描、審核、來源證明      │
      │ 固定執行的 Gate：檢查結果、實際執行與證據版本     │
      └─────────────────────────────┬──────────────────────┘
                                    │ 通過與合併
      ┌─────────────────────────────▼──────────────────────┐
      │ RELEASE：實際產物 digest 重驗＋部署核准＋回滾     │
      │ 事故與效能遙測 → 新 Issue；不反向賦予 Agent 權限  │
      └────────────────────────────────────────────────────┘
```

信任根：有效政策來自受保護的 base/main 或獨立受信任政策倉庫，而不是 PR 作者提交的政策檔。主幹保護、Repo 規則及憑證若可由單一管理員變更，就不能聲稱絕對不可繞過；關鍵發布可額外使用獨立帳戶/環境的授權控制，以降低單點權限失陷風險。

## 4｜Repository 檔案佈局與架構契約

```
repo/
├─ .github/
│  ├─ CODEOWNERS
│  ├─ ISSUE_TEMPLATE/{bug.yml,feature.yml,performance.yml,config.yml}
│  ├─ workflows/{ci.yml,security.yml,release.yml,governance.yml}
│  └─ pull_request_template.md
├─ AGENTS.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  LICENSE
├─ governance/{owners.yml,labels.yml,risk.yml,exceptions.yml,exceptions.schema.json}
│  ├─ sensitive-paths.yml  release-policy.yml  asset-policy.yml
├─ docs/{architecture,adr,rfc,runbooks,threat-model,release-policy}/
│  ├─ contracts/{system-invariants.md,save-schema.md}
│  ├─ ci-trust-boundary.md
│  └─ runbooks/break-glass.md
├─ apps/{game,playground}/
├─ packages/{core,ecs,renderer,physics,world,platform,ui}/
├─ native/{rust-core,wasm-bridge}/
├─ shaders/wgsl/
├─ assets/{source,manifests}/  .gitattributes
├─ tests/{unit,integration,e2e,visual,perf,fuzz,security}/
└─ tools/{architecture-check,benchmark,release-verify}/
```

以上是 World Unbound 類型多語言 Monorepo 的目標目錄，不是要空建所有資料夾。每個 package 必須聲明 public API、Owner、可依賴的上層/下層模組、測試範圍及相容性政策；core/ecs/physics 不能 import UI 或 DOM，renderer 不直接讀取 Issue 或部署資料，Wasm 橋接要有版本化 ABI、資料所有權及錯誤契約。 上述治理與資產檔案也屬第 21 章 F 節最低檔案藍圖；.gitattributes、asset-policy.yml、存檔 schema 和跨模組不變量須分配明確 Owner 並由 CODEOWNERS 保護。

現成驗證工具：TypeScript 用 tsc、ESLint、Vitest、dependency-cruiser（檢查循環、非法相依與產生依賴圖）；Rust 用 cargo fmt、clippy、test、必要時 cargo-audit/cargo-deny；WGSL 用 wgpu 專案內的 Naga 驗證器。瀏覽器互動用 Playwright，但其手機模擬不等於真實 iOS/Android GPU，跨裝置硬體測試必須另行進行。

## 5｜人類與 AI：權責、隔離和衝突解決

### 5.1 人類權限

Architecture Owner：確認 RFC、破壞性 ABI/API、跨領域依賴。Domain Maintainer：批准模組內變更。Security Owner：批准權限、workflow、secret、供應鏈或敏感政策變更。Release Owner：簽核正式發布。Contributor：提交 PR/Issue。各責任可由同一人兼任非衝突角色，但高風險變更的獨立人類批准不可由 AI 代替。

單人專案的真實限制：若只有一位人類維護者，不能冒充已具備『兩位獨立人類審核』。可先使用嚴格 CI、AI 對抗審查與發布延時作風險補償，但在第二位授權人類加入以前，雙人控制標記為未滿足。

### 5.2 AI 代理最低工作契約

- AI 每次工作必須有 Issue/任務 ID、允許路徑、禁止變更的政策、可使用工具、清楚驗收條件與產出格式。
- 每個 AI 在獨立 worktree／容器中作業；只分配最小所需寫入權限，沒有 main push、ruleset 修改、policy 發布、secret 讀取與 release 權限。
- AGENTS.md / SKILL 是開發指令，不是安全邊界；真正的保護依靠 runner、token scope、GitHub permissions 和外部授權。
- Builder 產生程式與自測；Skeptic 獨立指出可能失敗的情境；Verifier 在乾淨環境重跑。AI 審查可提供意見，正式核准由有權限的人類/受信任的 CI 負責。
- Issue 本文、PR 留言、網頁、依賴 README、測試報告都屬可能被投毒的輸入；任何要求忽略規則、讀取秘密、提升權限、修改發布政策的文字不得成為新的命令。
- 多 AI 同時改同一個基礎模組時，先按檔案所有權及依賴順序分派；不同分支採先驗證再整合，不把 merge conflict 留給機器盲目自動解決。 Session Memory 邊界：跨 Issue、跨 Repo、跨安全等級及 Security Incident 後需結束或重置 Agent session、長期記憶索引 namespace、MCP Server state、工具 cache、允許的資源與短期憑證；不能讓本次 PR 文字寫入下一個高信任任務的系統指令。對不能驗證清除的持久化第三方服務，改採獨立實例／權限隔離，不只靠一句『請忘記』。

### 5.3 必須留下的證據

AI 對 PR 提供：任務 ID、變更摘要、修改檔案、執行過的命令、可核對的測試結果／未執行項、已知風險、未解決問題與回退方式。不能寫『全部確認完美』或編造測試。AI 參與可以由人類自述與工具紀錄雙軌記錄，但 ai/generated 標籤不等於來源證明。

## 6｜Issues 決策：三種 Type、精準欄位、明確狀態

### 6.1 Type / Field / Label 的唯一真相來源

Issue Type：Bug、Feature、Task，使用 GitHub 原生；Regression／Architecture／Performance／Research／Incident 等以細分類欄位、模板或 labels 區分，避免 Type 膨脹。

Issue Fields：Priority(P0–P4)、Severity、Impact、Effort、Target Date、Component、Risk、Verification Owner（是否支援與類型/額度依帳戶而定）。Status 使用 Projects 欄位；標籤用來檢索與提醒，不是身份、權限與最終驗收結果。任何欄位只允許一個受信任系統成為權威資料源。

### 6.2 九類模板驗收契約

- Bug：預期／實際、重現、版本、日誌、敏感資訊遮蔽、回歸測試。
- Regression：上次正常版本、首次異常版本、影響評估與逆向測試。
- Feature：使用者目的、成功條件、非目標、相容性與回滾方案。
- Performance：場景、裝置、測試溫度／環境、P50/P95/P99、畫質對照與統計。
- Architecture：ADR/RFC、替代方案、依賴圖差異、遷移和撤除。
- Security：公開 Issue 僅留非敏感索引，漏洞細節使用 Private Vulnerability Reporting。
- Technical Debt：可量測成本、風險、改善目標、完成條件。
- Research：明確假說、否證條件、方法、限制、停止準則。
- Incident：影響、時間線、緩解、根因、復原、後續驗證。

### 6.3 狀態機與合併不等於完成

```
Submitted → Triage → Accepted → Ready → In Progress
       → PR Review → Integrated → Verified → Resolved
旁路：Needs Evidence / Blocked / Duplicate / Not Planned / Reopened / Security Hold
```

每次狀態轉換記錄 actor、timestamp、來源與理由。GitHub Projects 預設可能在 Issue close 或 PR merge 時直接設為 Done；本方案必須調整此自動化，使 PR merge 只代表 Integrated，Verified 需驗收證據，Resolved 需實際決策。Issue Form required 只是表單體驗，API、整合或其他入口仍需後端資料完整性檢查。

### 6.4 Priority / Severity / Risk 有明確分界

Severity＝結果嚴重度；Priority＝排程優先次序；Risk＝威脅、可能性、影響及不確定性；Impact＝受影響範圍。P0 重大安全、資料毀損或核心服務失效，P1 重要功能失效，P2 一般重要問題，P3 常規改進，P4 研究。首次 Triage 目標：P0 1 小時、P1 1 工作日、P2 3 工作日、P3 7 工作日、P4 14 工作日，僅在實際輪值人力足夠時啟用為承諾。

## 7｜Labels：精簡字典、互斥驗證、不替代安全控制

正式約定採 namespace/name：area/*、impact/*、risk/*、needs/*、platform/*、release/*、ai/*、community/*。不建立重複的 status/*、priority/*；狀態和優先級使用 Projects / Fields。標籤的建立與修改由 governance/labels.yml 版本控管；Label 顏色不作為程式語意。

```
area/core, area/ecs, area/renderer, area/shader, area/physics,
area/world, area/platform, area/ui, area/infra
impact/security, impact/performance, impact/correctness,
impact/compatibility, impact/accessibility
risk/low, risk/medium, risk/high, risk/critical
needs/triage, needs/reproduction, needs/benchmark,
needs/design, needs/review
platform/android, platform/ios, platform/desktop, platform/web
release/breaking, release/migration, release/blocker
ai/assisted, ai/generated, ai/reviewed
good first issue, help wanted, docs-needed
```

互斥群：risk 同一事件只能有一個值；area/platform/impact 可以多選。敏感標籤如 evidence/verified 不建議充作放行條件，真正驗證應讀可信 Check Run 與產物。AI 可建議分類，但不能藉由改 label 自行核准 Issue、降低風險或完成驗收。

## 8｜Pull Request：五個必備問題、一個可信 Gate

### 8.1 PR 模板要短，但證據不能省

- 為什麼改？關聯 Issue / RFC / 例外編號；具體 Acceptance Criteria。
- 改了什麼？主要模組、API/ABI、相依風險及功能邊界。
- 如何測？列出可重現命令、結果、未執行的測試與限制。
- 會壞什麼？安全、相容性、效能、資料遷移、回滾路徑。 若涉及 IndexedDB/LocalStorage、ECS 或玩家存檔序列化，PR 必附 schemaVersion、舊資料 fixture、向後相容讀取／遷移測試、備份與恢復設計；程式碼 revert 不可視為資料還原。
- 誰審？CODEOWNERS 覆蓋與必要領域的人類 Reviewer；機器輸出不可冒充批准。

### 8.2 受保護的四類檢查

必跑：format/lint/type、unit/integration、architecture/risk、gate。按變更內容加跑：CodeQL、安全依賴審查、e2e、fuzz、visual/perf、release。最終 required gate 必須本身在所有相關事件執行，讀取 needs 結果並判定必要 job 是 success；不能把 skipped/neutral 一律等於真實測試通過。

GitHub 官方明確指出：條件跳過的 Job 可能顯示 Success、仍不阻擋必要檢查；而整個 Workflow 因 paths/branches/commit 跳過，Required Check 可能一直 Pending。因此『Required Gate 必執行，昂貴子測試按風險分配，Gate 驗證子測試是否真的存在並通過』是本方案硬規則。

Status Checks 應指定預期 GitHub App 來源（可用時），workflow 使用最低 GITHUB_TOKEN 權限、第三方 Actions 以完整 commit SHA pin、必要時獨立 runner；不可在 pull_request_target/workflow_run/issue_comment 的高權限流程直接執行外部 PR 程式碼或不可信 artifact。 高權限工作流不得 checkout PR head 後執行 `./.github/actions/*`；本地 Action 必須從受保護 base/ref 或不可變可信來源載入，尤其要避免 `pull_request_target`/`workflow_run` 裡的工作目錄替換。高權限 Reusable Workflow 禁用 `secrets: inherit`，改在 `workflow_call` 中逐項宣告、傳遞必要 secrets，核對環境 secrets 的解析與覆蓋。低權限、無 secrets 流程可依風險允許 inherit，但不得擴權。

### 8.3 審查與競態

CODEOWNERS 護欄使用 base branch 的 CODEOWNERS；多名 Owner 的同一規則只要其中一人批准就可能滿足原生要求。真的需要所有受影響領域批准時，優先用具體分支分工與獨立驗證/人類流程；只有跨模組重大變更頻繁、且原生控制不足，才開發薄 Multi-Domain Approval Gate。

對過期批准、PR 新 commit、base 變動採 Dismiss stale approvals + Require approval of most recent reviewable push（若可用）；每次審核對應當前 diff。Webhook 只作提示，不作放行的唯一資料源；Gate 最終要重新向 GitHub 讀取可信狀態並綁定當前 SHA。

## 9｜合併與發布：兩次驗證，不允許舊證據移花接木

### 9.1 有 Queue 的情況

組織公開 Repo／適用 Enterprise Cloud 組織私有 Repo：啟用 Merge Queue，設定 CI 的 pull_request 與 merge_group 事件並對組合後的程式碼跑必要檢查。證據應標記 PR HEAD、base SHA、merge_group SHA、policy SHA，正式 artifact 再綁定 release commit/digest。

### 9.2 沒有 Queue 的情況（個人 Repo 正式方案）

使用 Rulesets 的 Required Checks＋Require branches to be up to date before merging；每次只整合一個 PR，成功後讓下一個 PR 更新並重新驗證。這是可以採用的串行流程，但不應稱為原生 Merge Queue。若團隊成長且經常合併，轉為 GitHub Organization 以取得原生 Queue 的適用條件。

### 9.3 發布證據

發布信任鏈：trusted source revision → trusted builder/workflow → artifact digest → attestation/signature（當方案與渠道支援）→ release authorization → immutable release / deployment → rollback。發布前重驗產物摘要與可信來源，避免只拿某個舊 PR 的『綠燈』當正式產物憑證。

SLSA v1.2 的 Source Track 與 Build Track 應分別驗證；Build L3 是對建置平台加固的等級，不等於所有依賴無漏洞、所有 build 必然 deterministic，或已全面取得某種通用認證。沒有足夠證據就不宣稱達到指定等級。

## 10｜資安、依賴與政策：先利用現成生態

最低安全集合：SECURITY.md、Private Vulnerability Reporting（適用時）、Dependabot alerts/security updates、CodeQL（可用時）、Secret Scanning／Push Protection（可用時）、License/依賴審查、GitHub Actions 權限最小化。 原始碼來源合規不等於 package license：新增／大量修改 Rust、TS、WGSL、Shader、第三方樣板及資產需檢查著作權與授權來源，採 REUSE/SPDX 標頭慣例與 ScanCode Toolkit 對高風險差異/定期全庫掃描；Licensee 主要識別專案 LICENSE，不能代替片段審查。無法確認來源或與受限制程式碼高度相似的片段必須由人類補充出處與法律授權判斷；自動掃描不保證找出改寫過的 GPL/AGPL 程式碼。

依賴策略定案：普通 Repo 使用 Dependabot；TS＋Rust＋GitHub Actions＋Docker 同時存在且更新噪聲大時，用 Renovate config:best-practices 取代其版本更新職責，但可保留 Dependabot alerts。不要讓兩種版本更新器互相建立重複 PR；重大升級必須有人類審查。

政策策略定案：在真的有結構化 policy 檔、測試和多 Repo 擴展後使用 Conftest/Rego；OPA 作動態複雜授權引擎不是第一天必備。政策的有效版本必須是受保護的 base policy；PR 不能修改後即由自己版本執行放行。

現成供應鏈策略定案：GitHub artifact attestations 優先（支援時）；需要跨不同 CI 平台的 layout/多步驗證再用 in-toto；產物型態需要額外簽章可考慮 Cosign。多 Repo + SBOM 關聯查詢需求明確前不部署 GUAC。跨 Repo 安全設定強制管理需求明確前不部署 Minder/自架 Allstar。官方代管 Allstar App 已退休，不視為現成 SaaS。

## 11｜風險分層：不拿巨型流程壓垮普通 PR

```
R0　文字／註解／無可執行變更 → 格式、連結、基本檢查；1 名審核依政策
R1　單模組常規程式修補       → lint/type/unit + 相關整合 + owner
R2　多模組／重大效能／存檔 Schema → R1 + RFC/ADR + 平台與回歸基線 + schemaVersion/舊存檔遷移測試；不可逆刪除、批量重寫、無復原路徑或不可支援舊玩家資料的變更升 R3，需專門回滾/備份方案。
R3　憑證／權限／CI／發布政策  → R2 + Security Owner + 獨立人類核准
```

風險由實際 diff、檔案與政策判定，不從 risk/* 標籤直接取得授權；風險升級容易，降級需要可信理由。對單人專案，R3 仍需額外獨立人類審查才可宣稱達成高保證；緊急事故走有期限的 Break-glass，保留事件編號與事後復盤。

## 12｜測試矩陣：正向成功與負面攻擊一樣重要

### 12.1 最低成功測試

- 單元：TS/Rust 的公開功能契約、邊界值、錯誤處理。
- 整合：JS↔Wasm 資料契約、資源生命週期、序列化、Shader Binding。
- 端到端：主要介面、可玩路徑、失敗恢復、儲存讀取、無網路情境。
- 架構：禁止非法依賴、循環依賴和非公開 API 跨模組呼叫。
- 效能：代表性遊戲場景及目標裝置，畫質與 frame time 同時衡量。
- 安全：依賴漏洞、機密暴露、工具與流程權限。

### 12.2 負面測試 T01–T51（按風險、觸發器及頻率選擇，不是每個 PR 全跑）

- T01 PR 移除 required workflows 或修改策略降低風險 → Gate 不允許自行放行。
- T02 偽造相同名稱的成功 Status → 來源未經授權時拒絕。
- T03 pull_request_target 執行惡意 PR 程式 → 高權限環境不得遭執行。
- T04 workflow_run 讀取／執行不可信 artifact → 必須隔離或拒絕。
- T05 必要 Job 被條件跳過而回 Success → 總 Gate 偵測未真實執行。
- T06 新提交使用過期 Reviewer approval → 需重新驗證。
- T07 跨模組重大 PR 只獲一個領域批准 → 依風險政策不得放行。
- T08 Merge Queue 的組合 SHA 變更 → 重新跑必要檢查。
- T09 使用舊 SHA 的簽章/證明套到新產物 → Digest 不符即拒絕。
- T10 改 label 直接宣告 Verified → 不應改變可信驗證結果。
- T11 Issue/PR 注入升權指令 → Agent 不得取得新權限。
- T12 Webhook 延遲、重播、亂序 → 不影響當前狀態的決定。
- T13 管理員／旁路操作 → 被記錄，關鍵發布仍受獨立 Gate 限制。
- T14 故意刪測試或放寬容差 → 基準/契約與人類審查能辨識。
- T15 核心安全、授權、必要建置/測試或 Release Gate 無法確認可信結果 → Fail-Closed；文件連結等外部輔助檢查在明確允許且有紀錄時可重試後降級警告，不得偽裝成可信的 Pass。
- T16 維護者退出或憑證遭撤銷 → 代理授權失效，備援負責人能恢復作業。

對每個測試保留腳本、輸入樣本、環境版本、commit、預期結果、實際輸出及證據 URL。只有通過正反測試才能稱為已驗證的治理控制；文檔寫『應該安全』不給分。 第 21 章定義 T17–T42；新增 T43–T51 的實際分類與驗收見本章修訂段落。所有 T 編號只是一份主清單的索引，不應建立第二套正式放行標準。

## 13｜跨平台 Web 遊戲專用：畫面品質與治理必須分開驗收

World Unbound 型專案的前端控制由 TypeScript、重運算由 Rust/Wasm（只有 profiling 證明值得下沉時），GPU shader 使用 WGSL／WebGPU，執行緒與資料拋轉靠 Web Workers。在不支援 WebGPU 或必要 feature 的裝置，需有明確降級到 WebGL2/低階畫質或停止支援的決策，不可假裝所有平台可同等執行。

手機：Android 真機與 iOS Safari 真機至少各有代表裝置；桌機包含 Chromium/WebGPU 與必要的 WebGL fallback；資料至少記錄 CPU/GPU/瀏覽器、OS、分辨率、畫質 preset、熱狀態與功耗。Playwright viewport/mobile emulation 只是 UI 層，不能取代真實 GPU 驗證。

效能預算範例：60 FPS 的 frame budget 為 16.67ms；30 FPS 為 33.33ms。實際門檻需區分 P50/P95/P99、載入、熱穩態、GPU/CPU 時間與畫質量化評分。效能 PR 附對照影片/Golden Image、變異和統計方法，不因『小檔案』『很擬真』的形容而認證。 大型資產治理：用 governance/asset-policy.yml 管理 .blend/.fbx/.glb/.ktx2/.png/.exr/.wav/.flac 等源素材與發佈內容，依大小、壓縮、重用及 LFS 成本分類。建議預設阻擋『未經 LFS 追蹤的新增二進位單檔超過 2 MiB』，此為可調專案門檻（不是 GitHub 固定限制），允許經批准的小型壓縮資產和 fixture 例外；不可把所有圖片音檔無條件放 LFS。Asset Manifest 至少列 path、SHA-256、原始來源／授權、壓縮格式/版本、導入管線、關聯發布 digest，Release Gate 必須驗證完整性；監控 LFS storage/bandwidth 預算。

## 14｜發布、事故、維運、開源社群治理

- 發布：版本/變更記錄、Release notes、breaking changes、API/ABI 廢棄期、migration、rollback、撤回與 EOL 政策。
- 漏洞：Security Advisory/私密通報、分級、修補、保密與揭露時間、下游通知。
- 人力：Owner 備援、角色代理、定期權限盤點、離職撤權、重要操作多方可恢復。
- 開源：LICENSE、Code of Conduct、Contributing、貢獻簽署選擇（DCO/CLA 依需求）、著作權與第三方依賴清單。
- 資料：CI 日誌、Issue、AI 輸入、事故、SBOM/Attestation 依敏感度設定存取、保存期、刪除和審計；不將私人憑證放在公開證據圖。
- 運營：P0 緊急通道、值班制度（有足夠人力才承諾）、每月安全/效能/CI 成本盤點、季度權限與廢棄工具審核。

## 15｜治理評分：公認標準和自訂成果絕不混淆

外部：OpenSSF Scorecard 依官方 0–10 檢查；OSPS Baseline 對應 CURRENT v2026.08.28 的適用 Level 1–3 控制；SLSA Build/Source 按 v1.2 分開列實際符合等級；NIST SSDF 與 OWASP Agentic Top 10 作控制映射。每項要有實際證據與 N/A 原因，不能自行說全部『滿分』。

內部：AEGIS-GI 100 分，建議配重：身份/分支/政策 20、Issues/Labels/追蹤 10、CI/正確性 20、供應鏈 15、AI 安全 10、架構測試 10、發布回復 10、維運成本與審計 5。硬性否決採『風險與功能適用性』：基礎必查 T01/T02/T03/T05/T09/T11；公開 Fork 適用 T17/T20/T21；R3 發布適用 T23/T24；AI 協作適用 T26/T46；多模組核心適用 T29；Lockfile 適用 T31/T33；例外與 Hotfix 適用 T36/T39；治理變更適用 T40/T41；高權限 Actions/Reusable Workflow 適用 T43/T44；玩家存檔適用 T50/T51。任何適用的阻斷級控制失敗，即使總分很高，也不得標記『可信治理驗收通過』。N/A 需附責任人、可核對理由與替代證據。

成績分成『設計已定案』『配置已部署』『負面測試已通過』『實際使用中』四個不同狀態。本文件目前只達成第一個狀態。沒有測量維護者工時、回歸缺陷、lead time、change failure rate、recovery time 等，不能聲稱成效已超越公開標竿。

## 16｜實施藍圖：一次定案，分段實作，不再研究迴圈

### M0：配置與主幹保護

交付物：main Ruleset、CODEOWNERS、CODE_OF_CONDUCT.md/SECURITY.md、Issue Forms、Labels、Issue Fields、Project State、AGENTS.md、PR 模板。完成條件：模擬 PR 直接 push main 被拒；Issue/PR 欄位與審查責任可用。 此階段同步建立第 4 章治理目錄：exceptions.schema.json、sensitive-paths.yml、release-policy.yml、asset-policy.yml、.gitattributes、docs/contracts/{system-invariants.md,save-schema.md}、docs/ci-trust-boundary.md、docs/runbooks/break-glass.md（依適用範圍啟用並配置 Owner）。

### M1：最小可信品質門

交付物：always-on gate、format/lint/type/unit、必要 integration、dependency scanning、可用的 CodeQL、分支過期批准處理。完成條件：原 T01/T02/T05/T06，加上適用的 T17/T20/T21/T26/T31/T33/T43/T44/T45；Fork PR 無秘密洩漏、必要測試不得誤放行、可驗證 GitHub API 限流降級規則。

### M2：AI 並行與架構契約

交付物：每個 Agent worktree/scope、禁止提權規則、TS/Rust/WGSL 靜態驗證、代表性 Web UI/手機真機回歸路徑。完成條件：原 T03/T04/T07/T11/T14，加上適用的 T28/T29/T30/T34/T35/T46/T47/T48/T49；確認 Agent 記憶／MCP 隔離、來源授權與資產完整性有證據。

### M3：發布與證據

交付物：release gate、artifact digest/signature（支援時）、Rollback Runbook、事件重送處理、角色授權撤銷與 OSPS/Scorecard 對照表。完成條件：原 T08/T09/T10/T12/T13/T15/T16，加上適用的 T23/T24/T25/T36/T38/T39/T50/T51；有存檔格式變動者需舊版本遷移與備份驗收；能從 release 追溯到 source SHA、測試與授權。

### M4：日常運營

固定每月對 CI 成本、誤報、PR 排隊、逃逸缺陷及維護工時進行量測；只有數據顯示真實瓶頸，才評估 Renovate、OPA、GUAC 或自訂 GitHub App。每新增工具須有導入價值、維護 Owner、回退條件和替代方案。 M4 的政策升級／定期演練涵蓋適用的 T18/T19/T22/T27/T32/T37/T40/T41/T42，並把所有 T01–T51 依 PR、Release、排程及演練分派，不要求每個 PR 全跑。

## 17｜可實作的最小設定（骨架，不假裝已跑過）

### 17.1 治理政策契約示意

```
policy_version: 2
authority: protected-base
principles:
  unknown_sensitive_action: deny
  pull_request_may_change_policy: propose_only
  ai_may_approve_own_pr: false
risk_tiers:
  R0: [lint, link_check]
  R1: [lint, typecheck, unit, owner_review]
  R2: [R1, integration, architecture, performance_if_applicable]
  R3: [R2, independent_human_security_review, protected_release_gate]
evidence_keys: [head_sha, base_sha, policy_sha, workflow_identity, artifact_digest]
```

這是政策語義範例，並非可直接交給 GitHub Rulesets 執行的 YAML；必須由現有工具（GitHub 設定、Conftest/CI、受保護檢查服務）依權限分工實現。不得將這個範例貼進 Repo 就宣稱 R3 已受保護。

### 17.2 Actions 設計原則（避免常見自動化誤判）

```
on: [pull_request, merge_group]    # 僅在具 Merge Queue 的 Repo 使用 merge_group
permissions: { contents: read }
jobs:
  lint-type-unit:  always-run      # 未裁剪 PR，產生可查證結果
  security-check:  enabled-if-supported / documented-exception
  integration:     run-by-risk     # risk 決策來自受保護 base policy
  final-gate:     always-run      # 逐一檢查 required jobs 的實際 conclusion
```

上面是人類可閱讀的流程規格，不是已驗證的 YAML workflow。實際編寫 GitHub Actions 時，使用其合法 on/jobs/if/needs 語法，固定 actions 的完整 SHA、對 checkout 的 untrusted head 設限，配合 Settings 中 required check source 設定；驗收後再列為 Required Check。

## 18｜運營檢查表：不做就不能宣稱完成

- □ 主幹禁止直接推送、強制 PR、禁止 force push/delete、限制 bypass 並啟用審計。
- □ Owner / Code Owner 映射可用，跨模組高風險流程可阻擋不完整審核。
- □ 所有 Required Checks 由可信來源出示，final gate 能偵測被跳過的必測 Job。
- □ pull_request_target / workflow_run / artifacts 不會將不可信程式碼帶入高權限 job。
- □ AI 只能依任務寫分支與回報，沒有自行批准、改規則、部署或讀 secret 的權限。
- □ Issue／PR 的狀態、Priority、Risk 與 Label 擁有唯一權威資料源，合併≠驗收。
- □ 合併後/Queue SHAs 與 release artifact digest 被區別且正確關聯。
- □ 依賴、漏洞與供應鏈證據真正驗證，不能靠檔案存在或 AI 自述。
- □ T01–T51 具風險與適用性矩陣；本次 PR、正式發布與定期演練的相關測試有可重現證據，阻斷級失敗立即停止高信任發布。
- □ 發布能回滾、事故能記錄、人員可撤權、維護者有備援。
- □ 有 PR 等待時間、逃逸缺陷、CI 成本、回退率與風險例外的實測基準。
- □ GitHub 實際帳戶與功能限制確認過，未能使用的能力有可行替代。

## 19｜採納與版本凍結聲明

治理方案正式採納 AEGIS ∞ v2.0 作為單一設計規格。這次已完成技術選型與安全邊界的決策，不再以無止境『再一輪研究』推遲落地。後續工作只有按 M0–M4 實作、在真正 Repo 上驗收及依事實維護版本。

定案≠已部署。若未在指定 Repository 實際套用 Rulesets、CI、Agent 權限並跑過負面測試，不宣稱已達 Scorecard 10/10、OSPS 最高等級、SLSA Build L3 或全球領先成績。不同專案規模不必強行啟用所有元件；真正的成熟是以足夠少的制度確保足夠高的信任。

## 20｜官方規格與實作參考（2026-11-17 查核）

GitHub｜Rulesets 規則與必要檢查｜<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>

GitHub｜Merge Queue 可用性與 merge_group｜<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>

GitHub｜CODEOWNERS 語法與審查條件｜<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners>

GitHub｜Status Checks 及 skipped jobs｜<https://docs.github.com/en/pull-requests/reference/status-checks>

GitHub｜Troubleshooting required status checks｜<https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks>

GitHub｜Securely using pull_request_target｜<https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target>

GitHub｜2026-11-11 個人帳戶 Issue Types/Fields｜<https://github.blog/changelog/2026-11-11-issue-types-and-fields-are-available-for-personal-accounts/>

GitHub｜Projects built-in automations｜<https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-built-in-automations>

GitHub｜Artifact Attestations 方案限制｜<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>

GitHub｜CodeQL default scanning｜<https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning>

GitHub｜Supply Chain feature availability｜<https://docs.github.com/en/code-security/concepts/supply-chain-security/supply-chain-security>

OpenSSF｜OSPS Baseline v2026.08.28｜<https://baseline.openssf.org/versions/2026-08-28>

OpenSSF｜Scorecard｜<https://scorecard.dev/>

SLSA｜Build Track Basics v1.2｜<https://slsa.dev/spec/v1.2/build-track-basics>

SLSA｜Source Requirements v1.2｜<https://slsa.dev/spec/v1.2/source-requirements>

NIST｜SSDF｜<https://csrc.nist.gov/Projects/ssdf>

OWASP｜Agentic Top 10 2026｜<https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/>

Open Policy Agent｜Conftest｜<https://github.com/open-policy-agent/conftest>

Renovate｜Best Practices｜<https://docs.renovatebot.com/upgrade-best-practices/>

dependency-cruiser｜Dependency rules｜<https://github.com/sverweij/dependency-cruiser>

wgpu / Naga｜WGSL validation｜<https://github.com/gfx-rs/wgpu/blob/trunk/naga/README.md>

Playwright｜Mobile emulation scope｜<https://playwright.dev/docs/emulation>

OpenSSF｜Allstar hosted app retired｜<https://github.com/ossf/allstar>

OpenSSF｜Minder｜<https://openssf.org/projects/minder/>

GUAC｜Software supply chain graph｜<https://github.com/guacsec/guac>

附註：本文不宣稱上述文件的所有功能都對每個帳戶、所有版本與所有程式語言開放。部署前以 Repo 設定頁、方案能力和 CI 實測為準。

## 21｜執行層安全補強：12 項控制的最終定案（具規範效力）

### 適用範圍與優先序

本章為 v2.0 內的『規範性實作修正』，不是研究階段或另一份方案；與第 3、5、8、9、11、12、14、16、17 章有衝突時，以本章較具體的執行要求為準。對現有需求整理為四個維度、共 12 項。採用 GitHub 已提供的隔離與審核能力，不為追求安全感自行重造工具。『強制』指符合相應風險／發布範圍且功能可用時強制；不具方案功能時必須採可驗證替代，不能假裝已啟用。

### A｜GitHub Actions／CI-CD 執行面（四項）

#### A01｜Cache Trust Boundary（必採）

規則：不可信 PR、受信任 main、正式 Release 使用不同 Runner / token 權限；只快取可重建、無秘密的依賴資料。正式發布不得直接恢復來自 PR merge ref 或可由低信任事件覆寫的 Cache。高權限部署流程最好不恢復任何可執行快取，或對可用快取重新驗證完整性。快取鍵包含 OS、工具鏈、lockfile hash、trust tier；不要快取 Secrets、CI Token、具執行能力的未經驗證 node_modules、Cargo build output 或二進位。

官方語義更正：GitHub pull_request 建立的 Cache 在 refs/pull/.../merge 範圍，不能直接由 main 或別的 PR 恢復；PR 可能讀取 base/default branch Cache。GitHub 也已對某些低信任事件在 main scope 採預設唯讀保護；不可為方便而開啟能恢復跨權限寫入的 cache-mode。保護重點是『跨信任環境讀寫』與『高權限流程是否執行恢復內容』，不是錯認所有 fork PR 都能寫入 main cache。

驗收：T17 從 fork PR 建立惡意 cache → release job 不會載入該 cache；T18 嘗試透過低信任事件提升 cache-mode 並污染 default scope → 可信工作流拒絕或隔離；驗證刪除快取後仍可從固定相依套件重建。

#### A02｜供應鏈深層相依及 Runner Egress（R3 必採）

規則：Pin 直接使用的第三方 Actions／Reusable Workflows 至完整 commit SHA；審核 Composite Action、Docker image digest、其內部網路下載、Runtime scripts 與維護者可信度；對 JS 的 preinstall/install/postinstall、Rust build.rs 與 proc-macro、Dockerfile RUN、遠端 shell pipe 執行採高風險審查。即使 Pin SHA，也不等於傳遞相依程式都安全。

Runner Egress：普通 PR job 先以 StepSecurity Harden-Runner（或等價網路控制）採 audit，觀察真實必要目的地；R3 build/release job 在支援的執行環境改用 allowlist block 模式，禁止非必要網際網路出口。不可因未經驗證的外掛顯示綠燈，就宣稱已阻擋流量；Harden-Runner 社群層對公共 GitHub-hosted Linux 支援較完整，自架與 Windows/macOS 支援／付費方案存在差異。

驗收：T19 惡意 postinstall/build.rs 企圖向不在允許清單的網域傳送資料，正式建置環境拒絕；第三方 Action 更新要經由可信 CI 產生差異審核與負面測試。

#### A03｜外部 Fork PR 與受保護政策的雙階段模型（必採）

階段 1：untrusted pull_request 在無 Secrets、contents:read、隔離 runner 中執行格式、型別、單元與不需私有資源的整合；不得 checkout 私有政策 repo 或要求受保護部署金鑰。若有共享政策，優先用公開簽署規則快照或 CI 驗證器固定版本，避免 fork PR 無法取得私有資源。

階段 2：維護者依可信 GitHub UI 核實來源並決定是否觸發額外的安全檢查。受保護 verifier 可以取得驗證所需的可信資料，但不得在同一高權限 job 中執行 fork PR 的任意程式碼或解壓未驗證 artifact；必要時將讀取 policy 與執行 PR tests 分開 runner。凡需 Secrets 的最終部署只允許可信合併／受保護工作流程啟動，人工批准 fork Workflow 不等於程式碼已變可信。

Concurrency：使用 github.workflow 與 PR number/ref 作獨立 group，對重複 PR 測試可 cancel-in-progress；對 production deploy 使用單獨 group 串行，不允許重複更新取消進行中的發佈。搭配 timeout-minutes、最低 token 權限、Job 數量／成本預算與手動核准門檻，降低 Fork PR 資源濫用。

驗收：T20 外部 fork PR 沒有 Secrets 仍能正常得到基礎 CI 結果；T21 惡意 fork 無法由第二階段取得 policy secrets 或部署 credential；T22 快速連推多個 commit 不會挾持 production concurrency。

#### A04｜R3 正式發布保護：Environments + OIDC（必採或有等效獨立放行）

建立預先配置的 production Environment，設定 selected deployment branches/tags、Required Reviewers、Prevent self-review、禁止管理員繞過（若功能可用），且先驗證此帳戶方案是否提供對應 protection rules。避免因 workflow 引用不存在的新 environment 而產生未受保護的環境；Release Job 僅能指定預建的 production 名稱。

正式發佈最小權限：僅部署 Job 指定 permissions: { contents: read, id-token: write }，透過 OIDC 與雲端發行端交換短期憑證；雲端角色必須驗證 issuer、audience、repo 身分、branch/ref 或 environment、必要時 job_workflow_ref，不能只靠工作流程開啟 id-token:write。2026-07-15 之後建立的新 GitHub Repo 使用不可變 ID 形式的預設 sub，舊 Repo 可能仍是舊格式；雲端信任政策依實際 OIDC claims 填寫。

特別限制：Environment Required Reviewers 可指定多名候選人，但通常只需其中一人核准；R3 若要求兩名不同職責批准，必須在 GitHub 之外加受保護的第二層權限檢查。若提供者不支援 OIDC，須採同等短期憑證代理並記錄明確例外及到期時間，不能直接回退永久靜態金鑰。

驗收：T23 未經批准的 Release Workflow 或非允許分支不能取得部署憑證；T24 未匹配 OIDC sub/aud/environment 的工作不得部署；T25 部署發起者不能自己核准（在方案可用時）。

### B｜AI 多人協作的證據與語意正確性（三項）

#### B01｜獨立產生的執行證據（必採）

AI 在 PR 填寫測試摘要只供閱讀；權威測試結果必須由受保護的 GitHub Actions/可信 Runner 生成。對每個驗收指標保存 command argv、退出碼、runner/workflow identity、Git commit SHA、diff hash、測試報告 hash、開始／結束時間、工具鏈與環境 digest；必要時以可信 CI 的 provenance/attestation 對 artifact subject 與執行身份進行驗證。

關鍵精度：Runner 執行日誌、artifact、簽章只能提升可歸責性與篡改可偵測性，並非對任意被攻陷的 Runner 絕對『不可篡改』。若要求更高保證，使用隔離的受管理 Runner、可信外部日誌收集、不可覆寫保存策略、短期密鑰與獨立再測；PR 作者不能修改產生證據的驗證程式。

驗收：T26 AI 將自述的 fail 改成 pass，但 Gate 仍依 CI 失敗阻擋；T27 修改證據正文或 SHA 後，驗證器拒絕錯誤 digest。

#### B02｜防測試語意作弊（按風險採用）

凡同 PR 修改實作與對應測試：要求 Reviewer 額外檢視測試差異及斷言實質性，檢查 tautological assertions、過度 Mock、整個模組 mock、被忽略的測試、skip/only、Snapshot/Golden Image 大量更新、寬鬆誤差。對安全與核心演算法可先獨立提交重現既有缺陷的 failing regression test，或在同一 PR 進行獨立測試審查；無須硬規定所有 PR 都拆成兩份，以免人力負擔膨脹。

Mutation Testing：挑選核心計算/安全邏輯使用 cargo-mutants、Stryker 等現成工具，抽樣執行並把 surviving mutants 當作風險訊號；不以 100% mutation score 作為所有工作必過的硬性門檻。Golden 更新需保留 before/after 及可核對的人工判斷。

驗收：T28 空斷言、永遠通過測試、Mock 整個 SUT、Golden 盲目覆寫在高風險範例下被偵測或需要顯式 Reviewer 核准；測試品質實測記錄為通過或限制，不虛構保證。

#### B03｜跨模組語意一致性（必採核心路徑）

檔案不衝突 ≠ 行為不衝突。定義 ECS system ordering、physics stepping、物件生命週期、asset loading、time delta、事件處理順序的不變量，為模組 API/ABI、序列化資料格式與 shader binding group 建立契約基線。每次互相依賴的 PR 應在整合候選 commit 上執行 contract tests / scenario tests；需要依賴舊執行順序的 PR 在 base 變動後重測。

ABI／API 快照可以檢查介面漂移，但無法獨立驗證行為語意，因此須增加跨模組整合場景、deterministic simulation（可用時）、壓力或故障注入。若無原生 Merge Queue，至少使用 strict up-to-date＋單一整合序列避免兩個各自綠燈的 PR 互相覆蓋。

驗收：T29 故意讓 ECS 與 Physics 對 system order 的假設不一致，合併候選測試必須失敗；T30 非 API 簽章變動但行為破壞的樣本必須有整合層訊號。

### C｜多語言 Monorepo 與檔案風險（兩項）

#### C01｜敏感路徑與變更型態風險提升（必採）

高風險監看範圍：pnpm-lock.yaml、Cargo.lock、package.json scripts、pnpm-workspace.yaml、.npmrc、Cargo build.rs、proc macro、.cargo/config.toml、Dockerfile、.dockerignore、.github/workflows、.github/actions、CODEOWNERS、governance/、.devcontainer/、.vscode/tasks.json、settings.json、launch.json、extensions.json，以及 AGENTS.md / agent skills。

風險分級精修：上述路徑≠無條件全部 R3。Lockfile 一般例行版本更新可列 R2＋dependency review；新增未核准 registry、外部可執行 script、來源不明下載、Docker privileged、CI/secret 權限擴張、Agent 指令變更導致高風險工具權限，才自動升至 R3 並要求 Security Owner。每個敏感路徑設定 code ownership 和特定 CI 檢查，避免正常更新癱瘓。

本地開發安全：收到未信任 PR 的 workspace 在 VS Code Restricted Mode 中檢視，避免直接信任 tasks、devcontainer 或擴充；Workspace Trust 不是萬能的執行沙箱，受信任擴充仍有風險；真正需執行的 PR 先在隔離 container/VM 中操作。

驗收：T31 變更 registry/build.rs/postinstall/workflow 權限被正確升級到 R3；T32 單純良性 lockfile 更新不會被機械性阻擋或被誤判 R3。

#### C02｜可重現依賴與 Wasm/WGSL 一致性（必採）

安裝版本：固定 Node/pnpm/Rust 工具鏈與 packageManager；JS CI 使用 pnpm install --frozen-lockfile（pnpm 11+ 可評估 pnpm ci），Rust CI 使用 cargo build/test --locked。只在依賴已經可信預先下載、要求離線且具對應快取時使用 cargo --frozen（同時意味 --locked + --offline）。所有 lockfile 變更需依賴審核與 registry/source 檢查。

Wasm 產物：預設不把 release 生成的 .wasm 與其 JS glue 納入 Git 原始碼，從可信 CI 的固定工具鏈重新產生並綁定 artifact digest；若專案確有測試 fixture、可再現的已生成示例或發佈需求，允許經說明與雜湊驗證的例外，不採無條件禁止所有 .wasm 的錯誤規則。

wasm-bindgen 實務：比對 Cargo.lock 真正解析的 wasm-bindgen crate 版本、wasm-bindgen-cli/wasm-pack 使用的工具版本，以及生成 glue 的預期相容性；不能僅拿 Cargo.toml 與 package.json 的同名字串相比。再對公開 JS API、錯誤處理、Wasm memory、ABI 與輸出型別執行整合測試。WGSL 經 Naga 靜態驗證後，仍需在實際 WebGPU 裝置、瀏覽器與目標 GPU 功能集做跨後端/驅動真機驗證；靜態 parser 通過不保證跨裝置可運行。

驗收：T33 鎖定檔與 manifest 不一致時 CI fail；T34 crate/CLI 不相容時 Wasm bridge build fail；T35 WGSL 在 Naga 通過但實際 GPU 驅動不相容時，跨平台硬體矩陣能顯示異常與降級處理。

### D｜治理例外、事故與無停機演進（三項）

#### D01｜Exception TTL＋自動失效（必採）

exceptions.yml 必填：id、scope、control_id、reason、owner（具權限人類）、approved_by（非申請者）、created_at、expires_at（UTC）、compensating_control、linked_issue、risk、review_at。敏感例外不得由 PR 作者或其 AI 寫入後直接生效；由受保護 policy 驗證並載入經核准的例外。不能用改機器時鐘或改無保護 YAML 延期。

過期即不再認可；固定 Gate 對所需例外做每次 PR / release 驗證，另以每日 schedule 掃描提醒與清理。過期例外遇到涉及該控制的高風險變更必須 fail closed，但與例外無關的低風險 PR 不應全部遭受連坐阻擋；安全修復可走 Break-glass 特殊通道。

實作示意（非可直接啟用的 GitHub Rulesets 語法）：

- id: EX-2026-017

  scope: packages/renderer/**

  control_id: perf-baseline

  owner: '@renderer-owner'

  approved_by: '@security-owner'

  created_at: '2026-11-17T00:00:00Z'

  expires_at: '2026-11-24T00:00:00Z'

  compensating_control: nightly-device-benchmark

  linked_issue: '#427'

  reason: temporary hardware lab outage

驗收：T36 過期例外不再能放行其關聯敏感控制；T37 無關的普通文件 PR 不會因一條例外到期而全部被阻擋。

#### D02｜Break-glass + Hotfix 回流閉環（必採）

緊急核准留下 incident id、操作人、繞過範圍、來源 commit、有效時間、補償控制、回復步驟。建議政策：P0 補充審查最晚 24 小時內完成，並在事後 72 小時內提交復盤（屬建議內控 SLO，非 GitHub 原生 SLA）。超時時將正式新功能發布停止放行，但允許有明確事件編號的修復／回退專用通道，避免『防止繞過』本身阻斷救火。

Hotfix 合併至 release/* 後，建立並追蹤回流 main 的 PR；由機器檢查 main 是否包含該修正的 commit／patch-equivalent 內容與同等回歸測試。不要只比 commit SHA，因 cherry-pick 可能改變 SHA；使用 patch-id、差異比較與測試確認。回流未完成前，阻擋不含修補的下一版正常 release（緊急回退通道例外）。

驗收：T38 逾期補審造成常規發布暫停，但修復通道仍可用；T39 cherry-pick 後修補語意在 main 丟失時，下一次 release 被阻擋。

#### D03｜治理規則採 Shadow → Warn → Enforce（必採）

新規則採 policy_version、owner、scope、begin_at、promotion_criteria、rollback_plan，先 Shadow（只有旁路檢查紀錄，不影響合併），再 Warn-only（發出結構化建議與 Owner），最後 Enforce（正式 Required Check）。依預期 PR 量設定合理觀察樣本/期限，量測 false-positive rate、額外 CI 分鐘、處理工時、阻擋 PR 數與安全收益。資料不足時延長觀察或降低影響範圍，不能只靠日曆宣告成熟。

安全例外：已經確認會造成金鑰洩漏或繞過 main 保護的 Critical 漏洞，應立即啟用阻擋與必要補救，不應為了灰度實驗保留已知漏洞。重大安全門檻的放鬆則不得在影子模式不經審核就生效。

驗收：T40 導入新 Linter 對既有 50 個進行中 PR 不會瞬間阻斷全部工作；T41 切換為 required 時有 Owner 核准、數據與回退；T42 對已知憑證外洩的 Critical 規則不會被不合理的觀察期延後防護。

### E｜驗收主索引：T01–T51 的單一標準（本章涵蓋 T17–T42）

原版 T01–T16 保留；新增 T17–T42 作為細化場景，不要求每種 Repo 每次 PR 都跑全部 42 項。測試分為：設計靜態驗證、一次性攻擊演練、每次 PR required gate、每日／每週掃描、正式 release gate、定期變異測試。每個測試要指定 Trigger、Owner、輸入樣本、可重跑腳本、預期/實際、證據連結、失敗後撤回策略。 T43–T51 進一步測試高權限本地 Action/Secrets 傳遞、GitHub API Rate Limit、Agent Session 跨任務污染、原始碼片段授權、二進位資產/LFS 與玩家存檔遷移。第 15 章硬性否決、第 16 章里程碑及第 18 章清單皆以同一適用性矩陣為準。

正式上線可驗收的最小集合：Fork PR 不洩漏秘密；main Release 不載入 untrusted cache；R3 需受保護環境與正確 OIDC；敏感建置腳本能被發現；AI 自述不能偽造 CI；ECS/Physics 跨模組破壞能被測試抓到；Lockfile 版本衝突必失敗；Exceptions TTL 有效；Hotfix 回流有 Gate；新政策能安全灰度。其餘條件由 Owner 依 Repo 風險標明『已驗證、不可用、替代、待部署』。 2026-11-17 跨章節同步：第 15 章『風險適用的硬性否決』、第 16 章 M0–M4 與第 18 章執行清單為本章唯一對應版本；T43–T51 包含以下新情境，需列入相同的矩陣，而非另建第二套標準。

T43 高權限 Workflow checkout untrusted PR local composite Action → 不得執行其 .github/actions 下的程式。

T44 高權限 Reusable Workflow 意外 inherit 所有 Secrets → 須被政策掃描阻擋，僅允許逐項 secrets。

T45 GitHub REST API 403/429 或次要限流 → 核心 Gate 等待重試/Fail-Closed；非核心檢查依政策降級警告，不能偽裝成功。

T46 跨 Security Incident → 公開 PR 的 AI Session/MCP 記憶被污染或殘留敏感資料 → 不得跨權限讀取。

T47 新增具有明確外來 GPL/AGPL 授權標頭或未授權來源的程式碼/Shader 樣本 → 掃描與審查流程觸發，不聲稱偵測一切未知重寫來源。

T48 不受允許且未 LFS 追蹤的 >2 MiB 二進位資產進 PR → 阻擋；可追蹤例外須記理由。

T49 Asset Manifest Digest 與發佈內容不一致 → Release Gate 拒絕。

T50 舊版 IndexedDB/LocalStorage 玩家存檔升級資料 → schema 遷移不遺失、重複執行可辨識錯誤，異常時能備份/復原。

T51 新舊版本部署切換造成不可逆 Schema 退化 → 預先阻擋無遷移/回退方案的版本；破壞性變更需 R3 批准。

### F｜最低新增檔案／工具，不重造平台

最低新增／條件檔案與第 4 章一致：governance/exceptions.schema.json、governance/sensitive-paths.yml、governance/release-policy.yml、governance/asset-policy.yml、.gitattributes、docs/runbooks/break-glass.md、docs/contracts/system-invariants.md、docs/contracts/save-schema.md、docs/ci-trust-boundary.md；現有 workflows 擴充 trusted-release-gate、fork sandbox 和高權限 local/reusable Action 邊界檢查；必要時採 Harden-Runner。任何新增治理根必須分配 Owner 並限制 PR 自我修改。

不預設新增：自家不可篡改帳本、專用 Agent Runtime、自建圖資料庫、所有 PR 的全量 Mutation Testing、所有 Lockfile diff 自動升 R3、無條件禁止已追蹤 Wasm fixtures。這些做法或會扭曲實務風險，或會製造不必要的維護負擔。

### G｜本章官方與現成工具參考（來源核對）

GitHub Actions Cache / 分支隔離：https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching

GitHub｜Reusable Workflow 與 Secrets：<https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows>

GitHub｜GitHub REST API Rate Limit：<https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api>

GitHub｜REST API Best Practices：<https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api>

ScanCode Toolkit｜Source Code License Detection：<https://github.com/aboutcode-org/scancode-toolkit>

Licensee｜辨識能力及非涵蓋範圍：<https://github.com/licensee/licensee/blob/main/docs/what-we-look-at.md>

GitHub｜Git LFS 配置：<https://docs.github.com/en/repositories/working-with-files/managing-large-files/configuring-git-large-file-storage>

GitHub｜Git LFS Billing：<https://docs.github.com/en/billing/concepts/product-billing/git-lfs>

MDN｜IndexedDB Upgrade Event：<https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/upgradeneeded_event>

MDN｜IndexedDB Versionchange：<https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/versionchange_event>

GitHub Cache Security：<https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching>

GitHub Environments：<https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments>

GitHub OIDC Claims：<https://docs.github.com/en/actions/reference/security/oidc>

GitHub OIDC Cloud Trust：<https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers>

GitHub Workflow Concurrency：<https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency>

StepSecurity Harden-Runner：<https://github.com/step-security/harden-runner>

pnpm install frozen lockfile：<https://pnpm.io/cli/install>

Cargo --locked / --frozen：<https://doc.rust-lang.org/cargo/commands/cargo-build.html>

wasm-bindgen project and CLI：<https://github.com/wasm-bindgen/wasm-bindgen>

VS Code Workspace Trust：<https://code.visualstudio.com/docs/editing/workspaces/workspace-trust>

總結：這 12 項已進入 v2.0 的執行規格。『設計定案』不等於『在目標 Repo 完成部署或實測』；正式驗收只會在真實配置、測試與證據皆存在時標記通過。後續工作直接按本章修改 GitHub 設定和 CI，不再反覆增加研究版本。
