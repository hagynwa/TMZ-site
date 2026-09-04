/* The public site's only link to the archive.
 *
 * Two RPCs cover both views, each returning a payload already resolved into
 * the requested language, so the browser never joins translation tables or
 * learns that the private originals bucket exists.
 *
 * ?demo=1 keeps the invented data from data.js instead — the generated
 * rosters and photograph counts that were built before there was a database.
 * It exists so the design can still be shown to someone before the archive
 * has anything in it, and it says so on screen. It is never the default. */

const TMZ_SUPABASE_URL = 'https://xuoxkmwtdascazutoaxs.supabase.co';
const TMZ_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1b3hrbXd0ZGFzY2F6dXRvYXhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3MjI5MDcsImV4cCI6MjA3NTI5ODkwN30.Cy1W0lXNuP-lXbRyGOPjz2fL6ano-Nzxf7HBoRv9EJM';

const DEMO = new URLSearchParams(location.search).get('demo') === '1';

async function rpc(fn, args) {
  const res = await fetch(`${TMZ_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: TMZ_ANON_KEY,
      Authorization: `Bearer ${TMZ_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`${fn} → ${res.status}`);
  return res.json();
}

/* A photograph is only ever served from the public bucket, and only ever has
   a path there once a reviewer approved it. */
const photoUrl = path =>
  path ? `${TMZ_SUPABASE_URL}/storage/v1/object/public/tmz-photo-public/${path}` : null;

/* ---- map ----------------------------------------------------------------- */

/* Adapts the payload to the shape the map already speaks: a flat name string
   rather than a translation object (tf() passes strings straight through), and
   a years map the band reads instead of the old generator. */
async function loadMap(lang) {
  if (DEMO) {
    return {
      demo: true,
      communities: COMMUNITIES.map(c => ({ ...c, total: null, years: null })),
      regions: REGIONS.map(id => ({ id, name: null }))
    };
  }
  const p = await rpc('tmz_map_payload', { want: lang });
  return {
    demo: false,
    communities: (p.communities || []).map(c => ({
      id: c.id, name: c.name, lon: c.lon, lat: c.lat, rg: c.rg,
      f: c.f, c: c.c || 0,
      total: c.total || 0,
      years: c.years || {}
    })),
    regions: p.regions || []
  };
}

/* The per-year bars for one community. Live data gives us only the years that
   have something, so the empty ones have to be filled in — those gaps are the
   point of the whole campaign and must be drawn, not omitted. */
function historyFrom(community) {
  if (DEMO) return historyOf(community);
  const last = community.c || 2026;
  const rows = [];
  let peak = 1, total = 0, holes = 0;
  for (let y = community.f; y <= last; y++) {
    const n = community.years[String(y)] || 0;
    if (n > peak) peak = n;
    if (n === 0) holes++; else total += n;
    rows.push({ year: y, n });
  }
  return { rows, peak, total, holes, first: community.f, last };
}

/* ---- year ---------------------------------------------------------------- */

async function loadYear(slug, year, lang) {
  const p = await rpc('tmz_year_payload', { community_slug: slug, yr: year, want: lang });
  const roster = p.roster || [];
  return {
    community: p.community,
    year: p.year,
    // The Rosh Kollel and his household are tenures like any other; the shape
    // the year screen wants is those three groups pulled apart. A household
    // belongs to whoever household_of names, NOT to whoever happens to be Rosh
    // Kollel that year — a shaliach's wife is not the Rosh Kollel's wife, and
    // grouping every spouse under him says on screen that she is.
    ...(() => {
      const rosh = roster.find(r => r.role === 'rosh_kollel') || null;
      const kin = roster.filter(r => ['spouse', 'child'].includes(r.role));
      const household = rosh ? kin.filter(r => r.household_of === rosh.id) : [];
      const claimed = new Set(household.map(r => r.id));

      // Each shaliach followed immediately by whoever came with him, so a
      // couple reads as a couple and the count matches the cards on screen.
      const cohort = [];
      for (const h of roster.filter(r => ['shaliach', 'shlicha', 'staff'].includes(r.role))) {
        cohort.push(h);
        for (const k of kin) if (k.household_of === h.id) { cohort.push(k); claimed.add(k.id); }
      }
      // Anyone whose household head is not on this year's roster is named on
      // her own rather than dropped off the screen.
      for (const k of kin) if (!claimed.has(k.id)) cohort.push(k);

      return { rosh, household, cohort };
    })(),
    photos: (p.photos || []).map(ph => ({ ...ph, url: photoUrl(ph.path) })),
    empty: roster.length === 0 && (p.photos || []).length === 0
  };
}

window.TMZApi = { loadMap, loadYear, historyFrom, photoUrl, DEMO };
