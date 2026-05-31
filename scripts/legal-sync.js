// Pulls canonical legal content from legal.json so the website and the mobile
// app share one source of truth. The page ships with a baked copy of the same
// text inside .legal-body as a no-JS / offline fallback; on a successful fetch
// this script swaps in the canonical version.
(function () {
  var el = document.querySelector('.legal-body[data-legal-doc]');
  if (!el || typeof fetch !== 'function') return;

  var doc = el.getAttribute('data-legal-doc');
  var src = el.getAttribute('data-legal-src');
  if (!doc || !src) return;

  fetch(src, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) throw new Error('legal.json ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var entry = data && data.documents && data.documents[doc];
      if (entry && typeof entry.bodyHtml === 'string' && entry.bodyHtml.length) {
        el.innerHTML = entry.bodyHtml;
      }
    })
    .catch(function () {
      // Keep the baked fallback already in the page.
    });
})();
