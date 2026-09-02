/* Router, shell and the three views. Hash routing so GitHub Pages needs no
   rewrite rules: #/ , #/c/<community> , #/c/<community>/<year> , #/contribute */

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"]/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[m]));

const view = { zoom: 'world', custom: null, sel: 'memphis' };
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

function footer() {
  return `<footer class="foot">
    <span>${esc(t('foot.mock'))}</span>
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
      b.onclick = () => { setLang(b.dataset.lang); render(); };
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

function drawMap() {
  const stage = $('#stage');
  if (!stage) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  if (W < 40 || H < 40) return;

  const proj = projection(W, H);
  const views = buildViews(proj, W, H);
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
  const pts = COMMUNITIES.map(c => {
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
      view.custom = fitCluster(markers[+b.dataset.cluster].members, W, H);
      view.zoom = 'custom';
      drawSide(views); drawMap();
    };
  });
}

function drawStats() {
  const open = COMMUNITIES.filter(c => !c.c).length;
  let photos = 0;
  for (const c of COMMUNITIES) photos += historyOf(c).total;
  $('#heroStats').innerHTML = [
    [COMMUNITIES.length, t('u.communities'), ''],
    [open, t('u.open'), ''],
    [photos, t('u.photographs'), 'gold']
  ].map(([n, lab, cl]) =>
    `<div class="stat"><span class="v ${cl}">${num(n)}</span><span class="k">${esc(lab)}</span></div>`
  ).join('');
}

function drawSide(views) {
  const open = COMMUNITIES.filter(c => !c.c).length;
  const rows = ['world', ...REGIONS].filter(k => views[k]).map(k =>
    `<button class="rgn${view.zoom === k ? ' on' : ''}" data-view="${k}">
       <span>${esc(t(views[k].key))}</span><span class="n">${num(views[k].n)}</span></button>`).join('');

  $('#side').innerHTML = `
    <div class="legend">
      <div class="lg"><span class="s open"></span>${esc(t('legend.open'))} &mdash; ${num(open)}</div>
      <div class="lg"><span class="s alum"></span>${esc(t('legend.alumni'))} &mdash; ${num(COMMUNITIES.length - open)}</div>
      <div class="lg"><span class="s clus"></span>${esc(t('legend.cluster'))}</div>
    </div>
    <div class="flyto">${esc(t('fly.to'))}</div>${rows}
    <p class="side-note">${esc(t('foot.mock'))} <a href="canvas.html">${esc(t('foot.canvas'))} &rarr;</a></p>`;

  $('#side').querySelectorAll('[data-view]').forEach(b => {
    b.onclick = () => { view.zoom = b.dataset.view; view.custom = null; drawMap(); };
  });
}

function drawBand() {
  const c = community(view.sel);
  const h = historyOf(c), r = roshOf(c);
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
      <div class="rosh"><span class="av"></span>
        <span>${esc(tf(r.name) ? 'Rav ' + tf(r.name) : '')}<br>
        <span class="dim">${esc(t('yr.rosh'))} <span dir="ltr">${r.from}&ndash;${r.to}</span></span></span></div>
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

function communityView(id, year) {
  const c = community(id);
  if (!c) { location.hash = '#/'; return ''; }
  const h = historyOf(c);
  const yr = year && year >= h.first && year <= h.last ? year : (h.rows.find(r => r.n > 0) || h.rows[0]).year;
  const row = h.rows.find(r => r.year === yr);
  const r = roshOf(c), house = householdOf(c), cohort = cohortOf(c, yr);
  const photos = photosOf(c, yr, row.n);
  const inRosh = yr >= r.from && yr <= r.to;

  const rail = h.rows.map(o => {
    const d = Math.abs(o.year - yr);
    return `<button class="ry${o.year === yr ? ' on' : ''}${o.n === 0 ? ' none' : ''}" data-year="${o.year}"
      style="font-size:${Math.max(11, 46 - d * 4.6).toFixed(1)}px; opacity:${Math.max(0.2, 1 - d * 0.11).toFixed(2)}">${o.year}</button>`;
  }).join('');

  const people = photos.reduce((a, p) => a + p.people, 0);

  const roster = inRosh ? `
    <section class="rosh-band">
      <div class="rosh-main">
        <div class="pf big">${avatar()}</div>
        <div class="rosh-txt">
          <span class="eyebrow gold">${esc(t('yr.rosh'))}</span>
          <h3>Rav ${esc(tf(r.name))}</h3>
          <p class="dim">${esc(tf(c.name))} <span dir="ltr">${r.from}&ndash;${r.to}</span>${
            r.prior ? ' &middot; ' + esc(t('yr.before')) + ' ' + esc(tf(r.prior.name)) + ' <span dir="ltr">' + r.priorYear + '</span>' : ''}</p>
          <a class="lnk" href="#/c/${c.id}/${r.from}">${esc(t('yr.seeAll'))} &rarr;</a>
        </div>
      </div>
      <div class="vsep"></div>
      <div class="house">
        <span class="eyebrow">${esc(t('yr.household'))}</span>
        <div class="people">${house.map(p => `
          <div class="card"><div class="pf">${avatar()}</div>
            <span class="pn">${esc(tf(p.name))}</span>
            <span class="pr">${p.role ? esc(t('nav.shlichim')) : 'b. <span dir="ltr">' + p.born + '</span>'}</span></div>`).join('')}
        </div>
      </div>
    </section>` : '';

  const photoBlock = row.n === 0 ? `
    <section class="empty-year">
      <h3>${esc(t('yr.empty'))}</h3>
      <p>${esc(t('yr.emptySub'))}</p>
      <a class="btn-gold" href="#/contribute">${esc(t('cta.send'))}</a>
    </section>` : `
    <section class="sec">
      <div class="sec-head"><span>${esc(t('yr.photos'))}</span>
        <span class="dim">${num(row.n)} ${esc(t('band.held'))} &middot; ${num(Math.max(1, Math.round(row.n / 5)))} ${esc(t('yr.awaiting'))}</span></div>
      <div class="photos">
        ${photos.slice(0, 4).map(p => `
          <figure class="photo">${photoArt(p)}
            <figcaption><span class="ev">${esc(tf(p.event))}</span>
              <span class="mt"><span dir="ltr">${p.day} ${p.month} ${p.year}</span> &middot; ${num(p.people)} ${esc(t('u.identified'))}</span>
            </figcaption></figure>`).join('')}
        <aside class="meta">
          <span class="eyebrow gold">${esc(tf(photos[0].event))}</span>
          <div class="mrow"><span>${esc(t('yr.date'))}</span><span dir="ltr">${photos[0].day} ${photos[0].month} ${photos[0].year}</span></div>
          <div class="mrow"><span>${esc(t('yr.place'))}</span><span>${esc(tf(photos[0].venue))}</span></div>
          <div class="mrow"><span>${esc(t('yr.sentBy'))}</span><span>${photos[0].source === 'whatsapp' ? esc(t('yr.whatsapp')) : esc(t('cta.add'))}</span></div>
          <span class="eyebrow mt2">${esc(t('yr.peopleIdent'))} &mdash; ${num(photos[0].people)}</span>
          <div class="chips">${cohort.slice(0, 5).map(p => `<span class="chip">${esc(tf(p.name))}</span>`).join('')}
            <span class="chip">+${num(Math.max(0, photos[0].people - 5))} ${esc(t('yr.more'))}</span></div>
        </aside>
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
        <div class="stat"><span class="v">${num(row.n)}</span><span class="k">${esc(t('u.photographs'))}</span></div>
        <div class="stat"><span class="v">${num(people)}</span><span class="k">${esc(t('u.peopleNamed'))}</span></div>
      </div>
    </div>

    ${roster}

    <section class="sec">
      <div class="sec-head"><span>${esc(t('yr.cohort'))} <span dir="ltr">${yr}</span></span>
        <span class="dim">${num(cohort.length)} ${esc(t('yr.returned'))}</span></div>
      <div class="cohort">${cohort.map(p => `
        <div class="card"><div class="pf">${avatar()}</div>
          <span class="pn">${esc(tf(p.name))}</span>
          <span class="pr">${esc(p.from)}</span></div>`).join('')}
      </div>
    </section>

    ${photoBlock}
  </div>`;
}

/* ---- contribute ---------------------------------------------------------- */

function contributeView() {
  const opts = COMMUNITIES.slice().sort((a, b) => tf(a.name).localeCompare(tf(b.name)))
    .map(c => `<option>${esc(tf(c.name))}</option>`).join('');
  return `
  <div class="cn">
    <span class="eyebrow gold">${esc(t('cta.add'))}</span>
    <h1>${esc(t('con.title'))}</h1>
    <p class="lede">${esc(t('con.lede'))}</p>

    <label class="drop">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#E8C87D" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-5 5-2-2-6 5"/></svg>
      <span>${esc(t('con.drop'))}</span>
      <span class="btn-gold sm">${esc(t('cta.choose'))}</span>
    </label>

    <div class="fields">
      <label><span>${esc(t('con.f1'))}</span><select><option></option>${opts}</select></label>
      <label><span>${esc(t('con.f2'))}</span><input type="number" min="1996" max="2026" placeholder="2007"></label>
      <label><span>${esc(t('con.f3'))} <em>${esc(t('con.opt'))}</em></span><input placeholder="&mdash;"></label>
      <label><span>${esc(t('con.f4'))} <em>${esc(t('con.opt'))}</em></span><input placeholder="&mdash;"></label>
    </div>

    <p class="screened">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="#93A1BD" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V5z"/><path d="M7.5 10l1.8 1.8L13 8"/></svg>
      ${esc(t('con.screened'))}</p>

    <button class="btn-gold big" disabled>${esc(t('cta.send'))}</button>
    <p class="wa">${esc(t('con.wa'))} &mdash; <span dir="ltr">[WHATSAPP NUMBER]</span></p>
  </div>`;
}

/* ---- router -------------------------------------------------------------- */

function parseRoute() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[1]) return { name: 'community', id: parts[1], year: parts[2] ? +parts[2] : null };
  if (parts[0] === 'contribute') return { name: 'contribute' };
  return { name: 'map' };
}

function render() {
  const r = parseRoute();
  const root = $('#app');
  document.body.dataset.route = r.name;

  if (r.name === 'map') {
    root.innerHTML = shell() + mapView();
    wireShell();
    drawBand();
    drawStats();
    requestAnimationFrame(drawMap);
  } else if (r.name === 'community') {
    root.innerHTML = shell() + communityView(r.id, r.year) + footer();
    wireShell();
    root.querySelectorAll('[data-year]').forEach(b => {
      b.onclick = () => { location.hash = `#/c/${r.id}/${b.dataset.year}`; };
    });
    const on = root.querySelector('.ry.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  } else {
    root.innerHTML = shell() + contributeView() + footer();
    wireShell();
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', render);
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (parseRoute().name === 'map') drawMap(); }, 180);
});

initLang();
render();
