> **Source title:** Pixel-Games｜世界級純程式 3D 引擎架構研究與技術決策 v1.1｜2026-11-17
> **Imported from the owner's Google Doc on 2026-11-17.**
> **Status in the source:** research proposal, not an authorization to change mainline or the engine.
> This is a reference copy; the repository's AGENTS.md, governance/ and ADRs are what is enforced.

# 世界級純程式 3D 引擎

### 跨語言 × 跨平台 × 極致畫質／效能／精度架構研究

Pixel-Games｜聖奧爾德里克港｜技術決策研究 v1.1｜2026-11-17

狀態：研究提案（NOT IMPLEMENTED / NOT BENCHMARKED）｜本文件不構成修改主線或引擎的授權。

## 執行摘要

核心結論：不存在不受平台與工作負載影響的「絕對最快語言或引擎」。在手機、桌機和瀏覽器同時追求高畫質時，合理的最高潛力候選是「共用世界核心 + 分平台渲染後端 + 資料導向 + GPU 常駐資源 + 可量測的品質門檻」，而不是把全部系統改成 C++ 或 Rust。

v1.1 決策更新：不預先選定 Rust 或自訂引擎勝出。Web 端先公平比較 Three.js/WebGL2、Three.js/WebGPU/TSL、PlayCanvas/WebGPU、原生 TS/WebGPU/WGSL 及 Filament/WASM/WebGL2；Rust/Wasm 僅在 CPU 熱點與資料交換測試證實收益時導入，原生 wgpu／Filament 另外競爭。保留可追溯世界資料、GPU 常駐資源、分平台能力偵測與同畫質真機驗收。

短期唯一執行路線：先固定 A（Three.js/WebGL2）基準，優先以 B（Three.js WebGPURenderer／TSL）做受控 A/B；只有確定 B 遇到渲染框架瓶頸且收益可量測時，才對 D（原生 TypeScript／WebGPU／WGSL）做最小突破原型。C（PlayCanvas）與 F（Filament Web）只做特定場景／API 的輕量參考，E（Rust/Wasm）在 CPU Profiling 後考慮，N（原生）另案。全部代號以第15章為唯一權威；量測條件及否決門檻見第09、10、20、21章。

最高優先事項：①減少無效像素／幾何處理，②讓資料盡量留在 GPU，③讓 CPU/GPU 並行且不造成過量延遲，④針對手機頻寬與熱降頻設計，⑤為精度與視覺品質建立可重現驗收。

## 01｜需求、邊界與不能偷換的目標

視覺：13–15 世紀漢薩港鎮的擬真建築、地形、植被、岩石、海水、天空、日夜、季節與天氣。程序化生成是優先原則；素材來源、尺度和歷史正確性都需可追溯。

運行：Android（POCO F8 Ultra）、iPhone Safari、桌機瀏覽器。若另外提供原生 App，可以使用不同渲染後端，但遊戲世界和玩家資料不應分叉。

體驗：自由移動、NPC、碰撞、釣魚、划船、農田、背包與存檔等系統，不可被固定鏡頭技術展示取代。高解析度、60 FPS 和桌機級視覺風格是驗證目標，並非現況成績。

部署（Owner 最新決策，2026-11-17）：只要可在 GitHub 託管並以 GitHub Pages／HTTPS 正式發布，即不再要求單檔 HTML。保留單一正式遊戲入口（index.html），但正式產物允許多個 JavaScript／WGSL 或轉譯 Shader 模組、Wasm、程序生成的已烘焙幾何／紋理、KTX2、字體和其他按需載入的靜態資產。優先採模組化建置、Chunk 串流、獨立快取與資源版本化；離線單檔 HTML、file:// 運行及 PWA 僅為可選交付，不再阻擋正式版本驗收。WebGPU、Feature Detection、跨來源隔離與部署標頭依平台實測。

成功條件：同畫質的真實效能更好，或在相同持續功耗與幀時間內提供明確可見的更高畫質；只降低渲染解析度或草葉數量，不算同等畫質勝出。

## 02｜跨平台專用引擎總體架構

採「資料與世界模型共用、GPU 渲染後端分化」。CPU 世界核心對建築、NPC、地形與存檔產生明確的 Chunk / Entity / Material / Transform 契約；Web 端由 TypeScript 呼叫 WebGPU，Native 端比較 wgpu 與平台專用 Vulkan/Metal／Filament。

Rust 不是唯一候選：如果高品質 TS/WebGPU 在同畫質下更快、記憶體更省，應保留 TS 熱路徑；若 C++ Filament 在原生手機上具持續優勢，也可以成為原生後端。多語言只為消除瓶頸，不應為了技術堆疊漂亮而增加橋接成本。

**圖 1｜共享世界核心與 Web／Native 雙路徑架構**

*[Image not captured in the import: embedded figure]*

## 03｜技術候選概覽（代號統一見第15章）

候選範圍包含既有 Three.js/WebGL2、Three.js WebGPURenderer／TSL、PlayCanvas／WebGPU、原生 TypeScript／WebGPU、必要時加入 Rust/Wasm、Filament Web，以及 Native wgpu／Filament／Vulkan／Metal。此處只說明方法定位與研究可能性，不另定 A/B/C/D 代號，避免與第15章衝突。圖2沿用 v1.0 的方向性適配矩陣，並非新版七條路線的完整實測排名，不可依舊圖單獨下決策。

**圖 2｜v1.0 歷史技術適配矩陣（僅質性示意；新路線與執行順序以第15章為準）**

*[Image not captured in the import: embedded figure]*

設計判斷：Web 首先要證明瀏覽器能力與 fallback；Native 首先要證明手機 GPU 帶寬、記憶體與持續功耗；大型世界則要證明區塊載入、可見性和模擬成本能一起下降。Filament 是成熟 PBR 參考，但不內建完整遊戲世界；Unreal/Nanite/Lumen 可以作藝術與算法基準，不能假設網頁版直接得到相同特性。

## 04｜語言與任務的正確分工

TypeScript（Web Shell）：DOM/HUD、輸入、生命週期、能力偵測、資源載入協調、事件與 WebGPU 命令提交；避免每幀為數萬個實體重新建立 JS 物件。

Rust/Wasm（Simulation Core）：Archetype ECS、SoA、物理、空間查詢、A*、NPC 邏輯、世界 Chunk、程序建築生成、確定性 Seed、Sim LOD；將 Rust 應用於測得的 CPU 熱點，不要求所有小任務跨語言處理。

WebGPU/WGSL（GPU Core）：Compute 地形、GPU Instancing、Instance Culling、植被風動、粒子、渲染、光照與後製；只有高同質、低分歧而且可以留在 GPU 的工作，才適合加速。複雜相依的 NPC 邏輯與權威碰撞不應為了 GPU 化而頻繁讀回。

C++（Native / Offline）：meshoptimizer 等成熟幾何工具、Filament 對照、專用 Vulkan／Metal 路線；只有 Profiling 證明收益後，才把額外的 C++ 原生模組帶進 runtime。

Python（Offline QA）：批次世界生成、參數掃描、Shader 靜態驗證、截圖比對、Benchmark 統計與報表產出；不建議放在網頁每幀的核心路徑。

## 05｜CPU／GPU 重疊與記憶體資料流

建議初步拓樸：主執行緒只處理 DOM／輸入；Simulation Worker 執行有需要的 Wasm；Render Worker 在裝置支援 OffscreenCanvas + WebGPU 時擁有 GPUDevice 與 GPUBuffer。若不支援，回退至主執行緒渲染。Worker 數量依任務粒度與功耗調整，不固定 4 個。

資料交換：以連續 SoA Buffer、固定布局、Dirty Range、GPU 常駐資源與版本化快照為主。Wasm Memory 可以建立 TypedArray view，但它不是 GPUBuffer；queue.writeBuffer 仍可能需要傳輸。禁止每幀 GPU→CPU 同步讀回。

同步與輸入延遲：Double／Triple Buffering 可能降低等待，也可能增加內存與操作延遲；Simulation 與 Render Worker 讀取帶時間戳與遞增序號的最新完整輸入快照，盡可能於模擬／命令建構前取最新資料（late sampling／late latching），避免處理過期封包。Render Worker 並非必然增加固定一幀；需實測 pointer/touch 到畫面回應的 p50/p95、最差長幀及與主執行緒的 A/B。DOM HUD 的 backdrop-filter、半透明大面積覆蓋與 CSS 合成成本獨立設開關、量測合成器工作量；必要時改用簡單透明色背景與低頻 HUD 更新。SharedArrayBuffer 不可預設 GitHub Pages 有跨來源隔離。

**圖 3｜CPU／GPU 時間重疊及同步依賴示意**

*[Image not captured in the import: embedded figure]*

## 06｜世界與渲染管線：每個像素都有成本

離線階段：確定性世界配方、建築參數化與物種分布；必要時預建 Meshlets／HLOD／壓縮幾何。運行階段：世界分塊 → CPU 粗剔除 → GPU 常駐資料 → GPU Instance/Visibility 剔除 → 陰影／主渲染／透明水體 → HDR／後處理 → 最終呈現。

建築與岩壁：採真實尺度、可驗證窗門開口、模組化程序幾何、接縫/倒角、材質合批與分層幾何叢集。不能直接把高密度草葉的 Instancing 手法套到每個複雜建築；也不能把 Nanite 視為手機 WebGPU 的即插即用功能。

植被：近景草葉有形狀、彎曲、粗糙度；中景採 Instance/LOD；遠景採面積覆蓋與抗閃爍。草地互動可使用低解析度 Interaction Map，不必逐草碰撞；避免透明 Overdraw 與高頻陰影耗盡頻寬。

材質：石材、木材、屋瓦、泥土、濕潤岩石需有尺寸與物理行為一致的 Albedo / Roughness / Normal / AO。結合 SDF、Voronoi、FBM、Triplanar 和導數反鋸齒；不要以單一 Noise 假裝材質細節。

光影：優先 PBR + Clustered Lighting、可控的太陽陰影、程序化探針/烘焙間接光與局部 Screen-space 技法。高階桌機可以另測更精細的 GI 和反射；手機避免預設全場景 Path Tracing。

海水與天空：依尺度分開波譜、泡沫、消光/反射、岸邊濕潤、氣霧和雲影。當波紋小於像素時應轉向整合／模糊而非持續出現亮條紋；天空可採預計算層與低解析度光束避免重複 Ray Marching。

畫質穩定性：Temporal AA／Upscaling 有可能改善鋸齒，但會引入拖影與歷史失效風險。建議以近距離植被、細柵欄、逆光海水、雨滴及快速轉向做動態驗收，而非只看靜態照片。

**圖 4｜程序化世界從生成到螢幕像素的成本管線**

*[Image not captured in the import: embedded figure]*

## 07｜大世界精度與模擬管理

世界座標：使用 Chunk ID + 局部位置，必要時 CPU 世界絕對位置使用 f64；上傳到 GPU 的幾何採 Camera-relative f32。避免直接用巨大的全域 f32 座標造成地面接縫、物理與相機精度失真。

Simulation LOD：互動圈候選 60Hz，中距 NPC 10–20Hz，遠景 1–5Hz 或事件驅動；這些只是測試起點，真正更新率取決於 NPC 行為、戰鬥、種田和存檔的觀察一致性。不要讓遠處 NPC 回到近景時瞬移。

空間索引：密集同質查詢優先 Spatial Hash/Grid；廣域靜態場景可用 BVH／Chunk 階層；動態物件則要計算重建/更新成本。所有剔除要驗證不能錯誤消失玩家可見物件。

## 08｜四個參考專案的技術定位與授權邊界

Abyssal Garden（Noniv）：原生 WebGPU + WGSL Compute、GPU 程序地形、植被密度、品質檔位、效能飛行測試。MIT；作者公開的手機 FPS 是特定低階手機與低解析度結果，不代表 Pixel-Games 真機目標。

Crimson Loong（ChetasLua）：Three.js r180 / WebGL2，90 秒程序化電影。可參考精細程序建築、植被樹冠、水鏡、天空預烘、後製與動態品質控制；完整自由視角開放世界成本不同。根目錄未確認其作者程式採可複製授權；Three.js vendor MIT 不代表整部作品 MIT。

Grassworks（Tech Redux）：Three.js WebGPU / TSL 的商業植被系統，重點是 Camera-relative Tiling、LOD、GPU Instancing 與互動草地。官方文件可研究，未取得完整授權原始碼前不複製其實作。

Brinewater：Three.js + Rapier/Wasm 的城市開放世界案例；可研究地圖資料預處理、區塊串流、建築合批、交通 AI、Shader 暖機。它不是純程式生成素材的完整範例，且未取得完整可審查原始碼，不把作者自述當獨立 benchmark。

四案最佳組合：Grassworks 處理近景植被、Crimson 處理程序建築/水/天空、Abyssal 處理 GPU 生成、Brinewater 處理大型世界與模擬串流；只抽取已驗證的方法，不直接混裝互不相容函式庫。

## 09｜公平畫質、效能與相容性量測契約

本章不再定義 A/B/C/D：唯一名稱及路線見第15章。快速路徑固定 A（現有 Three.js/WebGL2）與 B（Three.js WebGPURenderer／TSL）的可比較畫面，再依瓶頸決定是否啟動 D（原生 TS/WebGPU）；C、F 只設微型對照，E、N 條件式。每項對照固定 Seed、相機、可見幾何、材質、光照、陰影、實際 Drawing Buffer、互動行為、冷機與熱穩態，禁止只靠降畫質勝出。

共同報表：裝置／OS／Browser／GPU 版本、Feature／Limits、實際 Render Size、p50/p95/p99 Frame Interval、Draw Calls、三角形與 Instance、各 GPU Pass（若可測）、CPU→GPU 傳輸、操作延遲、首次渲染／首次可玩／場景切換、Pipeline 編譯與 Shader 變體、20 分鐘熱穩態、GPU/CPU 應用資源計帳、峰值與釋放後殘留、Device Lost／背景返回／OOM 疑似重載。無法直接量測的數值填 N/A；未測填 NOT RUN；不確定填 INCONCLUSIVE。

POCO F8 Ultra 的裝置原生螢幕為 2608×1200；60 FPS 的幀預算為 16.67ms，90 FPS 為 11.11ms，120 FPS 為 8.33ms。幀預算不是每一個 CPU/GPU 階段可獨占的執行時間；並行時也不能直接把階段時間當總延遲。

**圖 5｜v1.0 五路線歷史示意（非 v1.1 代號與 Gate；正式執行以第15章為唯一依據）**

*[Image not captured in the import: embedded figure]*

## 10｜Fast-Track 階段門檻（與第15章一致）

Gate 0（先有可追溯的 A）：固定正式主線與候選 SHA、六鏡頭、標準操作路徑、世界 Seed、內部像素量與收斂量測腳本；建立畫質、記憶體、Shader 首次使用與 20 分鐘持續運行的 A 基準。

Gate 1（A → B）：只針對必要場景把 Three.js WebGL2 轉為 Three.js WebGPURenderer／TSL；將 ShaderMaterial／onBeforeCompile／EffectComposer 遷移成本列為顯式工作，不假設原 GLSL 可直接回退。若瀏覽器沒有 WebGPU Adapter，照實標記，fallback 不等於完成 WebGPU 比較。

Gate 2（B → D，有條件）：僅當 B 在 Profiling 中呈現無法局部繞過的框架／Render Pass／Draw Submission 瓶頸時，建立最小原生 TS/WebGPU／WGSL 對照，不搬完整 NPC、存檔與全部環境。若 B 成本、畫質或維護表現已達標，D 可不啟動。

Gate 3（先 TS SoA，再決定 E）：CPU 邏輯先以 TS TypedArray／SoA、Chunk Grid、Dirty Range 優化；若實際 CPU p95 熱點仍超過約 3.5ms／60FPS 幀（暫定調查門檻，而非絕對標準），且經可重現 A/B 證明純 CPU 優化不足，才針對單一熱點研究無 Threads 的 Rust/Wasm E。Workers、SIMD、Threads、GPU Culling、Render Graph 分別消融，不把多功能啟用混在同一版。

Gate 4（可選研究，不擋主線）：C（PlayCanvas）與 F（Filament Web）只建立可比的最小場景／渲染器特性測試；若產品另行決定 Native 版本才評估 N（Filament／wgpu／Vulkan／Metal）。不得要求七條路線都完整重製開放世界，也不得將 Native 分數冒充 Browser 分數。

採用門檻：只有在可見品質不降低、主要功能回歸正確、p95 與持續功耗有明確收益，且部署、授權、相容與維護風險可控時，才提議更換正式渲染核心。否則保留現有 Three.js，逐步吸收合法可用的技術。

## 11｜當前風險清單

Wasm Threads：SharedArrayBuffer 和 cross-origin isolation 需要對應 HTTP Headers；一般 GitHub Pages 無法自由加 COOP/COEP。若要 threads 作關鍵效能方案，必須測試可控標頭的託管，不得擅自更改部署。

WebGPU GPU-driven：部分特性、Buffer limits、Indirect Draw 使用情形依瀏覽器/硬體不同。需要 feature detection、fallback、shader validation 和掉裝置恢復。

GPU 讀回：高頻 mapAsync/readback、建構期峰值 GPU Buffer、RT 疊加、MSAA/HDR 大量像素頻寬可能抵銷 Compute 的收益；不同記憶體架構不代表「自動零複製」。

美術誤判：極度降低草密度、縮小內部解析度或停用高成本陰影後，FPS 可能升高，但未達相同可視畫質。測試報告必須同時附截圖和畫面像素資料。

授權：MIT、Apache-2.0、商業套件、未宣告授權必須各自辨識；研究演算法不等於可以直接複製來源檔案或素材。

## 12｜參考來源與查證入口

Google Filament — https://github.com/google/filament

wgpu / Naga — https://github.com/gfx-rs/wgpu

meshoptimizer — https://github.com/zeux/meshoptimizer

Three.js WebGPURenderer — https://threejs.org/manual/en/webgpurenderer

Bevy ECS — https://github.com/bevyengine/bevy

Rapier — https://rapier.rs/

AMD FidelityFX — https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK

Slang — https://github.com/shader-slang/slang

Noniv / Abyssal Garden — https://github.com/Noniv/abyssal-garden

ChetasLua / Crimson Loong — https://github.com/ChetasLua/crimson-loong

Grassworks Forest Demo — https://grassworks.techredux.co/forest-demo

Brinewater — https://brinewater.vlad.yt/play/

MDN WebGPU — https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API

MDN SharedArrayBuffer — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer

wasm-bindgen-rayon — https://docs.rs/wasm-bindgen-rayon/latest/wasm_bindgen_rayon/

Cloudflare Pages Headers — https://developers.cloudflare.com/pages/configuration/headers/

Google Docs 現有相關規格書（2026-11-13）— [REDACTED: Google Docs URL]

Pixel-Games 研究 PR #149 — [REDACTED: private repository URL]

報告說明：這是一份決策研究與實測計畫，不是已交付的遊戲引擎，也沒有宣稱取得手機原生 2K／60 FPS、超越 UE5 或完成硬體光追。所有量化比較在公平測試前均保持 NOT RUN。

## 13｜v1.1 第二輪交叉驗證：結論與證據分級

本版是在 v1.0、2026-11-13 的環境重構規格，以及 Pixel-Games PR #147/#149 現況之上完成的第二輪交叉查證。查證日期：2026-11-17。來源分四級：S1 官方規格／開發文件，S2 可審查的開源程式與授權，S3 上游作者或使用者回報，S4 Pixel-Games 自有實測。S1 可證明 API 或設計意圖；S2 可證明方法存在；S3 只能提示風險；只有 S4 能證明本遊戲在指定設備達到目標。現階段 S4 的新引擎 A/B 和真機長時成績均 NOT RUN。

已交叉核實：① Safari 26 正式支援 WebGPU，但不能推論所有 iPhone 的 Feature、效能及穩定性相同；② Three.js WebGPURenderer 支援 WebGL2 回退，但舊 ShaderMaterial/onBeforeCompile/EffectComposer 無法無痛遷移；③ PlayCanvas 同時提供 WebGL2 與 WebGPU（官方目前將 WebGPU 標為 Beta），可作成熟 Web 引擎對照；④ Filament 不只支援 Native，也提供 WASM／JavaScript API 與 WebGL2 後端；⑤ wgpu 在 wasm 有 BrowserWebGPU 與 WebGL 後端，但只見 navigator.gpu 不能代表可取得 Adapter；⑥ Chrome 146 引入 WebGPU Compatibility Mode 與 Transient Attachment；⑦ 多重間接繪製不能視為跨瀏覽器標配；⑧ KTX2/Basis 應依實際壓縮格式支援轉碼；⑨ Android ADPF 為 Native APIs，普通瀏覽器頁面不能直接當作可呼叫的熱狀態介面；⑩ iPhone Safari 的一般非影片元素全螢幕仍有 WebKit 限制。

重要修正：將「Filament＝只用來比較原生端」、「iPhone Safari 可與 Android Chrome 同規格強制全螢幕」、「Worker/WebGPU 一律可靠」、「GPU 時間相加就是實際幀延遲」列為禁止假設。

## 14｜平台事實、解析度與能力降級契約

**14.1 WebGPU／Worker：**啟動時依序檢查 secureContext、navigator.gpu、requestAdapter() 結果、adapter.features/limits、device.lost、navigator.gpu 在 Worker 中是否可用，以及 OffscreenCanvas 與 Shader 編譯。不能僅檢查全域屬性存在便推定成功。WebGPU GPUDevice 丟失時重建 GPU 資源、必要時重建 Canvas，若無法重新取得 Adapter 則使用有明示狀態的 WebGL2 退路。Safari／iOS 27 的 GPU Process 成長與 Worker Device Lost 有具體問題回報，但屬特定環境回報，不能普遍化為所有 iPhone。

**14.2 全螢幕：**Android Chrome 以使用者手勢的 Fullscreen API＋橫向鎖定作必測；iPhone Safari 普通網頁的非影片元素 requestFullscreen 不能當成必然支援，採可用視口最大化與加入主畫面 Web App 等分流方案，標示不同體驗等級。不能把 iPhone 瀏覽器本身無法控制的系統 UI 隱藏視作程式寫錯，也不能假稱已達真全螢幕。

**14.3 解析度：**POCO F8 Ultra 官方面板 2608×1200＝3,129,600 pixels，長寬比約 2.1733；若保持這個比例將內部高度設為 1440，需約 3130×1440＝4.51M pixels，不等同 2560×1440＝3.69M。每次驗收記錄 CSS viewport、DPR、Drawing Buffer、像素總數、是否超採樣、實體螢幕解析度。任何含『2K』標籤皆附精確寬高，不能誤導。保留原 1080p 等級的最低內部渲染要求，性能無法達標須明示 NOT MET，不能偷偷縮放。

**14.4 正式發布契約（2026-11-17 Owner 已正式放寬）：能部署於 GitHub Pages 的 HTTPS 靜態網站即符合發行入口要求，不再限制只有一個 HTML。推薦以 Vite 模組化原始碼經 GitHub Actions 建置，發布 index.html＋經內容雜湊命名的 JS／Wasm／紋理／程序生成的預烘焙資料等多檔產物；Wasm 需檢查 MIME、fetch、instantiateStreaming 的實際行為；WGSL 可以以打包字串、獨立原始資料或建置產物管理，依瀏覽器安全規則測試。正式網站採依需求請求 Chunk、下載／解壓節流、版本化 Manifest、每資產校驗與 Loading/Recovery 流程；合理採 HTTP 快取與瀏覽器可用的 CacheStorage／IndexedDB（功能偵測），並驗證資源版本切換不會混搭新舊 Shader／幾何。**

**14.4.1 GitHub Pages 實施：專案站點若使用 https://<帳號>.github.io/Pixel-Games/，Vite 的 base 應依實際發布路徑設定為 /Pixel-Games/（自訂網域或 root site 不可照抄）；CI 在 build、測試與視覺 Gate 通過後產出 dist，Actions 再部署。部署不代表新增後端 API 或資料庫。GitHub Pages 官方限制包含已發布網站總尺寸上限 1GB、建議來源倉庫 1GB、軟性每月頻寬 100GB，以及部署逾 10 分鐘會 timeout；本專案更嚴格的 150MB 目標在未另行變更前沿用為『正式發布資產總量研究上限』而非單一 HTML 限制，且另外量測首屏下載 bytes、壓縮 bytes、總快取 bytes 與 GPU／CPU 記憶體。**

**14.4.2 功能邊界：HTTPS GitHub Pages 是 WebGPU 安全來源的部署條件之一，但仍需 requestAdapter、GPU limits、shader validation 及 WebGL2 fallback；GitHub Pages 不應假設可直接自訂 COOP／COEP Header，因此 SharedArrayBuffer／Wasm Threads 不列必要主線能力。只有在所有目標裝置與部署路徑證實隔離可用、或使用另一個獲准的靜態託管平台時，才研究 Threads；Service Worker 模擬 Header 不能直接當作跨裝置穩定且無風險的解法。可選的離線 HTML／file:// 原型另行測試，卻不再屬於正式發行 Gate。**

**14.5 熱資訊：**普通 Web 頁面先以連續幀時間、GPU Timing（可用時）、電池與外部 ADB／Perfetto／AGI 量測作間接觀察；若另有 Native 殼再研究 ADPF Thermal API。不要宣稱 Web 已直接取得原生熱狀態或功耗。

## 15｜唯一代號定義與 A → B → D Fast-Track

唯一代號表：A＝Pixel-Games 正式 Three.js/WebGL2；B＝Three.js WebGPURenderer／TSL（其 WebGL2 回退需單獨測）；C＝PlayCanvas WebGPU／WebGL2（微型成熟引擎對照）；D＝TypeScript 原生 WebGPU／WGSL（只針對 B 框架瓶頸）；E＝D 或 B 搭配 Rust/Wasm 的 CPU 熱點微型對照，絕非預設重寫所有世界；F＝Filament WASM／WebGL2（微型參照，需可重現建置）；N＝可選 Native Filament／wgpu／Vulkan／Metal（不與 Web FPS 混算）。本表是全文唯一 A/B/C/D/E/F/N 定義，圖2與圖5舊圖中的任何同名代號都不具規範性。

控制變因：同 Seed、世界分布、視野、光源、參照幾何、PBR、天空、水面、陰影、後製、像素總量、互動／NPC 數量，並以動態影片和盲評檢查相同畫質。若各引擎實作方式不同，須揭露功能缺口與畫質差異，不能把降低功能的版本計為獲勝。區分 Cold Start、Shader Warmup、Steady-state、突發 Chunk Loading、Device Lost Recovery。

Fast-Track 成本收斂：第0階段只建立 A 基準及雙平台能力矩陣；第1階段以共同場景測 A vs B，需統計等畫質與現有 Shader 遷移成本；第2階段僅當 B 存在可證明框架瓶頸才做 D 的最小 Pass 對照；第3階段針對 TS／SoA 仍未解決的 CPU 熱點，條件式測 E，Worker／GPU 剔除等逐一消融；第4階段 C、F 僅作窄範圍微基準、N 待原生產品決策。若收益被量測變異吞沒標 INCONCLUSIVE，不建七套完整世界。採用原則是最小變更帶來最大持續效能與品質收益。

重要技術約束：WebGPU 單次 drawIndirect 不是 Multi-Draw Indirect；Chrome 非標準／實驗功能不得設為正式平台先決條件。Chrome WebGPU Compatibility Mode 可以研究但有核心功能子集限制，不保證所有 WGSL／Compute 路線不變。

## 16｜Render Graph、GPU 資源生命週期與成本模型

建議每個 Pass 宣告 inputs、outputs、load/store、format、sample count、dimensions、history dependence 和可否合併。Graph 負責拓樸排序、資源讀寫危害檢查、Transient/Persistent 區分、Render Target 池、Resolution Class、Warmup、Pass 計時與可重現 Dump。GPU 非同步執行，CPU submit／GPU pass／螢幕 present 分別計時，不把各階段簡單加總為畫面延遲。

手機先測 Forward+／簡化 Forward vs Deferred：以可見光源數、透明草葉／海水、G-buffer 頻寬實測，而不是固定以 Clustered／Deferred 為最佳。大量夜間局部燈光才優先比較 light clustering，正午戶外不必自動付出分類成本。

Transient 附件與版本相容：Chrome 146 引入 GPUTextureUsage.TRANSIENT_ATTACHMENT 的可選路徑，Chrome 149／150 進一步收緊驗證：建立 transient texture 時 viewFormats 必須為空、createView 不能藉 view 改變既有 usage、transient texture 不可作 resolveTarget。僅允許受限生命週期的深度／MSAA 等一次性附件，不得跨 Pass 讀取或作常駐紋理；需要跨 Pass 使用則選一般 attachment。所有用途先用 feature detection、GPU validation 與 fallback 驗證，並比較 GPU ms、外部記憶體流量代理值和峰值資源計帳。對 Tile GPU 採受控 loadOp=clear／storeOp=discard 測試，不能清除後續仍需的內容。

**GPU 資源／Pipeline 註冊中心：**每種 Geometry／Texture／BindGroup／Buffer／RenderTarget／Pipeline 建立資產 ID、估算 bytes、引用者、版本、最後使用幀、優先級和釋放路徑；按 Chunk 與距離實施 LRU／Priority 回收，Buffer 傳輸使用 Chunked Upload／Dirty Range，不做頻繁 GPU→CPU 讀回。Shader 變體由可重現 key（材質功能、燈光模式、頂點 Layout、目標 Format、MSAA 等）管理；優先在載入階段以 createRenderPipelineAsync／createComputePipelineAsync 非同步預編譯，收集 getCompilationInfo() 的錯誤與警告。記錄每條 Pipeline 建立 Promise 的耗時分布（與 GPU driver 真實內部編譯耗時不同）、變體數、首次可玩時間與首次使用時的 50／100ms 以上卡頓；不得假設網頁可控制或持久化瀏覽器驅動 Pipeline Cache。初始研究警戒為 Balanced 避免超過 64、High 避免超過 128 個必要 Pipeline 變體，須由真機基線修正，不把這些數字當平台固定限制。

## 17｜大世界幾何、程序建築與植被：不虛構 Nanite

地形權威性與串流：CPU 端定義唯一確定性高度權威（建議 Seed＋可版本化的量化整數高度 Tile／邊界一致規則），GPU 幾何、碰撞、植被放置、岸線及存檔均由同一資料契約重建；若 GPU 另用 sin／cos／pow 或 FMA、f16/f32 近似生成位移，不可直接當成與 CPU 逐位元一致。針對固定 Seed、Chunk 接縫、LOD、不同 GPU／瀏覽器，以碰撞接點與渲染表面最大高度誤差、位移連續性、坡度與法線差異設定驗收；近玩家碰撞誤差可先以 2cm 暫定警戒值，應依實際玩法重新校準。世界串流使用有界佇列、視角預取、取消、優先級、GPU 駐留預算、退場回收；高速移動與天氣切換不得造成不可控峰值。

幾何：CPU Chunk/BVH 粗剔除 → 可選 GPU 視錐與 Hi-Z 遮擋 → 按畫面投影誤差選 LOD／HLOD → Instance Compaction／Batch；先驗證遮擋保守性、畫面跳變與提交成本。meshoptimizer 可以產生 meshlets 和簡化幾何，但 meshlet 不等於 WebGPU 具有硬體 Mesh Shader；是否在 WebGPU 以 Compute／間接繪製有效利用需單獨 A/B。

建築：加入類型化生成文法（街廓、地基、柱樑、牆、門窗、樓梯、屋頂、屋瓦、港口碼頭）和拓樸有效性檢查。要求門窗是有深度與正確遮擋的洞口、碰撞與導航一致、屋瓦排布避免規則重複、轉角不穿模、歷史尺度與建造邏輯可追溯。Seed／語法版本固定，離線生成可決定性 Bake 到幾何與材質資料，避免每幀重新建造。

植被：Near／Mid／Far／Canopy 依畫面誤差、Alpha Overdraw、陰影頻率分級；局部 GPU 風場與交互圖驅動，避免每片草 CPU 更新，透光／風影一致；在側逆光轉頭時檢查鋸齒、葉片覆蓋率與 TAA 重影。這裡的突破標準是同等可見密度與樹形更便宜，而非單純減少葉片。

## 18｜視覺可信度：GI、海水、時序與材質的一致性

光照分流：戶外核心為 PBR＋太陽陰影＋Sky IBL／大氣；少光源先用簡化 Forward，夜間密集點光源再測 Clustered；局部 Probe GI、SSGI、SSR 僅在真實畫質提升與耗時可接受時啟用。高階桌機 GI／反射要有受控預算，不能把 Web 方案叫做完整 Lumen。加入漏光、戶內外過渡、動態日落與雲影同步測試。

海岸：共用岸線／海床查詢控制 Gerstner 長浪、近景法線、浪花泡沫、淺水消光、濕沙、岸壁遮擋、船體浮力；FFT／淺水 PDE 僅作與廉價基準同場景 A/B。反射必須依天空、平面區域、螢幕空間資訊分級，區分有來源的實景反射與近似；特別測逆光金色高光與相機旋轉穩定。

材質：把可重用的程序紋理離線或初始化時 Bake，依 Feature 選 KTX2/Basis → ASTC、BC、ETC2 或未壓縮退路；標示傳輸壓縮與 GPU 執行格式不同。明確區分 Base Color 的 sRGB 與 Normal/Roughness 等線性通道，控制 texel density、mipmap／anisotropy、triplanar 導數抗鋸齒與濕度演化。

時間抗鋸齒／Upscaling：每條路線實作 History Validity、Motion Vector、Depth／Normal Rejection、Disocclusion、Reactive Mask、透明植被與海面特殊處理；在快速轉頭、逆光欄杆、雨滴、海浪、NPC 移動、LOD 轉換期間同時量動態細節與拖影。若沒有足夠證據，先選較穩定的 TAA／FXAA／MSAA 組合，而不是追逐演算法名稱。

## 19｜遊戲世界的精度、模擬、存檔與產物契約

World Core 對外至少定義 Chunk ID、Entity ID、Transform、Material Instance、Seed、Generation Version、Biome、Height Query、Collision Query、Environment State、Snapshot Epoch、Storage Version。固定 Simulation Timestep，render 插值與跨距離 Simulation LOD 不破壞權威物理與導航。遠距 NPC 進入近景時依可追溯事件還原，不能瞬移；存檔需版本遷移與崩潰恢復。

**發行與記憶體的新決策（2026-11-17）：GitHub Pages／HTTPS 多檔正式版取代原先『必須單一 HTML』的交付限制；不再為正式產物將所有依賴與資料 Base64 內嵌。保持按需下載、並行請求有上限、按場景預取、逐 Chunk 解碼與 GPU 分批上傳，將 Manifest、程式與生成資料的版本綁定。允許純程式生成的幾何／材質在 CI 或初始化時預烘焙為靜態資源，不等於違背純程式來源原則；但第三方素材授權仍需獨立核對。保留既有 150MB（若作為總發布資產上限）的工程目標，不將其偷換成單檔、首屏下載、RAM 或 VRAM 限制；應分別記錄 dist 總 bytes、首次所需 bytes、二次進入 cache hit、載入／場景切換峰值、CPU/GPU logical bytes 與在實際網路條件下的載入時長。大世界資料持續以有限 Chunk Residency、LRU、預取取消和資源回收處理。file:// 與單檔離線包可選，不再是必要的 CI/PR 合格條件。**

**記憶體預算（可執行但未實測的初始工程門檻）：**使用 Asset/Resource Registry 持續計算「引擎持有的 GPUTexture／GPUBuffer／RenderTarget 邏輯 bytes」「CPU 已解碼且仍保留的幾何／紋理 bytes」「同時存在的 staging／轉碼／上傳 bytes」「Wasm Memory bytes」，同一共享 backing store 不應當作真實物理記憶體重複加總；引擎計帳也不等於作業系統 WebContent RSS 或 GPU process 實際 VRAM。行動 Balanced 初值依序 192／128／64／64 MiB，High 320／192／96／96 MiB；達任一配額 80% 即進行快取整理、LOD/Chunk 預取收斂，達 100% 不再新增非必要常駐資源並先嘗試安全回收或明示降檔。上述門檻不是 Safari 的通用硬體上限，應隨機型實測修訂；強制要求在相機漫遊 20 分鐘與快速傳送後回收到合理穩態，並記錄峰值與故障樣本。

**OOM 與 iOS 預防：**歷史 WebKit 工程師說明多數 iPhone WebContent 約 1.5GB OS 管制、受機型及記憶體壓力影響，非所有機型固定 1.2～1.5GB，也無法由網頁自行可靠讀取全部程序／VRAM。可將外部工具觀察 WebContent RSS 低於 900MiB 作保守的初始研究目標（不是瀏覽器 API 的可強制硬門檻，更不是保證不崩潰）。performance.measureUserAgentSpecificMemory() 在支援時可追蹤估計值，但需要 secure context 與 cross-origin isolation、量測範圍與 OS RSS 不同；不支援時標 N/A，不用 performance.memory 假裝總 RAM。頁面可能因 OS OOM 直接被殺／重載，不必先觸發 device.lost；所以重要世界狀態需原子化持續檢查點、重進頁自動偵測未正常結束、異常時採低配與分批載入，不依賴一次性的卸載事件才存檔。任何降檔與資料恢復均需遊戲層回歸。

授權：MIT 的 Abyssal Garden 可依法研究／使用；Crimson Loong 只確認 vendor Three.js 的 MIT，沒有完整原作授權時不可複製；Grassworks 為商業產品、Brinewater 未取得足夠可審查原始碼時僅參考技法。每個引入模組都鎖 commit、授權、來源與維護承諾。

## 20｜真正能支持『顛覆世界級』的驗收

性能與卡頓驗收：裝置／OS／Browser／GPU 版本與固定 SHA、六鏡頭＋自由漫遊；相同溫度／亮度／電源條件交錯重複 3 次以上，取 p50/p95/p99 幀間隔、長幀（例如 >50ms 與 >100ms，暫定工程分類）、主執行緒佔用、各 GPU Pass（若可測）、輸入到畫面回饋延遲、首次可玩、首次 Pipeline Warmup、Shader 變體數、Chunk 解壓與上傳停頓、20 分鐘熱穩態、裝置丟失與疑似頁面 OOM 重載。Pipeline 首次使用造成的 >50ms 長幀須個案標示並分析，正式場景不應出現未解釋的 >100ms 連續卡頓；以上是試驗 Gate 而非已達成數字。GPU／CPU／合成器耗時各自計帳，不能把 GPU Pass 時間當作 input-to-photon。

視覺：同 Seed／鏡頭／光照與天氣，保存未壓縮 PNG 及動態影片；不能只做漂亮靜照。固定六鏡頭包括低角度海岸、建築 0.5m／2m／20m、近景植被、逆光黃昏、雨夜反射與大視距森林。由不知方案名稱的評審評估幾何可信、尺度、光照／反射、抗閃爍、可探索完整度；Golden Screenshot 在同 OS／GPU 類別維持基準，跨裝置不硬套逐像素一致。

統計：相同裝置交錯執行 A/B，避免全將一方案排在冷機而另一排在熱機；報告原始樣本與不確定性。收益需超過變異並且不造成可見品質退步、操作延遲上升、更多掉裝置或不可維護的依賴。沒有同裝置實測不使用『全面超越 UE5』『手機全程原生 QHD 60』『硬體光追』等措辭。

產品：完整垂直切片需同時能移動、碰撞、保存／重載、走過建築與海岸、能看見樹木與雲風海一致的時間天氣；若只做固定鏡頭特效或局部畫面，定位仍是 Shader Demo，不是完整世界級遊戲。

## 21｜v1.1 採用／否決決策與優先順序

P0（規格與基準，不改 main）：① 第15章為代號唯一權威，第09／10章沿用 Fast-Track；② 保留五張內嵌圖，圖2／圖5是舊候選歷史示意；③ 固定 SHA、六鏡頭、解析度、GitHub Pages HTTPS 多檔正式發布契約與部署後驗收；④ 建立 dist／首屏／快取 bytes、RAM/GPU Residency、Shader Warmup、Input/HUD 合成與 20 分鐘熱穩態量測；⑤ 舊 file:// 單檔與離線是可選實驗，不再阻擋驗收；⑥ PR #147/#149 可能仍記載單檔打包，它們的實作未因本文更新而自動改變，後續必須明確調整才可視為符合新契約。

P1（短線最值得做）：A → B 同畫質／移植成本對照；優先改善 A 現有 Shader 變體管理、資源分塊上傳、LRU 駐留與回收、CPU/GPU 地形同源、程序材質 Bake、HUD 合成與低風險 GPU Attachment 優化。新允許的 HTTPS 多檔發布可直接引入可快取的 Wasm／KTX2、Chunk 按需載入、內容雜湊與版本化 Manifest，需依真機測到的下載／解壓／Shader Warmup／記憶體峰值逐項評估。D（自訂 TS/WebGPU）僅在 B 框架限制被證明後做針對性 PoC。

P2（僅有證據才擴張）：先 TS TypedArray／SoA 最佳化；若實際 CPU p95 熱點超過暫定 3.5ms 且變異顯著、無法以簡單修正消除，再做 E（無 Threads Rust/Wasm）微測試；Worker、Wasm Threads、SharedArrayBuffer、Meshlet／Hi-Z、Probe GI、FFT 海洋、更多體積雲、N 原生均須有平台能力及實測收益才開發。C／F 僅做小型參考，不占正式遊戲全量重建人力。

否決條件：對照無法維持同畫質、缺少指定手機實測、iPhone 退路不可靠、真機長時掉裝置、部署不符合已更新的 GitHub Pages HTTPS 多檔／單一正式入口契約、未達資源／快取／授權與可維護性要求時，不把候選升為正式核心。不得再以『不是單檔 HTML』作為否決理由。

截至此版：僅研究與規格升級；Pixel-Games 正式程式、PR、部署、畫質及性能數字沒有因此改變。NOT IMPLEMENTED / NOT BENCHMARKED / NO MERGE。

## 22｜v1.1 可追溯查證來源（官方優先；2026-11-17）

S1 WebKit Safari 26 正式 WebGPU：https://webkit.org/blog/17333/webkit-features-in-safari-26-0/

S1 Three.js WebGPURenderer／TSL 遷移：https://threejs.org/manual/pages/webgpurenderer

S1 PlayCanvas Graphics Backends：https://developer.playcanvas.com/user-manual/graphics/

S1 PlayCanvas Frame Graph Camera Passes：https://developer.playcanvas.com/user-manual/graphics/advanced-rendering/frame-graph/camera-passes/

S1 Chrome 146 Compatibility Mode／Transient：https://developer.chrome.com/blog/new-in-webgpu-146

S1 Chrome 149/150 Transient 嚴格驗證：https://developer.chrome.com/blog/new-in-webgpu-149-150

S1 WebGPU 規格 Load／Store：https://gpuweb.github.io/gpuweb/

S1 MDN GPUDevice.lost：https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/lost

S1 MDN WorkerNavigator.gpu：https://developer.mozilla.org/en-US/docs/Web/API/WorkerNavigator/gpu

S1 MDN WebGPU Limits：https://developer.mozilla.org/en-US/docs/Web/API/GPUSupportedLimits

S1 MDN COOP／COEP：https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy

S1 Cloudflare Pages Headers：https://developers.cloudflare.com/pages/configuration/headers/

S1 Android ADPF（Native）：https://developer.android.com/games/optimize/adpf

S1 Apple Metal Memoryless：https://developer.apple.com/documentation/metal/mtlstoragemode/memoryless

S1 POCO F8 Ultra 官方規格：https://www.mi.com/tw/product/poco-f8-ultra/specs/

S1 Khronos KTX2/Basis Developer Guide：https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXDeveloperGuide.md

S1 Playwright Golden Image：https://playwright.dev/docs/test-snapshots

S2 Google Filament WASM／WebGL2：https://github.com/google/filament/blob/main/README.md

S2 wgpu wasm backends：https://docs.rs/wgpu/latest/wasm32-unknown-unknown/struct.Backends.html

S2 wgpu adapter 選擇注意：https://docs.rs/wgpu/latest/wasm32-unknown-unknown/struct.InstanceDescriptor.html

S2 meshoptimizer 幾何叢集／LOD：https://github.com/zeux/meshoptimizer

S2 Abyssal Garden MIT：https://github.com/Noniv/abyssal-garden

S2 Crimson Loong（授權範圍待確認）：https://github.com/ChetasLua/crimson-loong

S3 iPhone 非影片 Fullscreen WebKit 議題：https://bugs.webkit.org/show_bug.cgi?id=206854

S3 iOS Safari 27 WebGPU 記憶體問題回報：https://bugs.webkit.org/show_bug.cgi?id=331130

S3 Safari WebGPU Worker Device Lost 回報：https://bugs.webkit.org/show_bug.cgi?id=321676

S4 Pixel-Games PR #147（正式遊戲遷移未合併）：[REDACTED: private repository URL]

S4 Pixel-Games PR #149（研究文件 Draft 未合併）：[REDACTED: private repository URL]

2026-11-17 補充證據：W3C Secure Contexts（file URL potentially trustworthy）— https://www.w3.org/TR/secure-contexts/

2026-11-17 補充證據：Chrome WebGPU 疑難排解（file:// 可能不提供 WebGPU）— https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips

2026-11-17 補充證據：WebKit 工程師 iPhone WebContent 記憶體限制（歷史說明，非保證值）— https://bugs.webkit.org/show_bug.cgi?id=268816

2026-11-17 補充證據：MDN createRenderPipelineAsync — https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipelineAsync

2026-11-17 補充證據：MDN getCompilationInfo — https://developer.mozilla.org/en-US/docs/Web/API/GPUShaderModule/getCompilationInfo

2026-11-17 補充證據：MDN measureUserAgentSpecificMemory（僅特定瀏覽器且需隔離）— https://developer.mozilla.org/en-US/docs/Web/API/Performance/measureUserAgentSpecificMemory

2026-11-17 補充證據：WGSL 浮點精度與實作容許差異 — https://www.w3.org/TR/WGSL/

2026-11-17 補充證據：Chromium GPU Memory Tracing — https://chromium.googlesource.com/chromium/src/+/main/docs/memory-infra/probe-gpu.md

2026-11-17 補充證據：Chromium Canvas 與 backdrop-filter 合成性能案例（特定環境回報）— https://issues.chromium.org/issues/414525204

2026-11-17 補充證據：Chrome 149/150 Transient 驗證 — https://developer.chrome.com/blog/new-in-webgpu-149-150

2026-11-17 技術勘誤與執行收斂補註：上述 P0/P1/P2 及第15章代號為本文唯一執行依據。原圖2與圖5仍為 Google Docs 內嵌圖片，反映舊版候選而非新版代號；需另做新版完整圖時再換圖，不可把文字匯出的 image placeholder 誤判為圖片不存在。記憶體、Shader 變體、地形誤差與 CPU 3.5ms 閾值皆為待真機校正的工程初值，不能當作已驗證的極限或通用標準。此版仍為研究規格：NOT IMPLEMENTED／NOT BENCHMARKED／NO MERGE。
