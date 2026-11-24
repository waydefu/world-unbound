# 全域草毯畫質優先：三方向母模側投影試驗

## 目的與範圍

Refs #33、#42、#43、#47。這是一支獨立可回退的**畫質試驗**，不是效能修復，也不宣稱達到全域高模驗收。

保留 `sod-world-master.bin`、79,524 葉／m² 的邏輯草根密度、世界固定選取、完整與簡化原模葉、原始側面草形貼圖、三層地表草冠及既有風場與光照。只針對 2 m 後至 30 m 的中景草片表現，檢查單一方向的扁平感和遮蔽不足。

## 試驗內容

- 新增 `?turfRibbon=quality`，限 `sward=world&turfLod=30&turfTrial=canopy` 試驗，預設完全不變。
- 從現有母模側投影材質建立**三個方位**的實體面（每格 6 個三角形；基準為兩方向、4 個三角形）。保留同一貼圖葉形、世界根位、高度和風動。
- 以三方向分攤遮蔽量，避免直接增加 50% 表面就讓草地無條件變暗；這是近似的光學厚度分配，不保證任何視角完全等價。
- 提高葉根到葉尖的明暗差、使用母模原有色彩取樣並加入隨葉高改變的彎曲與方向性法線變化，保留根部位置，降低直立草片感。
- 不改 Low、完整母模、WebGL2 備援規則、解析度調節或既有基準。成本可能增加，不能直接合入預設。

## 同鏡頭對照

在同一版本、同一鏡頭與環境下輪流測試：

- 基準：`?sward=world&turfLod=30&turfTrial=canopy&cam=6&turfSite=lowland&turfView=standing&q=med&scale=1`
- 畫質版：在基準 URL 後加入 `&turfRibbon=quality`
- 母模：`?sod=full&sodView=edge&q=med`

另於 `turfSite=slope|highland|seam`、`turfView=close|standing|raised` 對照，包括斜視、逆光、旋轉、走動與風擺。

畫面必須同時評估**細葉輪廓、自然綠色、葉間遮蔽、立體厚度、原模接地、遠坡連續性**。若三方向造成重影、視角條帶、密度突變、閃爍、草片過暗或近景圈，判定試驗未達標。不得僅以草片數目增加當作提升畫質的證明。

## 驗收與安全界線

- `npm ci --ignore-scripts && npm run lint && npm run typecheck && npm test && npm run build && npm run audit`。
- `npm run audit:visual` 用於既有基準六鏡頭，不代表 `turfRibbon=quality` 通過；品質模式須另在相同鏡頭擷取截圖。`tools/turf-capture.mjs` 對 WebGL2 只在 `depth` 試驗回退 `trim`；`quality` 必須在兩種後端都回報 `quality`。
- POCO F8 Ultra 的 WebGPU／WebGL2 分開確認實際後端，60 秒和 10 分鐘熱機結果另記。新增模式可較慢，但不能因此虛報達到 60 FPS。
- 不動 `main`、不更改治理規則、不得弱化測試或自動切預設。移除 `turfRibbon=quality` 即退回基準。

## 尚未解決

此試驗尚未改造原始幾何的可見距離、原模 LOD 交接、每葉次像素覆蓋率，亦無法保證從 30 m 以外觀看遠坡時具有真實立體草尖。它是能隔離比較的中景視覺改善候選，不是完成全域草毯的聲明。

## 三輪研究與直接修正（2026-11-24）

第一輪以目前程式為準，確認全域草根與母模、簡化葉、三方向草片及地表投影分層；9.1 FPS 的真機基準不代表新版本成績。第二輪研究 Abyssal Garden 的參數化幾何、分區剔除與專用著色器，但不將它的自動降解析度及手機低畫質視為相同品質的效能證明。第三輪審查 SoC：草根在 `world/turfPopulation.ts`，代理網格在 `render/turfRibbonGeometry.ts`，材質及視野更新在 `render/turfRibbonLod.ts`，試驗選項在 `app/params.ts`，數據在 `render/worldTurfMetrics.ts`。發現截圖工具會在 WebGL2 錯誤預期 `quality` 為 `trim`，已修正。另增加三方向畫質試驗的葉尖彎曲與隨葉高法線，其他模式維持原樣。

可執行 `WU_TURF_COMPARE=trial WU_TURF_LOD=30 WU_TURF_TRIAL=canopy WU_TURF_RIBBON=quality node tools/turf-capture.mjs out/quality-three-plane webgl2 lowland slope highland seam`；同鏡頭移除 `WU_TURF_RIBBON` 擷取原版。此輪尚未證實畫質等價、更未達全圖高模驗收，須保留為 opt-in 試驗。