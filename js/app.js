// app.js — 入力の収集・状態管理・結果描画
import { evaluate, dimSum, takeHome, cheaperAdvice, FEE_LABEL } from './engine.js?v=5';

const METHODS = window.SHIPPING_METHODS || [];
const META = window.SHIPPING_META || {};

const $ = (id) => document.getElementById(id);
const yen = (n) => '¥' + Number(n).toLocaleString('ja-JP');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 方法が属する発送サービスの正式名（らくらく/ゆうゆうメルカリ便・かんたんラクマパック・おてがる配送・自分で発送）
function serviceBrand(m) {
  if ((m.platforms || []).includes('general')) return '自分で発送';
  const p = (m.platforms || [])[0];
  if (p === 'mercari') {
    if (/たのメル便/.test(m.name)) return 'メルカリ便（たのメル便）';
    return /日本郵便/.test(m.carrier || '') ? 'ゆうゆうメルカリ便' : 'らくらくメルカリ便';
  }
  if (p === 'rakuma') return 'かんたんラクマパック';
  if (p === 'yahoo') return 'おてがる配送';
  return '';
}

// 購入が必要な専用資材の名称（materialJpy がある方法）
function materialName(m) {
  const n = m.name || '';
  if (/コンパクト/.test(n)) return '専用BOX';
  if (/プラス/.test(n)) return '専用箱';
  if (/mini|ミニ/.test(n)) return '専用封筒';
  if (/ポスト/.test(n)) return '発送用シール';
  return '専用資材';
}

const PLATFORM_LABEL = { mercari: 'メルカリ', rakuma: 'ラクマ', yahoo: 'Yahoo!フリマ' };
const BEN_LABEL = {
  mercari: 'らくらく / ゆうゆうメルカリ便を使う',
  rakuma: 'かんたんラクマパックを使う',
  yahoo: 'おてがる配送を使う',
};
const STORE_KEY = 'shipping-navi-v1';

const PRESETS = [
  { name: '本・CD', ico: '📗', l: 19, w: 14, h: 1.5, wt: 250 },
  { name: '薄い小物', ico: '🪪', l: 23, w: 12, h: 1, wt: 50 },
  { name: 'Tシャツ', ico: '👕', l: 24, w: 17, h: 2.5, wt: 200 },
  { name: 'アクセサリ', ico: '💍', l: 14, w: 9, h: 2, wt: 60 },
  { name: '化粧品', ico: '💄', l: 20, w: 15, h: 6, wt: 400 },
  { name: '本数冊', ico: '📚', l: 25, w: 18, h: 8, wt: 1200 },
  { name: '靴・箱', ico: '👟', l: 30, w: 20, h: 12, wt: 900 },
  { name: '大きめ箱', ico: '📦', l: 40, w: 30, h: 25, wt: 3000 },
];

const state = {
  platform: 'mercari',
  benEnabled: true,
  needs: { anonymous: false, tracking: false, insurance: false },
  places: { post: false, konbini: false, pickup: false },
  expanded: false,
};

// ---------- 入力収集 ----------
const readDims = () => ({
  l: parseFloat($('d-len').value) || 0,
  w: parseFloat($('d-wid').value) || 0,
  h: parseFloat($('d-hei').value) || 0,
  weightG: parseFloat($('d-wt').value) || 0,
});
const readPrice = () => parseFloat($('d-price').value) || 0;

// ---------- 結果描画パーツ ----------
const badge = (label, on, kind) =>
  on ? `<span class="badge badge--${kind || 'ok'}">✓ ${label}</span>` : `<span class="badge badge--off">– ${label}</span>`;

function howBlock(m) {
  const rows = [];
  if (m.shipFrom) rows.push(['🏪', '出せる場所', m.shipFrom]);
  if (m.shipFlow) rows.push(['📝', '送り方', m.shipFlow]);
  if (m.maxSizeRule) rows.push(['📐', 'サイズ上限', m.maxSizeRule]);
  return `<div class="best__how">${rows.map(([i, l, v]) =>
    `<div class="how__row"><span class="how__ico">${i}</span><span class="how__lbl">${l}</span><span class="how__val">${esc(v)}</span></div>`
  ).join('')}</div>`;
}

function netLine(price, salePrice, platform) {
  if (!(salePrice > 0)) return '';
  const t = takeHome(salePrice, platform, price);
  const neg = t.net < 0 ? ' best__net--neg' : '';
  return `<div class="best__net${neg}">手取り <b>${yen(t.net)}</b><span>（手数料${FEE_LABEL[platform]} −${yen(t.fee)}・利益率${t.ratePct}%）</span></div>`;
}

function bestCard(top, platform, salePrice) {
  const m = top.method;
  const platTag = top.isGeneral ? '自分で発送' : PLATFORM_LABEL[platform];
  const brand = top.isGeneral ? '自分で発送（自分で宛名を書いて発送・匿名配送なし）' : serviceBrand(m);
  const warn = m.notes && /距離|地帯|変動|目安/.test(m.notes)
    ? `<div class="best__warn"><span>⚠️</span><span>${esc(m.notes)}</span></div>` : '';
  const breakdown = top.material > 0
    ? `<div class="best__break"><span class="best__break-tag">専用資材込みの総額</span>送料 ${yen(top.base)} ＋ ${materialName(m)} ${yen(top.material)} ＝ <b>${yen(top.price)}</b></div>`
    : '';
  const totalTag = top.material > 0 ? '<span class="best__totaltag">総額</span>' : '';
  return `
    <div class="best">
      <div class="best__top">
        <span class="best__crown">👑 最安はこれ</span>
        <span class="best__platform">${esc(platTag)}</span>
      </div>
      <div class="best__body">
        <h3 class="best__name">${esc(m.name)} <span class="best__carrier">${esc(m.carrier || '')}</span></h3>
        <div class="best__brand">発送サービス：<b>${esc(brand)}</b></div>
        <div class="best__price"><span class="best__yen">¥</span><span class="best__num">${Number(top.price).toLocaleString('ja-JP')}</span>${totalTag}</div>
        ${breakdown}
        ${netLine(top.price, salePrice, platform)}
        <div class="best__badges">
          ${badge('匿名配送', top.anonymous)}
          ${badge('追跡あり', top.tracking)}
          ${badge('補償あり', top.insurance)}
        </div>
        ${howBlock(m)}
        ${warn}
      </div>
    </div>`;
}

function adviceBlock(advs) {
  if (!advs.length) return '';
  const items = advs.map((a) => {
    const parts = a.viol.map((v) => `${v.k}をあと${v.over}${v.u}`).join('・');
    return `<div class="advice__item">${esc(parts)}減らすと <b>「${esc(a.name)}」${yen(a.total)}</b> が使えます <span class="advice__save">−${yen(a.saving)}</span></div>`;
  }).join('');
  return `<div class="advice"><div class="advice__title">💡 もう少し安くできるかも</div>${items}</div>`;
}

function altRow(item, rank, cheapest, salePrice, platform) {
  const m = item.method;
  const tags = [];
  if (item.anonymous) tags.push('<span class="alt__tag">🙈匿名</span>');
  if (item.tracking) tags.push('<span class="alt__tag">🔎追跡</span>');
  if (item.insurance) tags.push('<span class="alt__tag">🛡️補償</span>');
  if (item.material > 0) tags.push(`<span class="alt__tag alt__tag--mat">＋${materialName(m)}${yen(item.material)}</span>`);
  tags.push(`<span class="alt__tag alt__tag--brand">${esc(serviceBrand(m))}</span>`);
  let sub;
  if (salePrice > 0) {
    const t = takeHome(salePrice, platform, item.price);
    sub = `<span class="alt__delta">手取り${yen(t.net)}</span>`;
  } else {
    const delta = item.price - cheapest;
    sub = `<span class="alt__delta">${delta > 0 ? '+' + yen(delta) : '同額'}</span>`;
  }
  return `
    <div class="alt" data-mid="${esc(m.id)}" tabindex="0" role="button" aria-expanded="false">
      <span class="alt__rank">${rank}</span>
      <div class="alt__main">
        <p class="alt__name">${esc(m.name)}</p>
        <div class="alt__meta">${tags.join('')}</div>
      </div>
      <div>
        <span class="alt__price">${yen(item.price)}</span>
        ${sub}
      </div>
    </div>
    <div class="detail hidden" data-detail="${esc(m.id)}">
      <div class="detail__grid">
        ${item.material > 0 ? `<span class="detail__k">料金内訳</span><span class="detail__v">送料${yen(item.base)}＋${materialName(m)}${yen(item.material)}＝<b>${yen(item.price)}</b>（総額）</span>` : ''}
        ${m.carrier ? `<span class="detail__k">配送業者</span><span class="detail__v">${esc(m.carrier)}</span>` : ''}
        ${m.shipFrom ? `<span class="detail__k">出せる場所</span><span class="detail__v">${esc(m.shipFrom)}</span>` : ''}
        ${m.shipFlow ? `<span class="detail__k">送り方</span><span class="detail__v">${esc(m.shipFlow)}</span>` : ''}
        ${m.maxSizeRule ? `<span class="detail__k">サイズ上限</span><span class="detail__v">${esc(m.maxSizeRule)}</span>` : ''}
        ${m.insurance ? `<span class="detail__k">補償</span><span class="detail__v">${esc(m.insurance)}</span>` : ''}
        ${m.notes ? `<span class="detail__k">メモ</span><span class="detail__v">${esc(m.notes)}</span>` : ''}
      </div>
    </div>`;
}

// ---------- 直近の結果（コピー用） ----------
let lastBest = null;

function render() {
  const box = $('results');
  const dims = readDims();
  const salePrice = readPrice();
  const opts = { platform: state.platform, benEnabled: state.benEnabled, needs: state.needs, places: state.places, ...dims };
  const res = evaluate(METHODS, opts);

  const sum = dimSum(dims.l, dims.w, dims.h);
  $('dims-sum').textContent = sum > 0
    ? `3辺合計：${Math.round(sum * 10) / 10} cm${dims.weightG ? '　／ 重さ ' + dims.weightG + ' g' : ''}`
    : '3辺合計：— cm';

  saveState();
  lastBest = null;
  $('toolbar').classList.add('hidden');

  if (!res.hasInput) {
    box.innerHTML = `<div class="empty"><span class="empty__ico">📦</span><span class="empty__txt">荷物の<b>サイズ（cm）と重さ（g）</b>を入力すると、<br>一番安い送り方をすぐに表示します。</span></div>`;
    return;
  }
  if (!res.ok.length) {
    box.innerHTML = `<div class="noresult"><h3 class="noresult__title">😵 条件に合う方法がありません</h3><p class="noresult__txt">サイズ・重さが上限を超えているか、必要な条件（匿名／追跡／補償／出せる場所）を満たす方法がないようです。条件をゆるめるか、サイズをご確認ください。</p></div>`;
    return;
  }

  const top = res.ok[0];
  lastBest = { top, salePrice, platform: state.platform };
  const cheapest = top.price;
  const rest = res.ok.slice(1);
  const shown = state.expanded ? rest : rest.slice(0, 4);
  const advs = cheaperAdvice(METHODS, opts, cheapest);

  let html = bestCard(top, state.platform, salePrice);
  html += adviceBlock(advs);

  if (rest.length) {
    const anyMat = res.ok.some((x) => x.material > 0);
    html += `<div class="alts"><div class="alts__head"><span>ほかの方法（安い順）</span><span>${rest.length}件</span></div>`;
    if (anyMat) html += `<div class="alts__note">💡 金額は<b>専用箱・封筒・シール代を含む総額</b>です（安い順）</div>`;
    html += shown.map((it, i) => altRow(it, i + 2, cheapest, salePrice, state.platform)).join('');
    if (rest.length > 4) {
      html += `<button class="showall" id="toggle-all">${state.expanded ? '▲ 上位だけ表示' : `▼ 残り${rest.length - 4}件をすべて見る`}</button>`;
    }
    html += `</div>`;
  }
  box.innerHTML = html;
  $('toolbar').classList.remove('hidden');

  const t = $('toggle-all');
  if (t) t.addEventListener('click', () => { state.expanded = !state.expanded; render(); });

  box.querySelectorAll('.alt').forEach((row) => {
    const open = () => {
      const id = row.getAttribute('data-mid');
      const d = box.querySelector(`[data-detail="${CSS.escape(id)}"]`);
      if (!d) return;
      const willShow = d.classList.contains('hidden');
      d.classList.toggle('hidden');
      row.setAttribute('aria-expanded', String(willShow));
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

// ---------- 共有・コピー ----------
function buildShareUrl() {
  const d = readDims();
  const s = {
    p: state.platform, b: state.benEnabled ? 1 : 0,
    l: d.l, w: d.w, h: d.h, wt: d.weightG, pr: readPrice(),
    n: [state.needs.anonymous ? 1 : 0, state.needs.tracking ? 1 : 0, state.needs.insurance ? 1 : 0],
    pl: [state.places.post ? 1 : 0, state.places.konbini ? 1 : 0, state.places.pickup ? 1 : 0],
  };
  return location.origin + location.pathname + '#d=' + encodeURIComponent(JSON.stringify(s));
}

function resultText() {
  if (!lastBest) return '';
  const { top, salePrice, platform } = lastBest;
  const d = readDims();
  const m = top.method;
  const lines = [
    `【フリマ発送ナビ】${PLATFORM_LABEL[platform]}`,
    `荷物：${d.l}×${d.w}×${d.h}cm ${d.weightG}g`,
    `発送サービス：${serviceBrand(m)}`,
    `最安：${m.name}（${m.carrier}）${yen(top.price)}${top.material > 0 ? `（送料${yen(top.base)}＋${materialName(m)}${yen(top.material)}＝総額）` : ''}`,
    `匿名${top.anonymous ? '◯' : '×'} 追跡${top.tracking ? '◯' : '×'} 補償${top.insurance ? '◯' : '×'}`,
    `出せる場所：${m.shipFrom || '—'}`,
  ];
  if (salePrice > 0) {
    const t = takeHome(salePrice, platform, top.price);
    lines.push(`販売${yen(salePrice)}→手取り${yen(t.net)}（手数料${FEE_LABEL[platform]}・利益率${t.ratePct}%）`);
  }
  return lines.join('\n');
}

function flash(btn, msg) {
  const old = btn.innerHTML;
  btn.innerHTML = `<span class="tool__ico">✅</span>${msg}`;
  btn.classList.add('tool--done');
  setTimeout(() => { btn.innerHTML = old; btn.classList.remove('tool--done'); }, 1400);
}

async function copyText(text, btn, msg) {
  try {
    await navigator.clipboard.writeText(text);
    flash(btn, msg);
  } catch {
    // フォールバック
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); flash(btn, msg); } catch { alert(text); }
    ta.remove();
  }
}

// ---------- 状態の保存・復元 ----------
function saveState() {
  const d = readDims();
  const s = { platform: state.platform, ben: state.benEnabled, l: d.l, w: d.w, h: d.h, wt: d.weightG, pr: readPrice(), needs: state.needs, places: state.places };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
}

function applyState(s) {
  if (!s) return;
  const plat = s.platform || s.p;                 // localStorageは platform / 共有は p
  if (plat && PLATFORM_LABEL[plat]) setPlatform(plat);
  if (s.ben != null || s.b != null) {
    state.benEnabled = (s.ben != null) ? !!s.ben : !!s.b;
    $('ben-enabled').checked = state.benEnabled;
  }
  const setv = (id, v) => { if (v != null && v !== 0) $(id).value = v; };
  setv('d-len', s.l); setv('d-wid', s.w); setv('d-hei', s.h); setv('d-wt', s.wt); setv('d-price', s.pr);
  const needs = s.needs || (s.n ? { anonymous: !!s.n[0], tracking: !!s.n[1], insurance: !!s.n[2] } : null);
  if (needs) { state.needs = needs; syncChips('needs', 'need', state.needs); }
  const places = s.places || (s.pl ? { post: !!s.pl[0], konbini: !!s.pl[1], pickup: !!s.pl[2] } : null);
  if (places) { state.places = places; syncChips('places', 'place', state.places); }
}

function syncChips(boxId, attr, obj) {
  [...$(boxId).children].forEach((b) => {
    const k = b.dataset[attr];
    b.setAttribute('aria-pressed', String(!!obj[k]));
  });
}

function loadInitial() {
  // 共有リンク優先 → なければ localStorage
  const m = location.hash.match(/[#&]d=([^&]+)/);
  if (m) {
    try { applyState(JSON.parse(decodeURIComponent(m[1]))); history.replaceState(null, '', location.pathname); return; } catch {}
  }
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) applyState(JSON.parse(raw)); } catch {}
}

// ---------- イベント配線 ----------
function setPlatform(p) {
  state.platform = p;
  [...$('platform').children].forEach((b) => {
    const on = b.dataset.platform === p;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $('ben-label').textContent = BEN_LABEL[p];
}

function init() {
  $('ben-label').textContent = BEN_LABEL[state.platform];

  $('platform').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg'); if (!btn) return;
    setPlatform(btn.dataset.platform); render();
  });
  $('ben-enabled').addEventListener('change', (e) => { state.benEnabled = e.target.checked; render(); });
  $('needs').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip'); if (!btn) return;
    const k = btn.dataset.need; state.needs[k] = !state.needs[k];
    btn.setAttribute('aria-pressed', String(state.needs[k])); render();
  });
  $('places').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip'); if (!btn) return;
    const k = btn.dataset.place; state.places[k] = !state.places[k];
    btn.setAttribute('aria-pressed', String(state.places[k])); render();
  });
  ['d-len', 'd-wid', 'd-hei', 'd-wt', 'd-price'].forEach((id) => $(id).addEventListener('input', render));

  // プリセット
  const pbox = $('presets');
  pbox.innerHTML = PRESETS.map((p, i) =>
    `<button class="preset" data-i="${i}"><span class="preset__ico">${p.ico}</span>${p.name}</button>`
  ).join('');
  pbox.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset'); if (!btn) return;
    const p = PRESETS[+btn.dataset.i];
    $('d-len').value = p.l; $('d-wid').value = p.w; $('d-hei').value = p.h; $('d-wt').value = p.wt;
    render();
  });

  // 共有
  $('share-link').addEventListener('click', (e) => copyText(buildShareUrl(), e.currentTarget, '共有リンクをコピーしました'));
  $('copy-result').addEventListener('click', (e) => copyText(resultText(), e.currentTarget, '結果をコピーしました'));

  // フッター
  if (Array.isArray(META.remainingUncertainties) && META.remainingUncertainties.length) {
    $('foot-note').textContent = '金額は専用箱・封筒・シール代を含む総額です。料金は目安です（' + META.remainingUncertainties[0] + '）。最新は各サービスの公式情報をご確認ください。';
  }
  if (META.updatedAt) $('foot-src').textContent = '料金データ：' + META.updatedAt + ' 時点';

  loadInitial();
  render();
}

document.addEventListener('DOMContentLoaded', init);
