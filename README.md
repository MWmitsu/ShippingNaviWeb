# フリマ発送ナビ

メルカリ・ラクマ・Yahoo!フリマの発送で、**サイズと重さから一番安い送り方と発送手順**がすぐ分かるWebアプリ。

🔗 公開URL: **https://mwmitsu.github.io/ShippingNaviWeb/**

- フリマ専用便（らくらく／ゆうゆうメルカリ便・かんたんラクマパック・おてがる配送）と、自分で発送する一般的な方法（クリックポスト・定形外・レターパック等）を**横断で比較**して最安を提示。
- **専用箱・シール・封筒などの資材代を含めた実質総額**で比較。
- **匿名配送／追跡／補償**の必要条件、**出せる場所（ポスト投函／コンビニ／集荷）**で絞り込み。
- **手取り計算**（販売価格→販売手数料＋送料を引いた手取り・利益率）。
- **「あと少しで安く」提案**（厚さ・重さを少し減らすともっと安い方法が使えると提示）。
- 結果の**共有リンク／コピー**、入力の**記憶**（localStorage）。
- 出せる場所・送り方の手順つき。レスポンシブ＋ダークモード＋PWA対応。

## 使い方（ローカル）

```powershell
./serve.ps1          # http://localhost:8240/
```

`.claude/launch.json` に `shipping`(8240) を登録済み。プレビューは preview_start で起動。

## 構成（ビルドレス静的・Node不要）

```
index.html
css/styles.css
js/app.js          … 入力収集・状態管理・結果描画
js/engine.js       … 最安判定の純粋関数（サイズ/重さ適合・料金・絞り込み・並べ替え）
js/data/methods.js … 配送方法データ（料金・サイズ・属性）
manifest.webmanifest, sw.js, icons/, .nojekyll
```

データ駆動。`js/data/methods.js` の `SHIPPING_METHODS` を更新すれば料金改定に追従できる。

### 配送方法データの形

```js
{
  id, name, carrier, platforms:["mercari"|"rakuma"|"yahoo"|"general"],
  shipFrom, shipFlow, maxSizeRule, notes,
  maxSumCm, maxLongCm, maxWidthCm, maxThicknessCm, maxWeightG, // 機械判定用
  priceJpy,            // 一律料金（サイズ別なら null）
  sizeTable:[{sizeLabel, maxSumCm, maxWeightKg, priceJpy}],    // 段階料金
  anonymous, tracking, insurance, ben                          // ben=フリマ専用便
}
```

## 注意

料金は目安です。郵便料金やフリマ各社の送料は改定されることがあるため、最新は各サービスの公式情報をご確認ください。一般の宅配便（窓口のゆうパック・宅急便）は配送距離で料金が変わります。

## 公開

GitHub Pages で公開済み：**https://mwmitsu.github.io/ShippingNaviWeb/**（repo `MWmitsu/ShippingNaviWeb`・main/root・`.nojekyll` 同梱）。
更新は `git push` ＋ アセットの `?v=N` と `sw.js` の `CACHE` 名を上げる（現在 v2）。
