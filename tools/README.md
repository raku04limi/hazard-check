# 自治体ハザードマップの取り込み手順（開発者用）

アプリ本体には PDF を取り込む機能はなく、ここにある手順で解析したデータ（`data/`）を読み込みます。

1. PDF を 160.6dpi で画像化（`pdftoppm -r 160.6 -png`）し、作業フォルダの `pages/<page>.png` に置く
2. 区の設定 JSON（例：`ward_midori.json`）に、ページ・地図枠（範囲ポリゴン、% 座標）・縮尺・凡例を書く
3. `mosaic.py` で対象地域の地理院地図（標準地図 z16）を取得
4. `georef.py`（縮尺から地理院地図と粗く照合）→ `refine2.py`（小区画ごとの照合で精密化）。
   粗い照合に失敗した地図は `chain.py <対象> <位置合わせ済みの地図>` で同じ背景地図どうしを照合してから `refine2.py`
5. 凡例の色は PDF の凡例から読み取り（`legends_nagoya.json`）、地図内の実際の色とずれる場合は補正
6. `build_data.py <作業フォルダ> <区の設定JSON> data` でタイル画像と `data/index.json` を出力

位置の精度は地理院地図との照合残差で 1〜2m 程度（`data/index.json` の `accuracy_m`）。
