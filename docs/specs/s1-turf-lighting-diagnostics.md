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
