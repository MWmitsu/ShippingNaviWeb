// Google Analytics 4 (gtag.js) 初期化 — CSP対応のため index.html のインラインを外部化
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-QBPFLVM9XP');

// アフィリエイトリンク（楽天カードなど a.pcard）のクリックをGA4で計測
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a.pcard') : null;
  if (!a) return;
  var nameEl = a.querySelector('.pcard__name');
  var name = nameEl ? nameEl.textContent.trim() : (a.getAttribute('href') || '');
  gtag('event', 'affiliate_click', {
    item_name: name,
    link_url: a.getAttribute('href') || '',
    page_path: location.pathname
  });
}, true);
