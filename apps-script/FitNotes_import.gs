/**
 * FitNotes CSV to Google Sheets import
 *
 * Bound to the Food log spreadsheet, alongside Oura_sync.gs. Reads the newest FitNotes
 * CSV export in your Google Drive (FitNotes > Settings > Export, spreadsheet/CSV) and
 * rewrites the gym_sets tab: one row per set, with lifts normalised and an estimated 1RM.
 * Part of ai-health-tracking: https://github.com/marcuswhit/ai-health-tracking
 * Licence: PolyForm Noncommercial 1.0.0 (see LICENSE).
 *
 * - FitNotes' own Drive backup (.fitnotes) is a database file Apps Script can't read;
 *   export the CSV instead. Each export holds your full history, so every import
 *   replaces the tab.
 * - If your Google Workspace admin has turned off Drive access for scripts ("Access denied:
 *   DriveApp"), import the CSV yourself instead: File > Import > Upload, "Insert new sheet(s)",
 *   then rename that tab fitnotes_export. The importer reads that tab when it exists.
 * - A daily check imports a new export automatically when one appears. Re-export every
 *   few weeks (or after a gym block) to keep it current.
 * - The FitNotes menu is added by onOpen in Oura_sync.gs. Without Oura_sync.gs, add:
 *   function onOpen() { addFitNotesMenu_(); }
 * - Every name in this file starts with "fitnotes" or "FITNOTES" so it can share a project
 *   with the Oura and Strava scripts.
 *
 * Don't add your own columns to gym_sets: it is rewritten on every import.
 */

const FITNOTES_CONFIG = {
  FILE_PATTERN: /^FitNotes.*\.csv$/i,   // newest matching file in your Drive is imported
  TAB: 'gym_sets',
  IMPORT_TAB: 'fitnotes_export',        // optional: a CSV you imported into the sheet yourself
  CHECK_AT_HOUR: 22,
  E1RM_MAX_REPS: 12,                    // estimated 1RM only from sets of 1-12 reps
  DAY_FORMAT: 'ddd d mmm yyyy',
  // Exercise names as logged -> one lift name, so renamed exercises join up.
  LIFTS: {
    'deadlift': 'Deadlift',
    'conventional deadlift': 'Deadlift',
    'barbell squat': 'Squat',
    'back squat': 'Squat',
    'flat barbell bench press': 'Bench press',
    'barbell bench press': 'Bench press',
    'flat dumbbell bench press': 'Dumbbell bench press',
    'chin up': 'Chin-up',
    'chin-up': 'Chin-up',
    'pull up': 'Pull-up',
    'pull-up': 'Pull-up',
  },
  // Lifts where the logged weight is load added to body weight.
  BODYWEIGHT_LIFTS: ['Chin-up', 'Pull-up', 'Dips', 'Push Up', 'Parallel Bar Triceps Dip'],
};

const FITNOTES_COLUMNS = ['day', 'lift', 'exercise', 'category', 'set_no', 'weight_kg', 'reps',
  'volume_kg', 'est_1rm_kg', 'bodyweight', 'distance_km', 'time_min', 'comment'];

/* ---------------------------------------------------------------- menu */

function addFitNotesMenu_() {
  SpreadsheetApp.getUi().createMenu('FitNotes')
    .addItem('Import latest export now', 'fitnotesImportNow')
    .addItem('Install daily check', 'fitnotesInstallTrigger')
    .addToUi();
}

function fitnotesImportNow() {
  const r = fitnotesImport_(true);
  SpreadsheetApp.getUi().alert(r);
}

function fitnotesInstallTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'fitnotesDailyCheck')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('fitnotesDailyCheck').timeBased().everyDays(1)
    .atHour(FITNOTES_CONFIG.CHECK_AT_HOUR).inTimezone(SpreadsheetApp.getActive().getSpreadsheetTimeZone()).create();
  SpreadsheetApp.getUi().alert('FitNotes check installed: around ' + FITNOTES_CONFIG.CHECK_AT_HOUR +
    ':00 each day, a new export in Drive is imported.');
}

function fitnotesDailyCheck() {
  fitnotesImport_(false);
}

/* -------------------------------------------------------------- import */

function fitnotesImport_(force) {
  const ss = SpreadsheetApp.getActive();
  const manual = ss.getSheetByName(FITNOTES_CONFIG.IMPORT_TAB);
  if (manual) {
    // Sheets may have turned the Date column into dates; read those as yyyy-MM-dd, the rest as shown.
    const range = manual.getDataRange();
    const values = range.getValues();
    const shown = range.getDisplayValues();
    const dateCol = shown[0].map(h => String(h).trim().toLowerCase()).indexOf('date');
    const grid = shown.map((r, i) => r.map((v, c) => (c === dateCol && values[i][c] instanceof Date
      ? Utilities.formatDate(values[i][c], ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : v)));
    const rows = fitnotesParseGrid_(grid);
    fitnotesWrite_(ss, rows);
    return 'Imported ' + rows.length + ' sets from ' + new Set(rows.map(r => r.day)).size + ' sessions (tab ' +
      FITNOTES_CONFIG.IMPORT_TAB + '). To use a newer export, import it over that tab and run this again.';
  }
  let file;
  try {
    file = fitnotesNewestFile_();
  } catch (e) {
    if (/Access denied/i.test(e.message)) {
      return 'Google Drive access is turned off for scripts in your Google Workspace. Either turn on "Allow users to ' +
        'access Google Drive with the Drive SDK API" (Admin console > Apps > Google Workspace > Drive and Docs > ' +
        'Features and Applications), or import the CSV yourself: File > Import > Upload > Insert new sheet(s), rename ' +
        'the new tab ' + FITNOTES_CONFIG.IMPORT_TAB + ', and run this again.';
    }
    throw e;
  }
  if (!file) return 'No FitNotes CSV found in Drive. In FitNotes: Settings > Export, choose the CSV/spreadsheet export and save it to Google Drive.';
  const props = PropertiesService.getUserProperties();
  const stamp = file.getId() + '@' + file.getLastUpdated().getTime();
  if (!force && props.getProperty('FITNOTES_LAST_IMPORT') === stamp) return 'No new export.';
  const rows = fitnotesParse_(file.getBlob().getDataAsString());
  fitnotesWrite_(ss, rows);
  props.setProperty('FITNOTES_LAST_IMPORT', stamp);
  const days = new Set(rows.map(r => r.day)).size;
  return 'Imported ' + rows.length + ' sets from ' + days + ' sessions (' + file.getName() + ', ' +
    Utilities.formatDate(file.getLastUpdated(), ss.getSpreadsheetTimeZone(), 'd MMM yyyy HH:mm') + ').';
}

function fitnotesNewestFile_() {
  let best = null;
  const it = DriveApp.searchFiles("title contains 'FitNotes' and trashed = false");
  while (it.hasNext()) {
    const f = it.next();
    if (!FITNOTES_CONFIG.FILE_PATTERN.test(f.getName())) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best;
}

// Expected header: Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment
function fitnotesParse_(text) {
  return fitnotesParseGrid_(Utilities.parseCsv(text.replace(/^\uFEFF/, '')));
}

// grid: rows of strings, from the CSV or from an imported tab's display values.
function fitnotesParseGrid_(grid) {
  if (!grid.length) return [];
  const head = grid[0].map(h => String(h).replace(/^\uFEFF/, '').trim().toLowerCase());
  const col = name => head.indexOf(name);
  const need = ['date', 'exercise', 'weight', 'reps'];
  const missing = need.filter(n => col(n) < 0);
  if (missing.length) throw new Error('Not a FitNotes export: missing ' + missing.join(', '));
  const get = (r, name) => { const i = col(name); return i < 0 ? '' : String(r[i] === undefined ? '' : r[i]).trim(); };
  const setCount = {};
  const out = [];
  grid.slice(1).forEach(r => {
    const day = get(r, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    const exercise = get(r, 'exercise');
    const lift = FITNOTES_CONFIG.LIFTS[exercise.toLowerCase()] || exercise;
    const unit = get(r, 'weight unit').toLowerCase();
    let weight = parseFloat(get(r, 'weight'));
    if (isNaN(weight)) weight = null;
    else if (/^lb/.test(unit)) weight = fitnotesRound_(weight * 0.45359237, 1);
    const repsRaw = parseInt(get(r, 'reps'), 10);
    const reps = isNaN(repsRaw) ? null : repsRaw;
    const bodyweight = FITNOTES_CONFIG.BODYWEIGHT_LIFTS.indexOf(lift) >= 0;
    const key = day + '|' + lift;
    setCount[key] = (setCount[key] || 0) + 1;
    let dist = parseFloat(get(r, 'distance'));
    const dUnit = get(r, 'distance unit').toLowerCase();
    if (isNaN(dist)) dist = null;
    else if (dUnit === 'm') dist = dist / 1000;
    else if (/^mi/.test(dUnit)) dist = dist * 1.609344;
    out.push({
      day: day,
      lift: lift,
      exercise: exercise,
      category: get(r, 'category'),
      set_no: setCount[key],
      weight_kg: weight,
      reps: reps,
      // For body-weight lifts these use added load only; add body weight when it's known.
      volume_kg: weight !== null && reps ? fitnotesRound_(weight * reps, 1) : null,
      est_1rm_kg: !bodyweight && weight > 0 && reps >= 1 && reps <= FITNOTES_CONFIG.E1RM_MAX_REPS
        ? fitnotesRound_(reps === 1 ? weight : weight * (1 + reps / 30), 1) : null,   // Epley
      bodyweight: bodyweight,
      distance_km: dist === null ? null : fitnotesRound_(dist, 2),
      time_min: fitnotesMinutes_(get(r, 'time')),
      comment: get(r, 'comment'),
    });
  });
  return out;
}

function fitnotesWrite_(ss, rows) {
  let sh = ss.getSheetByName(FITNOTES_CONFIG.TAB);
  if (!sh) sh = ss.insertSheet(FITNOTES_CONFIG.TAB, ss.getSheets().length);
  const tz = ss.getSpreadsheetTimeZone();
  const cell = (k, v) => {
    if (v === null || v === undefined) return '';
    if (k === 'day') return Utilities.parseDate(v, tz, 'yyyy-MM-dd');
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;   // never let a comment become a formula
    return v;
  };
  const grid = [FITNOTES_COLUMNS].concat(rows.map(r => FITNOTES_COLUMNS.map(k => cell(k, r[k]))));
  const nRows = grid.length, nCols = FITNOTES_COLUMNS.length;
  if (sh.getMaxRows() < nRows) sh.insertRowsAfter(sh.getMaxRows(), nRows - sh.getMaxRows());
  if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, nRows, nCols).setValues(grid);
  sh.getRange(1, 1, 1, nCols).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (nRows > 1) sh.getRange(2, 1, nRows - 1, 1).setNumberFormat(FITNOTES_CONFIG.DAY_FORMAT);
}

/* ------------------------------------------------------------- helpers */

function fitnotesMinutes_(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0);
  return secs ? fitnotesRound_(secs / 60, 1) : null;
}

function fitnotesRound_(x, dp) {
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}
