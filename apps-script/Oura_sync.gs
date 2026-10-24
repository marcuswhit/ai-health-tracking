/**
 * Oura to Google Sheets sync (Oura API v2)
 *
 * Bound to the Food log spreadsheet. Writes one oura_* tab per data type.
 * Part of ai-health-tracking: https://github.com/marcuswhit/ai-health-tracking
 * Licence: PolyForm Noncommercial 1.0.0 (see LICENSE). Your Oura credentials and tokens are kept in your own Apps Script
 * user properties; nobody you share the sheet with can see them.
 *
 * Settings you may want to change are in CONFIG below: BACKFILL_START and the
 * EARLY_WAKE_* window (set EARLY_WAKE_TO to 15 minutes before your usual alarm).
 *
 * - syncLatest: runs hourly and re-pulls the last 2 days, so today's activity stays current.
 * - syncRecent: re-pulls a rolling 7-day window and replaces those rows.
 *   Runs twice daily (about 10:00 and 21:30) to catch late sleep edits and syncs.
 * - Backfill: walks your history in chunks and resumes itself if it nears
 *   Apps Script's 6-minute limit. Progress is written to oura_sync_log.
 * - Workouts: an autodetected workout that overlaps another workout (for example
 *   a ride imported from Strava) gets that workout's id in duplicate_of. Nothing is deleted.
 * - Sleep: raw 5-minute HR/HRV arrays are replaced by derived columns
 *   (lowest HR timing, HRV by half of the night) plus average HR in the 3 hours before bed,
 *   and early-hours waking: minutes awake and separate wakes between 1:30 and 4:15am,
 *   always stopping 15 minutes before the final wake so a planned early alarm doesn't count.
 *
 * - Standard tabs: besides the raw oura_* tabs, every sync also writes wearable_daily,
 *   wearable_sleep and wearable_workouts. These have the same columns whatever the
 *   device, and they are what the Daily tab and the dashboard read. See
 *   docs/wearable-layer.md for the contract other device adapters follow.
 *
 * Don't add your own columns to oura_* or wearable_* tabs: they are rewritten on every sync.
 */

const CONFIG = {
  WINDOW_DAYS: 7,                 // rolling re-pull window for the twice-daily sync
  LATEST_WINDOW_DAYS: 2,          // window for the hourly sync
  BACKFILL_START: '2024-01-01',   // earliest date to backfill; empty ranges are cheap
  BACKFILL_CHUNK_DAYS: 120,
  HR_CHUNK_DAYS: 10,              // heart rate time series is fetched in small ranges
  PRE_BED_HOURS: 3,
  EARLY_WAKE_FROM: '01:30',       // early-hours wake window, local time (EARLY_WAKE_TO: 15 min before your alarm)
  EARLY_WAKE_TO: '04:15',
  EARLY_WAKE_END_BUFFER_MIN: 15,  // window always ends this long before the final wake
  SYNC_TIMES: [{hour: 10, minute: 0}, {hour: 21, minute: 30}],
  TAB_PREFIX: 'oura_',
  LOG_TAB: 'oura_sync_log',
  LOG_MAX_ROWS: 300,
  MAX_RUN_MS: 4.5 * 60 * 1000,
  DAY_FORMAT: 'ddd d mmm yyyy',
  DATETIME_FORMAT: 'ddd d mmm yyyy, h:mm am/pm',
};

const OURA = {
  AUTH_URL: 'https://cloud.ouraring.com/oauth/authorize',
  TOKEN_URL: 'https://api.ouraring.com/oauth/token',
  REVOKE_URL: 'https://api.ouraring.com/oauth/revoke',
  API_BASE: 'https://api.ouraring.com/v2/usercollection/',
};

// dateField drives the replace window. drop removes long strings or arrays that
// don't belong in a sheet (arrays and time-series objects are skipped anyway).
const ENDPOINTS = [
  {path: 'daily_sleep', dateField: 'day'},
  {path: 'daily_readiness', dateField: 'day'},
  {path: 'daily_activity', dateField: 'day', drop: ['met', 'class_5_min']},
  {path: 'daily_stress', dateField: 'day'},
  {path: 'daily_resilience', dateField: 'day'},
  {path: 'daily_spo2', dateField: 'day'},
  {path: 'daily_cardiovascular_age', dateField: 'day'},
  {path: 'vO2_max', dateField: 'day', tab: 'vo2_max'},
  {path: 'sleep', dateField: 'day',
    drop: ['heart_rate', 'hrv', 'movement_30_sec', 'sleep_phase_5_min', 'sleep_phase_30_sec', 'app_sleep_phase_5_min']},
  {path: 'sleep_time', dateField: 'day'},
  {path: 'workout', dateField: 'day'},
  {path: 'session', dateField: 'day', drop: ['heart_rate', 'heart_rate_variability', 'motion_count']},
  {path: 'enhanced_tag', dateField: 'start_day'},
  {path: 'rest_mode_period', dateField: 'start_day', drop: ['episodes']},
];

// Standard tabs (the wearable layer). Column order is fixed so every device's
// adapter writes the same shape. 'id' and 'day' always come first.
const SOURCE = 'oura';
const STANDARD = {
  daily: {tab: 'wearable_daily', needs: ['daily_activity', 'daily_sleep', 'daily_readiness'],
    columns: ['id', 'day', 'source', 'active_calories', 'total_calories', 'steps',
      'activity_score', 'sleep_score', 'readiness_score', 'temperature_deviation']},
  sleep: {tab: 'wearable_sleep', needs: ['sleep'],
    columns: ['id', 'day', 'source', 'type', 'bedtime_start', 'bedtime_end', 'total_sleep_min',
      'deep_sleep_min', 'rem_sleep_min', 'light_sleep_min', 'awake_min', 'efficiency', 'average_hrv',
      'average_heart_rate', 'lowest_heart_rate', 'lowest_hr_pct_of_night', 'hrv_first_half_avg',
      'hrv_second_half_avg', 'pre_bed_hr_avg', 'early_wake_min', 'early_wake_count']},
  workouts: {tab: 'wearable_workouts', needs: ['workout'],
    columns: ['id', 'day', 'source', 'activity', 'start_datetime', 'end_datetime', 'calories',
      'intensity', 'recorded_by', 'duplicate_of']},
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_MS = 24 * 3600 * 1000;

let TZ_ = null;
let RUN_WARNINGS_ = [];

/* ---------------------------------------------------------------- menu */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Oura')
    .addItem('1. Set Oura app credentials', 'setCredentials')
    .addItem('2. Connect Oura account', 'connectOura')
    .addItem('3. Backfill history', 'startBackfill')
    .addItem('4. Install sync schedule', 'installTriggers')
    .addSeparator()
    .addItem('Sync last ' + CONFIG.WINDOW_DAYS + ' days now', 'syncRecent')
    .addItem('Show redirect URI', 'showRedirectUri')
    .addItem('Disconnect Oura', 'disconnect')
    .addToUi();
  // Menus for the optional scripts in the same project, when they're installed.
  if (typeof addStravaMenu_ === 'function') addStravaMenu_();       // Strava_sync.gs
  if (typeof addFitNotesMenu_ === 'function') addFitNotesMenu_();   // FitNotes_import.gs
}

/* ---------------------------------------------------------------- auth */

function props_() {
  // User properties: visible only to you, not to people you share the sheet with.
  return PropertiesService.getUserProperties();
}

function redirectUri_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function showRedirectUri() {
  SpreadsheetApp.getUi().alert('Register this as the redirect URI in your Oura API application:\n\n' + redirectUri_());
}

function setCredentials() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Oura client ID', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Oura client secret', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  props_().setProperties({
    OURA_CLIENT_ID: id.getResponseText().trim(),
    OURA_CLIENT_SECRET: secret.getResponseText().trim(),
  });
  ui.alert('Saved. Next: Oura > Connect Oura account.');
}

function connectOura() {
  const clientId = props_().getProperty('OURA_CLIENT_ID');
  if (!clientId) throw new Error('Set credentials first: Oura > Set Oura app credentials.');
  const state = ScriptApp.newStateToken().withMethod('authCallback').withTimeout(600).createToken();
  // scope is left out on purpose: Oura then asks for every available scope.
  const url = OURA.AUTH_URL + '?' + toQuery_({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri_(),
    state: state,
  });
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px">' +
    '<p>Tick every data type on Oura\'s consent screen.</p>' +
    '<p><a href="' + url + '" target="_blank">Authorise Oura</a></p></div>')
    .setWidth(360).setHeight(140);
  SpreadsheetApp.getUi().showModalDialog(html, 'Connect Oura');
}

function authCallback(request) {
  const code = request.parameter.code;
  if (!code) {
    return HtmlService.createHtmlOutput('Oura did not return a code: ' +
      escapeHtml_(JSON.stringify(request.parameter)));
  }
  tokenRequest_({grant_type: 'authorization_code', code: code, redirect_uri: redirectUri_()});
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif">Oura connected. Scopes granted: ' +
    escapeHtml_(request.parameter.scope || 'not reported') +
    '.<br>You can close this tab and run Oura > Backfill history.</div>');
}

function tokenRequest_(params) {
  const p = props_();
  params.client_id = p.getProperty('OURA_CLIENT_ID');
  params.client_secret = p.getProperty('OURA_CLIENT_SECRET');
  const res = UrlFetchApp.fetch(OURA.TOKEN_URL, {method: 'post', payload: params, muteHttpExceptions: true});
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('Oura token request failed (' + res.getResponseCode() + '): ' + body.slice(0, 300));
  }
  const t = JSON.parse(body);
  const store = {
    OURA_ACCESS_TOKEN: t.access_token,
    OURA_EXPIRES_AT: String(Date.now() + (t.expires_in || 3600) * 1000 - 60 * 1000),
  };
  // Refresh tokens can rotate, so always keep the newest one.
  if (t.refresh_token) store.OURA_REFRESH_TOKEN = t.refresh_token;
  p.setProperties(store);
  return t;
}

function accessToken_() {
  const p = props_();
  const token = p.getProperty('OURA_ACCESS_TOKEN');
  const expiresAt = Number(p.getProperty('OURA_EXPIRES_AT') || 0);
  if (token && Date.now() < expiresAt) return token;
  const refresh = p.getProperty('OURA_REFRESH_TOKEN');
  if (!refresh) throw new Error('Not connected to Oura. Use Oura > Connect Oura account.');
  return tokenRequest_({grant_type: 'refresh_token', refresh_token: refresh}).access_token;
}

function disconnect() {
  const p = props_();
  const t = p.getProperty('OURA_ACCESS_TOKEN');
  if (t) {
    UrlFetchApp.fetch(OURA.REVOKE_URL + '?access_token=' + encodeURIComponent(t), {muteHttpExceptions: true});
  }
  ['OURA_ACCESS_TOKEN', 'OURA_REFRESH_TOKEN', 'OURA_EXPIRES_AT'].forEach(k => p.deleteProperty(k));
  SpreadsheetApp.getUi().alert('Disconnected from Oura. Your data tabs are untouched.');
}

/* ---------------------------------------------------------------- API */

function ouraGet_(path, params) {
  const out = [];
  let nextToken = null;
  do {
    const q = Object.assign({}, params);
    if (nextToken) q.next_token = nextToken;
    const json = fetchJson_(OURA.API_BASE + path + '?' + toQuery_(q));
    (json.data || []).forEach(d => out.push(d));
    nextToken = json.next_token || null;
  } while (nextToken);
  return out;
}

function fetchJson_(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      headers: {Authorization: 'Bearer ' + accessToken_()},
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 401 && attempt === 0) { props_().deleteProperty('OURA_EXPIRES_AT'); continue; }
    if (code === 429 || code >= 500) { Utilities.sleep(2000 * Math.pow(2, attempt)); continue; }
    throw new Error(code + ' ' + res.getContentText().slice(0, 200));
  }
  throw new Error('request kept failing after retries');
}

/* ---------------------------------------------------------------- sync */

function syncLatest() {
  // Hourly: a short window keeps today's numbers fresh. If a longer sync is
  // still running, skip quietly; the next hour picks it up.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5 * 1000)) return;
  try {
    const today = todayKey_();
    const result = syncRange_(addDays_(today, -CONFIG.LATEST_WINDOW_DAYS), addDays_(today, 1), 'hourly');
    if (result.errors.length) throw new Error('Oura sync finished with errors: ' + result.errors.join(' | '));
  } finally {
    lock.releaseLock();
  }
}

function syncRecent() {
  const today = todayKey_();
  const start = addDays_(today, -CONFIG.WINDOW_DAYS);
  const end = addDays_(today, 1);
  const result = withLock_(() => syncRange_(start, end, 'scheduled'));
  if (result.errors.length) {
    // Throwing makes Apps Script email you a failure notice.
    throw new Error('Oura sync finished with errors: ' + result.errors.join(' | '));
  }
}

function syncRange_(start, end, label) {
  const ss = SpreadsheetApp.getActive();
  RUN_WARNINGS_ = [];
  const summary = [];
  const errors = [];
  const fetched = {};   // path -> docs, only for endpoints that succeeded
  ENDPOINTS.forEach(ep => {
    try {
      // Fetch a day either side: some endpoints (daily_activity) treat start_date
      // as exclusive and others treat end_date as exclusive. Keep only the window.
      let docs = ouraGet_(ep.path, {start_date: addDays_(start, -1), end_date: addDays_(end, 1)})
        .filter(d => { const k = String(d[ep.dateField] || '').slice(0, 10); return k >= start && k <= end; });
      if (ep.path === 'sleep') docs = enrichSleep_(docs);
      if (ep.path === 'workout') docs = flagDuplicateWorkouts_(docs);
      fetched[ep.path] = docs;
      const rows = docs.map(d => flatten_(d, ep.drop || []));
      const n = mergeIntoTab_(ss, ep, rows, start, end);
      summary.push(ep.path + ' ' + n);
    } catch (e) {
      errors.push(ep.path + ': ' + e.message);
    }
  });
  writeStandardTabs_(ss, fetched, start, end, summary, errors);
  log_(ss, label, start, end, summary.concat(RUN_WARNINGS_).concat(errors.map(e => 'ERROR ' + e)));
  return {summary: summary, errors: errors};
}

/* ------------------------------------------------------------ backfill */

function startBackfill() {
  props_().setProperty('BACKFILL_CURSOR', CONFIG.BACKFILL_START);
  toast_('Backfill started from ' + CONFIG.BACKFILL_START + '. It continues in the background; progress is in ' +
    CONFIG.LOG_TAB + '.');
  continueBackfill();
}

function continueBackfill() {
  clearTriggers_('continueBackfill');
  const p = props_();
  let cursor = p.getProperty('BACKFILL_CURSOR');
  if (!cursor) return;
  const t0 = Date.now();
  const stop = addDays_(todayKey_(), 1);
  withLock_(() => {
    while (cursor < stop) {
      if (Date.now() - t0 > CONFIG.MAX_RUN_MS) {
        ScriptApp.newTrigger('continueBackfill').timeBased().after(60 * 1000).create();
        return;
      }
      let chunkEnd = addDays_(cursor, CONFIG.BACKFILL_CHUNK_DAYS);
      if (chunkEnd > stop) chunkEnd = stop;
      syncRange_(cursor, chunkEnd, 'backfill');
      cursor = chunkEnd;
      p.setProperty('BACKFILL_CURSOR', cursor);
    }
    p.deleteProperty('BACKFILL_CURSOR');
    toast_('Oura backfill complete.');
  });
}

/* ------------------------------------------------------------ triggers */

function installTriggers() {
  clearTriggers_('syncRecent');
  clearTriggers_('syncLatest');
  CONFIG.SYNC_TIMES.forEach(t => {
    ScriptApp.newTrigger('syncRecent').timeBased()
      .everyDays(1).atHour(t.hour).nearMinute(t.minute).inTimezone(tz_()).create();
  });
  ScriptApp.newTrigger('syncLatest').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Oura sync installed: hourly for the last ' + CONFIG.LATEST_WINDOW_DAYS +
    ' days, plus a ' + CONFIG.WINDOW_DAYS + '-day re-pull around 10:00 and 21:30 (' + tz_() + ').');
}

function clearTriggers_(fnName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fnName)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Another Oura sync is still running.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------- derived data */

function enrichSleep_(docs) {
  docs.forEach(d => {
    const start = Date.parse(d.bedtime_start);
    const end = Date.parse(d.bedtime_end);
    const span = end - start;
    if (!(span > 0)) return;

    const hr = samples_(d.heart_rate).filter(s => s.v != null);
    if (hr.length) {
      const min = hr.reduce((a, b) => (b.v < a.v ? b : a));
      d.lowest_hr_5min = min.v;
      d.lowest_hr_time = new Date(min.t);
      d.lowest_hr_pct_of_night = round_((min.t - start) / span, 2);
    }

    const hrv = samples_(d.hrv).filter(s => s.v != null);
    if (hrv.length) {
      const mid = start + span / 2;
      d.hrv_first_half_avg = round_(mean_(hrv.filter(s => s.t < mid).map(s => s.v)), 1);
      d.hrv_second_half_avg = round_(mean_(hrv.filter(s => s.t >= mid).map(s => s.v)), 1);
    }
    if (d.type === 'long_sleep') addEarlyWake_(d, start, end);
  });
  addPreBedHr_(docs);
  return docs;
}

// Minutes awake and separate wakes in the early hours, from Oura's 5-minute
// sleep stages ('4' = awake). Clock times use the offset Oura gives the night.
function addEarlyWake_(d, bedStart, bedEnd) {
  d.early_wake_min = '';
  d.early_wake_count = '';
  const phases = String(d.sleep_phase_5_min || d.app_sleep_phase_5_min || '');
  const m = String(d.bedtime_start || '').match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (!phases || !m || !DAY_RE.test(String(d.day || ''))) return;
  const off = m[1] === 'Z' ? 'Z' : m[1].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const winStart = Math.max(bedStart, Date.parse(d.day + 'T' + CONFIG.EARLY_WAKE_FROM + ':00' + off));
  const winEnd = Math.min(Date.parse(d.day + 'T' + CONFIG.EARLY_WAKE_TO + ':00' + off),
    bedEnd - CONFIG.EARLY_WAKE_END_BUFFER_MIN * 60 * 1000);
  if (!(winEnd > winStart)) return;
  let mins = 0, wakes = 0, prevAwake = false;
  for (let i = 0; i < phases.length; i++) {
    const t = bedStart + i * 5 * 60 * 1000;
    if (t < winStart || t >= winEnd) { prevAwake = false; continue; }
    const awake = phases[i] === '4';
    if (awake) { mins += 5; if (!prevAwake) wakes++; }
    prevAwake = awake;
  }
  d.early_wake_min = mins;
  d.early_wake_count = wakes;
}

function addPreBedHr_(docs) {
  const mains = docs.filter(d => d.type === 'long_sleep' && !isNaN(Date.parse(d.bedtime_start)));
  if (!mains.length) return;
  const preMs = CONFIG.PRE_BED_HOURS * 3600 * 1000;
  const starts = mains.map(d => Date.parse(d.bedtime_start));
  const from = Math.min.apply(null, starts) - preMs;
  const to = Math.max.apply(null, starts);
  const hr = [];
  try {
    for (let s = from; s < to; s += CONFIG.HR_CHUNK_DAYS * DAY_MS) {
      const e = Math.min(to, s + CONFIG.HR_CHUNK_DAYS * DAY_MS);
      ouraGet_('heartrate', {start_datetime: isoUtc_(s), end_datetime: isoUtc_(e)})
        .forEach(x => hr.push({t: Date.parse(x.timestamp), v: x.bpm, src: x.source}));
    }
  } catch (e) {
    RUN_WARNINGS_.push('pre-bed HR skipped: ' + e.message);
    return;
  }
  mains.forEach((d, i) => {
    const b = starts[i];
    const vals = hr
      .filter(x => x.t >= b - preMs && x.t < b && (x.src === 'awake' || x.src === 'rest') && x.v != null)
      .map(x => x.v);
    d.pre_bed_hr_avg = round_(mean_(vals), 1);
    d.pre_bed_hr_samples = vals.length;
  });
}

function flagDuplicateWorkouts_(docs) {
  const w = docs.map(d => ({d: d, s: Date.parse(d.start_datetime), e: Date.parse(d.end_datetime)}));
  w.forEach(a => {
    a.d.duplicate_of = '';
    if (a.d.source !== 'autodetected' || !(a.e > a.s)) return;
    const match = w.find(b => b !== a && b.d.source !== 'autodetected' && b.e > b.s &&
      Math.min(a.e, b.e) - Math.max(a.s, b.s) > 0.5 * Math.min(a.e - a.s, b.e - b.s));
    if (match) a.d.duplicate_of = match.d.id || 'overlaps ' + match.d.start_datetime;
  });
  return docs;
}

function samples_(series) {
  if (!series || !Array.isArray(series.items) || !series.timestamp) return [];
  const t0 = Date.parse(series.timestamp);
  const step = (series.interval || 300) * 1000;
  return series.items.map((v, i) => ({t: t0 + i * step, v: v}));
}

/* ------------------------------------------------------ standard tabs */

// Writes the wearable_* tabs from this run's Oura documents. A standard tab is
// only rewritten when every endpoint it is built from succeeded, so a failed
// call never blanks out good rows.
function writeStandardTabs_(ss, fetched, start, end, summary, errors) {
  const builders = {daily: standardDaily_, sleep: standardSleep_, workouts: standardWorkouts_};
  Object.keys(STANDARD).forEach(key => {
    const def = STANDARD[key];
    const missing = def.needs.filter(p => !fetched[p]);
    if (missing.length) { RUN_WARNINGS_.push(def.tab + ' skipped (needs ' + missing.join(', ') + ')'); return; }
    try {
      const rows = builders[key](fetched).map(r => {
        const o = {};
        def.columns.forEach(c => { o[c] = r[c] === undefined || r[c] === null ? '' : r[c]; });
        return o;
      });
      const n = mergeIntoTab_(ss, {fullTab: def.tab, dateField: 'day', columns: def.columns}, rows, start, end);
      summary.push(def.tab + ' ' + n);
    } catch (e) {
      errors.push(def.tab + ': ' + e.message);
    }
  });
}

function standardDaily_(f) {
  const days = {};
  const row = day => days[day] || (days[day] = {id: SOURCE + '-' + day, day: day, source: SOURCE});
  f.daily_activity.forEach(d => {
    const r = row(d.day);
    r.active_calories = d.active_calories;
    r.total_calories = d.total_calories;
    r.steps = d.steps;
    r.activity_score = d.score;
  });
  f.daily_sleep.forEach(d => { row(d.day).sleep_score = d.score; });
  f.daily_readiness.forEach(d => {
    const r = row(d.day);
    r.readiness_score = d.score;
    r.temperature_deviation = d.temperature_deviation;
  });
  return Object.keys(days).sort().map(k => days[k]);
}

function standardSleep_(f) {
  const min = s => (typeof s === 'number' ? Math.round(s / 60) : '');
  return f.sleep.filter(d => d.type !== 'deleted').map(d => ({
    id: d.id, day: d.day, source: SOURCE,
    type: d.type === 'long_sleep' ? 'main' : 'nap',
    bedtime_start: d.bedtime_start, bedtime_end: d.bedtime_end,
    total_sleep_min: min(d.total_sleep_duration), deep_sleep_min: min(d.deep_sleep_duration),
    rem_sleep_min: min(d.rem_sleep_duration), light_sleep_min: min(d.light_sleep_duration),
    awake_min: min(d.awake_time), efficiency: d.efficiency,
    average_hrv: d.average_hrv, average_heart_rate: d.average_heart_rate,
    lowest_heart_rate: d.lowest_heart_rate, lowest_hr_pct_of_night: d.lowest_hr_pct_of_night,
    hrv_first_half_avg: d.hrv_first_half_avg, hrv_second_half_avg: d.hrv_second_half_avg,
    pre_bed_hr_avg: d.pre_bed_hr_avg, early_wake_min: d.early_wake_min, early_wake_count: d.early_wake_count,
  }));
}

function standardWorkouts_(f) {
  return f.workout.map(d => ({
    id: d.id, day: d.day, source: SOURCE, activity: d.activity,
    start_datetime: d.start_datetime, end_datetime: d.end_datetime, calories: d.calories,
    intensity: d.intensity, recorded_by: d.source, duplicate_of: d.duplicate_of,
  }));
}

/* ------------------------------------------------------- sheet writing */

function flatten_(obj, drop, prefix, out) {
  out = out || {};
  prefix = prefix || '';
  Object.keys(obj).forEach(k => {
    if (!prefix && drop.indexOf(k) !== -1) return;
    const v = obj[k];
    const key = prefix + k;
    if (v === null || v === undefined) { out[key] = ''; return; }
    if (v instanceof Date) { out[key] = v; return; }
    if (Array.isArray(v)) return;
    if (typeof v === 'object') {
      if ('items' in v && 'interval' in v) return;   // time-series samples stay out
      flatten_(v, drop, key + '_', out);
      return;
    }
    out[key] = v;
  });
  return out;
}

function mergeIntoTab_(ss, ep, rows, start, end) {
  const name = ep.fullTab || CONFIG.TAB_PREFIX + (ep.tab || ep.path).toLowerCase();
  let sh = ss.getSheetByName(name);
  const values = sh ? sh.getDataRange().getValues() : [[]];
  const oldHeaders = (values[0] || []).filter(h => h !== '').map(String);
  const oldRows = values.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => { const o = {}; oldHeaders.forEach((h, i) => { o[h] = r[i]; }); return o; });

  const newIds = new Set(rows.map(r => r.id).filter(Boolean).map(String));
  const kept = oldRows.filter(o => {
    const k = dateKey_(o[ep.dateField]);
    const inWindow = k >= start && k <= end;
    return !inWindow && !(o.id && newIds.has(String(o.id)));
  });
  const removed = oldRows.length - kept.length;
  if (!rows.length && !removed) return 0;

  // Column order: id, date field, existing columns, then anything new.
  const headers = [];
  const seen = new Set();
  const add = h => { if (!seen.has(h)) { seen.add(h); headers.push(h); } };
  ['id', ep.dateField].concat(ep.columns || []).forEach(add);
  oldHeaders.forEach(add);
  rows.forEach(r => Object.keys(r).forEach(add));

  const fresh = rows.map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = toCell_(r[k]); }); return o; });
  const all = kept.concat(fresh).sort((a, b) => {
    const ka = dateKey_(a[ep.dateField]);
    const kb = dateKey_(b[ep.dateField]);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  const grid = [headers].concat(all.map(o => headers.map(h => (o[h] === undefined || o[h] === null ? '' : o[h]))));

  if (!sh) sh = ss.insertSheet(name, ss.getSheets().length);
  writeGrid_(sh, grid);
  return rows.length;
}

function writeGrid_(sh, grid) {
  const nRows = grid.length;
  const nCols = grid[0].length;
  if (sh.getMaxRows() < nRows) sh.insertRowsAfter(sh.getMaxRows(), nRows - sh.getMaxRows());
  if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, nRows, nCols).setValues(grid);
  sh.getRange(1, 1, 1, nCols).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (nRows < 2) return;
  grid[0].forEach((h, c) => {
    let hasDate = false;
    for (let r = 1; r < nRows; r++) { if (grid[r][c] instanceof Date) { hasDate = true; break; } }
    if (!hasDate) return;
    const isDay = h === 'day' || /_day$/.test(h);
    sh.getRange(2, c + 1, nRows - 1, 1).setNumberFormat(isDay ? CONFIG.DAY_FORMAT : CONFIG.DATETIME_FORMAT);
  });
}

function toCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    if (DAY_RE.test(v)) return dayToDate_(v);
    if (DATETIME_RE.test(v)) { const d = new Date(v); return isNaN(d.getTime()) ? v : d; }
    if (/^[=+\-@]/.test(v)) return "'" + v;   // never let text become a formula
    return v.length > 45000 ? v.slice(0, 45000) : v;
  }
  return v;
}

function log_(ss, label, start, end, lines) {
  let sh = ss.getSheetByName(CONFIG.LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.LOG_TAB, ss.getSheets().length);
    sh.appendRow(['run_at', 'type', 'start', 'end', 'result']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), label, "'" + start, "'" + end, lines.join(' | ')]);
  const extra = sh.getLastRow() - 1 - CONFIG.LOG_MAX_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

/* ------------------------------------------------------------- helpers */

function tz_() {
  return TZ_ || (TZ_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone());
}

function todayKey_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function addDays_(dayKey, n) {
  // Noon anchor keeps this safe across daylight-saving changes.
  const d = Utilities.parseDate(dayKey + ' 12', tz_(), 'yyyy-MM-dd HH');
  return Utilities.formatDate(new Date(d.getTime() + n * DAY_MS), tz_(), 'yyyy-MM-dd');
}

function dayToDate_(dayKey) {
  return Utilities.parseDate(dayKey, tz_(), 'yyyy-MM-dd');
}

function dateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return v ? String(v).slice(0, 10) : '';
}

function isoUtc_(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function mean_(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function round_(x, dp) {
  if (x === null || x === undefined || isNaN(x)) return '';
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

function toQuery_(obj) {
  return Object.keys(obj)
    .filter(k => obj[k] !== undefined && obj[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Oura', 10); } catch (e) { /* no UI when run by a trigger */ }
}
