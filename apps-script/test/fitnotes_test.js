// Node harness for FitNotes_import.gs. Run from the apps-script folder: node test/fitnotes_test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function parseCsv(text) {   // minimal RFC 4180 parser, like Utilities.parseCsv
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
let grid = [];
const sheet = {
  getMaxRows: () => 1000, getMaxColumns: () => 26, insertRowsAfter() {}, insertColumnsAfter() {},
  clearContents: () => { grid = []; },
  getRange: () => ({setValues: v => { grid = v; }, setFontWeight() {}, setNumberFormat() {}}),
  setFrozenRows() {},
};
const ss = {getSheetByName: () => sheet, getSpreadsheetTimeZone: () => 'Australia/Brisbane', getSheets: () => [sheet]};
const ctx = {
  console, Date,
  Utilities: {parseCsv, parseDate: s => new Date(s + 'T00:00:00+10:00')},
  SpreadsheetApp: {getActive: () => ss},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'FitNotes_import.gs'), 'utf8'), ctx);

const csv = '﻿Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment\n' +
  '2013-11-07,Conventional Deadlift,Legs,80.0,kgs,8,,,,""\n' +
  '2013-11-07,Conventional Deadlift,Legs,80.0,kgs,8,,,,""\n' +
  '2026-10-22,Deadlift,Legs,140.0,kgs,5,,,,"felt ""heavy"", good"\n' +
  '2026-10-22,Barbell Squat,Legs,225.0,lbs,1,,,,"=bad"\n' +
  '2026-10-22,Chin Up,Back,10.0,kgs,8,,,,""\n' +
  '2026-10-22,Leg Press,Legs,200.0,kgs,20,,,,""\n' +
  '2026-10-22,Rowing Machine,Cardio,,,,2000,m,0:08:30,""\n';
const rows = ctx.fitnotesParse_(csv);
assert.strictEqual(rows.length, 7);
assert.deepStrictEqual(Array.from(rows.slice(0, 3).map(r => r.lift)), ['Deadlift', 'Deadlift', 'Deadlift']);
assert.deepStrictEqual(Array.from(rows.slice(0, 2).map(r => r.set_no)), [1, 2]);
assert.strictEqual(rows[2].set_no, 1);   // set numbers restart per day and lift
assert.strictEqual(rows[2].est_1rm_kg, 163.3);
assert.strictEqual(rows[2].comment, 'felt "heavy", good');
assert.strictEqual(rows[3].weight_kg, 102.1);   // lbs converted
assert.strictEqual(rows[3].est_1rm_kg, 102.1);
assert.strictEqual(rows[4].bodyweight, true);
assert.strictEqual(rows[4].est_1rm_kg, null);
assert.strictEqual(rows[5].est_1rm_kg, null);   // 20 reps: too many for a 1RM estimate
assert.strictEqual(rows[5].volume_kg, 4000);
assert.strictEqual(rows[6].distance_km, 2);
assert.strictEqual(rows[6].time_min, 8.5);
assert.strictEqual(rows[6].weight_kg, null);
ctx.fitnotesWrite_(ss, rows);
assert.strictEqual(grid.length, 8);
assert(grid[1][0] instanceof Date);
assert.strictEqual(grid[4][12], "'=bad");
assert.throws(() => ctx.fitnotesParse_('a,b\n1,2\n'), /Not a FitNotes export/);
const oura = fs.readFileSync(path.join(__dirname, '..', 'Oura_sync.gs'), 'utf8');
assert(/typeof addFitNotesMenu_ === 'function'/.test(oura));
const globals = src => new Set([...src.matchAll(/^(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const mine = globals(fs.readFileSync(path.join(__dirname, '..', 'FitNotes_import.gs'), 'utf8'));
['Oura_sync.gs', 'Strava_sync.gs'].forEach(f => {
  const clash = [...mine].filter(n => globals(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).has(n));
  assert.deepStrictEqual(clash, [], f);
});
console.log('fitnotes ok');

// Manual-import tab: Sheets' display values (dates as typed text after File > Import keeps them as text or dates)
const tabGrid = [['Date', 'Exercise', 'Category', 'Weight', 'Weight Unit', 'Reps', 'Distance', 'Distance Unit', 'Time', 'Comment'],
  ['2026-10-22', 'Deadlift', 'Legs', '140', 'kgs', '5', '', '', '', '']];
assert.strictEqual(ctx.fitnotesParseGrid_(tabGrid)[0].est_1rm_kg, 163.3);
console.log('manual tab ok');

// fitnotesImport_ with an imported tab whose Date column became real dates
const d = new Date('2026-10-22T00:00:00+10:00');
const manualTab = {getDataRange: () => ({
  getValues: () => [tabGrid[0], [d, 'Deadlift', 'Legs', 140, 'kgs', 5, '', '', '', '']],
  getDisplayValues: () => [tabGrid[0], ['22/10/2026', 'Deadlift', 'Legs', '140', 'kgs', '5', '', '', '', '']],
})};
ctx.Utilities.formatDate = (x, tz, p) => new Date(x.getTime() + 10 * 3600e3).toISOString().slice(0, 10);
ss.getSheetByName = n => (n === 'fitnotes_export' ? manualTab : sheet);
const msg = ctx.fitnotesImport_(true);
assert(/Imported 1 sets from 1 sessions/.test(msg), msg);
assert.strictEqual(grid[1][1], 'Deadlift');
console.log('manual import ok');
