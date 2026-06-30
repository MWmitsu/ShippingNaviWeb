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
  // 専用容器が複数形状（例:宅急便コンパクトの薄型/通常BOX）なら、いずれかに収まること
  if (Array.isArray(method.boxes) && method.boxes.length) {
    const ok = method.boxes.some((b) => {
      const bd = [b.l, b.w, b.t].sort((a, c) => c - a);
      return lng <= bd[0] + 1e-6 && mid <= bd[1] + 1e-6 && sht <= bd[2] + 1e-6;
    });
    if (!ok) return false;
  }
  if (num(method.maxSumCm) != null && sum > method.maxSumCm + 1e-6) return false;
  if (num(method.maxLongCm) != null && lng > method.maxLongCm + 1e-6) return false;
  if (num(method.maxWidthCm) != null && mid > method.maxWidthCm + 1e-6) return false;
  if (num(method.maxThicknessCm) != null && sht > method.maxThicknessCm + 1e-6) return false;
  // 最小サイズ（小さすぎる荷物は規格外・差出不可、または用途が大型専用）
  if (num(method.minLongCm) != null && lng < method.minLongCm - 1e-6) return false;
  if (num(method.minWidthCm) != null && mid < method.minWidthCm - 1e-6) return false;
  if (num(method.minSumCm) != null && sum < method.minSumCm - 1e-6) return false;
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

// shipFrom（差出場所）のテキストから「出せる場所」を判定。
// 注意: shipFlow（配達工程の「ポスト投函で配達」等）は差出ではないので使わない。
export function placeFlags(m) {
  const s = (m.shipFrom || '');
  const post = /(郵便ポスト|ポストに投函|ポスト投函)/.test(s) && !/投函不可|ポスト.{0,4}不可/.test(s);
  const konbini = /(コンビニ|ローソン|セブン|ファミマ|ファミリーマート|ミニストップ)/.test(s);
  const pickup = /集荷/.test(s) && !/集荷.{0,4}(不可|対象外|非対応)/.test(s);
  // 出せるコンビニ・チェーン: ヤマト系=セブン/ファミマ、日本郵便系=ローソン（テキストの明記も尊重）
  const stores = {};
  if (konbini) {
    const carrier = m.carrier || '';
    if (/ヤマト/.test(carrier)) { stores.seven = true; stores.familymart = true; }
    else if (/日本郵便/.test(carrier)) { stores.lawson = true; }
    if (/ローソン/.test(s)) stores.lawson = true;
    if (/セブン/.test(s)) stores.seven = true;
    if (/ファミマ|ファミリーマート/.test(s)) stores.familymart = true;
    if (/ミニストップ/.test(s)) stores.ministop = true;
  }
  return { post, konbini, pickup, stores };
}

// 補償額を比較用の数値に（円）。同額ソートのタイブレークに使う。
export function insuranceValue(m) {
  if (!hasInsurance(m)) return 0;
  const s = String(m.insurance);
  const man = s.match(/([\d,]+)\s*万円/);
  if (man) return parseInt(man[1].replace(/,/g, ''), 10) * 10000;
  const en = s.match(/([\d,]+)\s*円/);
  if (en) return parseInt(en[1].replace(/,/g, ''), 10);
  if (/取引金額/.test(s)) return 50000; // メルカリ便: 取引金額が上限（固定額非開示）→中位として扱う
  return 1;
}

// サイズ以外（プラットフォーム/専用便/必須条件/内容物/最低販売価格）を満たすか
function passesNonSize(m, opts) {
  const { platform, benEnabled = true, needs = {}, content = 'goods', salePrice = 0 } = opts;
  const isGeneral = (m.platforms || []).includes('general');
  if (!isGeneral && !(m.platforms || []).includes(platform)) return false;
  if (m.ben && !benEnabled) return false;
  if (needs.anonymous && !m.anonymous) return false;
  if (needs.tracking && !m.tracking) return false;
  if (needs.insurance && !hasInsurance(m)) return false;
  if (content === 'letter' && !m.letter) return false;
  if (content === 'goods' && m.printedOnly) return false;
  if (salePrice > 0 && num(m.minSalePriceJpy) != null && salePrice < m.minSalePriceJpy) return false;
  return true;
}

// 出せる場所フィルタ（OR）。ポスト投函は投入口サイズ（厚さ・長辺）で判定、コンビニはチェーン指定。
// slotThick/slotLong は投入口の厚さ・長辺の上限（既定=大きめのポスト 厚7cm・長辺40cm）。
function passesPlaces(m, opts, dims) {
  const { places = {}, konbiniStore = 'any', slotThick = 7, slotLong = 40 } = opts;
  if (!(places.post || places.konbini || places.pickup)) return true;
  const lng = dims[0], sht = dims[2];
  const pf = placeFlags(m);
  // ポスト投函: 自分でポストに入れて出せる方式(pf.post) かつ 投入口に収まるサイズ
  const postOk = places.post && pf.post && sht <= slotThick + 1e-6 && lng <= slotLong + 1e-6;
  const konbiniOk = places.konbini && pf.konbini && (konbiniStore === 'any' || !!pf.stores[konbiniStore]);
  const pickupOk = places.pickup && pf.pickup;
  return postOk || konbiniOk || pickupOk;
}

// バッジ用: 自分でポスト投函できる方式か、また指定の投入口サイズに収まるか。
// 自分でポスト投函できない方式（ネコポス等の端末発行系）は null。
export function postFit(m, dims, slotThick, slotLong) {
  if (!placeFlags(m).post) return null;
  const lng = dims[0], sht = dims[2];
  return { fits: sht <= slotThick + 1e-6 && lng <= slotLong + 1e-6 };
}

// 長辺/中辺/厚さ/最小だけの判定（3辺合計・重量・boxesは見ない＝サイズ別提案用）
function fitsShape(method, dims) {
  const [lng, mid, sht] = dims;
  if (num(method.maxLongCm) != null && lng > method.maxLongCm + 1e-6) return false;
  if (num(method.maxWidthCm) != null && mid > method.maxWidthCm + 1e-6) return false;
  if (num(method.maxThicknessCm) != null && sht > method.maxThicknessCm + 1e-6) return false;
  if (num(method.minLongCm) != null && lng < method.minLongCm - 1e-6) return false;
  if (num(method.minWidthCm) != null && mid < method.minWidthCm - 1e-6) return false;
  return true;
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
  const { weightG, l, w, h } = opts;
  const dims = sortedDims(l, w, h);
  const sht = dims[2];
  const sum = dims[0] + dims[1] + dims[2];
  const hasSize = sum > 0;
  const hasWeight = (weightG || 0) > 0;

  const out = [];
  const nonSizeOk = [];   // サイズ以外の条件を満たした方法（候補ゼロ時の診断に使う）
  for (const m of methods) {
    if (!passesNonSize(m, opts)) continue;
    if (!passesPlaces(m, opts, dims)) continue;
    nonSizeOk.push(m);

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
      places: placeFlags(m),
      isGeneral: (m.platforms || []).includes('general'),
    });
  }

  // 価格昇順。同額なら 匿名>追跡>補償の有無、さらに補償額の大きい方を上に。
  out.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    const score = (x) => (x.anonymous ? 2 : 0) + (x.tracking ? 1 : 0) + (x.insurance ? 1 : 0);
    if (score(a) !== score(b)) return score(b) - score(a);
    return insuranceValue(b.method) - insuranceValue(a.method);
  });

  return { ok: out, hasInput: hasSize || hasWeight, dims, sum, nonSizeOk };
}

const round1 = (x) => Math.round(x * 10) / 10;

// 一律料金の方法が小幅超過か（収まらない理由が厚さ・重さ・合計などの僅差か）
function shapeViol(m, dims, wt) {
  const [lng, mid, sht] = dims;
  const sum = lng + mid + sht;
  const viol = [];
  if (num(m.maxThicknessCm) != null && sht > m.maxThicknessCm) viol.push({ k: '厚さ', over: round1(sht - m.maxThicknessCm), u: 'cm' });
  if (num(m.maxWeightG) != null && wt > m.maxWeightG) viol.push({ k: '重さ', over: Math.ceil(wt - m.maxWeightG), u: 'g' });
  if (num(m.maxSumCm) != null && sum > m.maxSumCm) viol.push({ k: '3辺合計', over: round1(sum - m.maxSumCm), u: 'cm' });
  if (num(m.maxLongCm) != null && lng > m.maxLongCm) viol.push({ k: '長さ', over: round1(lng - m.maxLongCm), u: 'cm' });
  if (num(m.maxWidthCm) != null && mid > m.maxWidthCm) viol.push({ k: '幅', over: round1(mid - m.maxWidthCm), u: 'cm' });
  if (!viol.length || viol.length > 2) return null;
  const small = viol.every((v) => (v.k === '重さ' ? v.over <= 300 : v.over <= 2));
  return small ? viol : null;
}

// 「あと少し小さく/軽くすれば、もっと安い方法/サイズが使える」提案。
// 一律料金の方法と、サイズ別料金の「一つ下のサイズ階級」の両方を対象にする。
export function cheaperAdvice(methods, opts, bestPrice) {
  const dims = sortedDims(opts.l, opts.w, opts.h);
  const [lng, mid, sht] = dims;
  const sum = lng + mid + sht;
  const wt = opts.weightG || 0;
  if (!(sum > 0) || bestPrice == null) return [];

  const out = [];
  for (const m of methods) {
    if (!passesNonSize(m, opts)) continue;
    if (!passesPlaces(m, opts, dims)) continue;
    const material = num(m.materialJpy) || 0;

    if (num(m.priceJpy) != null) {
      // 一律料金：小幅超過なら提案
      const total = m.priceJpy + material;
      if (total >= bestPrice) continue;
      if (fits(m, dims, wt)) continue;            // 既に収まる＝通常候補なので対象外
      const viol = shapeViol(m, dims, wt);
      if (!viol) continue;
      out.push({ name: m.name, total, saving: bestPrice - total, viol });
    } else if (Array.isArray(m.sizeTable) && m.sizeTable.length) {
      // サイズ別料金：長辺/幅/厚さ/最小はOKで、3辺合計や重量を小幅に減らせば安い階級に届くか
      if (!fitsShape(m, dims)) continue;
      let bestRow = null;
      for (const row of m.sizeTable) {
        const total = row.priceJpy + material;
        if (total >= bestPrice) continue;
        const sumOver = num(row.maxSumCm) != null ? sum - row.maxSumCm : 0;
        const wtOver = num(row.maxWeightKg) != null ? wt - row.maxWeightKg * 1000 : 0;
        const viol = [];
        if (sumOver > 1e-6) viol.push({ k: '3辺合計', over: round1(sumOver), u: 'cm' });
        if (wtOver > 1e-6) viol.push({ k: '重さ', over: Math.ceil(wtOver), u: 'g' });
        if (!viol.length || viol.length > 2) continue;
        const small = viol.every((v) => (v.k === '重さ' ? v.over <= 300 : v.over <= 6));
        if (!small) continue;
        if (!bestRow || total < bestRow.total) bestRow = { name: `${m.name} ${row.sizeLabel}サイズ`, total, saving: bestPrice - total, viol };
      }
      if (bestRow) out.push(bestRow);
    }
  }
  out.sort((a, b) => b.saving - a.saving);
  const seen = new Set();
  return out.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true))).slice(0, 3);
}

// 候補ゼロのとき、どの寸法/重量が原因かを推定して短いメッセージで返す。
function overage(m, dims, wt) {
  const [lng, mid, sht] = dims;
  const sum = lng + mid + sht;
  const labels = []; let score = 0; let tooSmall = false;
  const over = (val, label, norm) => { if (val > 1e-6) { labels.push(label); score += val / (norm || 1); } };
  if (num(m.maxSumCm) != null) over(sum - m.maxSumCm, `3辺合計を${round1(sum - m.maxSumCm)}cm`, 1);
  if (num(m.maxLongCm) != null) over(lng - m.maxLongCm, `長辺を${round1(lng - m.maxLongCm)}cm`, 1);
  if (num(m.maxWidthCm) != null) over(mid - m.maxWidthCm, `幅を${round1(mid - m.maxWidthCm)}cm`, 1);
  if (num(m.maxThicknessCm) != null) over(sht - m.maxThicknessCm, `厚さを${round1(sht - m.maxThicknessCm)}cm`, 1);
  if (num(m.maxWeightG) != null) over(wt - m.maxWeightG, `重さを${Math.ceil(wt - m.maxWeightG)}g`, 100);
  if (Array.isArray(m.boxes) && m.boxes.length) {
    let bestBox = null;
    for (const b of m.boxes) {
      const bd = [b.l, b.w, b.t].sort((a, c) => c - a);
      const e = Math.max(0, lng - bd[0]) + Math.max(0, mid - bd[1]) + Math.max(0, sht - bd[2]);
      if (bestBox == null || e < bestBox) bestBox = e;
    }
    if (bestBox > 1e-6) { labels.push(`専用BOXに対し計${round1(bestBox)}cm`); score += bestBox; }
  }
  if (num(m.minLongCm) != null && lng < m.minLongCm) { labels.push(`長辺が${round1(m.minLongCm - lng)}cm不足`); score += (m.minLongCm - lng); tooSmall = true; }
  if (num(m.minWidthCm) != null && mid < m.minWidthCm) { labels.push(`幅が${round1(m.minWidthCm - mid)}cm不足`); score += (m.minWidthCm - mid); tooSmall = true; }
  return { labels, score, tooSmall };
}

export function diagnoseNoFit(methods, opts) {
  const dims = sortedDims(opts.l, opts.w, opts.h);
  const sht = dims[2];
  const sum = dims[0] + dims[1] + dims[2];
  const wt = opts.weightG || 0;
  const cand = methods.filter((m) => passesNonSize(m, opts) && passesPlaces(m, opts, dims));
  if (!cand.length) return '選んだ条件（匿名／追跡／補償／出せる場所／内容物／販売価格）に合う方法がありません。条件をゆるめてみてください。';
  if (!(sum > 0)) return null;
  let best = null;
  for (const m of cand) {
    const r = overage(m, dims, wt);
    if (r.labels.length && (best == null || r.score < best.r.score)) best = { m, r };
  }
  if (best) {
    if (best.r.tooSmall) return `小さすぎるようです：${best.r.labels.join('・')}（「${best.m.name}」基準）。`;
    return `あと ${best.r.labels.join('・')} 小さく/軽くできれば「${best.m.name}」が使えます。`;
  }
  return 'サイズ・重さの組み合わせがどの方法の範囲にも収まりません。入力値をご確認ください。';
}
