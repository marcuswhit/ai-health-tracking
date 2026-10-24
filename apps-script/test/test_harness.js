// Node harness: loads Oura_sync.gs with minimal Apps Script stubs and checks the pure logic.
// Run from the apps-script folder: node test/test_harness.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const OFFSET_MS = 10 * 3600 * 1000; // tests run on a fixed UTC+10 zone with no daylight saving
const pad = n => String(n).padStart(2, '0');
const Utilities = {
  formatDate(d, tz, pattern) {
    const x = new Date(d.getTime() + OFFSET_MS);
    const ymd = `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
    if (pattern === 'yyyy-MM-dd') return ymd;
    throw new Error('unsupported pattern ' + pattern);
  },
  parseDate(s, tz, pattern) {
    if (pattern === 'yyyy-MM-dd') return new Date(Date.parse(s + 'T00:00:00+10:00'));
    if (pattern === 'yyyy-MM-dd HH') { const [d, h] = s.split(' '); return new Date(Date.parse(`${d}T${h}:00:00+10:00`)); }
    throw new Error('unsupported pattern ' + pattern);
  },
  sleep() {},
};

function fakeSheet(name) {
  let grid = [];
  let maxRows = 1000, maxCols = 26;
  const formats = {};
  return {
    name, formats,
    _grid: () => grid,
    getDataRange: () => ({getValues: () => (grid.length ? grid.map(r => r.slice()) : [['']])}),
    getMaxRows: () => maxRows, getMaxColumns: () => maxCols,
    insertRowsAfter: (a, n) => { maxRows += n; }, insertColumnsAfter: (a, n) => { maxCols += n; },
    clearContents: () => { grid = []; },
    getRange: (r, c) => ({
      setValues: v => {
        assert(r - 1 + v.length <= maxRows && c - 1 + v[0].length <= maxCols, 'range outside sheet');
        v.forEach((row, i) => { grid[r - 1 + i] = row.slice(); });
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
  insertSheet: n => (sheets[n] = fakeSheet(n)),
  getSheets: () => Object.values(sheets),
  toast: () => {},
};
const ctx = {
  Utilities, console, Date, // share Date so instanceof works across the vm boundary, as in Apps Script
  SpreadsheetApp: {getActive: () => ss},
  PropertiesService: {getUserProperties: () => ({getProperty: () => null, setProperty() {}, deleteProperty() {}})},
  LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock() {}})},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Oura_sync.gs'), 'utf8'), ctx);

// 1. flatten
const flat = ctx.flatten_({
  id: 'r1', day: '2026-10-13', score: 81, temperature_deviation: -0.12,
  contributors: {hrv_balance: 77, resting_heart_rate: null},
  met: {interval: 60, items: [1, 2], timestamp: 'x'}, class_5_min: '000', tags: ['a'],
}, ['class_5_min']);
assert.deepStrictEqual(Array.from(Object.keys(flat).sort()),
  ['contributors_hrv_balance', 'contributors_resting_heart_rate', 'day', 'id', 'score', 'temperature_deviation']);
console.log('flatten ok');

// 2. sleep enrichment (5-min HR/HRV, pre-bed HR)
const bedStart = '2026-10-12T22:00:00+10:00';
const sleepDoc = {
  id: 's1', day: '2026-10-13', type: 'long_sleep', bedtime_start: bedStart, bedtime_end: '2026-10-13T06:00:00+10:00',
  heart_rate: {interval: 300, timestamp: bedStart, items: [60, 55, null, 48, 50, 52]},
  hrv: {interval: 300, timestamp: bedStart, items: [40, 50, null]},
};
const hrSamples = [
  {bpm: 70, source: 'awake', timestamp: '2026-10-12T19:30:00+10:00'},
  {bpm: 80, source: 'awake', timestamp: '2026-10-12T21:30:00+10:00'},
  {bpm: 120, source: 'workout', timestamp: '2026-10-12T20:00:00+10:00'},
  {bpm: 90, source: 'awake', timestamp: '2026-10-12T18:00:00+10:00'},
];
ctx.ouraGet_ = (p) => (p === 'heartrate' ? hrSamples : []);
const [en] = ctx.enrichSleep_([JSON.parse(JSON.stringify(sleepDoc))]);
assert.strictEqual(en.lowest_hr_5min, 48);
assert.strictEqual(en.lowest_hr_pct_of_night, 0.03);
assert.strictEqual(en.hrv_first_half_avg, 45);
assert.strictEqual(en.pre_bed_hr_avg, 75);
console.log('sleep enrichment ok');

// 3. duplicate workouts
const wk = ctx.flagDuplicateWorkouts_([
  {id: 'auto1', source: 'autodetected', start_datetime: '2026-10-13T05:05:00+10:00', end_datetime: '2026-10-13T07:00:00+10:00'},
  {id: 'strava1', source: 'manual', start_datetime: '2026-10-13T05:00:00+10:00', end_datetime: '2026-10-13T07:10:00+10:00'},
  {id: 'auto2', source: 'autodetected', start_datetime: '2026-10-13T17:00:00+10:00', end_datetime: '2026-10-13T17:40:00+10:00'},
]);
assert.deepStrictEqual(wk.map(w => w.duplicate_of), ['strava1', '', '']);
console.log('workout dedupe ok');

// 4. merge: replace window, keep history, drop records Oura removed
const ep = {path: 'daily_readiness', dateField: 'day'};
ctx.mergeIntoTab_(ss, ep, [
  {id: 'a', day: '2026-09-01', score: 70}, {id: 'b', day: '2026-10-10', score: 75}, {id: 'c', day: '2026-10-11', score: 76},
], '2026-08-01', '2026-10-15');
ctx.mergeIntoTab_(ss, ep, [
  {id: 'b', day: '2026-10-10', score: 79, temperature_deviation: 0.2}, {id: 'd', day: '2026-10-12', score: 80},
], '2026-10-08', '2026-10-15');
const g = sheets.oura_daily_readiness._grid();
assert.deepStrictEqual(Array.from(g[0]), ['id', 'day', 'score', 'temperature_deviation']);
assert.deepStrictEqual(Array.from(g.slice(1).map(r => r[0])), ['a', 'b', 'd']);
assert.strictEqual(ctx.mergeIntoTab_(ss, ep, [], '2025-01-01', '2025-02-01'), 0);
console.log('merge ok');

// 5. formula-like text is escaped
ctx.mergeIntoTab_(ss, {path: 'session', dateField: 'day'}, [{id: 'x', day: '2026-10-13', note: '=HACK()'}], '2026-10-01', '2026-10-15');
assert.strictEqual(sheets.oura_session._grid()[1][2], "'=HACK()");
console.log('escaping ok');

// 6. one endpoint failing does not stop the others
ctx.ouraGet_ = p => {
  if (p === 'daily_resilience') throw new Error('403 scope not granted');
  if (p === 'daily_sleep') return [{id: 'ds1', day: '2026-10-13', score: 88}];
  return [];
};
const res = ctx.syncRange_('2026-10-07', '2026-10-15', 'test');
assert.strictEqual(res.errors.length, 1);
assert.strictEqual(sheets.oura_daily_sleep._grid()[1][2], 88);
console.log('syncRange ok');

// 7. date helpers
assert.strictEqual(ctx.addDays_('2026-10-14', -7), '2026-10-07');
assert.strictEqual(ctx.addDays_('2026-12-31', 1), '2027-01-01');
console.log('helpers ok');

// 8. padded fetch keeps only the window
const calls8 = [];
ctx.ouraGet_ = (p, params) => {
  calls8.push(params);
  if (p === 'daily_activity') return [{id: 'x0', day: '2026-10-11'}, {id: 'x1', day: '2026-10-12', active_calories: 940}, {id: 'x2', day: '2026-10-16'}];
  return [];
};
ctx.syncRange_('2026-10-12', '2026-10-15', 'test');
assert.strictEqual(calls8[0].start_date, '2026-10-11');
assert.strictEqual(calls8[0].end_date, '2026-10-16');
assert.deepStrictEqual(Array.from(sheets.oura_daily_activity._grid().slice(1).map(r => r[0])), ['x1']);
console.log('padded fetch ok');

// 9. early-hours waking: 1:30-4:15, stops 15 min before the final wake
ctx.ouraGet_ = () => [];
const mk = (bs, be, awake) => {
  const s0 = Date.parse(bs), n = (Date.parse(be) - s0) / 300000;
  let str = '';
  for (let i = 0; i < n; i++) {
    const t = s0 + i * 300000;
    str += awake.some(([a, b]) => t >= Date.parse(a) && t < Date.parse(b)) ? '4' : '2';
  }
  return {id: 'n', day: be.slice(0, 10), type: 'long_sleep', bedtime_start: bs, bedtime_end: be, sleep_phase_5_min: str};
};
const A = mk('2026-10-15T20:45:00+10:00', '2026-10-16T04:30:00+10:00',
  [['2026-10-16T00:30:00+10:00', '2026-10-16T00:50:00+10:00'], ['2026-10-16T03:00:00+10:00', '2026-10-16T03:40:00+10:00'], ['2026-10-16T04:05:00+10:00', '2026-10-16T04:30:00+10:00']]);
ctx.enrichSleep_([A]);
assert.strictEqual(A.early_wake_min, 50);
assert.strictEqual(A.early_wake_count, 2);
const B = mk('2026-10-15T20:30:00+10:00', '2026-10-16T04:00:00+10:00',
  [['2026-10-16T02:00:00+10:00', '2026-10-16T02:05:00+10:00'], ['2026-10-16T02:15:00+10:00', '2026-10-16T02:20:00+10:00'], ['2026-10-16T03:50:00+10:00', '2026-10-16T04:00:00+10:00']]);
ctx.enrichSleep_([B]);
assert.strictEqual(B.early_wake_min, 10);
assert.strictEqual(B.early_wake_count, 2);
const C = Object.assign(mk('2026-10-16T13:00:00+10:00', '2026-10-16T13:40:00+10:00', []), {type: 'sleep'});
ctx.enrichSleep_([C]);
assert.strictEqual(C.early_wake_min, undefined);
console.log('early wake ok');

// 10. standard wearable tabs
ctx.ouraGet_ = p => {
  if (p === 'daily_activity') return [{id: 'a1', day: '2026-10-13', active_calories: 900, total_calories: 3200, steps: 8000, score: 81}];
  if (p === 'daily_sleep') return [{id: 's1', day: '2026-10-13', score: 77}];
  if (p === 'daily_readiness') return [{id: 'r1', day: '2026-10-13', score: 84, temperature_deviation: -0.1}];
  if (p === 'sleep') return [
    {id: 'n1', day: '2026-10-13', type: 'long_sleep', bedtime_start: '2026-10-12T21:00:00+10:00', bedtime_end: '2026-10-13T04:30:00+10:00', total_sleep_duration: 24600, average_hrv: 55, lowest_heart_rate: 44},
    {id: 'n2', day: '2026-10-13', type: 'sleep', bedtime_start: '2026-10-13T13:00:00+10:00', bedtime_end: '2026-10-13T13:30:00+10:00'},
    {id: 'n3', day: '2026-10-13', type: 'deleted', bedtime_start: '2026-10-13T15:00:00+10:00', bedtime_end: '2026-10-13T15:10:00+10:00'},
  ];
  if (p === 'workout') return [{id: 'w1', day: '2026-10-13', activity: 'surfing', calories: 350, source: 'manual', start_datetime: '2026-10-13T16:00:00+10:00', end_datetime: '2026-10-13T17:00:00+10:00'}];
  return [];
};
ctx.syncRange_('2026-10-12', '2026-10-14', 'test');
const wd = sheets.wearable_daily._grid();
assert.deepStrictEqual(Array.from(wd[0]), ['id', 'day', 'source', 'active_calories', 'total_calories', 'steps', 'activity_score', 'sleep_score', 'readiness_score', 'temperature_deviation']);
assert.deepStrictEqual(Array.from(wd[1].slice(2)), ['oura', 900, 3200, 8000, 81, 77, 84, -0.1]);
const wsl = sheets.wearable_sleep._grid();
assert.strictEqual(wsl[0][1], 'day');
assert.deepStrictEqual(Array.from(wsl.slice(1).map(r => r[wsl[0].indexOf('type')])), ['main', 'nap']);
assert.strictEqual(wsl[1][wsl[0].indexOf('total_sleep_min')], 410);
assert.strictEqual(sheets.wearable_workouts._grid()[1][3], 'surfing');
// a failed input leaves the standard tab untouched
ctx.ouraGet_ = p => { if (p === 'daily_sleep') throw new Error('500'); return []; };
const r10 = ctx.syncRange_('2026-10-12', '2026-10-14', 'test');
assert.strictEqual(sheets.wearable_daily._grid().length, 2);
assert(/wearable_daily skipped/.test(sheets.oura_sync_log._grid().slice(-1)[0][4]));
console.log('standard tabs ok');

console.log('ALL TESTS PASSED');
