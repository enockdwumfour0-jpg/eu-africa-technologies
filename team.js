/* Builds the "Our team" cards from the team_members table, so people can be added, hidden or deleted from the
   admin dashboard. The cards already in the page are the fallback: if the database cannot be reached they stay as they are.
   Containers are hidden while loading so a removed person never flashes up before the list arrives. */
(function () {
  var S = (window.SITE || {}).supabase || {};
  var boxes = document.querySelectorAll('[data-team]');
  if (!boxes.length || !S.url || !window.fetch) return;

  var PHOTO_OK = new RegExp('^(img/team-[a-z0-9-]+\\.jpg|' + S.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/storage/v1/object/public/gallery/team/[A-Za-z0-9._-]+)$');
  function reveal() { for (var i = 0; i < boxes.length; i++) boxes[i].classList.remove('team-wait'); }
  for (var i = 0; i < boxes.length; i++) boxes[i].classList.add('team-wait');
  var timer = setTimeout(reveal, 3000); // never leave the page blank if the request hangs

  function initials(n) { return n.split(/\s+/).filter(Boolean).slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?'; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function card(m, large) {
    var c = el('div', large ? 'card team' : 'crew-card');
    if (m.photo_url && PHOTO_OK.test(m.photo_url)) {
      var img = el('img', large ? 'team-photo' : '');
      img.src = m.photo_url; img.alt = m.name + (m.title ? ', ' + m.title : '');
      img.width = large ? 640 : 240; img.height = large ? 800 : 240; img.loading = 'lazy';
      c.appendChild(img);
    } else {
      var ph = el('div', 'ph', initials(m.name)); ph.setAttribute('aria-hidden', 'true'); c.appendChild(ph);
    }
    c.appendChild(el('h3', '', m.name));
    if (m.title) c.appendChild(el('p', '', m.title));
    return c;
  }

  fetch(S.url + '/rest/v1/team_members?select=name,title,section,photo_url&published=eq.true&order=sort_order.asc', { headers: { apikey: S.key, Authorization: 'Bearer ' + S.key } })
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (rows) {
      if (!Array.isArray(rows)) throw new Error('bad response');
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i], key = box.getAttribute('data-team'), large = key === 'leadership';
        var list = rows.filter(function (m) { return m.section === key; });
        box.textContent = '';
        list.forEach(function (m) { box.appendChild(card(m, large)); });
        // nothing left in this group: hide its whole section (heading included)
        var sec = box.closest('section'); if (sec) sec.hidden = list.length === 0;
      }
    })
    .catch(function () { /* keep the built-in cards */ })
    .then(function () { clearTimeout(timer); reveal(); });
})();
