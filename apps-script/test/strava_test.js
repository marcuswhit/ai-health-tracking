// Node harness for Strava_sync.gs: stubs Apps Script services and checks rows, paging, merge and backfill.
// Run from the apps-script folder: node test/strava_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const OFFSET_MS = 10 * 3600 * 1000;   // fixed UTC+10, no daylight saving
const pad = n => String(n).padStart(2, '0');
const Utilities = {
  formatDate(d, tz, pattern) {
    const x = new Date(d.getTime() + OFFSET_MS);
    if (pattern === 'yyyy-MM-dd') return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    throw new Error('unsupported pattern ' + pattern);
  },
  parseDate(s, tz, pattern) {
    if (pattern === 'yyyy-MM-dd') return new Date(Date.parse(s + 'T00:00:00+10:00'));
    if (pattern === 'yyyy-MM-dd HH') { const [d, h] = s.split(' '); return new Date(Date.parse(`${d}T${h}:00:00+10:00`)); }
    if (pattern === "yyyy-MM-dd'T'HH:mm:ss") return new Date(Date.parse(s + '+10:00'));
    throw new Error('unsupported pattern ' + pattern);
  },
  sleep() {},
};

function fakeSheet() {
  // Mimics Sheets: a leading apostrophe is stored as text and read back without it;
  // numeric-looking strings come back as numbers.
  let grid = [];
  let maxRows = 1000, maxCols = 26;
  const formats = {};
  const store = v => (typeof v === 'string' && v[0] === "'" ? {text: v.slice(1)}
    : typeof v === 'string' && /^[=]/.test(v) ? {formula: v}
    : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v);
  const read = v => (v && v.text !== undefined ? v.text : v && v.formula ? 'FORMULA!' : v);
  return {
    formats, _grid: () => grid.map(r => r.map(read)), _raw: () => grid,
    getDataRange: () => ({getValues: () => (grid.length ? grid.map(r => r.map(read)) : [['']])}),
    getMaxRows: () => maxRows, getMaxColumns: () => maxCols,
    insertRowsAfter: (a, n) => { maxRows += n; }, insertColumnsAfter: (a, n) => { maxCols += n; },
    clearContents: () => { grid = []; },
    getRange: (r, c) => ({
      setValues: v => {
        assert(r - 1 + v.length <= maxRows && c - 1 + v[0].length <= maxCols, 'range outside sheet');
        v.forEach((row, i) => { grid[r - 1 + i] = row.map(store); });
      },
      setFontWeight: () => {}, setNumberFormat: f => { formats[c] = f; },
    }),
    setFrozenRows: () => {},
    appendRow: row => { grid.push(row); },
    getLastRow: () => grid.length,
    deleteRows: (s, n) => { grid.splice(s - 1, n); },
  };
}
const sheets = {};
const ss = {
  getSpreadsheetTimeZone: () => 'Etc/GMT-10',
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = fakeSheet()),
  getSheets: () => Object.values(sheets),
  toast: () => {},
};
const props = {};
const triggers = [];
const calls = [];
let server = () => [];   // (query) -> {code, body}
const ctx = {
  Utilities, console, Date,
  SpreadsheetApp: {getActive: () => ss},
  PropertiesService: {getUserProperties: () => ({
    getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; },
    setProperties: o => Object.assign(props, o), deleteProperty: k => { delete props[k]; },
  })},
  LockService: {getDocumentLock: () => ({tryLock: () => true, releaseLock() {}})},
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: fn => ({timeBased: () => ({after: ms => ({create: () => triggers.push({fn, ms, getHandlerFunction: () => fn})})})}),
  },
  UrlFetchApp: {
    fetch(url) {
      const q = Object.fromEntries(new URL(url).searchParams);
      calls.push(q);
      const r = server(q);
      return {getResponseCode: () => r.code || 200, getContentText: () => JSON.stringify(r.body || r)};
    },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Strava_sync.gs'), 'utf8'), ctx);
const G = n => vm.runInContext(n, ctx);
props.STRAVA_ACCESS_TOKEN = 't';
props.STRAVA_EXPIRES_AT = String(Date.now() + 3600e3);

const ride = (id, local, extra) => Object.assign({
  id, name: 'Morning Ride', sport_type: 'Ride', start_date_local: local + 'Z', timezone: '(GMT+10:00) Australia/Brisbane',
  moving_time: 7200, elapsed_time: 7500, distance: 65432, total_elevation_gain: 512.4, average_speed: 9.1,
  average_watts: 200, weighted_average_watts: 220, max_watts: 900, device_watts: true, kilojoules: 1440,
  has_heartrate: true, average_heartrate: 140.4, max_heartrate: 171, average_cadence: 88.6, suffer_score: 95,
  trainer: false, commute: false, manual: false, workout_type: 12, gear_id: 'b1',
}, extra || {});

// 1. row mapping
const row = ctx.stravaRow_(ride(1, '2026-10-20T05:02:00'));
assert.strictEqual(row.day, '2026-10-20');
assert.strictEqual(row.moving_min, 120);
assert.strictEqual(row.distance_km, 65.43);
assert.strictEqual(row.avg_speed_kmh, 32.8);
assert.strictEqual(row.efficiency_factor, 1.57);
assert.strictEqual(row.variability_index, 1.1);
assert.strictEqual(row.workout_type, 'workout');
assert.strictEqual(row.timezone, 'Australia/Brisbane');
const est = ctx.stravaRow_(ride(2, '2026-10-20T05:02:00', {device_watts: false, has_heartrate: false, average_heartrate: undefined}));
assert.strictEqual(est.efficiency_factor, '');
assert.strictEqual(est.avg_hr, '');
assert.strictEqual(est.power_meter, false);
const run = ctx.stravaRow_({id: 3, sport_type: 'Run', start_date_local: '2026-10-21T06:00:00Z', moving_time: 1800});
assert.strictEqual(run.avg_watts, '');
assert.strictEqual(run.kilojoules, '');
console.log('row mapping ok');

// 2. local wall-clock time is kept (Strava's trailing Z is ignored)
const cell = ctx.stravaToCell_('start_local', '2026-10-20T05:02:00Z');
assert.strictEqual(cell.toISOString(), '2026-10-19T19:02:00.000Z');   // 05:02 in UTC+10
console.log('local time ok');

// 3. paging and window filtering
let all = [];
for (let i = 0; i < 450; i++) {
  const d = new Date(Date.UTC(2026, 9, 1) + Math.floor(i / 20) * 86400e3).toISOString().slice(0, 10);
  all.push(ride(1000 + i, d + 'T05:00:00'));
}
server = q => { const p = Number(q.page), n = Number(q.per_page); return all.slice((p - 1) * n, p * n); };
calls.length = 0;
const got = ctx.stravaFetchWindow_('2026-10-02', '2026-10-05');
assert.strictEqual(calls.length, 3);   // 200 + 200 + 50
assert.strictEqual(got.length, 80);   // 4 days x 20
assert(got.every(a => a.start_date_local >= '2026-10-02' && a.start_date_local < '2026-10-06'));
console.log('paging ok');

// 4. merge: window replaced, deleted activity removed, history kept, names never become formulas
server = () => [ride(1, '2026-09-01T05:00:00'), ride(2, '2026-10-10T05:00:00', {name: '=HYPERLINK("x")'}),
  ride(3, '2026-10-11T05:00:00'), ride(9007199254, '2026-10-12T05:00:00')];
ctx.stravaSyncRange_('2026-08-01', '2026-10-15', 'test');
server = () => [ride(2, '2026-10-10T05:00:00', {name: '=HYPERLINK("x")', weighted_average_watts: 240}),
  ride(4, '2026-10-13T05:00:00')];
ctx.stravaSyncRange_('2026-10-09', '2026-10-15', 'test');
const sh = sheets.strava_activities;
let g = sh._grid();
assert.deepStrictEqual(Array.from(g[0]), Array.from(G("STRAVA_COLUMNS")));
assert.deepStrictEqual(g.slice(1).map(r => String(r[0])), ['1', '2', '4']);   // 3 and 9007199254 deleted in Strava
assert.strictEqual(g[2][G("STRAVA_COLUMNS").indexOf('weighted_watts')], 240);
assert(!sh._raw().flat().some(v => v && v.formula), 'a name became a formula');
// a later sync outside that window must keep the escaped name as text
server = () => [ride(5, '2026-10-20T05:00:00')];
ctx.stravaSyncRange_('2026-10-18', '2026-10-21', 'test');
assert(!sh._raw().flat().some(v => v && v.formula), 'a kept name became a formula');
g = sh._grid();
assert.strictEqual(g[2][G("STRAVA_COLUMNS").indexOf('name')], '=HYPERLINK("x")');
assert(g[1][1] instanceof Date && g[1][3] instanceof Date);
assert.strictEqual(sh.formats[2], G("STRAVA_CONFIG").DAY_FORMAT);
assert.strictEqual(ctx.stravaSyncRange_('2025-01-01', '2025-01-31', 'empty').written, 0);
console.log('merge ok');

// 5. backfill walks year by year, pauses on the rate limit and resumes
delete sheets.strava_activities;
G("STRAVA_CONFIG").BACKFILL_START = '2023-01-01';
let yearCalls = 0;
server = q => {
  yearCalls++;
  if (yearCalls === 3) return {code: 429, body: {message: 'Rate Limit Exceeded'}};
  const from = Number(q.after) * 1000, to = Number(q.before) * 1000;
  return Number(q.page) > 1 ? [] : [ride(5000 + yearCalls, new Date(from + 3 * 86400e3).toISOString().slice(0, 19)),
    ride(6000 + yearCalls, new Date(to - 5 * 86400e3).toISOString().slice(0, 19))];
};
ctx.stravaStartBackfill();
assert.strictEqual(triggers.length, 1);
assert.strictEqual(triggers[0].ms, 16 * 60 * 1000);
assert.strictEqual(props.STRAVA_BACKFILL_CURSOR, '2024-12-31');   // two 365-day chunks done (2024 is a leap year), third rate-limited
ctx.stravaContinueBackfill();
assert.strictEqual(props.STRAVA_BACKFILL_CURSOR, undefined);
assert.strictEqual(triggers.length, 0);
const days = sheets.strava_activities._grid().slice(1).map(r => ctx.stravaDateKey_(r[1]));
assert.deepStrictEqual(days, days.slice().sort());
assert(days[0] >= '2023-01-01' && days.length >= 6);
const log = sheets.strava_sync_log._grid();
assert(log.some(r => /^RATE LIMIT/.test(r[4])));
console.log('backfill ok');

// 6. Oura's onOpen adds the Strava menu when this file is present
const oura = fs.readFileSync(path.join(__dirname, '..', 'Oura_sync.gs'), 'utf8');
assert(/typeof addStravaMenu_ === 'function'/.test(oura));
// no global names shared with Oura_sync.gs
const globals = src => new Set([...src.matchAll(/^(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const clash = [...globals(fs.readFileSync(path.join(__dirname, '..', 'Strava_sync.gs'), 'utf8'))].filter(n => globals(oura).has(n));
assert.deepStrictEqual(clash, []);
console.log('coexistence ok');
