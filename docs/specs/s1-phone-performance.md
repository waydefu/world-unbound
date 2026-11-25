# 2026-11-25 Hellesylt 真機效能排查

測試裝置 POCO F8 Ultra，Adreno 8xx，WebGPU，Medium，2186 × 1006，scale 1.0。153.9 秒，報表近期平均 31 ms，P50 16.7 ms、P95 83.3 ms、P99 100 ms。GPU 各 pass 時間加總 P50 12.45 ms、P95 29.69 ms。LoAF 最嚴重阻塞 122 ms。相機實際為 3、日照 3.7°、曝光 28.041。初始固定鏡頭和最終相機姿態有落差，原始報表缺少切換歷史，無法追溯 70–110 秒的視點與負載，也無法據此判定降頻、GC 或 GPU 瓶頸。

舊版本的 `firstFrameMs` 從主執行緒完成地形載入後起算，51.66 秒外還有 12.26 秒的地形資產階段。原程式主執行緒與 Worker 分別讀取、驗證、解壓並組裝同一套地形。現在只在 Worker 解碼，保留其地形以繼續建構材質，另外複製 8 MiB 的已組裝地形網格，轉移其所有權給主執行緒。Worker 不可用時由主執行緒載入。地形準備與裝置初始化重疊。海底高度貼圖於首幀提交後才要求 Worker 建構。

`startup` 報表記錄每塊下載、摘要驗證、解壓和差值解碼耗時，另有組裝、跨執行緒送達、地形建構 `world.terrainTexturesMs`、GPU renderer 初始化、shader 暖機、首幀 rAF 等待與 CPU 提交。並行時間不能相加當作總載入時間。首幀指 CPU 提交，實際畫面呈現時間尚未量測。

## 固定比較

URL 固定使用 `?cam=6&turfSite=slope&turfView=macro&perf=1&q=med&scale=1&backend=webgpu&day=6&hour=13&wx=clear&exposure=1.428&hud=0&sward=world&turfLod=30&turfTrial=canopy&turfRibbon=quality&turfFrame=surface`。使用同一台手機、同一 Chrome、相同方向、2186 × 1006 drawing buffer。比對 JSON 的實際後端和相機姿態。保留實時風動。量 60 秒的穩定窗口及 10 分鐘熱機。冷載入與快取載入分開量，鎖定機身與環境條件，並記錄測試時是否在充電。舊版未支援 `perf=1`，量測時避免點擊相機欄或拖曳畫面。近期分位數保留在樣本數上限內，`sessionMeanMs` 涵蓋整段會話。新增的 CPU 時間分成地形更新、植被更新與 CPU render 提交。慢幀附前一個 callback 的耗時，以區分一幀內的工作與 callback 間隔。用 `perf=trace&inspect=1` 記錄自由移動時的慢幀與當時相機位置。缺少溫度或 GPU 時脈資料時保留未知。

GPU pass 加總不能當作單幀占用。診斷時分別比較一次 `shadows=0`、`turfOff=ribbon`、`turfOff=full`、`turfOff=folded`、`turfOff=canopy`，每次只改一個開關。這些測試用於估計各層對成本的影響。正式品質／效能驗收使用所有畫質層。

另開 `turfStats=1` 做間接繪製計數取樣，保留 `countSource`、取樣年齡及各層結果。只有實際無繪製或讀回計數為 0 才回報 0，停用、等待或相機已改變時仍回報 null。原 `triangles` 欄在未取到完整數據時是小計，可用 `triangleCountComplete` 辨識；正式效能記錄使用 `turfStats=0`。

## 畫面驗收

此次遙測的 302,106 個三角形是 50,351 個中景草片格 × 6，完整母模葉片數未知。近景原模幾何與簡化冠的投影交接、10–13 m 覆蓋淡出及 30 m 草片層是不同階段。舊版的高模範圍與中遠景連續性仍是 [Issue #50](https://github.com/waydefu/world-unbound/issues/50) 的驗收項目。回歸測試使用相同根位與等價的高度插值。依既有流程比較坡地微距母模，並另外在低地、高地和接縫重播站姿、抬升與移動。裝置幀時、畫面和可用性皆待實測。
