# S1 連續草地與土壤

在 Hellesylt CDLOD 地圖的草甸及可生長坡面，以核准原模和實拍驗收草地。實物資料附實際來源與適用尺度，現場未知的數值記為模型假設。

## 全域草毯驗收

使用者於 2026-11-21 確認全圖採同一品質標準。現有版本的近景密草圈和圈外平綠地已判定未達標。

- **範圍與密度。** 整張地圖可生長的土面都要有連續底層草毯。以核准的完整 1 m² 高模及其 **79,524 葉／m²** 為標準。以沿地表量得的實際面積計算，任選完整落在草地內的 1 m² 都應呈現同級的草量與厚度，包含跨地形格線或載入區塊的樣區。草花按各自品種疊在底層草毯上。
- **近看與遠看。** 在地圖各處貼近觀察應看到原模的細葉輪廓、彎曲、綠色及扎在土面的草根。從腳邊到遠坡都應看得出同一片高密度草毯的厚度、覆蓋感和風吹起伏。近景成圈、遠處變成平綠地、接縫露出稀草或移動時密度跳變，任何一項都判定未達標。
- **驗收畫面。** 用一般遊戲入口比對核准高模和實拍。取相隔的河谷、坡地和高地草區，各拍貼地、站姿及抬升。保存地點、相機高度、畫質、曝光、光照和風設置。同一場景再以錄影或連續畫格跨過細節切換和載入邊界。密度抽樣列出同一批實際 1 m² 區域的葉數與範圍。
- **效能與判定。** 先用畫面對照確認全視野的草地品質，再量測最佳化的影響。視野外可以裁切或動態載入。視野內的細節切換必須以相同鏡頭證明仍維持核准的草毯外觀。單塊展示及標稱密度各自用於檢查資產及參數。全域結果依實際遊戲畫面與使用者驗收判定，手機幀時間另記。

[核准的 1 m² 原模與遊戲對照](g2.1-real-turf-field.md#原模直接繪製) · [視覺審查流程](../process/visual-review.md#worldwide-turf-acceptance)

## 全域草毯試玩

以 `?sward=world&cam=6&q=med` 進入試玩。`?sward=baseline` 回到現行草地，`?sward=0` 使用舊程序草。`?sod=full` 查看完整母版。

- `turfSite=slope|lowland|highland|seam` 固定驗收地點，世界座標依序為 (20, −40)、(684, 444)、(−660, 492)、(0, −40)。最後一點位於輸入地形的磁磚縫。`turfView=close|standing|raised` 指定離地 0.16、1.2、7.2 m 的角度。`turfReference=1` 在 4 × 4 m 的展示範圍內繪製全部原模草葉，保留原始根位排列及分簇，逐葉貼地。普通試玩可用 `walk=1` 沿測試路線移動或在 6 號鏡頭拖曳。
- `Graphics` 可選 Auto、Low、Medium、High 及自動或固定 100% 渲染比例。套用會在目前場景網址重載。開始畫面的進度由裝置偵測、已驗證的 16 塊地形、場景、暖機和首張可用畫面推進。
- 母版打包全部 8,836 簇，各含九葉。葉片拓撲維持 22 個三角形，位置以約 4.9 μm 量化，法線和葉色也使用量化格式。連續世界座標讓相鄰的根取用母版相鄰的葉形及色彩，保留這些細節在母版上的局部關聯。根位遵循真實坡面，幾何與材質共用植被格線遮罩。
- 近處至站姿腳邊使用全密度、完整拓撲，依草簇的螢幕投影漸退，葉片保持高度。過渡以世界座標雜湊做覆蓋率，在真機移動中仍需檢查閃爍。遠景由母版三角形烘出三層的投影葉面積與葉色，在地形材質沿視線積分並隨風位移。Low 使用這套草層。試玩版的幾何投影距離參數暫限 2.35–3.0 m，半徑外的表面效果仍需驗收。
- WebGPU 用 TSL 收集可見實例並間接繪製。WebGL2 用 CPU 篩選同一份世界座標資料。`turfStats=1` 開啟 GPU 間接計數非同步採樣與 16 m 網格的遠景視錐面積估算。面積包含可能被近處地形遮擋的地面。效能測試移除診斷參數，整幀時間以 JSON 的 frame intervals 為準。

以現有完整母版重建兩個資產並擷取試玩前後對照。

```sh
python3 tools/bake-world-turf.py assets/grass/sod-full.bin assets/grass
npm run build
npm run preview -- --port 4174
# 在另一個終端機
node tools/turf-capture.mjs out/turf webgl2 slope lowland highland
```

所有場景的畫質與手機 WebGPU 效能仍依全域驗收標準確認。

![試玩密度修正後的實拍。左為 4 × 4 m 原模對照，右為全域試玩。由上而下為坡地貼地、河谷貼地、河谷站姿、坡地抬升。](s1-world-turf-trial.jpg)

Chromium 156／SwiftShader WebGL2，400 × 225、Medium、固定渲染比例 1.0、13:00 晴天。畫面記錄撤除稀疏草簇後的第一次取樣。貼地可見完整葉形。站姿仍可看出向遠景草層的過渡，抬升仍缺草毯質感，均待驗收。

## 表土與水

- Hellesylt 地表母質採 © Norges geologiske undersøkelse (NGU) 區域鬆散沉積物分類。按 EPSG:25832 裁切為現有地形邊界，重柵格化為 16 m 採樣。NGU 來源尺度為約 1:100,000–1:500,000。cam 1（6.872755° E、62.084569° N）為河流沉積物，cam 2（6.870350° E、62.083365° N）為崩塌堆積；16 m 是遊戲運算格距。六個測試點在 NIBIO 查不到可用的表土或排水資料。[NGU 資料集](https://data.norge.no/en/datasets/4c8bdb99-68e3-317c-922f-a77d1f21e309/losmasser-regionalt) · [NLOD 1.0](https://data.norge.no/nlod/en/1.0) · [NIBIO Kilden](https://kilden.nibio.no/)
- 土面取 Ground103 的實測影像、法線、粗糙度及高度通道。地形以約 1.2 m 尺度取樣，緩變世界座標偏移打散重複。高度影響微表面著色，粗糙度與法線隨濕潤和水膜改變。1.2 m 是視覺校準，掃描為材質類比。濕潤著色採水分增加後逐漸飽和的反射曲線與水膜折射率約 1.33。[Ground103（CC0）](https://ambientcg.com/view?id=Ground103) · [Lobell 與 Asner 的土壤含水量與反射研究](https://doi.org/10.2136/sssaj2002.7220)
- 河谷與沖積地使用 180 mm 砂質壤土及 300 mm 壤質砂；一般坡面和崩塌類使用 80 mm 砂質壤土及 120 mm 壤土。這些為 Rosetta 類別參數和專案假定層厚。水量在表層、下層及表面三者間轉移，包含入滲、向下滲排、蒸發、八鄰域坡面逕流及窪地積水。正常遊戲由 Worker 每秒更新，傳送水分狀態給材質。有根區深度、兩層含水量和水膜厚度可讀。沙岸、岩壁及石造表面沿用各自地形權重。[Rosetta](https://cales.arizona.edu/research/rosetta/rosetta.html) · [內布拉斯加大學草根剖面參考](https://turf.unl.edu/ianr/agronomy-horticulture/turf/sites/unl.edu.ianr.agronomy-horticulture.turf/files/media/file/2018RootzoneOgranicMatterManagement.pdf)

## 現版草根與距離

- 以一平方公尺原模的 79,524 葉為面密度，8,836 簇 × 9 片。穩定的世界座標採樣按地形三角形的實際面積建立冠叢，沒有草皮大小的邊界。每葉以自己的原始根部偏移取地形三角形高度，根部插入 2 mm。使用原模的 16 個冠叢樣本，保留 19 點葉形和線性色，套用現場光色、根部遮蔽與原有風場。草花繼續使用各自的物種。
- Medium／High 得到兩層視錐內原模葉簇。最靠近使用九葉，外層使用較疏的固定選樣。連續草絨使用同一原模投影的葉色、高度與葉向，使用 mip 與粗糙度濾除遠處的次像素高頻。Low 由連續材質呈現覆蓋與風向。邏輯草根密度和一幀提交的葉數是兩個可分開量測的值。
- `?sod=full` 是原始整塊草皮的對照模式。一般草地用 `?cam=2&q=med&walk=1`，`?q=low` 檢查 Low。用 `?cam=1&soil=dry&grass=0` 顯示表土，將 `soil` 換成 `rain`（30 mm/h 兩小時）或 `drained`（接著晴天六小時），可在相同光位檢查濕色；移除 `soil` 參數恢復即時雨水。

## 貼地驗收

按工具列的 **6 Grass**、鍵盤 `6`，或開啟 `?cam=6&q=med`，從離地 16 cm 查看 cam 2 腳下同一片即時草地。鏡頭朝地表下看，近裁切面縮至 3.5 cm。Medium 可看原模葉片，Low 可用同鏡頭檢查草絨；按 `2` 回到同地點的站姿。

在 6 號畫面上用滑鼠拖曳或手機單指滑動，可原地水平轉一圈並抬頭、低頭。再按一次 **6 Grass** 恢復起始方向。

![同一斜坡的 Medium 站姿與貼地視角](s1-grass-closeup.jpg)

## 同鏡頭證據

![Medium 站姿、Low 抬升、Medium 近根鏡頭，以及同鏡頭雨前、雨後、排水後裸土](s1-rooted-soil-comparison.jpg)

上排是 cam 2，由左至右為 Medium 站姿、Low 比站姿抬升 6 m、Medium 離地 0.11 m。下排為 cam 1 離地 0.42 m 的同光位裸土，由左至右是雨前、2 小時降雨後、再排水 6 小時。Chromium 156／SwiftShader WebGL2，畫布 960 × 540。另以相同 Medium 貼地場景檢查軟體 WebGPU。裸土相機位置的體積含水量依序為 7.1%、16.7%、15.2%，水膜為 0、0.35、0 mm。

`tests/soil-sod.test.ts` 在合成平面與不同坡度上抽測 256 個實際面積一平方公尺的窗口，包含草地內部的格線交界。以冠叢根位換算為 78,561–80,730 葉，各距目標 1.6% 以內。測試另驗證兩剖面的落雨、入滲、排水與總水量守恆，並驗證原模冠叢及逐葉根偏移的資產格式。

範圍截至連續土面、兩層水量與草根接地。地表水膜是 16 m 水量的光學表現。腳印變形、細小積水輪廓、泥土力學和跨工作階段的水分存檔留待接觸系統。遠景可辨認的葉量與攝影級細節、手機 WebGPU 的幀時間及持續負荷仍需驗收。

## 資產重建

```sh
python3 tools/bake-soil.py Ground103_1K-JPG.zip assets/soil
blender -b /tmp/world-unbound-sod/fescue-sod.blend -t 2 --python-exit-code 1 -P tools/bake-sod.py -- crowns assets/grass/sod-crowns.bin
npm test -- tests/soil-sod.test.ts --reporter=verbose
```

土壤烘焙使用 GDAL 與 Pillow，輸入為 [Ground103 1K-JPG 壓縮檔](https://ambientcg.com/view?id=Ground103)。地質裁切範圍、來源網址、授權及色圖尺度寫在 [assets/soil/sources.json](../../assets/soil/sources.json)。正常啟動地圖從本機建置載入資料。診斷草相機的高度和俯角由固定攝影腳本設定，各水相共用相機、晴天天空、13:00 日照與曝光。
