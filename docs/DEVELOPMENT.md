# WORLD UNBOUND — GitHub 開發環境與找檔

依據 [AGENTS.md](../AGENTS.md) 的治理邊界執行；本文件**不授予**修改受保護檔案的權限。任務接手請先查看 [HANDOFF.md](HANDOFF.md)、[INDEX.md](INDEX.md) 及最新 Issues／PR，避免使用過期進度。

## 直接在 GitHub 使用（手機可操作）

在本倉庫點 **Code → Codespaces → Create codespace**。合併設定後，新 Codespace 使用 Ubuntu 24.04 與 Node.js 22，並透過 `.devcontainer/setup-tools.sh` 安裝 `rg`、`fd`、`jq`。既有 Codespace 需重新建置（Rebuild Container）。Codespaces 消耗 GitHub 帳號的雲端運算／儲存配額，並不保證免費。

啟動時**不**自動跑 `npm ci`、下載 Chromium、建置場景、啟動 MCP 或建立向量索引。需要測試時才執行：

```bash
npm ci --ignore-scripts
npm run check:quiet -- --no-visual     # 修改一般文件或程式時的快速完整靜態檢查
npm run check:quiet                   # 含 WebGL2 視覺稽核；需 Playwright Chromium
# 只有需要視覺稽核，且瀏覽器缺失時：
npx playwright install chromium
```

## 先定位再讀取

```bash
git ls-files 'src/render/*grass*'            # 找被 Git 追蹤的路徑
fd -t f 'grass|ocean|terrain' src tests docs  # 依檔名縮小範圍
rg -n -F 'grass' src/app src/render tests     # 列出行號
rg -n -C 3 -F 'sward' src/app src/render       # 讀局部上下文
git diff --stat                               # 先看修改範圍，按需再看 patch
npm run check:quiet -- --no-visual            # 精簡測試輸出
```

Agent 應先看相關模組，最後才讀整份文件。遇到跨檔語法重構才評估 ast-grep；Serena、RTK 等選用工具不常駐，也不自動裝，避免啟動和上下文額外成本。不得把私密資料、完整 Session、憑證或產生的遙測檔送進 Prompt／PR。

## 驗收界線

Codespaces 與 GitHub CI 是 Linux／軟體 WebGL2 環境，**不是** POCO 手機的 WebGPU GPU 實測。效能、High 畫質、幀時間、熱穩定與 10 分鐘測試仍需擁有者提供真機遙測。完整流程見 [process/agent-workflow.md](process/agent-workflow.md)；發布前應以 GitHub `final-gate`、CodeQL 與實際 Pages 部署為準。
