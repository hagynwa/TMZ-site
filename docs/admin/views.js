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
export async function translations() {
  const [comms, ppl] = await Promise.all([
    sb.from('tmz_community', {}).select('id,slug,tmz_community_tr(lang,name)', { order: 'slug.asc' }),
    sb.from('tmz_person', {}).select('id,slug,tmz_person_tr(lang,display_name)', { order: 'slug.asc.nullslast' })
  ]);

  const entities = [
    ...comms.map(c => ({ kind: 'community', id: c.id, slug: c.slug,
                         name: pickName(c.tmz_community_tr) || c.slug, tr: c.tmz_community_tr || [] })),
    ...ppl.map(p => ({ kind: 'person', id: p.id, slug: p.slug || '—',
                       name: pickName(p.tmz_person_tr) || p.slug || 'unnamed', tr: p.tmz_person_tr || [] }))
  ];

  const perLang = {};
  for (const l of LANGS) perLang[l] = entities.filter(e => !e.tr.some(t => t.lang === l)).length;
  const active = (new URLSearchParams(location.hash.split('?')[1] || '')).get('lang') || 'he';
  const missing = entities.filter(e => !e.tr.some(t => t.lang === active));

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Translations</h1>
        <p>${entities.length} translatable records across communities and people.</p></div>
    </div>
    <div class="stat-grid">
      ${LANGS.map(l => `
        <button class="stat-tile" data-lang="${l}" style="text-align:start; ${l === active ? 'border-color:rgba(232,200,125,.5)' : ''}">
          <span class="k">${esc(LANG_NAMES[l])}</span>
          <span class="v ${perLang[l] ? '' : 'gold'}">${perLang[l] === 0 ? '✓' : perLang[l]}</span>
          <span class="k" style="letter-spacing:0; text-transform:none">${perLang[l] === 0 ? 'complete' : 'missing'}</span>
        </button>`).join('')}
    </div>

    <h2 style="font-family:var(--serif); font-size:20px; margin:0 0 12px">
      Missing in ${esc(LANG_NAMES[active])} — ${missing.length}</h2>
    ${missing.length === 0
      ? `<div class="empty">Nothing missing. Every record has a ${esc(LANG_NAMES[active])} translation.</div>`
      : `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Record</th><th>Type</th><th>Fallback shown</th><th>Coverage</th><th></th></tr></thead>
      <tbody>${missing.map(e => `<tr data-id="${e.id}" data-kind="${e.kind}">
        <td>${esc(e.name)}</td>
        <td class="dim">${esc(e.kind)}</td>
        <td class="dim">${esc(pickName(e.tr) || '—')}</td>
        <td>${coverage(e.tr)}</td>
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
  const e = entities.find(x => x.id === id);
  const table = kind === 'community' ? 'tmz_community_tr' : 'tmz_person_tr';
  const fkey = kind === 'community' ? 'community_id' : 'person_id';
  const field = kind === 'community' ? 'name' : 'display_name';

  const el = openDrawer(`${LANG_NAMES[lang]} — ${e.name}`, `
    <div id="drawerErr"></div>
    <p class="dim" style="margin-top:0">
      Currently falling back to <b>${esc(pickName(e.tr) || '—')}</b>.
      Existing translations:</p>
    <div class="tbl-wrap" style="margin-bottom:16px"><table class="tbl">
      <tbody>${(e.tr.length ? e.tr : [{ lang: '—', [field]: 'none' }]).map(t =>
        `<tr><td class="dim" style="width:90px">${esc(LANG_NAMES[t.lang] || t.lang)}</td>
             <td>${esc(t[field] || t.name || t.display_name || '')}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="field"><label>${esc(LANG_NAMES[lang])}</label>
      <input id="q_val" dir="${lang === 'he' ? 'rtl' : 'ltr'}" placeholder="${esc(pickName(e.tr) || '')}"></div>
  `, [
    { label: 'Cancel', onClick: closeDrawer },
    { label: 'Save', kind: 'solid', onClick: async drawer => {
      const v = drawer.querySelector('#q_val').value.trim();
      if (!v) return;
      try {
        await sb.from(table).upsert({ [fkey]: id, lang, [field]: v },
                                    { onConflict: `${fkey},lang` });
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

/* ---- photos / moderation queue ------------------------------------------ */

export async function photos() {
  const [pending, approved, rejected] = await Promise.all([
    sb.from('tmz_photo', {}).select(
      'id,year,storage_path,source,created_at,tmz_community(slug,tmz_community_tr(lang,name))',
      { filter: { status: 'eq.pending' }, order: 'created_at.desc', limit: 200 }),
    sb.from('tmz_photo', {}).select('id', { filter: { status: 'eq.approved' } }),
    sb.from('tmz_photo', {}).select('id', { filter: { status: 'eq.rejected' } })
  ]);

  $('#page').innerHTML = `
    <div class="page-head">
      <div><h1>Moderation queue</h1>
        <p>${pending.length} waiting · ${approved.length} approved · ${rejected.length} rejected.</p></div>
    </div>
    ${pending.length === 0 ? `<div class="empty">Nothing waiting. New submissions from the upload page or WhatsApp appear here first.</div>` : `
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>Submitted</th><th>Community</th><th>Year</th><th>Source</th><th>Path</th><th></th></tr></thead>
      <tbody>${pending.map(p => `<tr data-id="${p.id}">
        <td class="mono">${new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' ')}</td>
        <td>${esc(pickName((p.tmz_community || {}).tmz_community_tr) || (p.tmz_community || {}).slug || '—')}</td>
        <td>${p.year || '—'}</td>
        <td>${esc(p.source)}</td>
        <td class="mono">${esc(p.storage_path)}</td>
        <td class="actions">
          <button class="approve">Approve</button>
          <button class="del">Reject</button>
        </td>
      </tr>`).join('')}</tbody>
    </table></div>`}`;

  document.querySelectorAll('#page tbody tr').forEach(tr => {
    tr.querySelector('.approve').onclick = () => setPhotoStatus(tr.dataset.id, 'approved');
    tr.querySelector('.del').onclick = () => setPhotoStatus(tr.dataset.id, 'rejected');
  });
}

async function setPhotoStatus(id, status) {
  try {
    const patch = { status };
    if (status === 'approved') patch.published_at = new Date().toISOString();
    await sb.from('tmz_photo').update(patch, { id: `eq.${id}` });
    toast(status === 'approved' ? 'Photo approved.' : 'Photo rejected.');
    photos();
  } catch (e) { alert(e.message); }
}
