/* Applies admin-edited text to elements marked data-cms="key". The text already in the page is the default,
   so the site still reads correctly if this script or the database is unavailable. Text only (no HTML). */
(function () {
  var S = (window.SITE || {}).supabase || {}, KEY = 'eatl_cms_v1';
  var nodes = document.querySelectorAll('[data-cms]'), imgs = document.querySelectorAll('[data-cms-img]');
  if ((!nodes.length && !imgs.length) || !S.url) return;
  function apply(map) {
    for (var j = 0; j < imgs.length; j++) {
      var u = map[imgs[j].getAttribute('data-cms-img')];
      if (typeof u === 'string' && u.indexOf(S.url + '/storage/v1/object/public/gallery/site/') === 0 && imgs[j].getAttribute('src') !== u) { imgs[j].removeAttribute('srcset'); imgs[j].src = u; }
    }
    for (var i = 0; i < nodes.length; i++) {
      var v = map[nodes[i].getAttribute('data-cms')];
      if (typeof v === 'string' && v.length && nodes[i].textContent !== v) nodes[i].textContent = v;
    }
  }
  var path = (location.pathname.replace(/\/+$/, '').split('/').pop() || 'index').replace(/\.html$/, '');
  var page = path === 'index' ? 'home' : path;
  try { var c = JSON.parse(localStorage.getItem(KEY + ':' + page) || 'null'); if (c) apply(c); } catch (e) {}
  fetch(S.url + '/rest/v1/site_content?select=key,value&page=eq.' + encodeURIComponent(page), { headers: { apikey: S.key, Authorization: 'Bearer ' + S.key } })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      var m = {}; rows.forEach(function (x) { m[x.key] = x.value; });
      apply(m); try { localStorage.setItem(KEY + ':' + page, JSON.stringify(m)); } catch (e) {}
    }).catch(function () {});
})();
