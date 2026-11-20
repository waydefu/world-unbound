# Agent Tooling v2 — 成效驗收與 Token 評測（仍待實際 Agent A/B）

## 證據層級

**CLI 正確性**由 GitHub CI 的真實程式、合成 fixture 與負向案例證明；**CLI 耗時／記憶體／輸出量**由 `node tools/agent-benchmark.mjs --runs 5 --json` 的獨立 Node 程序觀察；**實際模型 Token 節省**只能由相同 Agent harness 與模型的獨立 A/B 工作階段量測。不得把輸出 bytes 或成功的 TypeScript 測試當作實際 Token 節省證據。

## Gate A：先量測已存在的版本

固定 SHA、Node、TypeScript、OS／架構、原始碼檔案數、每題的預期正確答案與嚴重錯誤分類。重複執行 `find`、`calls`、`impact`，記錄 cold-start/warm-start、p50/p95 wall time、最大 RSS、stdout bytes 與正確率。效能必須與相同硬體／版本的基準比較，不得僅挑選有利數據。只有語意查詢才應啟動 TypeScript Language Service。

## Gate B／C：正確性、退化與跨平台

- **Git／交接**：main 前進、feature 落後、squash merge、只有文件變動、影響執行碼／規格的變動、diverged、淺複製與 missing origin，均可區分已知變動與 unknown；本機 Git 不等於遠端即時狀態。
- **路徑**：POSIX、Windows drive／UNC、同前綴兄弟資料夾、父目錄越界、symlink escape、缺失檔案與錯誤 URL 編碼。
- **索引**：精確與部分符號、同名方法、alias/re-export、跨檔調用、incoming／outgoing **各自限額**、offset 分頁及無效查詢退出碼；TypeScript 語意工具對 dynamic call、Worker、TSL／Shader、資產契約明確標示不完整。
- **安全與失敗**：不新增常駐索引／MCP、不連線、不讀取或列印憑證；任何錯誤不應回傳看似成功的空依賴表。

## Gate D：真正的 Agent A/B 測量

先做 5–10 題 pilot，再至少 20 題，涵蓋找函式、呼叫者、受影響測試與交接判讀。A：使用既有 `git ls-files`、`rg`、模組文件；B：允許新 CLI。固定 repo SHA、模型、推理模式、溫度、工具權限、提示詞及時間預算；每次均用**全新獨立對話與乾淨工作副本**，禁止沿用上一輪結果。採 AB/BA 交叉平衡順序，建議每題每組至少三次獨立測試（成本不足須明列樣本與不確定性）。

紀錄：題目 ID、模式、模型與版本、SHA、正確與否、前三次搜尋中的正確入口、呼叫者／測試完整度、工具次數、端到端耗時、provider 提供的 input/output/reasoning/cache read/cache write Tokens、錯誤案例。原始紀錄存放受控 `out/`（忽略提交），不要存私人 Session 或憑證。Token 只有供應商回報才可計入。

## 提案門檻（非已完成結果）

至少 90% 入口在前三次搜尋中正確定位；已知直接呼叫／相關測試不得重大漏報；配對樣本的中位模型 Token 降低 ≥20%，正確率不下降，端到端延遲無重大惡化。須報各類任務差異與樣本不確定性；若條件不成立就保留原工具或回退，不能宣稱已到 9/10。