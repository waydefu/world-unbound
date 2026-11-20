# 草毯與單株草種手機試測

PR #32 初版的近景用寬尖片撐出覆蓋率，在遊戲裡會讀成三角錐。貼地重新看過 [#31 的單株盲審](https://github.com/waydefu/world-unbound/pull/31) 後，將草毯的厚度交給密植紫羊茅，並保留兩種帶花穗的草。Medium／High 以 `sward=1` 啟用。

[村地同鏡頭對照](grass-carpet/village-comparison.jpg) · [草坡同鏡頭對照](grass-carpet/slope-comparison.jpg)

## 草毯底層與單株

- **紫羊茅（B）**。腳邊重取樣原型的七片折葉，每株 126 個三角形。保留原始葉尖、寬度曲線、葉根位置和不同方向的弧度。更密的覆蓋來自同一個 B 模型的 32 株正投影。每一片都保留葉片透明輪廓，兩張交錯的切片跟著同一風場伏起。切片約至 16 m 逐步接入地表的雙層草絨。
- **黃花茅（A）和細弱剪股穎（C）**。以 #31 的 GLB 位置、法線和顏色合批，疏落長在草毯上。保留 A 的金色狹穗和 C 的疏分枝花序，兩株分別是 686 和 1,056 個三角形。這些花穗不參與草毯的覆蓋計算。

地表草絨固定使用紫羊茅的原型曲線。512² 烘焙分布有葉片的 texel 為 261,457／262,144（99.74%）。這個數字量的是俯視貼圖。辨認厚度用站姿及貼地實拍式鏡頭的遊戲截圖。植被格子依視野動態重用，紫羊茅以 2 m 格子為單位，兩種花穗共用 4 m 格子，視錐外保留 2 m。遠草地跟著 CDLOD 地形選取，兩個直向站姿鏡頭的可見草地距離估計約為 2.36 km（村地）與 1.15 km（草坡）。

## 同路線比較

Medium 固定渲染比例 1。每條 8.4 m 路線取 25 個位置，基準為 PR #32 初版 `fa2bafb`。直向截圖實際緩衝為 1072 × 2051。貼地截圖在同一 x/z 將鏡頭降到離地 42 cm。

| 草三角形尖峰 | 村地 | 草坡 |
| --- | ---: | ---: |
| 初版，直向 | 163,200 | 166,656 |
| 單株草種與密植草毯，直向 | 165,646 | 175,412 |
| 單株草種與密植草毯，16:9 | 205,698 | 216,432 |

三個草批次內完成，取樣中沒有格網溢出。新切片的通透區域會增加逐像素取樣，手機 WebGPU 幀時間需要真機測量。遠處的個別細葉仍會合併成地表紋理，細薄的花序也較適合近看。截圖使用 Chromium 156 的 SwiftShader WebGL2。

## 重現及實測

用 Python 3 與 Pillow 重烘焙素材。給定 #31 的 A、B、C GLB 所在資料夾，執行 `python3 tools/bake-grass-specimens.py SPECIMEN_DIR assets/grass/specimens-ac.bin`。它會一併輸出 `fescue-tuft.bin`。

在 PR 分支以 Node 22 執行 `npm ci --ignore-scripts`、`npm run build`，再執行 `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`。Android 可透過 USB 執行 `adb reverse tcp:4173 tcp:4173`。以手機 Chrome 打開以下連結，比較靠近地面的厚度和 p95 幀時間。

- [村地](http://127.0.0.1:4173/world-unbound/?cam=1&q=med&scale=1&backend=webgpu&sward=1&walk=1)
- [草坡](http://127.0.0.1:4173/world-unbound/?cam=2&q=med&scale=1&backend=webgpu&sward=1&walk=1)

確認 HUD 顯示 WebGPU。每個鏡頭走動一分鐘，按 **JSON** 匯出遙測。切回原有草層用 `sward=0`。CI 結果以 GitHub Actions 為準。
