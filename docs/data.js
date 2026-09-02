/* ---------------------------------------------------------------------------
   Everything below is INVENTED. Community list, founding years, open/closed
   status, every person and every photograph are generated placeholder data.
   Nothing here is a record of any real community or person.

   Shaped the way the real schema will be, so the views are written against
   something realistic: content fields are { en, he, ru, ... } and go through
   the same fallback chain as the UI strings.
--------------------------------------------------------------------------- */

const REGIONS = ['na', 'la', 'eu', 'oc'];

const COMMUNITIES = [
  { id:'toronto',   name:{en:'Toronto',   he:'טורונטו',   ru:'Торонто'},   lon:-79.38,  lat:43.65,  rg:'na', f:1997, c:0 },
  { id:'montreal',  name:{en:'Montreal',  he:'מונטריאול', ru:'Монреаль'},  lon:-73.57,  lat:45.50,  rg:'na', f:1999, c:0 },
  { id:'chicago',   name:{en:'Chicago',   he:'שיקגו',     ru:'Чикаго'},    lon:-87.63,  lat:41.88,  rg:'na', f:1999, c:0 },
  { id:'washington',name:{en:'Washington',he:'וושינגטון', ru:'Вашингтон'}, lon:-77.04,  lat:38.91,  rg:'na', f:2000, c:0 },
  { id:'cleveland', name:{en:'Cleveland', he:'קליבלנד',   ru:'Кливленд'},  lon:-81.69,  lat:41.50,  rg:'na', f:2001, c:2014 },
  { id:'memphis',   name:{en:'Memphis',   he:'ממפיס',     ru:'Мемфис'},    lon:-90.05,  lat:35.15,  rg:'na', f:2001, c:0 },
  { id:'newyork',   name:{en:'New York',  he:'ניו יורק',  ru:'Нью-Йорк'},  lon:-74.01,  lat:40.71,  rg:'na', f:2003, c:0 },
  { id:'detroit',   name:{en:'Detroit',   he:'דטרויט',    ru:'Детройт'},   lon:-83.05,  lat:42.33,  rg:'na', f:2004, c:2011 },
  { id:'kansas',    name:{en:'Kansas City',he:'קנזס סיטי',ru:'Канзас-Сити'},lon:-94.58, lat:39.10,  rg:'na', f:2005, c:0 },
  { id:'stlouis',   name:{en:'St Louis',  he:'סנט לואיס', ru:'Сент-Луис'}, lon:-90.20,  lat:38.63,  rg:'na', f:2006, c:0 },
  { id:'atlanta',   name:{en:'Atlanta',   he:'אטלנטה',    ru:'Атланта'},   lon:-84.39,  lat:33.75,  rg:'na', f:2007, c:0 },
  { id:'nashville', name:{en:'Nashville', he:'נאשוויל',   ru:'Нашвилл'},   lon:-86.78,  lat:36.16,  rg:'na', f:2008, c:0 },
  { id:'boca',      name:{en:'Boca Raton',he:'בוקה רטון', ru:'Бока-Ратон'},lon:-80.09,  lat:26.37,  rg:'na', f:2009, c:0 },
  { id:'losangeles',name:{en:'Los Angeles',he:'לוס אנג׳לס',ru:'Лос-Анджелес'},lon:-118.24,lat:34.05,rg:'na', f:2010, c:0 },
  { id:'denver',    name:{en:'Denver',    he:'דנוור',     ru:'Денвер'},    lon:-104.99, lat:39.74,  rg:'na', f:2012, c:0 },
  { id:'vancouver', name:{en:'Vancouver', he:'ונקובר',    ru:'Ванкувер'},  lon:-123.12, lat:49.28,  rg:'na', f:2014, c:0 },
  { id:'baltimore', name:{en:'Baltimore', he:'בולטימור',  ru:'Балтимор'},  lon:-76.61,  lat:39.29,  rg:'na', f:2015, c:0 },
  { id:'houston',   name:{en:'Houston',   he:'יוסטון',    ru:'Хьюстон'},   lon:-95.37,  lat:29.76,  rg:'na', f:2017, c:0 },

  { id:'buenosaires',name:{en:'Buenos Aires',he:'בואנוס איירס',ru:'Буэнос-Айрес'},lon:-58.38,lat:-34.60,rg:'la',f:1998,c:0 },
  { id:'montevideo',name:{en:'Montevideo',he:'מונטבידאו', ru:'Монтевидео'},lon:-56.16,  lat:-34.90, rg:'la', f:2000, c:0 },
  { id:'mexico',    name:{en:'Mexico City',he:'מקסיקו סיטי',ru:'Мехико'},  lon:-99.13,  lat:19.43,  rg:'la', f:2002, c:0 },
  { id:'saopaulo',  name:{en:'São Paulo', he:'סאו פאולו', ru:'Сан-Паулу'}, lon:-46.63,  lat:-23.55, rg:'la', f:2006, c:2019 },
  { id:'santiago',  name:{en:'Santiago',  he:'סנטיאגו',   ru:'Сантьяго'},  lon:-70.65,  lat:-33.46, rg:'la', f:2008, c:0 },
  { id:'panama',    name:{en:'Panama City',he:'פנמה סיטי',ru:'Панама'},    lon:-79.52,  lat:8.98,   rg:'la', f:2011, c:0 },
  { id:'lima',      name:{en:'Lima',      he:'לימה',      ru:'Лима'},      lon:-77.04,  lat:-12.05, rg:'la', f:2013, c:0 },
  { id:'rio',       name:{en:'Rio de Janeiro',he:'ריו דה ז׳ניירו',ru:'Рио-де-Жанейро'},lon:-43.17,lat:-22.91,rg:'la',f:2015,c:2021 },

  { id:'moscow',    name:{en:'Moscow',    he:'מוסקבה',    ru:'Москва'},    lon:37.62,   lat:55.75,  rg:'eu', f:1996, c:2022 },
  { id:'kyiv',      name:{en:'Kyiv',      he:'קייב',      ru:'Киев'},      lon:30.52,   lat:50.45,  rg:'eu', f:2001, c:2022 },
  { id:'antwerp',   name:{en:'Antwerp',   he:'אנטוורפן',  ru:'Антверпен'}, lon:4.40,    lat:51.22,  rg:'eu', f:2003, c:2016 },
  { id:'istanbul',  name:{en:'Istanbul',  he:'איסטנבול',  ru:'Стамбул'},   lon:28.98,   lat:41.01,  rg:'eu', f:2004, c:2015 },
  { id:'paris',     name:{en:'Paris',     he:'פריז',      ru:'Париж'},     lon:2.35,    lat:48.86,  rg:'eu', f:2005, c:0 },
  { id:'warsaw',    name:{en:'Warsaw',    he:'ורשה',      ru:'Варшава'},   lon:21.01,   lat:52.23,  rg:'eu', f:2007, c:0 },
  { id:'london',    name:{en:'London',    he:'לונדון',    ru:'Лондон'},    lon:-0.13,   lat:51.51,  rg:'eu', f:2009, c:2018 },
  { id:'mumbai',    name:{en:'Mumbai',    he:'מומבאי',    ru:'Мумбаи'},    lon:72.88,   lat:19.08,  rg:'eu', f:2010, c:0 },
  { id:'vienna',    name:{en:'Vienna',    he:'וינה',      ru:'Вена'},      lon:16.37,   lat:48.21,  rg:'eu', f:2011, c:0 },
  { id:'munich',    name:{en:'Munich',    he:'מינכן',     ru:'Мюнхен'},    lon:11.58,   lat:48.14,  rg:'eu', f:2012, c:0 },
  { id:'berlin',    name:{en:'Berlin',    he:'ברלין',     ru:'Берлин'},    lon:13.40,   lat:52.52,  rg:'eu', f:2013, c:0 },
  { id:'riga',      name:{en:'Riga',      he:'ריגה',      ru:'Рига'},      lon:24.11,   lat:56.95,  rg:'eu', f:2014, c:0 },
  { id:'milan',     name:{en:'Milan',     he:'מילאנו',    ru:'Милан'},     lon:9.19,    lat:45.46,  rg:'eu', f:2016, c:0 },
  { id:'hongkong',  name:{en:'Hong Kong', he:'הונג קונג', ru:'Гонконг'},   lon:114.17,  lat:22.32,  rg:'eu', f:2018, c:0 },
  { id:'tokyo',     name:{en:'Tokyo',     he:'טוקיו',     ru:'Токио'},     lon:139.69,  lat:35.69,  rg:'eu', f:2020, c:0 },

  { id:'capetown',  name:{en:'Cape Town', he:'קייפטאון',  ru:'Кейптаун'},  lon:18.42,   lat:-33.93, rg:'oc', f:1996, c:0 },
  { id:'sydney',    name:{en:'Sydney',    he:'סידני',     ru:'Сидней'},    lon:151.21,  lat:-33.87, rg:'oc', f:1998, c:0 },
  { id:'melbourne', name:{en:'Melbourne', he:'מלבורן',    ru:'Мельбурн'},  lon:144.96,  lat:-37.81, rg:'oc', f:2000, c:0 },
  { id:'johannesburg',name:{en:'Johannesburg',he:'יוהנסבורג',ru:'Йоханнесбург'},lon:28.05,lat:-26.20,rg:'oc',f:2003,c:0 },
  { id:'perth',     name:{en:'Perth',     he:'פרת׳',      ru:'Перт'},      lon:115.86,  lat:-31.95, rg:'oc', f:2004, c:0 },
  { id:'durban',    name:{en:'Durban',    he:'דרבן',      ru:'Дурбан'},    lon:31.02,   lat:-29.86, rg:'oc', f:2009, c:0 },
  { id:'auckland',  name:{en:'Auckland',  he:'אוקלנד',    ru:'Окленд'},    lon:174.76,  lat:-36.85, rg:'oc', f:2016, c:0 },
  { id:'goldcoast', name:{en:'Gold Coast',he:'גולד קוסט', ru:'Голд-Кост'}, lon:153.43,  lat:-28.02, rg:'oc', f:2019, c:0 }
];

/* Coarse coastlines. Stippling forgives the simplification and is what gives the
   map its schematic character. Verified: every community above sits on land. */
const LAND = [
  [[-168,65],[-164,68],[-156,71],[-148,70],[-136,69],[-128,70],[-120,70],[-112,69],[-104,69],[-96,72],[-90,73],[-82,74],[-76,73],[-70,70],[-64,66],[-60,60],[-56,54],[-53,48],[-60,46],[-66,45],[-70,42],[-74,39],[-76,35],[-81,31],[-80,26],[-83,29],[-88,30],[-94,29],[-97,26],[-97,22],[-91,19],[-87,21],[-88,16],[-92,15],[-96,16],[-101,17],[-106,21],[-110,24],[-114,28],[-117,32],[-121,35],[-124,40],[-124,46],[-125,49],[-131,53],[-136,58],[-142,60],[-150,59],[-158,56],[-162,59],[-166,62]],
  [[-45,60],[-38,63],[-30,68],[-22,70],[-19,74],[-22,78],[-30,82],[-42,83],[-55,82],[-64,80],[-70,77],[-66,72],[-58,66],[-52,62]],
  [[-81,7],[-77,9],[-72,12],[-66,11],[-61,10],[-55,6],[-51,4],[-50,0],[-46,-1],[-41,-3],[-35,-5],[-35,-9],[-38,-13],[-40,-20],[-43,-23],[-48,-26],[-53,-33],[-57,-37],[-62,-39],[-63,-44],[-66,-48],[-69,-52],[-74,-53],[-73,-46],[-75,-40],[-73,-33],[-71,-25],[-70,-18],[-76.5,-14],[-80.5,-7],[-81,-3],[-80,1],[-78,4]],
  [[-92,15],[-88,16],[-84,11],[-79,9],[-76,7],[-79,6],[-84,9],[-88,13],[-92,14]],
  [[-17,15],[-16,20],[-13,25],[-9,30],[-6,35],[0,36],[10,37],[19,33],[25,32],[31,31],[35,28],[38,20],[43,12],[48,12],[51,11],[45,5],[41,-1],[40,-8],[40,-15],[35,-20],[33,-26],[31,-32],[18,-35],[15,-29],[13,-23],[12,-16],[9,-5],[8,4],[3,6],[-4,5],[-8,4],[-13,9],[-16,12]],
  [[-10,44],[-9,39],[-6,36],[-1,37],[3,40],[4,43],[8,44],[12,45],[16,42],[19,40],[23,38],[26,40],[28,41],[30,45],[34,45],[38,46],[40,50],[42,54],[38,58],[30,60],[32,64],[28,66],[22,68],[25,71],[19,69],[15,68],[12,65],[11,60],[13,56],[10,54],[7,54],[5,53],[4,51],[0,49],[-2,48],[-4,48],[-5,46]],
  [[-10,52],[-8,55],[-6,57],[-4,58],[-2,58],[-1,55],[0,53],[1,51],[-2,50],[-5,50],[-8,51]],
  [[36,52],[38,48],[44,45],[52,44],[60,43],[66,41],[72,39],[78,36],[84,31],[90,29],[96,27],[99,23],[103,22],[105,19],[108,21],[110,20],[113,22],[117,23],[120,26],[122,31],[121,37],[125,39],[129,42],[133,45],[137,49],[141,52],[143,55],[141,59],[147,61],[155,62],[163,61],[170,63],[178,65],[180,68],[172,71],[160,72],[148,74],[136,75],[124,74],[112,76],[100,77],[88,77],[76,74],[68,73],[60,71],[52,69],[46,68],[42,66],[38,64],[36,60],[38,55]],
  [[68,24],[70,21],[73,17],[75,12],[78,8],[80,11],[82,17],[85,20],[88,22],[91,22],[92,26],[88,27],[82,27],[76,29],[71,27],[68,25]],
  [[34,30],[38,31],[43,30],[48,30],[53,26],[57,24],[59,21],[55,17],[50,14],[45,12],[43,13],[39,17],[36,23],[34,27]],
  [[26,40],[28,42],[34,42],[40,41],[44,40],[48,38],[50,36],[48,32],[47,30],[44,29],[40,30],[36,29],[34,29],[34,33],[35,36],[32,36],[29,36],[27,37]],
  [[97,21],[99,16],[100,12],[100,7],[103,2],[105,1],[107,3],[109,6],[107,11],[109,15],[107,20],[104,22],[100,21]],
  [[95,6],[99,4],[104,-2],[106,-6],[103,-6],[98,0],[94,4]],
  [[105,-6],[110,-7],[114,-8],[114,-9],[108,-9],[105,-7]],
  [[109,2],[114,4],[119,2],[118,-2],[116,-4],[110,-3],[108,0]],
  [[119,1],[123,0],[125,-2],[123,-5],[120,-4],[119,-2]],
  [[131,-1],[137,-2],[144,-4],[150,-7],[147,-10],[141,-9],[135,-6],[131,-4]],
  [[120,18],[123,17],[126,10],[126,6],[122,6],[120,10],[118,15]],
  [[129,32],[133,33],[137,34],[141,36],[142,40],[145,43],[144,45],[141,43],[140,39],[138,36],[135,34],[131,33]],
  [[43,-12],[47,-14],[50,-16],[49,-22],[46,-25],[44,-22],[43,-16]],
  [[113,-22],[114,-26],[115,-31],[118,-35],[123,-34],[129,-32],[134,-33],[138,-35],[141,-38],[146,-39],[150,-37],[154,-31],[154,-26],[149,-21],[146,-19],[142,-11],[137,-12],[132,-11],[128,-15],[124,-16],[122,-18],[117,-21]],
  [[145,-41],[148,-41],[148,-43],[145,-43]],
  [[166,-46],[170,-44],[174,-41],[177,-38],[175,-36],[172,-40],[168,-44]],
  [[80,9],[82,8],[82,6],[80,6]],
  [[-24,65],[-19,66],[-14,66],[-14,64],[-20,63]],
  [[-85,22],[-78,21],[-74,20],[-77,23],[-83,23]]
];

/* --- deterministic invention ---------------------------------------------- */

function seedOf(str) {
  let s = 0;
  for (let i = 0; i < str.length; i++) s = (s * 31 + str.charCodeAt(i)) % 1000000;
  return s;
}
function rng(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const MEN = [
  {en:'Yonatan',he:'יונתן'},{en:'Shmuel',he:'שמואל'},{en:'Dovid',he:'דוד'},{en:'Elchanan',he:'אלחנן'},
  {en:'Tzvi',he:'צבי'},{en:'Binyamin',he:'בנימין'},{en:'Meir',he:'מאיר'},{en:'Yehuda',he:'יהודה'},
  {en:'Amichai',he:'עמיחי'},{en:'Yisrael',he:'ישראל'},{en:'Natan',he:'נתן'},{en:'Gidon',he:'גדעון'},
  {en:'Uri',he:'אורי'},{en:'Refael',he:'רפאל'},{en:'Aharon',he:'אהרן'},{en:'Moshe',he:'משה'},
  {en:'Yaakov',he:'יעקב'},{en:'Doron',he:'דורון'},{en:'Shlomo',he:'שלמה'},{en:'Avraham',he:'אברהם'},
  {en:'Ariel',he:'אריאל'},{en:'Netanel',he:'נתנאל'},{en:'Eitan',he:'איתן'},{en:'Yoav',he:'יואב'},
  {en:'Amit',he:'עמית'},{en:'Menachem',he:'מנחם'}
];
const WOMEN = [
  {en:'Avigail',he:'אביגיל'},{en:'Tamar',he:'תמר'},{en:'Shira',he:'שירה'},{en:'Noa',he:'נעה'},
  {en:'Michal',he:'מיכל'},{en:'Ayala',he:'איילה'},{en:'Shaked',he:'שקד'},{en:'Roni',he:'רוני'},
  {en:'Yael',he:'יעל'},{en:'Hodaya',he:'הודיה'},{en:'Maayan',he:'מעיין'},{en:'Talia',he:'טליה'},
  {en:'Rivka',he:'רבקה'},{en:'Efrat',he:'אפרת'},{en:'Chana',he:'חנה'},{en:'Naama',he:'נעמה'}
];
const INITIALS = ['A.','B.','C.','D.','E.','F.','G.','H.','K.','L.','M.','N.','P.','R.','S.','T.','V.','W.','Z.'];
const YESHIVOT = ['Har Etzion','Migdal Oz','Ein HaNatziv','Otniel','Sha\'alvim','Ma\'ale Gilboa','Ein Tzurim','Kerem B\'Yavneh'];

const EVENTS = [
  {en:'Simchat Torah hakafot', he:'הקפות שמחת תורה'},
  {en:'Community shabbaton',   he:'שבתון קהילתי'},
  {en:'Morning seder',         he:'סדר בוקר'},
  {en:"Yom Ha'atzmaut",        he:'יום העצמאות'},
  {en:'Chanukah night',        he:'ליל חנוכה'},
  {en:'Purim seudah',          he:'סעודת פורים'},
  {en:'Opening night',         he:'ערב פתיחה'},
  {en:'Melave Malka',          he:'מלווה מלכה'},
  {en:'Shavuot night learning',he:'ליל שבועות'},
  {en:'Farewell dinner',       he:'ארוחת פרידה'},
  {en:'Chavruta learning',     he:'לימוד בחברותא'},
  {en:'Youth shabbaton',       he:'שבתון נוער'}
];
const VENUES = [
  {en:'the beit midrash', he:'בית המדרש'},
  {en:'the main shul',    he:'בית הכנסת המרכזי'},
  {en:'the JCC',          he:'המרכז הקהילתי'},
  {en:'the kollel',       he:'הכולל'},
  {en:'the day school',   he:'בית הספר'}
];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function person(seed, female, withInitial = true) {
  const pool = female ? WOMEN : MEN;
  const f = pool[seed % pool.length];
  const i = INITIALS[(seed >> 3) % INITIALS.length];
  return { name: { en: f.en + (withInitial ? ' ' + i : ''), he: f.he + (withInitial ? ' ' + i : '') },
           female, seed };
}

const byId = {};
COMMUNITIES.forEach(c => { byId[c.id] = c; });
function community(id) { return byId[id]; }

/* Photographs per year — thin in the early years, a zero means a hole in the record */
function historyOf(c) {
  const end = c.c || 2026, next = rng(seedOf(c.id));
  const rows = []; let peak = 1, total = 0, holes = 0;
  for (let y = c.f; y <= end; y++) {
    const r = next(), mat = (y - 1996) / 30;
    const n = r < 0.30 - mat * 0.22 ? 0 : Math.round(6 + r * 34 + mat * 16);
    if (n > peak) peak = n;
    if (n === 0) holes++; else total += n;
    rows.push({ year: y, n });
  }
  return { rows, peak, total, holes, first: c.f, last: end };
}

function roshOf(c) {
  const s = seedOf(c.id + ':rosh');
  const p = person(s, false);
  const from = c.f, to = Math.min(c.c || 2026, c.f + 8 + (s % 4));
  const prior = COMMUNITIES[(s >> 5) % COMMUNITIES.length];
  return { ...p, from, to, prior: prior.id === c.id ? null : prior, priorYear: from - 3 - (s % 5) };
}

function householdOf(c) {
  const s = seedOf(c.id + ':house');
  const next = rng(s);
  const spouse = person(seedOf(c.id + ':spouse'), true);
  spouse.role = 'shlicha';
  const kids = [];
  const n = 3 + Math.floor(next() * 3);
  for (let i = 0; i < n; i++) {
    const k = person(seedOf(c.id + ':kid' + i), next() > 0.5, false);
    k.born = c.f - 4 + i * 2 + Math.floor(next() * 2);
    kids.push(k);
  }
  return [spouse, ...kids];
}

function cohortOf(c, year) {
  const next = rng(seedOf(c.id + ':' + year));
  const size = 6 + Math.floor(next() * 4);
  const out = [];
  for (let i = 0; i < size; i++) {
    const p = person(seedOf(c.id + year + 'p' + i), next() > 0.5);
    p.from = YESHIVOT[Math.floor(next() * YESHIVOT.length)];
    out.push(p);
  }
  return out;
}

function photosOf(c, year, count) {
  const next = rng(seedOf(c.id + ':ph:' + year));
  const out = [];
  const shown = Math.min(count, 8);
  for (let i = 0; i < shown; i++) {
    const ev = EVENTS[Math.floor(next() * EVENTS.length)];
    const vn = VENUES[Math.floor(next() * VENUES.length)];
    const mo = Math.floor(next() * 12);
    out.push({
      id: c.id + '-' + year + '-' + i,
      event: ev, venue: vn,
      day: 1 + Math.floor(next() * 27),
      month: MONTHS[mo],
      year: mo >= 8 ? year : year + 1,
      people: 2 + Math.floor(next() * 34),
      art: [Math.floor(next() * 240), Math.floor(next() * 240), Math.floor(next() * 240),
            80 + Math.floor(next() * 70), next() > 0.5 ? 1 : 0],
      source: next() > 0.5 ? 'whatsapp' : 'upload'
    });
  }
  return out;
}
