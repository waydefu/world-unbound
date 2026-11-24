# Hellesylt 草葉近景對照

進度與實際驗收記錄在 [Issue #50](https://github.com/waydefu/world-unbound/issues/50)。核准母模有 79,524 葉／m²。全域外觀與 POCO F8 Ultra 在 Medium、scale 1.0 的 60 FPS 分開驗收。

## 重現同一片草

在正常遊戲入口使用 `?inspect=1&cam=6&turfSite=slope&turfView=macro&q=med&scale=1`。WASD 或方向鍵移動，拖曳轉頭，C、V、B 切換貼地、站姿與抬升。手機可同時按住移動鍵並拖曳轉頭。貼地鏡頭高 5.5 cm，近裁切面 8 mm。坡地、低地、高地、接縫均可作為起點。匯出的 `camera.pose.query` 可放入 `inspectPose` 重現同一位置、方向、焦距設定和近裁切面。比較時也要匹配實際後端、畫幅與 drawing buffer。

| 對照 | 在相同鏡頭加入的參數 |
| --- | --- |
| 正常遊戲草地 | 沿用預設 |
| 地形上的 4 × 4 m 母模對照 | `sward=world&turfReference=1`，指定 turfSite |
| #49 地表草與三方向草層 | `sward=world&turfLod=30&turfTrial=canopy&turfRibbon=quality` |
| 坡面葉身試驗 | 使用 #49 同一組參數，加入 `turfFrame=surface` |
| 含根墊的獨立母模 | `?cam=2&sod=full&sodView=edge&inspect=1`，位於原來的固定草塊 |

原來的世界草葉在每一片葉的腳點取樣地形，再將平地母模的水平位移及高度加到腳點。朝上坡伸展的低葉尖可能穿入同一個地形三角形。surface 試驗用腳點的真實三角形法線將母模葉身與葉片法線一起旋轉；葉長、折痕、根部位置、原始葉色及拓撲沿用母模。在不同三角形的交會處仍須近看尖端與土面。比較中的遠景草層、根位和 LOD 分派使用相同設定。地形取樣共用兩個對角端點，再依三角形選第三個高度。最近層在原本覆蓋率恆為 1 的 canopy 試驗距離內可以用不透明葉身提交。

## 取像與判讀

`captureMs` 可固定風與草葉動畫時間，搭配 `walk=1` 重現固定路線上的一幀。正式效能量測請用正常遊戲時鐘。動態調色對照固定同一曝光。下列命令使用鎖定版本的 Chromium，在執行中的 Vite preview 對同位置拍攝，輸出 PNG、逐張 JSON 和條件清單。

```sh
WU_TURF_COMPARE=stage1 WU_TURF_MOTION_MS=off WU_TURF_VIEWS=macro,standing,raised \
  node tools/turf-capture.mjs out/turf webgl2 slope lowland highland seam
```

完整命令省略 `WU_TURF_MOTION_MS=off` 即加入固定步行時間樣本；使用 webgpu 參數可另外取像。固定參考草塊外的畫面須依清單中的位置標記解讀。每次 npm 視覺稽核另外保存坡面微距三張對照到 `artifacts/visual/turf-stage1`。軟體渲染的影像只能驗證該後端實際畫面，裝置速度要另測。

## 架構選擇與待驗項目

Abyssal Garden 在頂點著色器內依列生成葉中心線、寬度、扭轉與風動。該作以 CPU 剔除整格並合併連續繪製範圍，每筆實例用 36 bytes。World Unbound 已用 16 bytes 記錄草簇，WebGPU 間接繪製共用母模，WebGL2 對相同根位做 CPU 選取。保留 Three 的裝置、深度、相機矩陣、陰影與資源重建路徑，可以直接比較同一個世界的葉身姿態；參考專案使用的水下光照與遠處加寬葉片需獨立評估。[葉片實作](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/source/src/shaders.js#L389-L445) · [繪製與 LOD](https://github.com/Noniv/abyssal-garden/blob/a596354eff400d458bc2aeb9bdf5e0a9734b2bcf/source/src/main.js#L395-L424)

標準仍包括任意地表接地、站姿厚度、轉頭走動、遠坡覆蓋、256 個實際表面積樣區與跨區連續性，以及真機 60 秒和 10 分鐘熱機。canopy 在投影門檻開始使用簡化幾何，10–13 m 是另一個覆蓋淡出區間。這個試驗尚未解決兩者之間的畫質差距。關閉 `turfFrame` 即可切回原有葉身方向；關閉 `inspect` 恢復預設操作。
