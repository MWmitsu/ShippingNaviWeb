// engine.js — 最安発送の判定ロジック（純粋関数）。
// データは window.SHIPPING_METHODS（配列）/ window.SHIPPING_META を参照。
// method の形:
// {
//   id, name, carrier, platforms:["mercari"|"rakuma"|"yahoo"|"general"...],
//   shipFrom, shipFlow, maxSizeRule, notes,
//   maxSumCm, maxLongCm, maxWidthCm, maxThicknessCm, maxWeightG,  // 機械判定用（無ければ無制限扱い）
//   priceJpy,            // 一律料金。null ならサイズ別。
//   sizeTable:[{sizeLabel, maxSumCm, maxWeightKg, priceJpy}],     // 段階料金
//   anonymous:bool, tracking:bool, insurance:"あり(上限〜)"|"なし",
//   ben:bool           // フリマ専用便か（true なら専用便オフ時に除外）
// }

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

// 3辺を降順に。長辺・中辺・短辺。
export function sortedDims(l, w, h) {
  return [num(l) || 0, num(w) || 0, num(h) || 0].sort((a, b) => b - a);
}

export function dimSum(l, w, h) {
  return (num(l) || 0) + (num(w) || 0) + (num(h) || 0);
}

// その method に荷物が物理的に収まるか
export function fits(method, dims, weightG) {
  const [lng, mid, sht] = dims;          // 長辺 / 中辺 / 短辺(=厚さ)
  const sum = lng + mid + sht;
  if (num(method.maxWeightG) != null && (weightG || 0) > method.maxWeightG) return false;
  if (num(method.maxSumCm) != null && sum > method.maxSumCm + 1e-6) return false;
  if (num(method.maxLongCm) != null && lng > method.maxLongCm + 1e-6) return false;
  if (num(method.maxWidthCm) != null && mid > method.maxWidthCm + 1e-6) return false;
  if (num(method.maxThicknessCm) != null && sht > method.maxThicknessCm + 1e-6) return false;
  return true;
}

// その method の料金（円）。サイズ別なら適合する最安段を選ぶ。収まらなければ null。
export function priceOf(method, dims, weightG) {
  const [lng, mid, sht] = dims;
  const sum = lng + mid + sht;
  if (num(method.priceJpy) != null) return method.priceJpy;
  if (Array.isArray(method.sizeTable) && method.sizeTable.length) {
    let best = null;
    for (const row of method.sizeTable) {
      if (num(row.maxSumCm) != null && sum > row.maxSumCm + 1e-6) continue;
      if (num(row.maxWeightKg) != null && (weightG || 0) > row.maxWeightKg * 1000 + 1e-6) continue;
      if (num(row.maxLongCm) != null && lng > row.maxLongCm + 1e-6) continue;
      if (best == null || row.priceJpy < best) best = row.priceJpy;
    }
    return best;
  }
  return null;
}

const has = (v) => v != null && String(v).trim() !== '' && !/^なし$/.test(String(v).trim());

// 補償が「あり」と言えるか
export function hasInsurance(method) {
  return has(method.insurance);
}

// 各サービスの販売手数料率（手取り計算用）
export const FEE_RATE = { mercari: 0.10, rakuma: 0.045, yahoo: 0.05 };
export const FEE_LABEL = { mercari: '10%', rakuma: '4.5%', yahoo: '5%' };

// shipFrom/shipFlow のテキストから「出せる場所」を判定
export function placeFlags(m) {
  const s = (m.shipFrom || '') + ' / ' + (m.shipFlow || '');
  const post = /(郵便ポスト|ポストに投函|ポスト投函)/.test(s) && !/投函不可|ポスト.{0,4}不可/.test(s);
  const konbini = /(コンビニ|ローソン|セブン|ファミマ|ファミリーマート|ミニストップ)/.test(s);
  const pickup = /集荷/.test(s) && !/集荷.{0,4}(不可|対象外|非対応)/.test(s);
  return { post, konbini, pickup };
}

// 手取り計算: 販売価格 - 手数料 - 送料(実質総額)
export function takeHome(salePrice, platform, shipping) {
  const rate = FEE_RATE[platform] || 0;
  const fee = Math.round((salePrice || 0) * rate);
  const net = (salePrice || 0) - fee - (shipping || 0);
  const ratePct = salePrice > 0 ? Math.round((net / salePrice) * 100) : null;
  return { fee, net, ratePct };
}

// 候補を評価して並べる。
// opts: { platform, benEnabled, needs:{anonymous,tracking,insurance}, dims:{l,w,h}, weightG }
// 戻り: { ok:[{method, price, ...}], dropped:[...], hasInput:bool }
export function evaluate(methods, opts) {
  const { platform, benEnabled = true, needs = {}, places = {}, l, w, h, weightG } = opts;
  const dims = sortedDims(l, w, h);
  const sum = dims[0] + dims[1] + dims[2];
  const hasSize = sum > 0;
  const hasWeight = (weightG || 0) > 0;
  const placeOn = places.post || places.konbini || places.pickup;

  const out = [];
  for (const m of methods) {
    // プラットフォーム：選択中サービスの便 or 一般発送（自分で発送）
    const isGeneral = (m.platforms || []).includes('general');
    const onPlatform = (m.platforms || []).includes(platform);
    if (!isGeneral && !onPlatform) continue;

    // 専用便オフなら ben 便を除外
    if (m.ben && !benEnabled) continue;

    // 必須条件
    if (needs.anonymous && !m.anonymous) continue;
    if (needs.tracking && !m.tracking) continue;
    if (needs.insurance && !hasInsurance(m)) continue;

    // 出せる場所フィルタ
    const pf = placeFlags(m);
    if (placeOn) {
      if (places.post && !pf.post) continue;
      if (places.konbini && !pf.konbini) continue;
      if (places.pickup && !pf.pickup) continue;
    }

    // サイズ・重さ判定（入力があるときだけ）
    if (hasSize && !fits(m, dims, weightG || 0)) continue;
    const base = priceOf(m, dims, weightG || 0);
    if (base == null) continue;
    const material = num(m.materialJpy) || 0;   // 専用箱・シール・封筒などの資材代
    const price = base + material;                // 実質総額で比較

    out.push({
      method: m,
      price,
      base,
      material,
      anonymous: !!m.anonymous,
      tracking: !!m.tracking,
      insurance: hasInsurance(m),
      places: pf,
      isGeneral,
    });
  }

  // 価格昇順。同額なら 便(匿名/追跡/補償が強い) を上に。
  out.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    const score = (x) => (x.anonymous ? 2 : 0) + (x.tracking ? 1 : 0) + (x.insurance ? 1 : 0);
    return score(b) - score(a);
  });

  return { ok: out, hasInput: hasSize || hasWeight, dims, sum };
}

const round1 = (x) => Math.round(x * 10) / 10;

// 「あと少し小さく/軽くすれば、もっと安い方法が使える」提案。
// 一律料金の方法だけを対象に、厚さ・重さ・3辺合計などが小幅に超過しているものを探す。
export function cheaperAdvice(methods, opts, bestPrice) {
  const { platform, benEnabled = true, needs = {}, places = {}, l, w, h, weightG } = opts;
  const dims = sortedDims(l, w, h);
  const [lng, mid, sht] = dims;
  const sum = lng + mid + sht;
  const wt = weightG || 0;
  if (!(sum > 0) || bestPrice == null) return [];
  const placeOn = places.post || places.konbini || places.pickup;

  const out = [];
  for (const m of methods) {
    if (num(m.priceJpy) == null) continue;                 // 一律料金のものだけ
    const isGeneral = (m.platforms || []).includes('general');
    const onPlatform = (m.platforms || []).includes(platform);
    if (!isGeneral && !onPlatform) continue;
    if (m.ben && !benEnabled) continue;
    if (needs.anonymous && !m.anonymous) continue;
    if (needs.tracking && !m.tracking) continue;
    if (needs.insurance && !hasInsurance(m)) continue;
    const pf = placeFlags(m);
    if (placeOn) {
      if (places.post && !pf.post) continue;
      if (places.konbini && !pf.konbini) continue;
      if (places.pickup && !pf.pickup) continue;
    }
    const total = m.priceJpy + (num(m.materialJpy) || 0);
    if (total >= bestPrice) continue;                       // 安くなければ提案しない
    if (fits(m, dims, wt)) continue;                        // 既に収まる＝通常の候補なので対象外

    const viol = [];
    if (num(m.maxThicknessCm) != null && sht > m.maxThicknessCm) viol.push({ k: '厚さ', over: round1(sht - m.maxThicknessCm), u: 'cm' });
    if (num(m.maxWeightG) != null && wt > m.maxWeightG) viol.push({ k: '重さ', over: Math.ceil(wt - m.maxWeightG), u: 'g' });
    if (num(m.maxSumCm) != null && sum > m.maxSumCm) viol.push({ k: '3辺合計', over: round1(sum - m.maxSumCm), u: 'cm' });
    if (num(m.maxLongCm) != null && lng > m.maxLongCm) viol.push({ k: '長さ', over: round1(lng - m.maxLongCm), u: 'cm' });
    if (num(m.maxWidthCm) != null && mid > m.maxWidthCm) viol.push({ k: '幅', over: round1(mid - m.maxWidthCm), u: 'cm' });
    if (!viol.length || viol.length > 2) continue;          // 違反なし or 3つ以上は対象外
    const small = viol.every((v) => (v.k === '重さ' ? v.over <= 300 : v.over <= 2));
    if (!small) continue;

    out.push({ name: m.name, isGeneral, total, saving: bestPrice - total, viol });
  }
  out.sort((a, b) => b.saving - a.saving);
  // 同名の重複を除き上位2件
  const seen = new Set();
  return out.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true))).slice(0, 2);
}
