/* Router, shell and the three views. Hash routing so GitHub Pages needs no
   rewrite rules: #/ , #/c/<community> , #/c/<community>/<year> , #/contribute */

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

const view = { zoom: 'world', custom: null, sel: null, history: [] };

/* Everything the map draws now comes from the database. Loaded once per
   language change and held here; the geometry in map.js is passed this list
   rather than reading a global. */
const STATE = { communities: [], regions: [], loaded: false, error: null };
const findCommunity = id => STATE.communities.find(c => c.id === id);

/* Every view change remembers where it came from, so zooming out walks back the
   way you came in instead of dumping you at the world. */
function setView(next) {
  view.history.push({ zoom: view.zoom, custom: view.custom });
  Object.assign(view, next);
}
function zoomOut() {
  const prev = view.history.pop();
  if (prev) { view.zoom = prev.zoom; view.custom = prev.custom; }
  else { view.zoom = 'world'; view.custom = null; }
}
let resizeTimer = null;

/* ---- shell --------------------------------------------------------------- */

function shell() {
  const langs = LANGS.map(l =>
    `<button class="lang-opt${l.id === LANG ? ' on' : ''}" data-lang="${l.id}">
       <span class="code">${l.label}</span><span class="nm">${esc(l.name)}</span></button>`).join('');

  return `
  <header class="mast">
    <a class="brand" href="#/">
      <img src="tmz-mark.png" alt="Torah MiTzion" width="41" height="38">
      <span class="rule"></span>
      <span class="brand-txt">
        <span class="he">תורה מציון</span>
        <span class="en">${LANG === 'he' ? esc(t('brand.thirty')) : 'Torah MiTzion'}</span>
      </span>
    </a>
    <nav class="nav">
      <a href="#/" data-nav="map">${esc(t('nav.map'))}</a>
      <a href="#/" data-nav="communities">${esc(t('nav.communities'))}</a>
      <a href="#/" data-nav="shlichim">${esc(t('nav.shlichim'))}</a>
      <a href="#/" data-nav="about">${esc(t('nav.about'))}</a>
      <div class="langpick">
        <button class="lang-btn" id="langBtn" aria-haspopup="true" aria-expanded="false">
          ${LANGS.find(l => l.id === LANG).label}
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4l3 3 3-3"/></svg>
        </button>
        <div class="lang-menu" id="langMenu" hidden>${langs}</div>
      </div>
      <a class="btn-gold" href="#/contribute">${esc(t('cta.add'))}</a>
    </nav>
  </header>`;
}

/* The disclaimer belongs to the demo data, not to the site. Leaving it up now
   that the archive holds the real communities would tell every visitor that
   the Rosh Kollel they are reading about is invented. */
function provenance() {
  return t(window.TMZApi && window.TMZApi.DEMO ? 'foot.mock' : 'foot.source');
}

function footer() {
  return `<footer class="foot">
    <span>${esc(provenance())}</span>
    <a href="canvas.html">${esc(t('foot.canvas'))} &rarr;</a>
  </footer>`;
}

function wireShell() {
  const btn = $('#langBtn'), menu = $('#langMenu');
  if (btn) {
    btn.onclick = e => {
      e.stopPropagation();
      const open = !menu.hidden;
      menu.hidden = open;
      btn.setAttribute('aria-expanded', String(!open));
    };
    document.addEventListener('click', () => { if (menu) menu.hidden = true; }, { once: true });
    menu.querySelectorAll('[data-lang]').forEach(b => {
      b.onclick = () => { setLang(b.dataset.lang); reloadForLanguage(); };
    });
  }
}

/* ---- map view ------------------------------------------------------------ */

function mapView() {
  return `
  <div class="map-wrap">
    <div class="stage" id="stage" dir="ltr">
      <div class="ambient" id="ambient"></div>
      <div class="zion-glow" id="zionGlow"></div>
      <svg class="map-svg" id="mapSvg"></svg>
      <div class="markers" id="markers"></div>
    </div>

    <div class="hero" id="hero">
      <div class="hero-l">
        <div class="thirty"><span class="n">30</span><span class="t">${esc(t('u.years'))}<br><span dir="ltr">1996&ndash;2026</span></span></div>
        <span class="vrule"></span>
        <div class="hero-copy">
          <p class="verse">${VERSE}</p>
          <p class="lede">${esc(t('hero.line'))} ${esc(t('hero.sub'))}</p>
        </div>
      </div>
      <div class="hero-stats" id="heroStats"></div>
    </div>

    <aside class="side" id="side"></aside>
    <div class="band" id="band"></div>
  </div>`;
}

/* The stage can still measure zero on the frame right after innerHTML — fonts
   and the banner are yet to settle. Giving up silently there left the map
   blank with no error to find, so wait for a real size instead of racing
   layout. */
function drawMap(attempt = 0) {
  const stage = $('#stage');
  if (!stage) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 40 || H < 40) {
    if (attempt < 30) requestAnimationFrame(() => drawMap(attempt + 1));
    return;
  }

  const proj = projection(W, H);
  const views = buildViews(proj, W, H, STATE.communities, STATE.regions.map(r => r.id));
  /* Fill the chrome BEFORE measuring it: an empty panel measures a few pixels
     tall, and labels then get placed exactly where it is about to appear. */
  drawSide(views);
  drawStats();
  const v = view.zoom === 'custom' && view.custom ? view.custom : (views[view.zoom] || views.world);
  const s = v.s, tx = W / 2 - s * v.cx, ty = H / 2 - s * v.cy;
  const zoomed = s > 1.01;

  const jx = proj.fx(JERUSALEM.lon), jy = proj.fy(JERUSALEM.lat);
  const step = Math.max(7, W / 190);

  let arcs = '', selArc = '';
  const pts = STATE.communities.map(c => {
    const mx = proj.fx(c.lon), my = proj.fy(c.lat);
    const seg = arc(jx, jy, mx, my);
    if (c.id === view.sel) selArc = seg; else arcs += seg;
    return { c, mx, my, x: mx * s + tx, y: my * s + ty };
  });

  $('#mapSvg').setAttribute('viewBox', `0 0 ${W} ${H}`);
  $('#mapSvg').innerHTML = `
    <g style="transform: translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})">
      <path d="${stipple(proj, W, H, s, tx, ty, step)}" stroke="#33518A" stroke-width="${(2.15 / s).toFixed(3)}" stroke-linecap="round" fill="none"/>
      <path d="${arcs}" stroke="#E8C87D" stroke-width="${(0.8 / s).toFixed(3)}" fill="none" opacity="0.16" stroke-linecap="round"/>
      <path d="${selArc}" stroke="#FBEFCF" stroke-width="${(1.5 / s).toFixed(3)}" fill="none" opacity="0.9" stroke-linecap="round"/>
    </g>`;

  const zg = $('#zionGlow');
  zg.style.left = (jx * s + tx) + 'px';
  zg.style.top = (jy * s + ty) + 'px';
  zg.style.opacity = zoomed ? 0.3 : 1;
  $('#ambient').style.opacity = zoomed ? 0.75 : 0;

  /* the chrome a label must not slide underneath, measured from the real DOM */
  const sr = stage.getBoundingClientRect();
  /* .hero is a full-width flex row with a gap in the middle; blocking it whole
     walls off the entire top strip and starves Europe of labels. Measure the two
     halves it actually occupies. */
  const blocked = ['.hero-l', '.hero-stats', '#side', '#band'].map(sel => {
    const e = $(sel); if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left - sr.left - 6, r.top - sr.top - 6, r.right - sr.left + 6, r.bottom - sr.top + 6];
  }).filter(Boolean);

  const groups = clusterPoints(pts, view.sel);
  const markers = groups.map(g => ({
    x: g[0].x, y: g[0].y, count: g.length, members: g,
    c: g[0].c, name: tf(g[0].c.name), sel: g[0].c.id === view.sel
  }));
  placeLabels(markers, blocked, W, H, isRTL());

  $('#markers').innerHTML =
    `<div class="jeru" style="left:${jx * s + tx}px; top:${jy * s + ty}px">
       <svg viewBox="0 0 44 44" width="44" height="44">
         <circle cx="22" cy="22" r="18" fill="none" stroke="#F6E2AE" stroke-width=".6" opacity=".3"/>
         <path d="M22 5 L24.6 19.4 L39 22 L24.6 24.6 L22 39 L19.4 24.6 L5 22 L19.4 19.4 Z" fill="#FBEFCF"/>
       </svg><span>${LANG === 'he' ? 'ירושלים' : LANG === 'ru' ? 'Иерусалим' : 'Jerusalem'}</span>
     </div>` +
    markers.map((m, i) => {
      if (m.count > 1) {
        return `<div class="mk" style="left:${m.x}px; top:${m.y}px">
                  <button class="clus" data-cluster="${i}">${m.count}</button></div>`;
      }
      const cls = m.sel ? 'is-sel' : (m.c.c ? 'is-alumni' : 'is-active');
      const lab = m.label
        ? `<span class="lbl" style="left:${m.label[0]}px; top:${m.label[1]}px; transform:${
            m.label[2] === 'e' ? 'translate(-100%,-50%)' : m.label[2] === 'm' ? 'translate(-50%,-50%)' : 'translateY(-50%)'
          }">${esc(m.name)}</span>` : '';
      return `<div class="mk ${cls}" style="left:${m.x}px; top:${m.y}px">
                <button class="hit" data-pick="${m.c.id}" aria-label="${esc(m.name)}"></button>
                <span class="dot"></span>${lab}</div>`;
    }).join('');

  $('#markers').querySelectorAll('[data-pick]').forEach(b => {
    b.onclick = () => { view.sel = b.dataset.pick; drawSide(views); drawBand(); drawMap(); };
  });
  $('#markers').querySelectorAll('[data-cluster]').forEach(b => {
    b.onclick = () => {
      setView({ custom: fitCluster(markers[+b.dataset.cluster].members, W, H), zoom: 'custom' });
      drawMap();
    };
  });
}

function drawStats() {
  const open = STATE.communities.filter(c => !c.c).length;
  const photos = STATE.communities.reduce((a, c) => a + (c.total || 0), 0);
  $('#heroStats').innerHTML = [
    [STATE.communities.length, t('u.communities'), ''],
    [open, t('u.open'), ''],
    [photos, t('u.photographs'), 'gold']
  ].map(([n, lab, cl]) =>
    `<div class="stat"><span class="v ${cl}">${num(n)}</span><span class="k">${esc(lab)}</span></div>`
  ).join('');
}

function drawSide(views) {
  const open = STATE.communities.filter(c => !c.c).length;
  const rows = ['world', ...STATE.regions.map(r => r.id)].filter(k => views[k]).map(k =>
    `<button class="rgn${view.zoom === k ? ' on' : ''}" data-view="${k}">
       <span>${esc(t(views[k].key))}</span><span class="n">${num(views[k].n)}</span></button>`).join('');

  const zoomed = view.zoom !== 'world' || view.custom;
  $('#side').innerHTML = `
    ${zoomed ? `<button class="zoomout" id="zoomOut">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="9" cy="9" r="6"/><path d="M6.5 9h5"/><path d="M13.5 13.5L18 18"/></svg>
      <span>${esc(t('fly.out'))}</span></button>` : ''}
    <div class="legend">
      <div class="lg"><span class="s open"></span>${esc(t('legend.open'))} &mdash; ${num(open)}</div>
      <div class="lg"><span class="s alum"></span>${esc(t('legend.alumni'))} &mdash; ${num(STATE.communities.length - open)}</div>
      <div class="lg"><span class="s clus"></span>${esc(t('legend.cluster'))}</div>
    </div>
    <div class="flyto">${esc(t('fly.to'))}</div>${rows}
    <p class="side-note">${esc(provenance())} <a href="canvas.html">${esc(t('foot.canvas'))} &rarr;</a></p>`;

  $('#side').querySelectorAll('[data-view]').forEach(b => {
    b.onclick = () => { setView({ zoom: b.dataset.view, custom: null }); drawMap(); };
  });
  const zo = $('#zoomOut');
  if (zo) zo.onclick = () => { zoomOut(); drawMap(); };
}

function drawBand() {
  const c = findCommunity(view.sel);
  if (!c) { $('#band').innerHTML = ''; return; }
  /* The Rosh Kollel used to be shown here from a generator. Real tenures need
     a query per selection, and the year screen already fetches them — so the
     band carries the community's own span instead, which is always true. */
  const h = TMZApi.historyFrom(c);
  const holes = h.holes === 0 ? t('band.covered')
    : num(h.holes) + ' ' + esc(h.holes === 1 ? t('band.emptyOne') : t('band.empty'));

  const bars = h.rows.map(o =>
    `<div class="yb"><div class="bar${o.n === 0 ? ' hole' : ''}" style="height:${
      o.n === 0 ? 13 : Math.max(4, Math.round(o.n / h.peak * 46))}px"></div>
     <span class="yl">${o.year % 5 === 0 ? String(o.year).slice(2) : ''}</span></div>`).join('');

  $('#band').innerHTML = `
    <div class="band-id">
      <div class="band-meta">
        <span class="rg">${esc(t('region.' + c.rg))}</span><span class="sep"></span>
        <span class="st">${c.c ? esc(t('st.closed')) + ' ' + num(c.c) : esc(t('st.open'))}</span>
      </div>
      <h2>${esc(tf(c.name))}</h2>
      <p class="band-span dim"><span dir="ltr">${c.f}&ndash;${c.c || ' '}</span>
        &middot; <span dir="ltr">${(c.c || 2026) - c.f + 1}</span> ${esc(t('u.years')).toLowerCase()}</p>
    </div>
    <div class="band-chart">
      <div class="band-head"><span>${esc(t('band.byYear'))}</span>
        <span class="dim">${num(h.total)} ${esc(t('band.held'))} &middot; <span class="warn">${holes}</span></span></div>
      <div class="bars">${bars}</div>
    </div>
    <a class="btn-ghost" href="#/c/${c.id}">${esc(t('cta.fly'))}
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h11"/><path d="M11 6l4 4-4 4"/></svg></a>`;
}

/* ---- community / year view ----------------------------------------------- */

function photoArt(p) {
  const [a, b, c2, band] = p.art;
  return `<svg viewBox="0 0 240 176" preserveAspectRatio="xMidYMid slice">
    <rect width="240" height="176" fill="#101B2E"/>
    <rect y="${band}" width="240" height="176" fill="#16243C"/>
    <circle cx="${a % 190 + 25}" cy="96" r="16" fill="#1E3050"/>
    <circle cx="${b % 190 + 25}" cy="104" r="20" fill="#22375C"/>
    <circle cx="${c2 % 190 + 25}" cy="92" r="14" fill="#1B2B48"/></svg>`;
}

function avatar(size) {
  return `<svg viewBox="0 0 64 64" width="100%" height="100%">
    <rect width="64" height="64" fill="#16223A"/>
    <circle cx="32" cy="25" r="10" fill="#243352"/>
    <path d="M12 60 a20 20 0 0 1 40 0 z" fill="#243352"/></svg>`;
}

async function communityView(id, year) {
  const c = findCommunity(id);
  if (!c) { location.hash = '#/'; return ''; }

  const h = TMZApi.historyFrom(c);
  const yr = year && year >= h.first && year <= h.last
    ? year
    : (h.rows.find(r => r.n > 0) || h.rows[0]).year;

  let data;
  try {
    data = await TMZApi.loadYear(c.id, yr, LANG);
  } catch (e) {
    return `<div class="cv"><div class="empty-year">
      <h3>${esc(t('err.load'))}</h3><p>${esc(e.message)}</p></div></div>`;
  }

  const { rosh, household, cohort, photos } = data;

  const rail = h.rows.map(o => {
    const d = Math.abs(o.year - yr);
    return `<button class="ry${o.year === yr ? ' on' : ''}${o.n === 0 ? ' none' : ''}" data-year="${o.year}"
      style="font-size:${Math.max(11, 46 - d * 4.6).toFixed(1)}px; opacity:${Math.max(0.2, 1 - d * 0.11).toFixed(2)}">${o.year}</button>`;
  }).join('');

  const peopleNamed = photos.reduce((a, p) => a + (p.people || 0), 0);

  const roshBlock = rosh ? `
    <section class="rosh-band">
      <div class="rosh-main">
        <div class="pf big">${avatar()}</div>
        <div class="rosh-txt">
          <span class="eyebrow gold">${esc(t('yr.rosh'))}</span>
          <h3>${esc(rosh.person || '')}</h3>
          <p class="dim">${esc(tf(c.name))}
            <span dir="ltr">${rosh.from}&ndash;${rosh.to || ''}</span></p>
        </div>
      </div>
      ${household.length ? `
      <div class="vsep"></div>
      <div class="house">
        <span class="eyebrow">${esc(t('yr.household'))}</span>
        <div class="people">${household.map(p => `
          <div class="card"><div class="pf">${avatar()}</div>
            <span class="pn">${esc(p.person || '')}</span>
            <span class="pr">${esc(p.role === 'spouse' ? t('nav.shlichim') : t('yr.child'))}</span></div>`).join('')}
        </div>
      </div>` : ''}
    </section>` : '';

  const cohortBlock = cohort.length ? `
    <section class="sec">
      <div class="sec-head"><span>${esc(t('yr.cohort'))} <span dir="ltr">${yr}</span></span>
        <span class="dim">${num(cohort.length)}</span></div>
      <div class="cohort">${cohort.map(p => `
        <div class="card"><div class="pf">${avatar()}</div>
          <span class="pn">${esc(p.person || '')}</span>
          <span class="pr">${esc(p.institution
            || (p.role === 'child' ? t('yr.child') : t('nav.shlichim')))}</span></div>`).join('')}
      </div>
    </section>` : '';

  /* Two different kinds of empty, and conflating them would be a lie. Holding
     no photographs but knowing the roster makes "we know who was here" true,
     and it is the strongest thing we can say. Knowing neither does not, and
     the copy has to admit that instead. */
  const photoBlock = photos.length === 0 ? `
    <section class="empty-year">
      <h3>${esc(t('yr.empty'))}</h3>
      <p>${esc(rosh || cohort.length ? t('yr.emptySub') : t('yr.emptyNothing'))}</p>
      <a class="btn-gold" href="#/contribute">${esc(t('cta.send'))}</a>
    </section>` : `
    <section class="sec">
      <div class="sec-head"><span>${esc(t('yr.photos'))}</span>
        <span class="dim">${num(photos.length)} ${esc(t('band.held'))}</span></div>
      <div class="photos">
        ${photos.slice(0, 6).map(p => `
          <figure class="photo">
            <img src="${esc(p.url)}" alt="${esc(p.event_name || '')}" loading="lazy">
            <figcaption><span class="ev">${esc(p.event_name || '')}</span>
              <span class="mt">${p.taken_on ? `<span dir="ltr">${esc(p.taken_on)}</span>` : ''}
                ${p.people ? ' &middot; ' + num(p.people) + ' ' + esc(t('u.identified')) : ''}</span>
            </figcaption></figure>`).join('')}
      </div>
    </section>`;

  return `
  <div class="cv">
    <div class="crumb">
      <a href="#/">&larr; ${esc(t('cta.back'))}</a><span class="sep"></span>
      <span>${esc(tf(c.name))}</span>
      <a class="btn-gold sm" href="#/contribute">${esc(t('cta.addYear'))}</a>
    </div>

    <div class="rail" id="rail">${rail}</div>
    <div class="rail-mark"></div>

    <div class="yhead">
      <div>
        <span class="eyebrow">${esc(tf(c.name))} &middot; ${esc(t('region.' + c.rg))} &middot; ${esc(t('yr.yearN'))} <span dir="ltr">${yr - c.f + 1}</span></span>
        <h1><span dir="ltr">${yr}&ndash;${String(yr + 1).slice(2)}</span></h1>
      </div>
      <div class="ystats">
        <div class="stat"><span class="v">${num(cohort.length)}</span><span class="k">${esc(t('u.shlichim'))}</span></div>
        <div class="stat"><span class="v">${num(photos.length)}</span><span class="k">${esc(t('u.photographs'))}</span></div>
        <div class="stat"><span class="v">${num(peopleNamed)}</span><span class="k">${esc(t('u.peopleNamed'))}</span></div>
      </div>
    </div>

    ${roshBlock}
    ${cohortBlock}
    ${photoBlock}
  </div>`;
}

/* ---- contribute ---------------------------------------------------------- */

function contributeView() {
  const opts = STATE.communities.slice().sort((a, b) => tf(a.name).localeCompare(tf(b.name)))
    .map(c => `<option value="${esc(c.id)}">${esc(tf(c.name))}</option>`).join('');
  return `
  <div class="cn">
    <span class="eyebrow gold">${esc(t('cta.add'))}</span>
    <h1>${esc(t('con.title'))}</h1>
    <p class="lede">${esc(t('con.lede'))}</p>

    <div id="upResult"></div>

    <label class="drop" id="drop">
      <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden>
      <div id="dropIdle">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#E8C87D" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-5 5-2-2-6 5"/></svg>
        <span>${esc(t('con.drop'))}</span>
        <span class="btn-gold sm">${esc(t('cta.choose'))}</span>
      </div>
      <div id="dropPreview" hidden></div>
    </label>

    <div class="fields">
      <label><span>${esc(t('con.f1'))}</span>
        <select id="u_comm"><option value="">—</option>${opts}</select></label>
      <label><span>${esc(t('con.f2'))}</span>
        <input id="u_year" type="number" min="1996" max="2026" placeholder="2007"></label>
      <label><span>${esc(t('con.f3'))} <em>${esc(t('con.opt'))}</em></span>
        <input id="u_people" placeholder="&mdash;"></label>
      <label><span>${esc(t('con.f4'))} <em>${esc(t('con.opt'))}</em></span>
        <input id="u_event" placeholder="&mdash;"></label>
      <label><span>${esc(t('con.yourName'))}</span>
        <input id="u_name" placeholder="&mdash;"></label>
      <label><span>${esc(t('con.yourEmail'))} <em>${esc(t('con.opt'))}</em></span>
        <input id="u_email" type="email" placeholder="&mdash;"></label>
    </div>

    <label class="consent">
      <input type="checkbox" id="u_consent">
      <span>${esc(t('con.consent'))}</span>
    </label>

    <p class="screened">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#93A1BD" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z"/><path d="M7.5 10l1.8 1.8L13 8"/></svg>
      ${esc(t('con.screened'))}</p>

    <button class="btn-gold big" id="u_send" disabled>${esc(t('cta.send'))}</button>
    <p class="wa">${esc(t('con.wa'))} &mdash; <span dir="ltr">[WHATSAPP NUMBER]</span></p>
  </div>`;
}

/* Wiring lives apart from the markup so the view stays a pure string and the
   handlers can be re-attached after every render. */
function wireContribute() {
  const fileInput = $('#file'), drop = $('#drop'), send = $('#u_send');
  const consent = $('#u_consent'), result = $('#upResult');
  let ready = null;

  const refresh = () => { send.disabled = !(ready && consent.checked); };
  consent.onchange = refresh;

  async function take(file) {
    if (!file) return;
    result.innerHTML = '';
    $('#dropIdle').hidden = true;
    const prev = $('#dropPreview');
    prev.hidden = false;
    prev.innerHTML = `<p class="dim">${esc(t('con.reading'))}</p>`;
    try {
      ready = await TMZUpload.prepare(file);
      prev.innerHTML = `
        <img src="${ready.preview}" alt="" style="max-height:200px; border-radius:3px; display:block; margin:0 auto 12px">
        <p class="dim" style="text-align:center; font-size:12px">
          ${esc(file.name)} · <span dir="ltr">${ready.width}×${ready.height}</span>
          · <span dir="ltr">${Math.round(ready.bytes / 1024)} KB</span>
          ${ready.resized ? ' · ' + esc(t('con.resized')) : ''}
        </p>
        <p style="text-align:center"><span class="btn-gold sm">${esc(t('con.replace'))}</span></p>`;
    } catch (e) {
      ready = null;
      prev.innerHTML = `<p class="warn" style="text-align:center">${esc(e.message)}</p>`;
    }
    refresh();
  }

  fileInput.onchange = () => take(fileInput.files[0]);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    take(e.dataTransfer.files[0]);
  });

  send.onclick = async () => {
    if (!ready) return;
    send.disabled = true;
    send.textContent = t('con.sending');
    try {
      const out = await TMZUpload.submit({
        file: ready.base64, mime: ready.mime, phash: ready.phash,
        community_slug: $('#u_comm').value || null,
        year: $('#u_year').value ? parseInt($('#u_year').value, 10) : null,
        people: $('#u_people').value.trim() || null,
        event_note: $('#u_event').value.trim() || null,
        contributor_name: $('#u_name').value.trim() || null,
        contributor_email: $('#u_email').value.trim() || null,
        consented: true
      });
      const kind = out.duplicate ? 'dup' : out.accepted ? 'ok' : 'no';
      result.innerHTML = `<div class="up-result ${kind}">
        <strong>${esc(out.message)}</strong>
        ${out.description ? `<p class="dim">${esc(out.description)}</p>` : ''}
        ${(out.reasons || []).length ? `<p class="dim">${esc(out.reasons.join(' · '))}</p>` : ''}
      </div>`;
      if (out.accepted && !out.duplicate) {
        ready = null;
        $('#dropIdle').hidden = false;
        $('#dropPreview').hidden = true;
        fileInput.value = '';
      }
    } catch (e) {
      result.innerHTML = `<div class="up-result no"><strong>${esc(e.message)}</strong></div>`;
    }
    send.textContent = t('cta.send');
    refresh();
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
}

/* ---- router -------------------------------------------------------------- */

function parseRoute() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[1]) return { name: 'community', id: parts[1], year: parts[2] ? +parts[2] : null };
  if (parts[0] === 'contribute') return { name: 'contribute' };
  return { name: 'map' };
}

/* The community list has to be in hand before any view can draw, and it is
   language-dependent, so it reloads when the language does. */
async function loadState() {
  try {
    const d = await TMZApi.loadMap(LANG);
    STATE.communities = d.communities;
    STATE.regions = d.regions.length
      ? d.regions
      : [...new Set(d.communities.map(c => c.rg))].map(id => ({ id, name: null }));
    STATE.error = null;
  } catch (e) {
    STATE.communities = [];
    STATE.regions = [];
    STATE.error = e.message;
  }
  STATE.loaded = true;
  // Keep a valid selection: the first community with photographs, else the first.
  if (!findCommunity(view.sel)) {
    const withPhotos = STATE.communities.find(c => c.total > 0);
    view.sel = (withPhotos || STATE.communities[0] || {}).id ?? null;
  }
}

function banner() {
  if (STATE.error) {
    return `<div class="site-banner err">${esc(t('err.load'))} &mdash; ${esc(STATE.error)}</div>`;
  }
  if (TMZApi.DEMO) {
    return `<div class="site-banner demo">${esc(t('banner.demo'))}
      <a href="${location.pathname}${location.hash}">${esc(t('banner.demoOff'))}</a></div>`;
  }
  const photos = STATE.communities.reduce((a, c) => a + (c.total || 0), 0);
  if (STATE.loaded && photos === 0) {
    return `<div class="site-banner">${esc(t('banner.empty'))}
      <a href="#/contribute">${esc(t('cta.send'))} &rarr;</a></div>`;
  }
  return '';
}

async function render() {
  const r = parseRoute();
  const root = $('#app');
  document.body.dataset.route = r.name;

  if (!STATE.loaded) {
    root.innerHTML = `<div class="site-loading">${esc(t('u.loading'))}</div>`;
    await loadState();
  }

  if (r.name === 'map') {
    root.innerHTML = shell() + banner() + mapView();
    wireShell();
    drawBand();
    drawStats();
    requestAnimationFrame(() => drawMap());
  } else if (r.name === 'community') {
    root.innerHTML = shell() + banner() +
      `<div class="site-loading">${esc(t('u.loading'))}</div>` + footer();
    wireShell();
    // the year screen needs a second round trip, so the shell goes up first
    const body = await communityView(r.id, r.year);
    root.innerHTML = shell() + banner() + body + footer();
    wireShell();
    root.querySelectorAll('[data-year]').forEach(b => {
      b.onclick = () => { location.hash = `#/c/${r.id}/${b.dataset.year}`; };
    });
    const on = root.querySelector('.ry.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  } else {
    root.innerHTML = shell() + contributeView() + footer();
    wireShell();
    wireContribute();
  }
  window.scrollTo(0, 0);
}

/* Switching language changes the resolved names, so the payload is refetched
   rather than translated in place. */
async function reloadForLanguage() {
  STATE.loaded = false;
  await render();
}

window.addEventListener('hashchange', render);
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (parseRoute().name === 'map') drawMap(); }, 180);
});

initLang();
render();
