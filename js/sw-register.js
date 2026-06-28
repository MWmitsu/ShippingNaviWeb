// Service Worker 登録（CSPでインラインscriptを禁止するため外部ファイル化）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
