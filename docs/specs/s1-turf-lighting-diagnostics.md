# S1 草毯成本診斷與全域天光對照

2026-11-22，使用者確認「開工」。按 [#45 的量測設計](https://github.com/waydefu/world-unbound/pull/45)，以 #44 全開版為基準。這一輪交付可隔離的真機入口，以及保留可見葉片的剔除試驗和全域天光試驗。畫質與效能依[全域草毯驗收](s1-rooted-soil.md#全域草毯驗收)分開判定。

## 草毯

在同一份建置使用 `?sward=world&turfLod=30&turfTrial=canopy&cam=6&turfSite=lowland&turfView=standing&q=med&scale=1`。同一輪只加下表其中一個參數。保留選取、計算通道、草根重建、母版、風動、其餘層的覆蓋與 LOD 門檻。地表草冠停繪時保留地面草色和遮罩，使用中性冠層顏色、零冠層傾斜及固定草下土壤比例。

| 加在基準網址後 | 差異 |
| --- | --- |
| `&turfOff=full` | 隱藏完整葉網格 |
| `&turfOff=folded` | 隱藏簡化葉網格 |
| `&turfOff=ribbon` | 隱藏交叉草片。遙測保留選取格數，提交三角形為零 |
| `&turfOff=canopy` | 跳過地表草冠材質中的多層取樣及計算 |
| `&turfCull=1` | WebGPU 的逐簇壓縮先用原本的距離與 LOD 條件排除，再對其餘草簇檢查相同的六個視錐平面 |

對全開和各試驗分別做固定站姿與同路線 `walk=1`。裝置暖機後各量 60 秒，交替重跑基準。另用 `turfStats=1` 量完整葉和簡化葉的間接提交量，正式幀時間測試關閉讀回。使用 `turfCull=1` 時，先用相同鏡頭核對停留與轉向的提交草簇數、畫面和幀間隔，確認保留草葉後才評估效能。它只作用於 WebGPU，對 WebGL2 的 CPU 選取沒有影響。

停繪的結果包含該層與其他層交互影響。對畫面與幀率以同一組合的差值解讀；各差值不能加總。隱藏物件可能同時讓渲染器略過該物件的可見實例屬性上傳，特別是 WebGL2。預設渲染與試驗版本各自確認。診斷畫面只用於歸因。

## 草片輪廓與深度試驗

2026-11-22，使用者確認「開始吧」，並要求確保畫面品質的 60 幀。POCO F8 Ultra 河谷固定站姿測試使用 2 號鏡頭、直向 1006 × 2186、WebGPU、Medium、比例 1.0。全開 9.1 FPS，關草片 20.1 FPS，第 20–80 秒各 10 秒視窗的平均幀間隔約為 109.1／48.6 ms。兩次的地形、陰影、候選根與草片格數一致。關草片是繪製成本對照，實作需保留草片提供的輪廓和厚度。

[固定鏡頭基準](https://waydefu.github.io/world-unbound/?sward=world&turfLod=30&turfTrial=canopy&cam=2&turfSite=lowland&turfView=standing&q=med&scale=1)可加上以下單一參數。

| 參數 | 繪製方式 |
| --- | --- |
| `&turfRibbon=trim` | 使用原草片貼圖的透明通道求出最高一列非零覆蓋，保留 16 列供過濾。現有母版保留原卡高度的 91.8%。以原座標取樣，沿用原根位、草片寬度、兩個方向、色彩、風與半透明混合 |
| `&turfRibbon=depth` | 沿用裁邊版，WebGPU 在啟用 MSAA 時以 alpha-to-coverage 將原本算出的覆蓋率交給多重取樣，草片寫入深度。WebGL2 及無 MSAA 的配置使用裁邊半透明版 |
| `&turfOff=ribbon` | 關閉草片繪製，供量測剩餘成本 |

匯出 `world.grass.worldTurf.ribbonLod.mode` 可確認實際繪製為 `blend`、`trim` 或 `depth`，`topV` 是上緣使用的母版 UV。`params.turfRibbon` 為請求值。因大幅縮小後的 mip 會混合邊緣，裁邊仍須做斜坡、斜視及移動對照。深度試驗的取樣遮罩可能改變重疊草尖的透明度和邊緣，需檢查草量變薄、鋸齒、斑紋和閃爍。

固定鏡頭基準、裁邊與深度各輪流跑，暖機後比較 60 秒的實際幀間隔，分開記錄直向和橫向。手機候選必須在 Medium、比例 1.0 維持 60 FPS，暖機後無幀超過 50 ms，並完成至少 10 分鐘熱機驗證。同時比對 A 河谷、D 坡地、F 高地、I 接縫的貼地、站姿和移動，包含中遠景連續性與草尖交錯。若草片改造後仍未達 60 FPS，下一輪分離完整葉、簡化葉與地表草冠，使用畫面差異決定哪一層可以優化。

可用 `WU_TURF_COMPARE=trial WU_TURF_LOD=30 WU_TURF_TRIAL=canopy WU_TURF_RIBBON=trim node tools/turf-capture.mjs out/ribbon-trim webgl2 lowland slope highland seam` 擷取裁邊版。WebGPU 對照使用 `depth` 與 `webgpu`。基準省略 `WU_TURF_RIBBON`，各輪使用相同設定。

## 全域天光

`&lighting=sky` 以現有天空查找表與同一 CIE 陰天天幕估算半球環境光，同時用這個天光估算值計算自動曝光目標。沿用既有太陽、月光、陰影、霧、地表反射和 AgX。試驗沿用色彩與光照的既有 GPU 路徑，調整的是 CPU 發布的光照值。

先在兩版都加 `&exposure=1.428`，只切換 `lighting=sky` 比較日照與陰影。這是 #44 河谷晴天 13 時的固定曝光對照值。逆光及陰天各先用基準的自動曝光讀出該畫面的值，再固定到同一數字比較。最後以自動曝光比較三組場景，檢查草葉綠色、根部暗部、遠坡岩石細節、水面與天幕亮度。雨夜另查天幕亮度與谷底可讀性。

## 放行

在 A 河谷、D 坡地、F 高地、I 接縫比較原模貼地、站姿、抬升、移動和風擺。Medium 固定比例 1.0，分別記錄 POCO F8 Ultra WebGPU 和 WebGL2，待 60 秒短測與至少 10 分鐘熱機，連同畫面交給使用者驗收。使用者要求的 10 公尺後才開始原模交棒仍需以單獨試驗驗證。這次開關用於測現況，移除新增參數即可回到基準。

## 不透明程序化草片對照（Abyssal Garden 研究）

2026-11-24 使用者同意開始獨立試驗。Refs #33；基線 main `e2b53e8`。沿用原本 30 m canopy 試驗，另加 `&turfRibbon=blades`。每一個既有草片代理根位改為三片具實際尖端輪廓的葉片（9 個三角形／格，而透明交叉草片為 4 個）；不讀取側面 alpha atlas，不混合、不使用 alpha test，開啟深度寫入，近遠交棒透過縮窄葉寬。沿用同一根位選取、地形、風、季節色和物理材質類型，保留全模、簡模和地表三層冠層。這只是程序化中景代理，不是 79,524 葉／m² 原模的等效性證明；不改預設，也不擅自改原模密度。兩種後端使用相同候選幾何。

視線核查：App.ts 的 camera.position 固定為零，terrain.root.position 為 -eye；因此現有 positionWorld.normalize() 在此相機相對座標契約下是正確的，不改草冠或基準草片。若未來採用非零渲染相機位置則須重審。

### 驗證矩陣

- 基準、trim、depth、blades、off=ribbon 五組；固定相同鏡頭、曝光、風、解析度與陰影；depth 只在支援 MSAA 的 WebGPU 真正啟用。匯出 mode 應為 blades，triangles 應為可見格數 × 9（停繪時為零）。不以三角形數量推定 GPU 幀時間。
- `npm ci --ignore-scripts`、`npm run check:quiet`，另用 `WU_TURF_COMPARE=trial WU_TURF_LOD=30 WU_TURF_TRIAL=canopy WU_TURF_RIBBON=blades node tools/turf-capture.mjs out/proxy-blades webgl2 lowland slope highland seam`；webgpu 同樣執行並確認實際 backend。
- 相同河谷固定站姿暖機後 60 秒，交替跑基準；再測轉向、walk=1、四地點貼地／站姿／抬升、直橫向、逆光與風擺。記錄 p50/p95/p99、長幀、實際解析度、GPU 通道及提交量。保留光影、厚度、草尖與連續性才可接受；原模 10 m 後交棒的標準仍待獨立驗證。最終須 Medium scale=1 的 POCO 60 FPS 及 10 分鐘熱機，不達標不替換預設。
- 後續依真機資料分別試特化光照、草簇共用地形／風資料、分格剔除。原生 WGSL 後端待 TSL A/B 證明必要性才另立 spike。未複製上游程式碼。


## Abyssal Garden 曲面葉片 A/B（2026-11-24，實驗中）

在 [Issue #50](https://github.com/waydefu/world-unbound/issues/50) 的要求下，經過母模／全域草地現況、[Abyssal Garden 的 `source/src/shaders.js` 葉片頂點函式](https://github.com/Noniv/abyssal-garden/blob/main/source/src/shaders.js) 與 renderer/SoC 契約三輪核對後，新增 `&turfRibbon=curved`，**不是正式畫質路徑**。

### 具體變更
- `src/render/turfCurvedGeometry.ts`：四片草葉、每葉五列、合計 32 triangles/cell。只有根位、左右與葉長參數，沒有透明貼圖；根位仍由原來的 `turfEligible`、`heightAt`、frustum/距離選取產生。
- `src/render/turfCurvedMaterial.ts`：TSL 頂點程序化塑形，從中心線延伸出逐節彎曲、寬度輪廓、隨高度扭轉、風場擺動和近似隨曲率變化的法線。與 Abyssal Garden 的「頂點時構形」策略相同，**不是直接搬其 WGSL 原始碼**，保留現有 three.js 光照、陰影及 WebGL2 備援。
- 原 `&turfRibbon=blades`（#48 三葉代理）以及 `trim`/`depth` 和預設路徑全保留，沒有把降低葉片數量當成手機畫質改善。
- `&turfView=macro`：貼地 0.055 m、鏡頭朝向約 0.19 m 外的地表草葉、8 mm 相機近裁切面；修正 `close` 原本瞄向地下的問題。此為**固定相機近看**，尚非可自由走到全圖任何位置的操作功能。

### 重現比較
在同一個**具備 PR 分支程式的測試部署**使用：
- `?sward=world&turfLod=30&turfTrial=canopy&turfRibbon=curved&cam=6&turfSite=lowland&turfView=macro&q=med&scale=1&backend=webgpu`
- 對照 `turfRibbon=blades`、`turfRibbon=trim`、無 `turfRibbon`；比較 `turfView=close|standing|raised` 及 slope/lowland/highland/seam。
- 拍照：`WU_TURF_COMPARE=trial WU_TURF_LOD=30 WU_TURF_TRIAL=canopy WU_TURF_RIBBON=curved WU_TURF_VIEWS=macro,close,standing,raised node tools/turf-capture.mjs out/curved webgl2 lowland slope highland seam`。
- 須觀察：真實立體葉尖、貼地、不形成格線、LOD 交接、遠坡密度、風動連續、視角閃爍、畫質提升是否**肉眼明顯**；記錄 60 秒與 10 分鐘原生解析度真機成績和 shader、GPU、CPU 花費。32 triangles/cell 約為 #48 不透明三葉代理的 3.56 倍，**可能比原方案更慢**。
- 沒有截圖、真機對照、視覺盲審前，絕不宣稱已達 79,524 葉／m² 的全域高模視覺標準，更不能據此合併 main。移除 `turfRibbon=curved` 就回退。

### 授權和來源
Abyssal Garden 的 MIT 許可可供研究和合法改作，請參照上游授權；本實作採用「程序化中心線＋曲面葉寬＋扭轉＋距離剔除」的技術思路，沒有複製其 WGSL 原始碼或素材。若後續決定複製上游程式，必須保留其原著作權與完整 MIT 授權聲明。
