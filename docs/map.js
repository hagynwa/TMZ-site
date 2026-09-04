/* The schematic projection, the stipple, the clustering and the label placement.
   Longitude and latitude are each stretched piecewise so the bands that hold
   communities get room and the empty oceans give it up. Jerusalem lands dead
   centre horizontally. Everything is expressed as a fraction of the stage, so
   the same composition survives any viewport. */

const LONF = [
  [-180, -160, 0,       0.01250], [-160, -70, 0.01250, 0.31250],
  [ -70,  -45, 0.31250, 0.35625], [ -45,   0, 0.35625, 0.50000],
  [   0,   15, 0.50000, 0.54844], [  15, 122, 0.54844, 0.91563],
  [ 122,  180, 0.91563, 1.00000]
];
const LATF = [
  [ 68,  60, 0,       0.03285], [ 60,  25, 0.03285, 0.46715],
  [ 25, -10, 0.46715, 0.67153], [-10, -40, 0.67153, 0.96350],
  [-40, -45, 0.96350, 1.00000]
];
const JERUSALEM = { lon: 35.22, lat: 31.78 };

const LAND_BOX = LAND.map(poly => {
  let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
});

function inLand(lon, lat) {
  for (let p = 0; p < LAND.length; p++) {
    const b = LAND_BOX[p];
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    const poly = LAND[p];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function projection(W, H) {
  const fx = lon => {
    let l = lon - JERUSALEM.lon;
    while (l < -180) l += 360;
    while (l > 180) l -= 360;
    for (const b of LONF) if (l >= b[0] && l <= b[1]) return (b[2] + (l - b[0]) / (b[1] - b[0]) * (b[3] - b[2])) * W;
    return W / 2;
  };
  const fy = lat => {
    for (const b of LATF) if (lat <= b[0] && lat >= b[1]) return (b[2] + (b[0] - lat) / (b[0] - b[1]) * (b[3] - b[2])) * H;
    return lat > 68 ? 0 : H;
  };
  const ix = x => {
    const u = x / W;
    for (const b of LONF) if (u >= b[2] && u <= b[3]) return b[0] + (u - b[2]) / (b[3] - b[2]) * (b[1] - b[0]) + JERUSALEM.lon;
    return JERUSALEM.lon;
  };
  const iy = y => {
    const v = y / H;
    for (const b of LATF) if (v >= b[2] && v <= b[3]) return b[0] - (v - b[2]) / (b[3] - b[2]) * (b[0] - b[1]);
    return 0;
  };
  return { fx, fy, ix, iy };
}

/* Re-sampled at every view so dot spacing on screen stays constant: zoomed-in
   land looks like land, not a magnified blur. */
function stipple(proj, W, H, s, tx, ty, step) {
  const x0 = Math.max(0, -tx / s), x1 = Math.min(W, (W - tx) / s);
  const y0 = Math.max(0, -ty / s), y1 = Math.min(H, (H - ty) / s);
  const d = step / s;
  let path = '';
  for (let y = y0; y <= y1; y += d) {
    const lat = proj.iy(y);
    for (let x = x0; x <= x1; x += d) {
      if (inLand(proj.ix(x), lat)) path += 'M' + x.toFixed(1) + ',' + y.toFixed(1) + 'h0';
    }
  }
  return path;
}

/* An arc that leaves Jerusalem and bulges north — the Torah going out from Zion */
function arc(jx, jy, x, y) {
  const dx = x - jx, dy = y - jy, len = Math.hypot(dx, dy) || 1;
  const sg = dx >= 0 ? -1 : 1, bulge = len * 0.17;
  const qx = ((jx + x) / 2 + sg * (-dy / len) * bulge).toFixed(1);
  const qy = ((jy + y) / 2 + sg * (dx / len) * bulge).toFixed(1);
  return `M${jx.toFixed(1)},${jy.toFixed(1)} Q${qx},${qy} ${x.toFixed(1)},${y.toFixed(1)} `;
}

/* Anything closer than this on screen cannot be told apart, so it collapses into
   one marker carrying a count. Zooming pulls the group back open. */
const CLUSTER_PX = 24;

function clusterPoints(pts, selId) {
  const sorted = pts.slice().sort((a, b) => {
    if ((a.c.id === selId) !== (b.c.id === selId)) return a.c.id === selId ? -1 : 1;
    if ((!a.c.c) !== (!b.c.c)) return !a.c.c ? -1 : 1;
    return a.c.f - b.c.f;
  });
  const groups = [];
  for (const pt of sorted) {
    let joined = false;
    if (pt.c.id !== selId) {
      for (const g of groups) {
        if (g[0].c.id === selId) continue;
        if (Math.hypot(pt.x - g[0].x, pt.y - g[0].y) < CLUSTER_PX) { g.push(pt); joined = true; break; }
      }
    }
    if (!joined) groups.push([pt]);
  }
  return groups;
}

/* Eight candidate slots per city; the first that collides with nothing wins.
   In a right-to-left language a label must reach west off its dot first, or the
   eye leaves the dot the wrong way. */
function labelSlots(rtl) {
  const ltr = [[13,0,'s'], [-13,0,'e'], [0,-15,'m'], [0,16,'m'],
               [11,-11,'s'], [11,12,'s'], [-11,-11,'e'], [-11,12,'e']];
  if (!rtl) return ltr;
  return [ltr[1], ltr[0], ltr[2], ltr[3], ltr[6], ltr[7], ltr[4], ltr[5]];
}

function placeLabels(markers, blocked, W, H, rtl) {
  const slots = labelSlots(rtl);
  const taken = blocked.slice();
  for (const m of markers) taken.push([m.x - 10, m.y - 10, m.x + 10, m.y + 10]);
  const clear = r => !taken.some(t => r[0] < t[2] && r[2] > t[0] && r[1] < t[3] && r[3] > t[1]);

  for (const m of markers) {
    if (m.count > 1) { m.label = null; continue; }
    const sel = m.sel;
    const per = sel ? 9.4 : 6.9, h = sel ? 15 : 12;
    const w = m.name.length * per;
    let placed = null;
    for (const sl of slots) {
      const lx = m.x + sl[0], ly = m.y + sl[1];
      const x0 = sl[2] === 's' ? lx : sl[2] === 'e' ? lx - w : lx - w / 2;
      const rect = [x0, ly - h / 2, x0 + w, ly + h / 2];
      if (rect[0] < 4 || rect[2] > W - 4 || rect[1] < 2 || rect[3] > H - 2) continue;
      if (clear(rect)) { placed = sl; taken.push(rect); break; }
    }
    m.label = placed;
  }
  return markers;
}

/* Each region's view is fitted to its own bounding box, so a region added in the
   back office needs no code. The community list is passed in rather than read
   from a global: it arrives from the database now, not a file. */
function buildViews(proj, W, H, communities, regions) {
  const pad = { x0: W * 0.06, x1: W * 0.94, y0: H * 0.10, y1: H * 0.92 };
  const views = { world: { s: 1, cx: W / 2, cy: H / 2, key: 'fly.world', n: communities.length } };
  for (const rg of regions) {
    const mem = communities.filter(c => c.rg === rg);
    if (!mem.length) continue;
    const xs = mem.map(c => proj.fx(c.lon)), ys = mem.map(c => proj.fy(c.lat));
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs);
    const by0 = Math.min(...ys), by1 = Math.max(...ys);
    const bw = Math.max(bx1 - bx0, W * 0.03), bh = Math.max(by1 - by0, H * 0.05);
    const fit = Math.min((pad.x1 - pad.x0) / bw, (pad.y1 - pad.y0) / bh);
    views[rg] = { s: Math.max(1, Math.min(6, fit * 0.88)),
                  cx: (bx0 + bx1) / 2, cy: (by0 + by1) / 2,
                  key: 'region.' + rg, n: mem.length };
  }
  return views;
}

/* Clicking a cluster flies to THAT cluster, not to its region, so the drill-down
   always terminates however many communities share a city block. */
function fitCluster(members, W, H) {
  const xs = members.map(m => m.mx), ys = members.map(m => m.my);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = Math.max(x1 - x0, W * 0.035), h = Math.max(y1 - y0, H * 0.05);
  const fit = Math.min((W * 0.88) / w, (H * 0.82) / h);
  return { s: Math.max(1, Math.min(14, fit * 0.88)), cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
