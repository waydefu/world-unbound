> **Source title:** world-unbound｜聖奧爾德里克港：完整設計與純程式 3D 引擎技術規範書 v1.0
> **Imported from the owner's Google Doc on 2026-11-17.**
> This is a reference copy; the repository's AGENTS.md, governance/ and ADRs are what is enforced.

# world-unbound（聖奧爾德里克港）

### 純程式 3D 開放世界引擎架構與完整遊戲設計規範書 v1.0（全量定案版）

專案倉庫：https://github.com/waydefu/world-unbound  
正式發布入口：https://waydefu.github.io/world-unbound/（GitHub Pages HTTPS 多檔靜態網站）  
目標運行平台：Android 旗艦行動裝置（基準機型 POCO F8 Ultra，2608×1200）、iPhone Safari、桌機主流瀏覽器

## 01｜專案定位、執行授權與核心工程原則

1. **全新從零建構授權**：本文件為《world-unbound：聖奧爾德里克港》的唯一正式技術與設計規範，正式授權 AI 開發代理與工程團隊從零開始設計架構並分階段實作。
1. **核心願景**：打造一款無需下載安裝、無外部龐大美術資源包、完全由確定性演算法與著色器驅動（Procedural）的 13–15 世紀北歐漢薩同盟波羅的海港鎮開放世界生活模擬網頁遊戲，在行動端與桌機瀏覽器實現接近桌機單機水準的寫實光影、物理一致性與流暢 60 FPS 體驗。
1. **發行與資源預算契約**：採用 Vite 模組化建置（base: '/world-unbound/'）部署至 GitHub Pages HTTPS 靜態網站，發布資產總量上限 150 MB，並以版本化 Manifest 與按需 Chunk 串流管理資源（詳細規範見第 3.1 節）。
1. **工程核心哲學**：不存在不受平台與工作負載影響的「絕對最快語言或渲染器」。在手機、桌機與瀏覽器同時追求高畫質時，最優架構為「共用確定性世界核心 + 平台自適應渲染後端 + 資料導向設計（SoA TypedArray）+ GPU 常駐資源 + 可量測品質門檻」。
1. **五大最高優先事項**：
  - 減少無效像素與幾何處理（剔除、LOD 與透明 Overdraw 控制）。
  - 讓資料盡量常駐於 GPU（分塊上傳、Dirty Range 與版本化緩衝區）。
  - 讓 CPU 與 GPU 高度重疊並行，且不造成過量操作延遲。
  - 針對行動端 Tile GPU 頻寬、記憶體上限與長時熱降頻設計。
  - 為空間精度與視覺一致性建立可重現的自動化驗收標準。

## 02｜AI 自主架構設計與四大開發鐵律

1. **架構自主權**：開發代理在動手撰寫業務程式碼前，必須先通讀本規範並自主決策整體技術架構（例如選擇 Three.js WebGPURenderer + TSL 含 WebGL2 自動降級，或 Three.js WebGL2 + 自訂 GLSL，或原生 TS/WebGPU/WGSL；以及規劃 ECS / SoA TypedArray 世界核心與 Render Pass 結構），提交《架構決策書（Architecture Blueprint）》經確認後再分階段推進。
1. **語言與任務分工原則**：
  - **TypeScript（Shell 與協調層）**：處理 DOM/HUD、輸入採樣、生命週期、瀏覽器能力偵測、Chunk 串流調度與渲染命令提交；嚴禁每幀為數萬個實體配置臨時 JS 物件。
  - **資料導向模擬核心（純 TS TypedArray SoA；僅在實測 CPU p95 熱點超過 3.5ms/幀且純 TS 優化不足時，才考慮針對單一熱點引入無 Threads 版 Rust/Wasm）**：處理 Chunk 網格、空間索引（Spatial Hash / BVH）、確定性高度與碰撞查詢、Simulation LOD、NPC 狀態、農耕與存檔。
  - **GPU 核心（TSL / WGSL / GLSL）**：負責 GPU Instancing、視錐與遮擋剔除、植被風場、粒子系統、PBR 光照、海洋與後處理；僅將高同質、低分歧且可留駐 GPU 的任務交由 GPU 加速，嚴禁為求 GPU 化而進行高頻率同步 GPU→CPU 讀回（mapAsync）。
  - **Offline / Build 工具（Node.js / Vite / 可選 C++ meshoptimizer）**：負責離線幾何簡化、預烘焙紋理轉碼（KTX2）與靜態審計腳本。
1. **3. 不可妥協的四大工程鐵律**：
  - **模擬與渲染徹底解耦**：CPU 世界核心（`src/world/`，負責確定性地形、碰撞、實體狀態與存檔）與 GPU 渲染管線（`src/render/`）完全分離，僅透過版本化快照或 TypedArray 緩衝區交換資料。
  - **嚴格模組化拆分**：單一程式碼檔案原則上不超過 **350 行**，單一模組職責單一，嚴禁將不同系統塞入單體巨型檔案。
  - **零渲染迴圈 GC 壓力**：嚴禁在 `requestAnimationFrame` 每幀迴圈內配置臨時物件（如 `new Vector3`、`new Matrix4` 或臨時陣列），所有工作緩衝區必須預先配置並重用。
  - **Clean-Room 參考邊界**：可借鏡公開技術案例的演算法思路（如 Abyssal Garden [MIT] 的 GPU 地形與品質檔位、Crimson Loong 的程序建築與天空預烘、Grassworks 的相機相對植被分塊、Brinewater 的區塊串流，以及材質鍵合批、頂點色風化變體、滯後式動態解析度、URL 除錯參數），但嚴禁複製任何未具明確授權的外部原始碼或著色器檔案。

## 03｜跨平台硬體事實、Render Graph 與記憶體紅線

### 3.1 發行契約與 GitHub Pages 部署邊界

- 採用 Vite 模組化原始碼建置（Vite base 必須設為 `'/world-unbound/'`），透過 GitHub Actions 部署至 GitHub Pages（https://waydefu.github.io/world-unbound/），產物包含單一正式入口 `index.html` 與經內容雜湊命名的 JS、Shader 模組、可選 Wasm 與預烘焙靜態資料。
- 正式發布資產總量上限為 **150 MB**；需分別記錄 dist 總 bytes、首屏下載 bytes、二次進入 cache hit、載入峰值與 GPU/CPU 邏輯記憶體。
- 所有 Worker、Wasm 與靜態資源路徑一律使用 `new URL(..., import.meta.url)` 動態解析，嚴禁寫死根路徑 `/assets/...`；並透過版本化 Manifest 防止資源切換時混搭新舊 Shader 與幾何。
- **無 COOP/COEP 假設**：標準 GitHub Pages 不支援自訂 COOP/COEP HTTP 標頭，因此 `SharedArrayBuffer` 與多執行緒 Wasm Threads 不得列為必要主線能力（亦不可依賴 Service Worker 模擬標頭作為跨裝置保證）。

### 3.2 CPU／GPU 重疊、Worker 拓樸與輸入延遲控制

- **建議執行緒拓樸**：主執行緒僅處理 DOM/HUD 與輸入事件；Simulation Worker 執行世界邏輯；Render Worker 僅在偵測裝置支援 `OffscreenCanvas` 與 `WorkerNavigator.gpu` 且穩定時擁有 GPUDevice，否則優雅退回主執行緒渲染（特別注意 Safari/iOS 環境下 Worker WebGPU 掉裝置風險）。
- **資料交換與雙/三緩衝**：以連續 SoA Buffer、固定記憶體布局與 Dirty Range 為主（注意 Wasm Linear Memory 的 TypedArray view 仍屬 CPU 記憶體，queue.writeBuffer 仍需傳輸）。
- **輸入延遲與 Late Latching**：輸入封包必須附帶高解析度時間戳與遞增序號，模擬步進與渲染命令建構前一律讀取最新完整輸入快照（Late Sampling / Late Latching），避免處理過期封包造成額外 1 幀延遲。
- **DOM HUD 合成成本**：獨立評估 CSS backdrop-filter 與大面積半透明覆蓋層的合成器開銷，行動端優先採用輕量純色半透明背景與低頻率 HUD 更新。

### 3.3 Render Graph、Tile GPU 頻寬與 Pipeline 編譯防護

- **顯式 Render Graph 設計**：每個 Pass 宣告 inputs、outputs、loadOp、storeOp、format、sampleCount、dimensions、historyDependence 與可合併性，負責拓樸排序、讀寫危害檢查、Transient/Persistent Render Target 池管理與 Pass 計時。CPU 提交耗時、GPU Pass 執行耗時與螢幕 Present 延遲必須分開計帳，不可直接加總當作操作延遲。
- **行動端光照管線選型**：依可見光源數量、透明草葉/水體 Overdraw 與 G-Buffer 頻寬實測比較 Simplified Forward / Forward+ 與 Deferred；正午戶外少光源場景優先使用簡化 Forward，僅在夜間密集點光源場景啟用 Clustered Light Culling。
- **Tile GPU 附件最佳化與版本相容**：在不需要保留內容時明確使用 `loadOp="clear"` 與 `storeOp="discard"` 以降低外部記憶體頻寬（對應 Metal Memoryless 機制）。若偵測支援 `GPUTextureUsage.TRANSIENT_ATTACHMENT`（Chrome 146+），必須嚴格遵守 Chrome 149/150 驗證規範：建立時 viewFormats 必須為空、createView 不可修改既有 usage、不可作 resolveTarget 且不可跨 Pass 取樣；不支援時自動退回一般 Attachment。
- **中央 GPU 資源與 Pipeline 註冊中心**：為每項 Geometry、Texture、BindGroup、Buffer、RenderTarget 與 Pipeline 追蹤資產 ID、估算 bytes、引用計數、版本、最後使用幀與優先級，依 Chunk 與距離實施 LRU/Priority 回收。
- **Shader 管線非同步預編譯（Warmup）**：以可重現 Key（材質功能、燈光模式、頂點 Layout、目標 Format、MSAA）管理 Shader 變體；於載入與轉場期呼叫 `createRenderPipelineAsync` / `createComputePipelineAsync` 預編譯並收集 `getCompilationInfo()` 診斷資訊，防範首次轉視角出現 >50ms 或 >100ms 編譯停頓（初始變體警戒線：Balanced ≤ 64、High ≤ 128）。

### 3.4 瀏覽器能力偵測、解析度預算與邏輯記憶體紅線

- **漸進式能力偵測與掉裝置恢復**：啟動時依序檢查 `window.isSecureContext` → `navigator.gpu` → `requestAdapter()` → `adapter.features/limits` → `OffscreenCanvas` → 壓縮紋理支援（KTX2/Basis 轉碼為 ASTC/BC/ETC2）→ Shader 編譯驗證。監聽 `device.lost` 實作 GPU 資源重建，若無法重新取得 Adapter 則切換至有明確狀態標示的 WebGL2 退路。注意 WebGPU 單次 drawIndirect 不等於原生 Multi-Draw Indirect，Chrome Compatibility Mode 或實驗旗標不得作為正式先決條件。
- **iOS Safari 專屬適配**：Safari 26+ 支援 WebGPU，但非 video 元素的系統級 Fullscreen API 受 WebKit 限制，必須實作可用視口最大化（100dvh / safe-area）與 PWA 加入主畫面（Standalone）分流方案。
- **像素預算與滯後式動態解析度（Hysteresis Dynamic Resolution）**：
  - POCO F8 Ultra 原生面板解析度為 2608×1200（3,129,600 pixels，長寬比約 2.1733），60 FPS 單幀總預算為 16.67ms（90 FPS 為 11.11ms，120 FPS 為 8.33ms）。
  - 內建滯後式動態解析度調節器：當幀間隔持續高於上限閾值（例如 >21.5ms）時逐步下調內部渲染倍率，必須持續低於安全下限閾值（例如 <16.5ms）數秒後才逐步回升，避免解析度頻繁震盪；每次驗收均記錄 CSS viewport、DPR、實際 Drawing Buffer 寬高與總像素數。
- **邏輯記憶體配額與 iOS OOM 防護**：
  - 中央 Resource Registry 分別追蹤四大邏輯記憶體區塊（GPUTexture/Buffer/RT、CPU 保留幾何/紋理、Staging 上傳緩衝、Wasm Memory），同一共享底層緩衝區不可重複計帳。
  - 行動端初始工程配額門檻：Balanced 檔位為 192 / 128 / 64 / 64 MiB；High 檔位為 320 / 192 / 96 / 96 MiB。達任一配額 80% 立即觸發距離與 LRU 快取回收，達 100% 禁止新增非必要常駐資源並執行安全降檔。
  - 針對 iOS WebContent 進程記憶體上限（保守研究目標低於 900 MiB），實作 IndexedDB 增量世界檢查點與 localStorage 輕量異常重載偵測旗標；頁面若因系統記憶體壓力重載，重進時自動偵測未正常結束旗標並以安全低配與分批串流恢復世界狀態。

## 04｜大世界精度、程序化建築生態與光學視覺工藝

### 4.1 大世界空間精度與模擬管理

- **座標系統**：世界空間採用 Chunk ID + 局部座標（CPU 端必要時使用 f64 絕對座標），所有上傳至 GPU 的頂點與矩陣一律轉換為 Camera-relative f32，徹底消除遠離世界原點時的浮點抖動與接縫裂隙。
- **地形權威性與串流**：CPU 端確定性高度、海床深度與海岸線查詢為唯一權威（採用可版本化的量化整數高度 Tile 與跨 Chunk 邊界法線一致規則），視覺渲染表面與物理碰撞接點最大高度誤差須控制在 2cm 以內。世界串流採用有界優先隊列、視角速度預取、過期請求取消與嚴格 GPU 駐留預算。
- **Simulation LOD 與空間索引**：互動圈（~0–40m）採用 60Hz 固定時間步長與渲染插值；中距離城鎮與 NPC（~40–150m）採用 10–20Hz；遠距離（>150m）採用 1–5Hz 或事件驅動狀態推演，進入近景時依確定性事件還原位置，嚴禁 NPC 或船隻瞬移。密集同質查詢（草地交互、局部碰撞）優先使用 Spatial Hash / Grid，廣域靜態世界使用 BVH / Chunk 階層。

### 4.2 光學大氣、光照分流與海岸水體

- **天文曆法與大氣 LUT（北緯 53.9°）**：設定地理緯度為北緯 53.9°，採用一年 32 日曆法（春、夏、秋、冬各 8 日），太陽軌跡與晝夜長短隨季節真實變化。實作預計算大氣散射天空 LUT（太陽、月亮、星空、動態雲層與雲影）、PMREM 環境光、三級聯陰影（CSM）、夏季高緯度夜間藍調（Blue Hour）與暗適應 Purkinje 夜視色偏，並以 AgX 或 ACES HDR 色調映射輸出。
- **光照分流與天氣材質系統**：支援晴朗、多雲、降雨、暴風雨四種天氣平滑過渡，建立共用程序化風化與雨濕材質調變系統（雨天自動降低表面 Roughness、加深 Albedo 並呈現濕地鏡面反射）。局部 Probe GI / SSGI / SSR 僅在實測畫質提升且手機幀預算允許時啟用，並通過戶內外過渡與防漏光測試。
- **海岸與多頻帶海洋**：共用岸線與海床水深查詢控制多頻帶波譜長浪（Gerstner / 頻譜波）、近景細部法線（波紋小於像素時轉向法線整合/模糊以消除遠處亮條紋閃爍）、岸線浪花泡沫、Beer-Lambert 淺水消光吸色、濕沙邊界與分級水面反射；船體浮力與釣魚浮標必須採樣同一組同步波場函數。

### 4.3 反「基本幾何體」的程序化建築與材質工藝

- **類型化建築生成文法**：嚴禁使用光禿禿的方塊、圓柱或圓錐充當建築與樹木。建立階層式生成文法（街廓 → 石砌地基 → 木構柱樑 → 牆體 → 具真實內凹深度與正確遮擋的門窗洞口 → 樓梯 → 出挑屋簷 → 起伏屋瓦與碼頭樁柱），並執行拓樸有效性檢查（轉角不穿模、屋瓦不規則化排布、碰撞體與導航網格一致）。
- **材質鍵合批與紋理管線**：靜態建築網格依材質鍵合併（Material Batching），透過頂點色（Vertex Color）注入風化、青苔、污漬與色調變異以大幅壓低 Draw Calls。可重用程序化 PBR 紋理（Albedo / Normal / Roughness / AO）於建置或初始化時烘焙，依裝置能力選用 KTX2/Basis → ASTC / BC / ETC2 或未壓縮退路；嚴格區分 Base Color 的 sRGB 與 Normal/Roughness 的線性色彩空間，控制 Texel Density、Mipmap/Anisotropy 與 Triplanar 導數反鋸齒。
- **時間抗鋸齒（TAA）與動態穩定性**：若啟用 TAA 或 Upscaling，必須完整實作 Motion Vector、History Validity、Depth/Normal Rejection、Disocclusion 與 Reactive Mask，針對透明植被與海面高光特殊處理；在快速轉頭、逆光欄杆、雨滴與 LOD 切換時評估拖影與閃爍，若動態穩定性不足則優先採用穩定的 MSAA / FXAA 組合。

### 4.4 聖奧爾德里克港空間尺度（真實公制單位）

| 區域類別 | 空間單元與結構 | 規格與細節描述 |
| --- | --- | --- |
| **防禦與城鎮格局** | 城牆與壕溝 | 約 500m × 400m 城牆環，配備 5 座城門樓；外側設梯形剖面乾壕（壕底高於海平面）。 |
|  | 市集廣場 | 城鎮中心 70m × 70m 方形市集廣場，包含中央井亭與行會廳柱廊。 |
| **地標與民居** | 哥德式教堂 | 兩座北德磚造哥德式教堂：主教堂高塔約 71m，港口教堂中殿約 35m。 |
|  | 程序化民居 | 約 400 棟依街區機能分布之建築：商人山牆屋（Dielenhaus）、階梯山牆磚屋、半木構民居、酒館及城外蘆葦屋頂農舍。 |
| **港口與海事設施** | 碼頭與防波堤 | 疏浚港灣、石砌碼頭、木棧橋（樁距 1.8m）、兩道防波堤與港口燈塔。 |
|  | 港務專用設施 | 水上關卡（Baumhaus）、多層磚造倉庫（Speicher）、魚市棚架、曬網架、斜坡修船台。 |
|  | 重型機械與船隻 | 高 26.5m 的雙輪踏輪起重機；停泊港內的 23m × 7.6m 漢薩柯格船（主桅高 21m，含完整舵與索具）。 |

### 4.5 波羅的海考據生態與程序化 Web Audio 音效

- **考據植物群落**：嚴格限定為 13–15 世紀北歐波羅的海原生植物（海岸沙丘草、耐鹽鹼草甸、淺水蘆葦、赤楊濕林、田間灌木樹籬、中世紀果園、山毛櫸／櫟木混交林、沙地樺松林），排除現代引入種與平地人工雲杉林。植被依 Near / Mid / Far / Canopy 分級，近景草地採用低解析度 Interaction Map 實現角色踩踏互動，並隨四季變色與積雪。
- 零外部音檔，純程式即時合成海浪拍岸、風聲、雨聲、雷聲、不同地面材質（石板、木棧道、草地、泥土）腳步聲與遠處教堂鐘聲。

## 05｜核心玩法閉環、自動化審計與驗收門檻

### 5.1 完整可玩系統（不可退化為純看風景 Demo）

1. **角色移動與精確碰撞**：支援第一／第三人稱視角切換、鍵盤滑鼠與行動端虛擬雙搖桿操作，具備行走、疾跑、跳躍與地形／建築精確碰撞。
1. **划船系統**：玩家可於碼頭邊登船或離船，船體起伏、俯仰與橫搖與海洋波場高度及法線即時物理連動。
1. **張力釣魚系統與圖鑑**：完整支援蓄力拋竿 → 等待浮標訊號 → 提竿咬鉤 → 收線張力條控制（防止斷線或脫鉤）；魚種出現權重隨季節、時段與水域深度變化，釣獲後記錄體長並登入魚類圖鑑。
1. **中世紀農耕系統（工具欄 1–4）**：
  - **1 號 鋤頭**：翻土整地。
  - **2 號 種子袋**：播種中世紀作物（黑麥、大麥、燕麥、亞麻、蕪菁等）。
  - **3 號 水桶**：澆水維持土壤濕度。
  - **4 號 鐮刀**：成熟收成。晚秋與冬季低溫未採收作物將受霜害枯萎。
1. **5. 市集經濟、背包與防崩潰存檔**：漁獲與農作物可存入背包並至市集廣場攤位買賣換取貨幣與工具升級；存檔採版本化 Schema，支援手動 JSON 匯出入與 IndexedDB 增量自動檢查點恢復。

### 5.2 除錯工具、靜態守衛與真機驗收標準

- **內建 URL 除錯參數**：
  - `?cam=0..5`：六個固定代表性測試鏡頭（0: 低角度海岸與防波堤、1: 建築細節 0.5m/2m/20m、2: 近景植被與風場、3: 逆光黃昏與水面高光、4: 雨夜濕地與反射、5: 城鎮與港口大視距俯瞰）
  - `?backend=webgpu|webgl2`
  - `?q=low|med|high`
  - `?scale=0.5..1.5`
  - `?hour=0..24`
  - `?wx=clear|cloudy|rain|storm`
- **遙測 HUD 與結構化報表**：內建可開關遙測 HUD 與 JSON 匯出器，統計 FPS、p50/p95/p99 幀間隔、長幀計數（>50ms 與 >100ms）、邏輯記憶體四項分區佔用、Shader 變體數與首次 Pipeline 編譯耗時、20 分鐘連續運行熱穩態與背景切換恢復表現。
- **自動化品質守衛（`scripts/audit.mjs`）**：每次完成階段任務必須執行靜態檢查，驗證單檔行數上限、資源相對路徑規範與零渲染迴圈 GC 分配，並透過無頭瀏覽器巡檢六個鏡頭畫面無報錯。

## 06｜分階段實作路線圖（Milestone 0 ～ Milestone 3）

每次僅推進一個 Milestone，完成並通過建置、靜態審計與六鏡頭視覺檢核後停止回報：

- **Milestone 0（工程骨架、權威地形與遙測基準）**：建立 Vite + TypeScript + 3D 渲染器模組化骨架（`base: '/world-unbound/'`），實作瀏覽器能力矩陣偵測、滯後式動態解析度控制器、遙測 HUD、CPU 確定性高度與海岸線系統（港口灣區、城鎮平地與山丘基礎地形）及 6 個固定測試鏡頭。
- **Milestone 1（光學大氣、PBR 風化材質與多頻帶海洋）**：實作北緯 53.9° 日夜與 32 日四季天象、預烘焙大氣天空 LUT、CSM 陰影、雨濕調變 PBR 材質系統與多頻帶波譜海水（淺水消光、岸邊泡沫與統一波浪高度採樣）。
- **Milestone 2（漢薩港鎮建築與考據生態植被）**：實作參數化中世紀港口與城鎮建築（500×400m 城牆、雙教堂、約 400 棟街屋、踏輪起重機與柯格船，具門窗內凹深度、材質鍵合批與碰撞註冊）及波羅的海考據植被分級系統。
- **Milestone 3（核心玩法閉環、程序化音效與存檔）**：實作第一／第三人稱移動碰撞、波浪浮力划船、張力釣魚與圖鑑、1–4 號農具種田與霜害、市集買賣、Web Audio 環境音效與 IndexedDB 防崩潰存檔。

## 07｜已驗證官方技術查證來源庫（API 實作依據，避免幻覺寫法）

- WebKit Safari 26 正式 WebGPU 支援：<https://webkit.org/blog/17333/webkit-features-in-safari-26-0/>
- Three.js WebGPURenderer 與 TSL 遷移指南：<https://threejs.org/manual/pages/webgpurenderer>
- Three.js Color Management：<https://threejs.org/manual/en/color-management.html>
- Three.js LOD 與 InstancedMesh：<https://threejs.org/docs/pages/LOD.html> ／ <https://threejs.org/docs/pages/InstancedMesh.html>
- Chrome 146 WebGPU Compatibility Mode 與 Transient Attachment：<https://developer.chrome.com/blog/new-in-webgpu-146>
- Chrome 149/150 Transient Attachment 嚴格驗證規範：<https://developer.chrome.com/blog/new-in-webgpu-149-150>
- W3C WebGPU 規格（Load/Store 與渲染管線）：<https://gpuweb.github.io/gpuweb/>
- W3C WGSL 浮點精度與實作容許差異：<https://www.w3.org/TR/WGSL/>
- MDN GPUDevice.lost 裝置丟失恢復：<https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost>
- MDN WorkerNavigator.gpu：<https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu>
- MDN GPUSupportedLimits：<https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits>
- MDN createRenderPipelineAsync：<https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipelineAsync>
- MDN GPUShaderModule.getCompilationInfo：<https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule/getCompilationInfo>
- MDN Fullscreen API 與 ScreenOrientation.lock：<https://developer.mozilla.org/en-US/docs/Web/API/Fullscreen_API> ／ <https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock>
- Apple Metal Memoryless Storage Mode（Tile GPU 頻寬參考）：<https://developer.apple.com/documentation/metal/mtlstoragemode/memoryless>
- Khronos KTX2 / Basis 紋理壓縮開發指南：<https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md>
- Playwright Golden Snapshot 視覺回歸測試：<https://playwright.dev/docs/test-snapshots>
- meshoptimizer 幾何叢集與 LOD 簡化：<https://github.com/zeux/meshoptimizer>
- WebKit iPhone 非 video 元素 Fullscreen 限制議題：<https://bugs.webkit.org/show_bug.cgi?id=206854>
- WebKit iOS Safari WebGPU 記憶體與 Worker 穩定性議題：<https://bugs.webkit.org/show_bug.cgi?id=331130> ／ <https://bugs.webkit.org/show_bug.cgi?id=321676>

### 08｜UE5 級程序化視覺技術研究補編（2026-11-17；非架構決策）

- 研究目的：為《world-unbound》補足朝 Unreal Engine 5 級視覺品質前進時會用到的圖形演算法、程序生成方法、模組資料契約、可替代技術與實際風險。這是獨立的技術研究資料庫，不受第 01～07 章或任何已定案架構的選型限制，也不預先指定語言／引擎／GPU API；不宣稱已實作、達 60 FPS、具有完整 Nanite／Lumen／TSR 或與 UE5 逐像素相同。實作時可選 TypeScript、C++、Rust、WGSL、GLSL、HLSL、Wasm 或離線工具，以品質和經驗證成本決策。
- 證據等級：A＝Epic／W3C／Khronos／AMD／NVIDIA 等官方技術文件或規範；B＝已發表的可追溯論文；C＝第三方工程實作或可審查原始碼；D＝尚待自行驗證的研究提案。下文的函式名稱是「建議抽象介面」，不是已存在、可直接匯入的 API。完整實作需要各模組另訂型別及契約。UE5 的 Nanite、Lumen、Virtual Shadow Maps 和 TSR 是整套技術，不能因為使用一個 Meshlet、SSGI 或 TAA 就宣稱等效。
- UE5 技術交叉核對：Nanite 使用階層化三角群集、可視性／LOD 篩選與細粒度串流；Lumen 混合 Screen Traces、Surface Cache／Radiance Cache 及可用時的軟／硬體追蹤；Virtual Shadow Maps 透過 Page／Clipmap／快取失效提升大型場景陰影；TSR 由歷史重投影、遮擋揭露與 Shading Rejection 等多種處理構成。這些技術可作畫質功能清單，但瀏覽器與手機並非一定具有其原生 GPU 特性。

### 09｜高密度幾何與 Nanite 類研究：讓輪廓不再低模

- **09.1 細節資料的六層：**世界區塊（Chunk）→ 建築／地形實體（Object）→ HLOD Group → Meshlet／Cluster → 頂點和三角形 → 頂點／表面材質。根據螢幕投影誤差、深度、視角與遮擋決定展示哪層；物件距離本身不足以判定是否可見。將極近距屋瓦、木梁端點、瓦緣、石縫、磚角與港口繩索／船舷輪廓納入真正幾何細節，不以 BaseColor／Normal Map 取代會改變 silhouette 的結構。
- **09.2 可比較演算法：**傳統連續 LOD／幾何變形（低複雜度）；Meshlet Cluster＋BVH／DAG＋螢幕空間誤差（高潛力但高實作成本）；Geometry Clipmap（適合高度場）；Voxel SDF＋Marching Cubes／Dual Contouring（適用洞穴、切割與非高度場結構）；SDF Raymarch 僅對特定局部物體或霧效評估。Meshlet 只是資料組織，不等於瀏覽器直接支援硬體 Mesh Shader；Compute Culling、逐群集繪製與 Indirect Draw 是否省時必須視平台證明。
- **09.3 必備設計函式：**
- quantizeGeometryPositions(mesh, scale, origin) -> PackedGeometry；建立精度可追溯、可解碼頂點。
- partitionMeshIntoClusters(mesh, maxVerts, maxTris) -> ClusterSet；維持材質鍵、拓樸相鄰資訊。
- buildClusterHierarchy(clusters, errorMetric) -> ClusterDAG；記錄父子群集、包圍盒／球、幾何誤差和串流 Page。
- estimateProjectedError(cluster, camera, viewportPixels) -> PixelError；以像素誤差而非固定公尺門檻選 LOD。
- queryVisibleClusters(camera, frustum, depthPyramid, history) -> VisibleSet；保守遮擋與錯誤回退。
- selectResidentPages(visibleSet, memoryBudget, motionPrediction) -> PageRequests；按需求預取、取消、固定駐留上限。
- resolveLODSeams(chunkNeighbors, lodSet) -> SeamFixups；同時處理相鄰群集裂縫、法線不連續與微形變閃爍。
- **09.4 必驗：**視線貼近屋角時輪廓、瓦片比例、城牆拐角、細繩與樹冠透空形狀；高速轉頭時沒有群集丟失／黑洞／嚴重 Popping；記錄 visible clusters、candidate clusters、Culling cost、Streaming misses、三角形數、Draw Calls、GPU bytes。資料出處見 [R01][R02][R03][R04]。

### 10｜Lumen 類間接光、天空反彈光與反射資料表示

- **10.1 為什麼只靠 Direct Light＋AO 不夠：**屋簷下、拱廊、室內窗邊、雨後港口、背光石牆的明暗由多次反彈、天空視域、遮蔽、色彩滲透與曝光共同決定。單純提亮 Ambient 會抹除空間感；SSR 只知道螢幕內資料，螢幕外物體反射會消失。
- **10.2 候選資料表示（可以混合，不預先選）：**離線／準靜態 Light Probes（SH 球諧／Probe Grid；室內外基本照明）；DDGI 類動態 Probe（更新成本及漏光防護）；Surfel／Surface Cache（為可見場景提供間接光查詢）；Signed Distance Field／Global SDF＋Screen-Space Traces（廉價軟追蹤但準確度受限）；Screen-Space GI（只補可視部分）；受支援的原生 Ray Tracing（不假設一般 WebGPU 有 BVH 光追 API）。先驗證場景表現，再談光線步數。
- **10.3 必備設計函式：**
- buildSurfaceLightingCache(scene, surfaceSampling) -> SurfaceCache；靜態與動態表面分開失效。
- updateRadianceProbes(probeGrid, sunSky, emissives, updateBudget) -> ProbeState；按重要性更新。
- traceScreenSpaceIndirect(depth, normals, roughness, history) -> GIImage；包含深度不連續與屏外退路。
- traceDistanceFieldVisibility(origin, direction, maxDistance, sdfClipmap) -> Visibility；需保守步進、薄牆處理。
- sampleIndirectDiffuse(position, normal, material, probeState) -> Radiance；在定義的色彩空間返回線性 HDR。
- sampleSpecularReflection(position, normal, roughness, sceneData, history) -> Radiance；SSR→Probe／天空等層級退路。
- detectLightLeaks(probes, geometry, occlusion) -> LeakMask；用薄牆、門縫、地下室等測例。
- **10.4 更新預算：**隨太陽、雲遮、火光、開關門變化，單一幀不必更新全部 Probe；紀錄時間延遲、能量誤差、漏光、滯後及視角依賴。必驗：由晴天室外走進暗屋，再回頭看門洞；牆壁有帶色反射但不整面染色；雨夜火光照亮濕牆，船身在水中反射不因離開螢幕便完全消失。資料出處見 [R05][R06]。

### 11｜Virtual Shadow Maps 類陰影研究：細節、快取、失效

- **11.1 可比較路線：**穩定 CSM＋PCF／PCSS；近景 Contact Shadows／Screen-Space Shadow；Virtual Shadow Pages＋Clipmaps＋動靜分層；過濾式 Moments/VSM/EVSM（注意 Light Bleeding）；RSM 僅在反彈光有明確效益時研究。
- **11.2 必備函式：**
- chooseShadowResolution(caster, receiver, camera, light, quality) -> ResolutionPlan；
- buildShadowPageRequests(viewDepth, lightView, clipmapLevels) -> PageSet；
- invalidateShadowPages(changedBounds, movingLights, pages) -> DirtyPages；
- renderShadowPages(dirtyPages, staticLayer, dynamicLayer) -> ShadowAtlas；
- filterShadowVisibility(depth, normal, receiverBias, filterKernel) -> ShadowTerm；
- computeContactShadow(depth, normal, lightDirection, thickness) -> ContactTerm。
- **11.3 光照節約關鍵：**地形與屋瓦是大量靜態投影者；船隻、旗幟、草葉、雲影是動態投影者。若不分層，海風持續擺動旗幟會大量打掉陰影快取。Shadow Bias 應結合接收面法線和斜率，監測 Peter-Panning、自陰影痤瘡、Cascade 邊界跳變、低太陽角度下長距離陰影與葉片重影。頁式陰影需要功能支援與自研成本，不預設一定勝過優化後 CSM。資料出處見 [R07][R08]。

### 12｜寫實 PBR／多尺度程序材質：不是只加雜訊

- **12.1 共用材質參數：**線性世界空間下的 BaseColor、Metallic、Roughness、Normal、AO、Emissive；依實際需要增加 Anisotropy、Sheen、Clearcoat、Transmission、Subsurface／Two-Sided Foliage。金屬、石牆、木材、布料、植物葉片與濕地泥沙的 BSDF 不相同；不得將所有材質共享相同高光模型就期待寫實。實現微表面 GGX／Smith／Schlick（或更精確模型）時應注意能量守恆、多重散射補償、粗糙度空間濾波與掠射角反射。
- **12.2 三階細節：**大尺度（建築群、不同年代磚色與雨痕）／中尺度（牆面污漬、灰縫、風化、磨損）／微尺度（木紋毛孔、磚石顆粒、粗糙度變化）；用地理環境規則與物理成因驅動，不把同一張雜訊貼到所有材質。三軸投影可解決 UV 拉伸，但必須控制 mip/導數和 Texture Samples。程序生成內容可在建置或初始化期 Bake，降低每像素重算成本；距離變化時減少頻譜與細節別名。
- **12.3 必備函式：**
- evaluateMaterialLayers(base, deposits, weathering, wetness, season) -> MaterialParams；
- generateBrickBondPattern(wallBounds, brickSize, bondRule, seed) -> BrickLayout；
- synthesizeMicroNormal(surfaceType, scale, seed, derivatives) -> NormalTerm；
- filterRoughnessForFootprint(normalVariance, roughness, derivatives) -> Roughness；
- evaluateLeafTransmission(normal, thickness, sunDirection, chlorophyll) -> Radiance；
- updateWetnessField(rainfall, slope, drainage, porosity, time) -> WetnessField；
- bakeMaterialTiles(recipe, resolution, colorSpace, mipPolicy) -> VersionedTextureSet。
- **12.4 對照：**同一石牆必須具磚塊大小一致、轉角有砌築規則、窗下有水痕、牆頂有苔斑；材質在陰影和強光都能看清微結構，不能只有法線閃光。可查證 PBR/雙面葉片／多層 BSDF 見 [R09][R10][R11][R12]。

### 13｜天空、大氣、體積雲、空氣透視與雲影

- 13.1 空氣由透射 Transmittance、單次散射、多次散射與相位函數控制；Epic 的 Sky Atmosphere 將其拆為 Transmittance、Multiple Scattering、Sky View、Aerial Perspective 等 LUT，而非每個像素都全程高成本積分。體積雲密度可採天氣尺度 2D Coverage Map＋3D Base Shape Noise＋細部侵蝕噪聲＋高度分布；日出／日落時要有正確的雲層陰陽面、半影與地面雲影，不能讓雲色獨立於日照。
- **13.2 必備函式：**
- computeSunMoonEphemeris(latitude, longitude, seasonDay, solarHour) -> CelestialState；
- bakeAtmosphereTransmittance(params, lutResolution) -> LUT；
- bakeMultipleScattering(params, transmittanceLUT) -> LUT；
- updateSkyViewLUT(cameraHeight, sunDirection, atmosphereVersion) -> LUT；
- updateAerialPerspectiveFroxels(camera, atmosphere, depthRanges) -> VolumeLUT；
- generateCloudDensity(worldPos, time, weatherVolume, turbulence) -> Density；
- raymarchClouds(viewRay, densityField, sunLight, stepBudget) -> HDRCloud；
- reprojectCloudHistory(history, motion, depth, wind) -> CloudHistory；
- buildCloudShadowMap(sun, densityField, area, sampleBudget) -> ShadowField。
- **13.3 低頻與高頻分流：**Sky LUT 當大氣／太陽參數變動才刷新；雲厚度和風平流可低頻更新，畫面輸出透過時間重建，但雲影與地景光照必須時序一致。Mobile 可評估半／四分之一解析度 Raymarch＋Bilateral Upsample；高階可增採樣與真實多重散射近似。注意 3D Texture 的 RAM、GPU 帶寬、Ray Step 與透明合成成本。測例：血紅落日、藍調高緯度傍晚、濃雲漏光、暴雨雲底與遠山霧化；不得用一張天空盒假裝全時段物理大氣。見 [R13][R14]。

### 14｜海洋、海岸、淺水、浮力與船體反射

- **14.1 海水須有三種頻帶：**大尺度海況（Gerstner／Spectral FFT）；中尺度切線波與破碎浪；小尺度法線細節與 Microfacet 閃光。海港內外波浪振幅／方向由岸線、海床、水深、遮蔽、風速區分。Far Field 可低幾何密度；近景海浪需波峰尖化、泡沫生命週期和連續接縫。海水與陸地高度資料共享地理座標但各自具有不同物理方程。
- **14.2 反射：**Fresnel、Sky Environment Reflection、平面局部 Reflection、SSR／高級追蹤按品質和海面 roughness 混合；對屏外物體一定要有退路。折射與吸色需區分 Beer-Lambert 吸收、散射渾濁與海床可見度；岸線泡沫可由水深、坡度、浪陡度、接觸事件及時間場計算，不能只由固定距離線條繪出。
- **14.3 核心函式：**
- sampleWaveDisplacement(xz, t, spectrum, seed) -> PositionDisplacement；
- sampleWaveNormal(xz, t, spectrum) -> UnitNormal；
- sampleWaterVelocity(xz, t) -> Velocity；
- sampleBathymetry(xz) -> MetresBelowDatum；
- computeBreakerProbability(depth, slope, waveSteepness) -> Probability；
- updateFoamAdvection(foamState, velocityField, decay, dt) -> FoamState；
- evaluateWaterBRDF(view, normal, sun, env, absorption) -> HDRRadiance；
- calculateHullBuoyancy(hullSamples, waveField, mass, time) -> ForceTorque；
- sampleFishingFloat(waveField, t, xz) -> FloatPose。
- **14.4 必驗：**高角度往港內看海床和岸線；逆光海面不能變成單一白色亮條；船尾浪／反射／浮力一同使用相同時間的波場；移動鏡頭的 SSR 不可劇烈破裂。純 FFT 並不能自動產生真實沿岸破碎浪；必要時近岸採淺水方程或美術受控近似。見 [R15][R16][R17]。

### 15｜程序建築的「可建造性」與中世紀漢薩港鎮

- 15.1 程序建築不只是 Extrude 方塊。用 Context-Sensitive Shape Grammar／CGA Shape 將城市與房舍分為道路／地塊→地基→結構牆與開間→門窗洞→梁柱→屋架→屋瓦→磚縫→裝飾→碰撞／Navmesh。真正的門窗洞口要有帶厚度的幾何和室內外遮蔽；不能單純在牆面貼黑色矩形。港口木樁、承重關係、石材砌法與哥德式拱肋也需規則。
- **15.2 生成邏輯區分：**SiteConstraints（地形、水位、道路與地塊）、HistoricalConstraints（13–15 世紀材料和尺度）、StructuralConstraints（承重、門窗間距、坡屋面防水）、VisualConstraints（不重複、輪廓可讀）與 GameConstraints（可通行、碰撞、釣魚和交易路線）。
- **15.3 核心函式：**
- partitionTownIntoBlocks(roadGraph, shoreline, cityWall) -> Blocks；
- subdivideBlockIntoParcels(block, demand, historicalRules, seed) -> Parcels；
- solveBuildingMassing(parcel, footprint, heightLimits, roofRules) -> MassModel；
- compileBuildingGrammar(massing, style, structuralRules) -> GrammarGraph；
- generateTrueOpenings(wallSegments, doorwayRules, windowRules) -> WatertightWalls；
- constructRoofStructure(massing, slope, timberSpans) -> RoofAssembly；
- tileRoofSurface(roof, tileModule, breakageSeed) -> TileInstances；
- generateStoneBonding(wall, bondPattern, mortarThickness) -> StoneMesh；
- validateBuildingTopology(mesh, portals, collision, navSurface) -> ValidationReport；
- deriveGeometryLODAndMaterials(building, cameraScales) -> RenderAssets。
- **15.4 驗證：**門洞與碰撞一致、樓梯坡道可走、瓦片接縫不穿插、排水坡向有意義、牆角砌築轉向正確、屋樑和窗戶比例符合年代；近距「0.5m」細節、俯視屋頂、低角度天際線皆需可看。CG A Shape 2006 論文確有產出細緻建築幾何之研究；其內容是演算法參考，不能無視著作授權。見 [R18][R19]。

### 16｜植被生態：真正的樹形、光照與風，避免紙片林

- **16.1 由生態規則先生成群落，再產生幾何：**土壤鹽分／含水量／地形坡度／光照遮蔽／風向／與人類干擾距離 → 群落組成 → 樹形物種參數 → 分枝／葉序 → 季節／健康狀態。區分山毛櫸、櫟、赤楊、樺木、松、果樹的枝幹比例、冠幅、樹皮和葉片簇；不能用同一低多邊形圓錐複製當不同樹種。
- **16.2 幾何研究：**Space Colonization／L-System／Branching Rules、Tree Skeletal Graph、Spline Tube 分枝、葉簇卡片或真實葉片的混合；Near 用分枝幾何及葉片間隙、Mid 用 Instanced Canopy Clusters、Far 用 Impostor／HLOD，順風角度保留體積而非一張會旋轉的薄板。草地可以用二次 Bézier Blades 或細胞聚類葉叢；Alpha Test 葉子會有 Overdraw／鋸齒，需依光照與 MSAA/TAA 評估 Alpha-to-Coverage、Coverage-preserving Mips、Dither 過渡。
- **16.3 必備函式：**
- sampleEcologicalBiome(position, season, soil, wetness, salinity) -> BiomeWeights；
- spawnSpeciesInstances(biome, slope, light, seed) -> PlantPlacements；
- growBranchSkeleton(species, age, constraints, seed) -> BranchGraph；
- meshTreeFromSkeleton(graph, lod, windRig) -> TreeMeshes；
- generateGrassPatch(distribution, density, wind, view) -> GrassInstances；
- computeWindField(weather, terrain, obstacles, time) -> VectorField；
- deformVegetation(wind, elasticity, branchHierarchy, t) -> VertexField；
- evaluateFoliageTransmittance(thickness, angle, sun) -> Radiance；
- selectVegetationRepresentation(view, screenDensity, overdrawBudget) -> LODRepresentation。
- **16.4 必驗：**逆光樹葉呈透光而非白色反光塑膠；樹冠存在枝條空隙；風吹時枝、葉與陰影同相；整片草地沒有同一頻率的機械擺動；相機由 1m 走至 200m 不出現明顯變換。材質研究與 Two-Sided Foliage 參見 [R09][R10]；樹形方法需依物種學資料另行查證。

### 17｜HDR 攝影、時間抗鋸齒、反鋸齒升採樣與動態品質

- **17.1 影像鏈候選：**Scene-linear HDR → 曝光估計與前曝光（Pre-exposure）→ Depth/Velocity/Normal/Reactive 等 History Data → Temporal Reconstruction／Spatial AA → Bloom／雜訊／景深（視需求）→ Tone Mapping（AgX／ACES 或自定）→ Display Transform。操作順序需依實際引擎與抗鋸齒方案驗證，不能對每個算法套固定公式。
- **17.2 UE TSR 的要點不是單純低解析度放大：**抖動採樣、Motion Vectors、Disocclusion／History Rejection、Shading Changes、Reactive Mask、Flickering Temporal Analysis、History Clamping、可見性恢復；細植被、強反光海面、欄杆、船索和快速鏡頭是最難的測例。FSR 3 的公開文件可參照上採樣所需的色彩／深度／速度／Reactive 與 T&C Mask，但 Web 平台適配與 API 支援須另行確認，不等於直接可用。
- **17.3 建議函式：**
- generateCameraJitter(frameIndex, renderSize) -> SubpixelOffset；
- computeMotionVectors(currentTransform, previousTransform, jitterState) -> VelocityBuffer；
- classifyHistoryValidity(depth, normal, velocity, materialId, cutFlag) -> ValidityMask；
- detectShadingChanges(currentHDR, previousHDR, exposure) -> ChangeMask；
- generateReactiveMask(water, foliage, translucency, particles) -> ReactiveMask；
- reprojectAndAccumulate(curr, history, motion, validity, reactive) -> TemporalHDR；
- estimateExposureHistogram(hdr, meteringMask) -> EV100；
- adaptExposure(previousEV, targetEV, dt, speedUp, speedDown) -> ExposureState；
- applyToneMapping(sceneLinearHDR, exposure, displaySpace) -> DisplayRGB。
- **17.4 必驗：**攝影機切換（強制 reset history）、雨夜亮點、防波堤欄杆、細磚牆、波光、遠處雲層；測動態清晰度、Ghosting、Jitter、Bloom 溢光、曝光跳動。幀率不同時 Temporal 的可見性也不同；只有靜止截圖不合格。見 [R20][R21][R22]。

### 18｜跨系統函式契約：把視覺世界連成同一個現實

- **18.1 共用時間與座標：**應研究單一 EnvironmentSnapshot { epoch, seed, simulationTimeSeconds, solarTime, season, latitude, sunDirection, moonDirection, windFieldVersion, precipitation, humidity, wetnessVersion, tidePhase, seaLevel, waveSpectrumVersion }。所有視覺系統與遊戲玩法從同一 Epoch 讀快照，不能某個 Shader 用系統毫秒、船體用固定步進秒、植被用獨立浮點計時。
- **18.2 單位約定：**世界與碰撞位置使用 meters；角度由型別保證 radians／degrees 不混用；所有 HDR Radiance 使用 scene-linear 明確色彩空間；速度 m/s；海床深度相對 Datum 的符號固定；GPU 程序數值誤差不得獨立改變 CPU 採用的碰撞高度權威。需定義已載入 Chunk 與缺資料的回傳語意（Pending／Unavailable／OutOfWorld），不能用無聲的 0 公尺替代。
- **18.3 共同資料介面研究：**
- queryTerrainHeight(worldXZ, terrainVersion) -> Result<HeightSample, QueryError>；
- queryWaterState(worldXZ, simulationTime, oceanVersion) -> Result<WaveSample, QueryError>；
- querySurfaceMaterial(worldPosition, worldVersion) -> MaterialSample；
- querySceneVisibility(ray, accuracyTier, accelerationData) -> RayHit[]；
- getEnvironmentSnapshot(epoch) -> ImmutableEnvironmentState；
- publishWorldSnapshot(previousEpoch, nextState) -> SnapshotID；
- reconcileSimulationRenderTime(simTime, renderTime, motionHistory) -> InterpolationState；
- invalidateTemporalResources(reason, affectedRegion, epoch) -> InvalidationSet；
- reserveGpuMemory(resourceClass, estimateBytes, priority) -> Result<BudgetToken, OutOfBudget>；
- releaseResource(resourceId, completionFence) -> ReleaseOutcome。
- **18.4 保存與重現：**Chunk ID、世代種子、幾何配方版本、材質版本、世界時間、玩家狀態、隨機事件流與存檔 Schema 必須分開版本化。Shader 程序效果可以近似，但會影響碰撞、農耕、存檔、船體浮力的查詢應有唯一的 CPU 或量化權威。這是研究契約草案，不要求預先決定 ECS 或物件導向。

### 19｜GPU 資源／渲染圖／效能風險研究（不預設特定 GPU API）

- **19.1 Render Graph 最小內容：**Pass ID、Resource ID、用途、格式、維度、採樣數、讀寫依賴、歷史依賴、建立／銷毀、Clear／Discard、Feature Requires 與 Fallback。僅在通過平台驗證後才考慮 Native Tile Memory／Transient Attachment；它們的限制與版本差異需各自核實，不可以跨 Pass 任意復用 Transient 作取樣貼圖。
- **19.2 極高畫質的成本不只頂點：**大量 Alpha 草葉和樹葉、螢幕空間 GI、SSR、半解析度雲、HDR RenderTarget、MSAA／TAA History、陰影 Atlas、動態解碼與 GPU→CPU 回讀，都可能成為瓶頸。必須拆成 Geometry、Pixel Shading、Overdraw、Bandwidth、Texture Residency、Compilation、Streaming、DOM Composition、Thermal 九組成本。動態解析度降低的是像素成本，不解決主執行緒同步 Chunk 生成或巨量 Draw Calls。
- **19.3 建議診斷函式：**
- profileRenderPasses(passGraph, optionalTimestampSupport) -> PassTimes | N_A；
- recordGeometryVisibility(candidate, visible, rejected, pixels) -> VisibilityTelemetry；
- trackResourceResidency(resources, logicalBudget) -> MemoryReport；
- classifyFrameHitches(cpu, gpu, compile, upload, layout, gc) -> HitchCauses；
- warmupPipelineVariants(visibleMaterials, passes, priority, abortSignal) -> WarmupReport；
- replayCameraTrace(seed, weather, cameraPath, deviceProfile) -> ComparableRun；
- compareQualityAtMatchedCost(referenceFrames, testFrames, timeSeries) -> QualityPerformanceReport。
- **19.4 注意：**GPU timestamp-query 不保證所有瀏覽器或 GPU 支援，取得時仍需正確排除空值和裝置差異；不支援必須記 N/A 而非憑 CPU 時間推算 GPU ms。Web 的 GPU 時序與 GPUDriver Pipeline Cache 控制有限。內容包容量、解碼峰值、CPU 記憶體和 GPU Residency 是不同維度。見 [R23][R24][R25]。

### 20｜UE5 視覺對標：可證偽的研究驗收集

- 20.1 參考場景必須控制相同世界尺度、視野角、相機高度、時間、太陽／雲／風／雨、材質類別與可見物件。比較包含（a）高品質 Unreal 參照、（b）候選程序化管線；不能拿 UE 的低畫質或候選的縮小幾何／假貼圖做不公平比較。輸出未壓縮 PNG、旋轉鏡頭錄影、Pass／Buffer 可視化；必要時記錄參照引擎版本、品質參數與不同表現能力的限制。
- **20.2 幾何鏡頭：**0.5m 石牆／木構／屋瓦／門窗、2m 街角、20m 建築正立面、150m 城鎮天際線；測 silhouette、轉角拓樸、LOD 跳變、紋理重複、門窗洞口厚度、物理尺度。光照鏡頭：正午硬陰影、陰天擴散光、夕陽逆光、室內暗屋看外面、夜晚火光、暴雨濕牆；測陰影穩定、反彈光、曝光、滲光、反射。自然鏡頭：近距草、逆光樹冠、海岸泡沫、船體倒影、高雲遮日、大片遠景霧；測光照與氣象一致及 Overdraw。動態鏡頭：高速轉頭、坡道行走、從室內轉到室外、船隻經過、季節切換；測 TAA 殘影、雲歷史失效、LOD Popping、載入卡頓。
- **20.3 指標分四類：**視覺可信（專家盲評、參照對照、輪廓細節）；時間穩定（影片中的閃爍、鬼影、Pop-in）；效能和成本（p50/p95/p99、GPU Pass、Streaming、Memory、持續熱功耗）；完整性（建築可進入、船可操作、海與碰撞對齊、不同天氣與時間都不破功）。SSIM／LPIPS 等影像指標只能輔助，因不同構圖／曝光／材質隨機種子會降低對照可比性。全部需在固定 Seed 與控制的渲染尺寸、固定畫質開關下測，未實測狀態為 NOT RUN。
- **20.4 禁止誤稱：**『真正使用 Nanite/Lumen/TSR』需有 Epic 原生技術或可查證的同等實作；『手機硬體光線追蹤』需可確認受支援 API／硬體；『GPU 產生＝零 CPU 成本』『使用 Rust＝一定更快』『150MB 程式＝低記憶體』均不成立。研究目標是接近 UE5 的可見品質，不代表已得到同等工程吞吐或畫質。

### 21｜交叉研究來源與可追溯索引（以官方／論文優先）

- [R01] Epic｜Nanite Technical Details／Cluster culling／Streaming：<https://dev.epicgames.com/documentation/unreal-engine/nanite-technical-details>
- [R02] Epic｜Nanite Virtualized Geometry：<https://dev.epicgames.com/documentation/en-us/unreal-engine/nanite-virtualized-geometry-in-unreal-engine>
- [R03] zeux meshoptimizer｜Meshlet、Cluster partition、簡化算法（需核對 LICENSE 與版本）：<https://github.com/zeux/meshoptimizer>
- [R04] meshoptimizer Clusterizer JS API（建置期路徑參考）：<https://github.com/zeux/meshoptimizer/blob/master/js/README.md>
- [R05] Epic｜Lumen Technical Details／Surface Cache／Screen Traces：<https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-technical-details-in-unreal-engine>
- [R06] Epic｜Lumen GI and Reflections：<https://dev.epicgames.com/documentation/en-us/unreal-engine/lumen-global-illumination-and-reflections-in-unreal-engine>
- [R07] Epic｜Virtual Shadow Maps，Page／Clipmap／Invalidation：<https://dev.epicgames.com/documentation/en-us/unreal-engine/virtual-shadow-maps-in-unreal-engine>
- [R08] NVIDIA GPU Gems 3｜Summed-Area Variance Shadow Maps 與 Light Bleeding：<https://developer.nvidia.com/gpugems/gpugems3/part-ii-light-and-shadows/chapter-8-summed-area-variance-shadow-maps>
- [R09] Epic｜Shading Models、Two-Sided Foliage、Clear Coat：<https://dev.epicgames.com/documentation/unreal-engine/shading-models-in-unreal-engine>
- [R10] Epic｜Material Properties、次表面與材質模型：<https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-material-properties>
- [R11] Epic｜Substrate Materials／Slab BSDF：<https://dev.epicgames.com/documentation/unreal-engine/overview-of-substrate-materials-in-unreal-engine>
- [R12] NVIDIA GPU Gems 3｜Procedural Terrain 與 Triplanar Texturing：<https://developer.nvidia.com/gpugems/gpugems3/part-i-geometry/chapter-1-generating-complex-procedural-terrains-using-gpu>
- [R13] Epic｜Sky Atmosphere／Transmittance、MultiScatter、Aerial LUT：<https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine>
- [R14] Epic｜Volumetric Cloud／Raymarch Samples、Cloud Shadows：<https://dev.epicgames.com/documentation/unreal-engine/volumetric-cloud-component-in-unreal-engine>
- [R15] Epic｜Water System 與水陸互動：<https://dev.epicgames.com/documentation/unreal-engine/water-system-in-unreal-engine>
- [R16] Epic｜Water Waves Asset／Gerstner 模型：<https://dev.epicgames.com/documentation/unreal-engine/simulating-waves-using-the-water-waves-asset-in-unreal-engine>
- [R17] NVIDIA GPU Gems｜Effective Water Simulation from Physical Models：<https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models>
- [R18] Müller et al. SIGGRAPH 2006｜Procedural Modeling of Buildings／CGA Shape：<https://doi.org/10.1145/1141911.1141931>
- [R19] ETH Zürich｜Procedural Modeling of Buildings 專案摘要：<https://emeritus.icu.ee.ethz.ch/research/demos/procedural-modeling.html>
- [R20] Epic｜Temporal Super Resolution／History／Shading Rejection：<https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine>
- [R21] AMD GPUOpen｜FidelityFX Super Resolution 3.1 Upscaler 與 Reactive Mask：<https://gpuopen.com/manuals/fidelityfx_sdk/techniques/super-resolution-upscaler/>
- [R22] Epic｜Auto Exposure／HDR Histogram／Pre-exposure：<https://dev.epicgames.com/documentation/unreal-engine/auto-exposure-in-unreal-engine>
- [R23] MDN｜GPUQuerySet／timestamp-query Feature：<https://developer.mozilla.org/en-US/docs/Web/API/GPUQuerySet>
- [R24] W3C WebGPU API／GPU Feature／Render Pass Usage：<https://gpuweb.github.io/gpuweb/>
- [R25] Google Chrome 149/150｜Transient Attachments 嚴格驗證：<https://developer.chrome.com/blog/new-in-webgpu-149-150>
- 研究狀態：本補編僅從官方文獻、公開研究及演算法原理整理「可嘗試的技術」，不代表這些選項的組合已完成 Benchmark。若後續有新的 UE5 版本、WebGPU 規範與行動端特性，應按新證據更新研究結論；任何候選架構都可接受公平的技術比較。
