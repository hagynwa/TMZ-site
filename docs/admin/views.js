import { sb } from './sb.js';
import { $, esc, LANGS, LANG_NAMES, REGIONS, REGION_NAMES,
         pickName, coverage, openDrawer, closeDrawer, toast } from './ui.js';

/* ---- dashboard ----------------------------------------------------------- */

export async function dashboard() {
  const [comms, people, photos, pending] = await Promise.all([
    sb.from('tmz_community').select('id,slug,closed_year'),
    sb.from('tmz_person').select('id'),
    sb.from('tmz_photo').select('id', { filter: { status: 'eq.approved' } }),
    sb.from('tmz_photo').select('id', { filter: { status: 'eq.pending' } })
  ]);
  const open = comms.filter(c => !c.closed_year).length;

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Dashboard</h1><p>Live counts across the archive.</p></div>
    </div>
    <div class="stat-grid">
      ${tile('Communities', comms.length)}
      ${tile('Open today', open)}
      ${tile('People', people.length)}
      ${tile('Approved photos', photos.length, 'gold')}
      ${tile('Pending review', pending.length, pending.length ? 'gold' : '')}
    </div>
    <p class="dim" style="margin:0">
      Community-year coverage lands here once photographs start arriving.
    </p>`;
}
const tile = (k, v, cls = '') =>
  `<div class="stat-tile"><span class="k">${esc(k)}</span>
    <span class="v ${cls}">${v.toLocaleString('en-US')}</span></div>`;

/* ---- campaign coverage --------------------------------------------------- */

/* The question the whole campaign exists to answer: which community, which
   year, still has nothing. One cell per community-year, so a gap is a hole you
   can see rather than a number you have to interpret. */
export async function campaign() {
  const [cov, intake] = await Promise.all([
    sb.rpc('tmz_coverage', { want: 'en' }),
    sb.rpc('tmz_intake_stats', { days: 30 })
  ]);

  const years = cov.years || [];
  const rows = cov.rows || [];
  const pct = cov.total_cells ? Math.round((1 - cov.empty_cells / cov.total_cells) * 100) : 0;

  const src = intake.by_source || {};
  const st = intake.by_status || {};

  const grid = rows.map(r => {
    const cells = years.map(y => {
      if (y < r.first || y > r.last) return `<span class="cv-cell out" title="${r.name} ${y}: not open"></span>`;
      const n = r.years[String(y)] || 0;
      const lvl = n === 0 ? 'zero' : n < 5 ? 'low' : n < 20 ? 'mid' : 'high';
      return `<span class="cv-cell ${lvl}" title="${esc(r.name)} ${y}: ${n === 0 ? 'nothing yet' : n + ' held'}"></span>`;
    }).join('');
    return `<tr>
      <td class="cv-name">${esc(r.name)}</td>
      <td class="cv-strip">${cells}</td>
      <td class="cv-num">${r.held}</td>
      <td class="cv-num ${r.empty ? 'warn' : ''}">${r.empty}</td>
    </tr>`;
  }).join('');

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Campaign</h1>
        <p>Every community across every year it was open — ${cov.total_cells.toLocaleString('en-US')} cells,
           ${cov.empty_cells.toLocaleString('en-US')} still empty.</p></div>
    </div>

    <div class="stat-grid">
      ${tile('Coverage', pct + '%', pct > 50 ? 'gold' : '')}
      ${tile('Years with nothing', cov.empty_cells)}
      ${tile('Contributors (30d)', intake.contributors || 0)}
      ${tile('Auto-rejected (30d)', intake.auto_rejected || 0)}
      ${tile('Awaiting review', st.pending || 0, (st.pending || 0) ? 'gold' : '')}
    </div>

    <div class="cv-legend">
      <span><i class="cv-cell zero"></i> nothing</span>
      <span><i class="cv-cell low"></i> 1–4</span>
      <span><i class="cv-cell mid"></i> 5–19</span>
      <span><i class="cv-cell high"></i> 20+</span>
      <span><i class="cv-cell out"></i> not open</span>
      <span class="dim" style="margin-inline-start:auto">
        Web ${src.web || 0} · WhatsApp ${src.whatsapp || 0} · Imported ${src.import || 0}</span>
    </div>

    <div class="tbl-wrap"><table class="tbl cv-table">
      <thead><tr>
        <th>Community</th>
        <th><span class="cv-years">${years.map((y, i) =>
          `<span class="cv-year">${y % 5 === 0 ? String(y).slice(2) : ''}</span>`).join('')}</span></th>
        <th class="cv-num">Held</th><th class="cv-num">Empty</th>
      </tr></thead>
      <tbody>${grid}</tbody>
    </table></div>`;
}

/* ---- communities --------------------------------------------------------- */

export async function communities() {
  const rows = await sb.from('tmz_community', {})
    .select('id,slug,region_id,lat,lon,founded_year,closed_year,is_open,tmz_community_tr(lang,name)',
            { order: 'founded_year.asc,slug.asc' });

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Communities</h1>
        <p>${rows.length} rows. Every row is one dot on the map.</p></div>
      <button class="btn solid" id="newC">+ New community</button>
    </div>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>
        <th>Name</th><th>Slug</th><th>Region</th><th>Founded</th><th>Status</th>
        <th>Translations</th><th></th>
      </tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.id}">
        <td>${esc(pickName(r.tmz_community_tr) || '—')}</td>
        <td class="mono">${esc(r.slug)}</td>
        <td>${esc(REGION_NAMES[r.region_id] || r.region_id)}</td>
        <td>${r.founded_year}${r.closed_year ? ` – ${r.closed_year}` : ''}</td>
        <td><span class="pill ${r.is_open ? 'open' : 'closed'}">${r.is_open ? 'Open' : 'Closed'}</span></td>
        <td>${coverage(r.tmz_community_tr)}</td>
        <td class="actions"><button class="edit">Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;

  $('#newC').onclick = () => communityDrawer(null);
  document.querySelectorAll('#page tbody tr').forEach(tr => {
    tr.querySelector('.edit').onclick = () =>
      communityDrawer(rows.find(r => r.id === tr.dataset.id));
  });
}

function communityDrawer(row) {
  const isNew = !row;
  const c = row || { slug: '', region_id: 'na', lat: '', lon: '',
                     founded_year: 2001, closed_year: '', tmz_community_tr: [] };

  const trBlock = lang => {
    const t = c.tmz_community_tr.find(x => x.lang === lang) || {};
    return `<div class="tr-block">
      <h4>${esc(LANG_NAMES[lang])}${!t.name ? '<span class="missing">missing</span>' : ''}</h4>
      <div class="field"><label>Name</label>
        <input data-tr="${lang}" data-tr-field="name" value="${esc(t.name || '')}"></div>
      <div class="field row2">
        <div><label>Country</label>
          <input data-tr="${lang}" data-tr-field="country" value="${esc(t.country || '')}"></div>
        <div><label>Blurb</label>
          <input data-tr="${lang}" data-tr-field="blurb" value="${esc(t.blurb || '')}"></div>
      </div>
    </div>`;
  };

  const el = openDrawer(isNew ? 'New community' : `Edit ${pickName(c.tmz_community_tr) || c.slug}`, `
    <div id="drawerErr"></div>
    <div class="field row2">
      <div><label>Slug</label>
        <input id="f_slug" value="${esc(c.slug)}" ${isNew ? '' : 'readonly'}></div>
      <div><label>Region</label>
        <select id="f_region">
          ${REGIONS.map(r =>
            `<option value="${r}" ${c.region_id === r ? 'selected' : ''}>${esc(REGION_NAMES[r])}</option>`).join('')}
        </select></div>
    </div>
    <div class="field row2">
      <div><label>Latitude</label><input id="f_lat" type="number" step="any" value="${c.lat}"></div>
      <div><label>Longitude</label><input id="f_lon" type="number" step="any" value="${c.lon}"></div>
    </div>
    <div class="field row2">
      <div><label>Founded year</label><input id="f_f" type="number" value="${c.founded_year}"></div>
      <div><label>Closed year <span class="dim">(blank = open)</span></label>
        <input id="f_c" type="number" value="${c.closed_year || ''}"></div>
    </div>
    <h3 style="font-family:var(--serif); font-size:18px; margin:20px 0 10px">Translations</h3>
    ${LANGS.map(trBlock).join('')}
  `, [
    !isNew && { label: 'Delete', kind: 'danger', onClick: () => deleteCommunity(c) },
    { label: 'Cancel', onClick: closeDrawer },
    { label: isNew ? 'Create' : 'Save', kind: 'solid', onClick: e => saveCommunity(c, e) }
  ].filter(Boolean));

  el.querySelector('#f_slug').focus();
}

async function saveCommunity(orig, el) {
  const q = sel => el.querySelector(sel);
  const val = id => q('#' + id).value.trim();
  const err = el.querySelector('#drawerErr');
  err.innerHTML = '';

  const patch = {
    slug: val('f_slug'),
    region_id: val('f_region'),
    lat: parseFloat(val('f_lat')),
    lon: parseFloat(val('f_lon')),
    founded_year: parseInt(val('f_f'), 10),
    closed_year: val('f_c') ? parseInt(val('f_c'), 10) : null
  };
  if (!patch.slug || Number.isNaN(patch.lat) || Number.isNaN(patch.lon) || !patch.founded_year) {
    err.innerHTML = '<div class="error">Slug, latitude, longitude and founded year are required.</div>';
    return;
  }

  try {
    let row;
    if (orig.id) {
      [row] = await sb.from('tmz_community').update(patch, { id: `eq.${orig.id}` });
    } else {
      [row] = await sb.from('tmz_community').insert(patch);
    }
    const trs = [];
    el.querySelectorAll('.tr-block').forEach(block => {
      const lang = block.querySelector('[data-tr-field="name"]').dataset.tr;
      const name = block.querySelector('[data-tr-field="name"]').value.trim();
      const country = block.querySelector('[data-tr-field="country"]').value.trim() || null;
      const blurb = block.querySelector('[data-tr-field="blurb"]').value.trim() || null;
      if (name) trs.push({ community_id: row.id, lang, name, country, blurb });
    });
    if (trs.length) {
      await sb.from('tmz_community_tr').upsert(trs, { onConflict: 'community_id,lang' });
    }
    toast(orig.id ? 'Community updated.' : 'Community created.');
    closeDrawer();
    communities();
  } catch (e) {
    err.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

async function deleteCommunity(c) {
  if (!confirm(`Delete ${pickName(c.tmz_community_tr) || c.slug}? This removes every tenure, photo and translation attached to it.`)) return;
  try {
    await sb.from('tmz_community').delete({ id: `eq.${c.id}` });
    toast('Community deleted.');
    closeDrawer();
    communities();
  } catch (e) {
    alert(e.message);
  }
}

/* ---- people -------------------------------------------------------------- */

export async function people() {
  const rows = await sb.from('tmz_person', {}).select(
    'id,slug,birth_year,tmz_person_tr(lang,display_name),tmz_tenure(id)',
    { order: 'slug.asc.nullslast', limit: 500 }
  );
  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>People</h1>
        <p>${rows.length} people. Each can hold tenures at any number of communities.</p></div>
      <button class="btn solid" id="newP">+ New person</button>
    </div>
    ${rows.length === 0 ? `<div class="empty">No people yet. Add a Rosh Kollel or shaliach to start.</div>` : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Name</th><th>Slug</th><th>Born</th><th>Tenures</th><th>Translations</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr data-id="${r.id}">
        <td>${esc(pickName(r.tmz_person_tr) || '—')}</td>
        <td class="mono">${esc(r.slug || '—')}</td>
        <td>${r.birth_year || '—'}</td>
        <td>${(r.tmz_tenure || []).length}</td>
        <td>${coverage(r.tmz_person_tr)}</td>
        <td class="actions"><button class="edit">Edit</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`}`;

  $('#newP').onclick = () => personDrawer(null);
  document.querySelectorAll('#page tbody tr').forEach(tr => {
    tr.querySelector('.edit').onclick = () =>
      personDrawer(rows.find(r => r.id === tr.dataset.id));
  });
}

/* Cached lookups the tenure editor needs; both are small and change rarely. */
let _communities = null, _institutions = null;
async function lookups() {
  if (!_communities) {
    [_communities, _institutions] = await Promise.all([
      sb.from('tmz_community', {}).select('id,slug,tmz_community_tr(lang,name)', { order: 'slug.asc' }),
      sb.from('tmz_institution', {}).select('id,slug,tmz_institution_tr(lang,name)', { order: 'slug.asc' })
    ]);
  }
  return { communities: _communities, institutions: _institutions };
}

const ROLES = {
  rosh_kollel: 'Rosh Kollel', shaliach: 'Shaliach', shlicha: 'Shlicha',
  spouse: 'Spouse', child: 'Child', staff: 'Staff'
};

async function personDrawer(row) {
  const isNew = !row;
  const p = row || { slug: '', birth_year: '', tmz_person_tr: [] };
  const { communities: comms, institutions: insts } = await lookups();

  const tenures = isNew ? [] : await sb.from('tmz_tenure', {}).select(
    'id,community_id,role,start_year,end_year,institution_id,household_of',
    { filter: { person_id: `eq.${p.id}` }, order: 'start_year.asc' });

  const commName = id => {
    const c = comms.find(x => x.id === id);
    return c ? (pickName(c.tmz_community_tr) || c.slug) : '—';
  };

  const trBlock = lang => {
    const t = p.tmz_person_tr.find(x => x.lang === lang) || {};
    return `<div class="tr-block">
      <h4>${esc(LANG_NAMES[lang])}${!t.display_name ? '<span class="missing">missing</span>' : ''}</h4>
      <div class="field"><label>Display name</label>
        <input data-tr="${lang}" value="${esc(t.display_name || '')}"></div>
    </div>`;
  };

  const tenureRows = tenures.length ? tenures.map(t => `
    <tr data-tenure="${t.id}">
      <td>${esc(commName(t.community_id))}</td>
      <td>${esc(ROLES[t.role] || t.role)}</td>
      <td class="mono">${t.start_year}–${t.end_year || 'now'}</td>
      <td class="actions"><button class="del rm-tenure">Remove</button></td>
    </tr>`).join('') : `<tr><td colspan="4" class="dim">No tenures yet.</td></tr>`;

  const el = openDrawer(isNew ? 'New person' : `Edit ${pickName(p.tmz_person_tr) || p.slug || 'person'}`, `
    <div id="drawerErr"></div>
    <div class="field row2">
      <div><label>Slug <span class="dim">(optional)</span></label>
        <input id="f_slug" value="${esc(p.slug || '')}"></div>
      <div><label>Birth year <span class="dim">(optional)</span></label>
        <input id="f_by" type="number" value="${p.birth_year || ''}"></div>
    </div>

    <h3 style="font-family:var(--serif); font-size:18px; margin:22px 0 10px">Translations</h3>
    ${LANGS.map(trBlock).join('')}

    <h3 style="font-family:var(--serif); font-size:18px; margin:24px 0 10px">Tenures</h3>
    ${isNew ? `<p class="dim" style="font-size:12.5px">Save the person first, then add tenures.</p>` : `
    <div class="tbl-wrap" style="margin-bottom:14px"><table class="tbl">
      <thead><tr><th>Community</th><th>Role</th><th>Years</th><th></th></tr></thead>
      <tbody id="tenureBody">${tenureRows}</tbody>
    </table></div>
    <div class="tr-block">
      <h4>Add a tenure</h4>
      <div class="field row2">
        <div><label>Community</label><select id="t_comm">
          ${comms.map(c => `<option value="${c.id}">${esc(pickName(c.tmz_community_tr) || c.slug)}</option>`).join('')}
        </select></div>
        <div><label>Role</label><select id="t_role">
          ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select></div>
      </div>
      <div class="field row2">
        <div><label>Start year</label><input id="t_from" type="number" placeholder="2001"></div>
        <div><label>End year <span class="dim">(blank = ongoing)</span></label><input id="t_to" type="number"></div>
      </div>
      <div class="field"><label>Sent from <span class="dim">(optional)</span></label><select id="t_inst">
        <option value="">—</option>
        ${insts.map(i => `<option value="${i.id}">${esc(pickName(i.tmz_institution_tr) || i.slug)}</option>`).join('')}
      </select></div>
      <div class="field" id="householdWrap" hidden>
        <label>Household of <span class="dim">(whose family are they part of)</span></label>
        <select id="t_house"><option value="">—</option></select>
      </div>
      <button class="btn" id="addTenure">Add tenure</button>
    </div>`}
  `, [
    !isNew && { label: 'Delete', kind: 'danger', onClick: () => deletePerson(p) },
    { label: 'Cancel', onClick: closeDrawer },
    { label: isNew ? 'Create' : 'Save', kind: 'solid', onClick: e => savePerson(p, e) }
  ].filter(Boolean));

  if (isNew) return;

  /* household_of only makes sense for a spouse or child, and only against a
     Rosh Kollel serving at the same community. Load those on demand. */
  const roleSel = el.querySelector('#t_role');
  const commSel = el.querySelector('#t_comm');
  const wrap = el.querySelector('#householdWrap');
  const houseSel = el.querySelector('#t_house');

  async function refreshHousehold() {
    const needs = ['spouse', 'child'].includes(roleSel.value);
    wrap.hidden = !needs;
    if (!needs) return;
    const heads = await sb.from('tmz_tenure', {}).select(
      'id,start_year,end_year,tmz_person(tmz_person_tr(lang,display_name))',
      { filter: { community_id: `eq.${commSel.value}`, role: 'eq.rosh_kollel' }, order: 'start_year.asc' });
    houseSel.innerHTML = '<option value="">—</option>' + heads.map(h =>
      `<option value="${h.id}">${esc(pickName((h.tmz_person || {}).tmz_person_tr) || 'Rosh Kollel')} (${h.start_year}–${h.end_year || 'now'})</option>`
    ).join('');
  }
  roleSel.onchange = refreshHousehold;
  commSel.onchange = refreshHousehold;

  el.querySelector('#addTenure').onclick = async () => {
    const err = el.querySelector('#drawerErr');
    err.innerHTML = '';
    const from = parseInt(el.querySelector('#t_from').value, 10);
    if (!from) { err.innerHTML = '<div class="error">A start year is required.</div>'; return; }
    try {
      await sb.from('tmz_tenure').insert({
        person_id: p.id,
        community_id: commSel.value,
        role: roleSel.value,
        start_year: from,
        end_year: el.querySelector('#t_to').value ? parseInt(el.querySelector('#t_to').value, 10) : null,
        institution_id: el.querySelector('#t_inst').value || null,
        household_of: houseSel.value || null
      });
      toast('Tenure added.');
      closeDrawer();
      const fresh = await sb.from('tmz_person', {}).select(
        'id,slug,birth_year,tmz_person_tr(lang,display_name)', { filter: { id: `eq.${p.id}` } });
      personDrawer(fresh[0]);
    } catch (e) {
      err.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  };

  el.querySelectorAll('.rm-tenure').forEach(b => {
    b.onclick = async () => {
      const id = b.closest('tr').dataset.tenure;
      if (!confirm('Remove this tenure? Any household members attached to it go too.')) return;
      try {
        await sb.from('tmz_tenure').delete({ id: `eq.${id}` });
        b.closest('tr').remove();
        toast('Tenure removed.');
      } catch (e) { alert(e.message); }
    };
  });
}

async function savePerson(orig, el) {
  const err = el.querySelector('#drawerErr');
  err.innerHTML = '';
  const patch = {
    slug: el.querySelector('#f_slug').value.trim() || null,
    birth_year: el.querySelector('#f_by').value ? parseInt(el.querySelector('#f_by').value, 10) : null
  };
  try {
    let row;
    if (orig.id) {
      [row] = await sb.from('tmz_person').update(patch, { id: `eq.${orig.id}` });
    } else {
      [row] = await sb.from('tmz_person').insert(patch);
    }
    const trs = [];
    el.querySelectorAll('.tr-block').forEach(block => {
      const inp = block.querySelector('[data-tr]');
      const name = inp.value.trim();
      if (name) trs.push({ person_id: row.id, lang: inp.dataset.tr, display_name: name });
    });
    if (trs.length) {
      await sb.from('tmz_person_tr').upsert(trs, { onConflict: 'person_id,lang' });
    }
    toast(orig.id ? 'Person updated.' : 'Person created.');
    closeDrawer();
    people();
  } catch (e) {
    err.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

async function deletePerson(p) {
  if (!confirm(`Delete ${pickName(p.tmz_person_tr) || 'person'}? This removes every tenure attached to them.`)) return;
  try {
    await sb.from('tmz_person').delete({ id: `eq.${p.id}` });
    toast('Person deleted.');
    closeDrawer();
    people();
  } catch (e) { alert(e.message); }
}

/* ---- translations -------------------------------------------------------- */

/* The whole reason translations live in their own tables rather than a jsonb
   blob: "what is still missing in Russian" has to be one query, and it has to
   be fixable in place without hunting through every community. */
/* Four kinds of record are translatable, and they do not all need all six
   languages — so this page distinguishes MISSING from NOT NEEDED. Before, it
   counted a person with no French row as missing, which is 231 people times
   three Latin locales of phantom work: a shaliach called Amichai Frei is
   called Amichai Frei in French, and writing that into three more rows creates
   three copies that go stale the day the English spelling is corrected. The
   fallback chain (requested -> en -> any) already returns the right string.

   The rule, per kind:
     communities   — all six. Names and countries are headline elements, and
                     Moscow really is Moscou, Moskau, Moscú.
     event types   — all six. "Community shabbaton" is a phrase, not a name.
     people        — he and ru only. A different SCRIPT is a different name; a
                     different Latin-script locale is the same one.
     institutions  — he and ru only, for the same reason.
   Anything outside a kind's set is shown as "same as English", and can still
   be overridden by hand when a name genuinely does differ. */

const TR_KINDS = {
  community: {
    label: 'Community', table: 'tmz_community_tr', fk: 'community_id', field: 'name',
    langs: LANGS
  },
  event: {
    label: 'Occasion', table: 'tmz_event_type_tr', fk: 'event_type_id', field: 'name',
    langs: LANGS
  },
  person: {
    label: 'Person', table: 'tmz_person_tr', fk: 'person_id', field: 'display_name',
    langs: ['en', 'he', 'ru']
  },
  institution: {
    label: 'Yeshiva', table: 'tmz_institution_tr', fk: 'institution_id', field: 'name',
    langs: ['en', 'he', 'ru']
  }
};

/* Six cells like coverage(), plus a third state for a locale this kind does
   not need — so a grey cell reads as "settled", never as "unfinished". */
function trCoverage(tr, needed) {
  const have = new Set((tr || []).map(t => t.lang));
  return `<div class="cov">${LANGS.map(l => {
    const on = have.has(l);
    const na = !needed.includes(l);
    const title = on ? LANG_NAMES[l]
      : na ? `${LANG_NAMES[l]} — same as English` : `${LANG_NAMES[l]} — missing`;
    return `<span class="cell ${on ? 'on' : na ? 'na' : ''}" title="${esc(title)}"></span>`;
  }).join('')}</div>`;
}

export async function translations() {
  const [comms, ppl, events, insts] = await Promise.all([
    sb.from('tmz_community', {}).select('id,slug,tmz_community_tr(lang,name)', { order: 'slug.asc' }),
    sb.from('tmz_person', {}).select('id,slug,tmz_person_tr(lang,display_name)',
      { order: 'slug.asc.nullslast', limit: 1000 }),
    sb.from('tmz_event_type', {}).select('id,tmz_event_type_tr(lang,name)', { order: 'sort.asc' }),
    sb.from('tmz_institution', {}).select('id,slug,tmz_institution_tr(lang,name)', { order: 'slug.asc' })
  ]);

  const entities = [
    ...comms.map(c => ({ kind: 'community', id: c.id, slug: c.slug,
                         name: pickName(c.tmz_community_tr) || c.slug, tr: c.tmz_community_tr || [] })),
    ...events.map(e => ({ kind: 'event', id: e.id, slug: e.id,
                          name: pickName(e.tmz_event_type_tr) || e.id, tr: e.tmz_event_type_tr || [] })),
    ...ppl.map(p => ({ kind: 'person', id: p.id, slug: p.slug || '—',
                       name: pickName(p.tmz_person_tr) || p.slug || 'unnamed', tr: p.tmz_person_tr || [] })),
    ...insts.map(i => ({ kind: 'institution', id: i.id, slug: i.slug,
                         name: pickName(i.tmz_institution_tr) || i.slug, tr: i.tmz_institution_tr || [] }))
  ];

  const needs = e => TR_KINDS[e.kind].langs;
  const lacks = (e, l) => needs(e).includes(l) && !e.tr.some(t => t.lang === l);

  const perLang = {};
  for (const l of LANGS) perLang[l] = entities.filter(e => lacks(e, l)).length;

  const active = (new URLSearchParams(location.hash.split('?')[1] || '')).get('lang') || 'he';
  const missing = entities.filter(e => lacks(e, active));
  const notNeeded = entities.filter(e => !needs(e).includes(active)).length;

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Translations</h1>
        <p>${entities.length} translatable records — communities, occasions, people and yeshivot.</p></div>
    </div>
    <div class="stat-grid">
      ${LANGS.map(l => `
        <button class="stat-tile" data-lang="${l}" style="text-align:start; ${l === active ? 'border-color:rgba(232,200,125,.5)' : ''}">
          <span class="k">${esc(LANG_NAMES[l])}</span>
          <span class="v ${perLang[l] ? '' : 'gold'}">${perLang[l] === 0 ? '✓' : perLang[l]}</span>
          <span class="k" style="letter-spacing:0; text-transform:none">${perLang[l] === 0 ? 'complete' : 'missing'}</span>
        </button>`).join('')}
    </div>

    <h2 style="font-family:var(--serif); font-size:20px; margin:0 0 6px">
      Missing in ${esc(LANG_NAMES[active])} — ${missing.length}</h2>
    <p class="dim" style="margin:0 0 14px; font-size:12.5px; max-width:70ch">
      ${notNeeded > 0
        ? `${notNeeded} more records are not counted: a name written in Latin letters is
           the same name in ${esc(LANG_NAMES[active])}, and the fallback chain already returns it.
           Add one by hand from the People or Communities page if it genuinely differs.`
        : `Every kind of record needs ${esc(LANG_NAMES[active])}.`}</p>

    ${missing.length === 0
      ? `<div class="empty">Nothing missing. Every record that needs ${esc(LANG_NAMES[active])} has it.</div>`
      : `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Record</th><th>Type</th><th>Fallback shown</th><th>Coverage</th><th></th></tr></thead>
      <tbody>${missing.map(e => `<tr data-id="${e.id}" data-kind="${e.kind}">
        <td>${esc(e.name)}</td>
        <td class="dim">${esc(TR_KINDS[e.kind].label)}</td>
        <td class="dim">${esc(pickName(e.tr) || '—')}</td>
        <td>${trCoverage(e.tr, needs(e))}</td>
        <td class="actions"><button class="fix">Add ${esc(active.toUpperCase())}</button></td>
      </tr>`).join('')}</tbody></table></div>`}`;

  // setting the hash fires hashchange, which re-runs the router for us
  document.querySelectorAll('#page [data-lang]').forEach(b => {
    b.onclick = () => { location.hash = `#/translations?lang=${b.dataset.lang}`; };
  });
  document.querySelectorAll('#page tbody tr').forEach(tr => {
    tr.querySelector('.fix').onclick = () => quickTranslate(tr.dataset.kind, tr.dataset.id, active, entities);
  });
}

function quickTranslate(kind, id, lang, entities) {
  const e = entities.find(x => x.id === id && x.kind === kind);
  const { table, fk, field, label } = TR_KINDS[kind];

  const el = openDrawer(`${LANG_NAMES[lang]} — ${e.name}`, `
    <div id="drawerErr"></div>
    <p class="dim" style="margin-top:0">
      ${esc(label)}. Currently falling back to <b>${esc(pickName(e.tr) || '—')}</b>.
      Existing translations:</p>
    <div class="tbl-wrap" style="margin-bottom:16px"><table class="tbl">
      <tbody>${(e.tr.length ? e.tr : [{ lang: '—', [field]: 'none' }]).map(t =>
        `<tr><td class="dim" style="width:90px">${esc(LANG_NAMES[t.lang] || t.lang)}</td>
             <td dir="${t.lang === 'he' ? 'rtl' : 'ltr'}">${esc(t[field] || t.name || t.display_name || '')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="field"><label>${esc(LANG_NAMES[lang])}</label>
      <input id="q_val" dir="${lang === 'he' ? 'rtl' : 'ltr'}" placeholder="${esc(pickName(e.tr) || '')}"></div>
  `, [
    { label: 'Cancel', onClick: closeDrawer },
    { label: 'Save', kind: 'solid', onClick: async drawer => {
      const v = drawer.querySelector('#q_val').value.trim();
      if (!v) return;
      try {
        await sb.from(table).upsert({ [fk]: id, lang, [field]: v },
                                    { onConflict: `${fk},lang` });
        toast('Translation saved.');
        closeDrawer();
        translations();
      } catch (err) {
        drawer.querySelector('#drawerErr').innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    } }
  ]);
  el.querySelector('#q_val').focus();
}

/* ---- photos ------------------------------------------------------------- */

/* Two lists behind one page, because they answer two different questions.
   "Waiting" is the old moderation queue and still matters — it holds whatever
   the agent would not clear. "Published by the agent" is new and matters more:
   nothing there was seen by a person before it went up, so this is where a
   person sees it afterwards. Publishing without review is only defensible if
   the undo is one click and the record of every decision is right there. */

const PHOTO_TABS = { pending: 'Waiting', agent: 'Published by the agent', all: 'Everything' };
let photoTab = 'pending';

const PUBLIC_BASE = `${window.TMZ_SUPABASE_URL}/storage/v1/object/public/tmz-photo-public/`;
const thumb = p => p.public_path
  ? `<img class="thumb" src="${PUBLIC_BASE}${encodeURI(p.public_path)}" alt="" loading="lazy">`
  : `<span class="thumb none" title="Not published — the original stays private">—</span>`;

export async function photos() {
  const [pending, agentUp, counts] = await Promise.all([
    sb.from('tmz_photo', {}).select(
      'id,year,storage_path,public_path,source,status,agent_decision,created_at,' +
      'tmz_community(slug,tmz_community_tr(lang,name))',
      { filter: { status: 'eq.pending' }, order: 'created_at.desc', limit: 200 }),
    sb.from('tmz_photo', {}).select(
      'id,year,storage_path,public_path,source,status,agent_decision,published_at,' +
      'tmz_community(slug,tmz_community_tr(lang,name))',
      { filter: { published_by: 'eq.agent' }, order: 'published_at.desc', limit: 200 }),
    sb.from('tmz_photo', {}).select('id,status', { limit: 2000 })
  ]);

  const by = s => counts.filter(c => c.status === s).length;
  const rows = photoTab === 'pending' ? pending
             : photoTab === 'agent' ? agentUp
             : await sb.from('tmz_photo', {}).select(
                 'id,year,storage_path,public_path,source,status,agent_decision,created_at,' +
                 'tmz_community(slug,tmz_community_tr(lang,name))',
                 { order: 'created_at.desc', limit: 200 });

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Photographs</h1>
        <p>${by('pending')} waiting · ${by('approved')} on the site · ${by('rejected')} rejected
           · ${agentUp.length} published by the agent.</p></div>
    </div>
    <div class="tabs">${Object.entries(PHOTO_TABS).map(([k, label]) =>
      `<button class="tab ${photoTab === k ? 'on' : ''}" data-tab="${k}">${label}</button>`).join('')}</div>
    ${rows.length === 0 ? `<div class="empty">${
      photoTab === 'agent'
        ? 'The agent has not published anything yet.'
        : 'Nothing here. Photographs arrive from the upload page and from WhatsApp.'
    }</div>` : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th></th><th>Community</th><th>Year</th><th>Source</th><th>Status</th><th>Screening</th><th></th></tr></thead>
      <tbody>${rows.map(p => `<tr data-id="${p.id}">
        <td>${thumb(p)}</td>
        <td>${esc(pickName((p.tmz_community || {}).tmz_community_tr) || (p.tmz_community || {}).slug || '—')}</td>
        <td>${p.year || '<span class="dim">not placed</span>'}</td>
        <td>${esc(p.source)}</td>
        <td><span class="pill ${p.status}">${esc(p.status)}</span></td>
        <td>${p.agent_decision ? `<span class="pill ${p.agent_decision}">${esc(p.agent_decision)}</span>` : '<span class="dim">—</span>'}</td>
        <td class="actions">
          <button class="edit">Open</button>
          ${p.status === 'approved'
            ? `<button class="del down">Take down</button>`
            : `<button class="up">Publish</button><button class="del">Reject</button>`}
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`}`;

  document.querySelectorAll('#page .tab').forEach(b => {
    b.onclick = () => { photoTab = b.dataset.tab; photos(); };
  });
  document.querySelectorAll('#page tbody tr').forEach(tr => {
    const row = rows.find(r => r.id === tr.dataset.id);
    tr.querySelector('.edit').onclick = () => photoDrawer(row);
    tr.querySelector('.up')?.addEventListener('click', () => setPhotoStatus(tr.dataset.id, 'approved'));
    tr.querySelector('.del')?.addEventListener('click', () => setPhotoStatus(tr.dataset.id, 'rejected'));
  });
}

/* Everything the brief asks a photograph to carry: its text in any of the six
   languages, when it was taken, where, what the occasion was, and who is in
   it. The screening record sits underneath, because for anything the agent
   published that record is the only account of why it is on the site. */
async function photoDrawer(row) {
  const [full] = await sb.from('tmz_photo', {}).select(
    'id,community_id,year,taken_on,venue,event_type_id,status,source,storage_path,' +
    'public_path,published_by,published_at,width,height,bytes,phash,submitter_ref,agent_decision,' +
    'tmz_photo_tr(lang,caption),tmz_photo_person(person_id,tmz_person(tmz_person_tr(lang,display_name)))',
    { filter: { id: `eq.${row.id}` } });
  const p = full || row;

  const [{ communities }, events, mods] = await Promise.all([
    lookups(),
    sb.from('tmz_event_type', {}).select('id,tmz_event_type_tr(lang,name)', { order: 'sort.asc' }),
    sb.from('tmz_moderation', {}).select('pass,decision,model,verdict,scores,reasons,decided_at',
      { filter: { photo_id: `eq.${p.id}` }, order: 'decided_at.asc' })
  ]);

  const capOf = l => (p.tmz_photo_tr || []).find(t => t.lang === l)?.caption || '';
  const tagged = (p.tmz_photo_person || []).map(t => ({
    id: t.person_id,
    name: pickName((t.tmz_person || {}).tmz_person_tr) || t.person_id.slice(0, 8)
  }));

  const el = openDrawer('Photograph', `
    ${p.public_path
      ? `<img class="preview" src="${PUBLIC_BASE}${encodeURI(p.public_path)}" alt="">`
      : `<div class="preview none">Not published, so there is no public copy to show.
           The original is in the private bucket.</div>`}

    <div class="grid2">
      <div><label>Community</label>
        <select id="f_comm"><option value="">— not placed —</option>
          ${communities.map(c => `<option value="${c.id}" ${c.id === p.community_id ? 'selected' : ''}>
            ${esc(pickName(c.tmz_community_tr) || c.slug)}</option>`).join('')}
        </select></div>
      <div><label>Year</label><input id="f_year" type="number" min="1990" max="2030" value="${p.year ?? ''}"></div>
      <div><label>Date taken <span class="dim">if known</span></label>
        <input id="f_date" type="date" value="${p.taken_on ?? ''}"></div>
      <div><label>Occasion</label>
        <select id="f_event"><option value="">— none —</option>
          ${events.map(e => `<option value="${e.id}" ${e.id === p.event_type_id ? 'selected' : ''}>
            ${esc(pickName(e.tmz_event_type_tr) || e.id)}</option>`).join('')}
        </select></div>
    </div>
    <label>Place</label><input id="f_venue" value="${esc(p.venue ?? '')}">

    <h3 class="drawer-h3">Caption</h3>
    ${LANGS.map(l => `<label>${LANG_NAMES[l]}</label>
      <input class="cap" data-lang="${l}" value="${esc(capOf(l))}" dir="${l === 'he' ? 'rtl' : 'ltr'}">`).join('')}

    <h3 class="drawer-h3">Who is in it</h3>
    <div id="tags" class="tags">${tagged.length
      ? tagged.map(t => `<span class="tag" data-person="${t.id}">${esc(t.name)}<button aria-label="Remove">✕</button></span>`).join('')
      : '<span class="dim">Nobody tagged yet.</span>'}</div>
    <div class="row-inline">
      <input id="f_person" list="peopleList" placeholder="Type a name…">
      <datalist id="peopleList"></datalist>
      <button class="btn" id="addTag">Tag</button>
    </div>

    <h3 class="drawer-h3">Screening record</h3>
    ${mods.length ? `<table class="tbl mini"><tbody>${mods.map(m => `<tr>
      <td class="mono">${esc(m.pass || '—')}</td>
      <td>${esc(m.decision || m.verdict)}</td>
      <td class="mono dim">${esc(m.model)}</td>
      <td class="dim">${esc((m.reasons || []).join('; ')).slice(0, 160)}</td>
    </tr>`).join('')}</tbody></table>` : '<p class="dim">No screening recorded.</p>'}

    <p class="dim mono" style="margin-top:14px">
      ${p.width ?? '?'}×${p.height ?? '?'} · ${Math.round((p.bytes ?? 0) / 1024)} KB · ${esc(p.source)}
      ${p.published_by ? ` · published by ${esc(p.published_by)}` : ''}<br>
      ${esc(p.storage_path)}<br>${esc(p.submitter_ref ?? '')}
    </p>`,
    [
      { label: 'Save', kind: 'solid', onClick: save },
      p.status === 'approved'
        ? { label: 'Take down', kind: 'danger', onClick: () => { closeDrawer(); setPhotoStatus(p.id, 'rejected'); } }
        : { label: 'Publish', kind: 'solid', onClick: () => { closeDrawer(); setPhotoStatus(p.id, 'approved'); } }
    ]);

  /* The name list is only fetched when the drawer opens — 231 people is small,
     but the photographs list is not the place to carry it. */
  const people = await sb.from('tmz_person', {}).select(
    'id,tmz_person_tr(lang,display_name)', { limit: 1000 });
  const nameOf = pr => pickName(pr.tmz_person_tr) || pr.id.slice(0, 8);
  el.querySelector('#peopleList').innerHTML =
    people.map(pr => `<option value="${esc(nameOf(pr))}">`).join('');

  const tagsEl = el.querySelector('#tags');
  const wire = span => span.querySelector('button').onclick = () => span.remove();
  tagsEl.querySelectorAll('.tag').forEach(wire);

  el.querySelector('#addTag').onclick = () => {
    const typed = el.querySelector('#f_person').value.trim();
    const hit = people.find(pr => nameOf(pr).toLowerCase() === typed.toLowerCase());
    if (!hit) { toast('No person by that name. Add them on the People page first.', 'error'); return; }
    if (tagsEl.querySelector(`[data-person="${hit.id}"]`)) return;
    tagsEl.querySelector('.dim')?.remove();
    const span = document.createElement('span');
    span.className = 'tag';
    span.dataset.person = hit.id;
    span.innerHTML = `${esc(nameOf(hit))}<button aria-label="Remove">✕</button>`;
    wire(span);
    tagsEl.append(span);
    el.querySelector('#f_person').value = '';
  };

  async function save() {
    try {
      const year = el.querySelector('#f_year').value;
      await sb.from('tmz_photo').update({
        community_id: el.querySelector('#f_comm').value || null,
        year: year ? Number(year) : null,
        taken_on: el.querySelector('#f_date').value || null,
        event_type_id: el.querySelector('#f_event').value || null,
        venue: el.querySelector('#f_venue').value.trim() || null
      }, { id: `eq.${p.id}` });

      /* Captions: write the ones with text, delete the ones emptied. A blank
         row would satisfy the fallback chain and show a caption of nothing. */
      const caps = Array.from(el.querySelectorAll('.cap'))
        .map(i => ({ photo_id: p.id, lang: i.dataset.lang, caption: i.value.trim() }));
      const filled = caps.filter(c => c.caption);
      const emptied = caps.filter(c => !c.caption).map(c => c.lang);
      if (filled.length) await sb.from('tmz_photo_tr').upsert(filled);
      for (const lang of emptied) {
        await sb.from('tmz_photo_tr').delete({ photo_id: `eq.${p.id}`, lang: `eq.${lang}` });
      }

      const want = Array.from(tagsEl.querySelectorAll('.tag')).map(s => s.dataset.person);
      const had = tagged.map(t => t.id);
      const added = want.filter(id => !had.includes(id));
      const removed = had.filter(id => !want.includes(id));
      if (added.length) {
        await sb.from('tmz_photo_person').insert(
          added.map(person_id => ({ photo_id: p.id, person_id })));
      }
      for (const person_id of removed) {
        await sb.from('tmz_photo_person').delete({ photo_id: `eq.${p.id}`, person_id: `eq.${person_id}` });
      }

      closeDrawer();
      toast('Saved.');
      photos();
    } catch (e) { alert(e.message); }
  }
}

/* Publishing moves a file, it does not just flip a column. The DERIVED copy is
   what gets published — sanitised and resized — never the original bytes; that
   distinction is the whole point of keeping two of them. Taking a photograph
   down deletes the public object, because a row change alone leaves the URL
   answering 200. */
async function setPhotoStatus(id, status) {
  try {
    const patch = { status };

    if (status === 'approved') {
      const [row] = await sb.from('tmz_photo', {})
        .select('storage_path,derived_path,public_path', { filter: { id: `eq.${id}` } });
      if (!row) throw new Error('That photograph no longer exists.');

      if (!row.public_path) {
        const source = row.derived_path || row.storage_path;
        const dest = source.replace(/^derived\//, '');
        await sb.storageCopy('tmz-photo-originals', source, 'tmz-photo-public', dest);
        patch.public_path = dest;
      }
      patch.published_by = 'staff';
      patch.published_at = new Date().toISOString();
    } else {
      const [row] = await sb.from('tmz_photo', {})
        .select('public_path', { filter: { id: `eq.${id}` } });
      if (row?.public_path) {
        await sb.storageRemove('tmz-photo-public', row.public_path);
        patch.public_path = null;
      }
      patch.published_by = null;
      patch.published_at = null;
    }

    await sb.from('tmz_photo').update(patch, { id: `eq.${id}` });
    toast(status === 'approved' ? 'Published.' : 'Taken down.');
    photos();
  } catch (e) { alert(e.message); }
}
