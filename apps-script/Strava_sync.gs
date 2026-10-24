/**
 * Strava to Google Sheets sync (Strava API v3)
 *
 * Bound to the Food log spreadsheet, alongside Oura_sync.gs. Writes one row per
 * activity to strava_activities: power, heart rate, energy and duration, for
 * long-run trends (W/kg, efficiency, training load) against food and sleep.
 * Part of ai-health-tracking: https://github.com/marcuswhit/ai-health-tracking
 * Licence: PolyForm Noncommercial 1.0.0 (see LICENSE). Your Strava credentials and tokens are kept in
 * your own Apps Script user properties; nobody you share the sheet with can see them.
 *
 * - The Strava menu is added by onOpen in Oura_sync.gs (it calls addStravaMenu_ when this file exists).
 *   If you don't use Oura_sync.gs, add: function onOpen() { addStravaMenu_(); }
 * - Hourly: re-pulls the last 3 days. Nightly: re-pulls the last 30 days, so edits, renames
 *   and deleted activities are picked up.
 * - Backfill: walks your history a year at a time from BACKFILL_START and resumes itself
 *   if it nears Apps Script's 6-minute limit or hits Strava's rate limit.
 * - Only summary fields are fetched (one call per 200 activities). Per-second streams,
 *   best efforts and FTP-based scores (TSS, IF) are not; kJ is the load measure that
 *   works across all years.
 * - Every name in this file starts with "strava" or "STRAVA" so it can share a project
 *   with Oura_sync.gs.
 *
 * Don't add your own columns to strava_activities: it is rewritten on every sync.
 */

const STRAVA_CONFIG = {
  BACKFILL_START: '2011-01-01',   // earliest date to backfill; empty years cost one call
  BACKFILL_CHUNK_DAYS: 365,
  LATEST_WINDOW_DAYS: 3,          // hourly
  RECENT_WINDOW_DAYS: 30,         // nightly
  NIGHTLY_AT: {hour: 21, minute: 45},
  PER_PAGE: 200,
  TAB: 'strava_activities',
  LOG_TAB: 'strava_sync_log',
  LOG_MAX_ROWS: 300,
  MAX_RUN_MS: 4.5 * 60 * 1000,
  RATE_LIMIT_RETRY_MIN: 16,       // Strava's short limit resets every 15 minutes
  DAY_FORMAT: 'ddd d mmm yyyy',
  DATETIME_FORMAT: 'ddd d mmm yyyy, h:mm am/pm',
};

const STRAVA = {
  AUTH_URL: 'https://www.strava.com/oauth/authorize',
  TOKEN_URL: 'https://www.strava.com/oauth/token',
  DEAUTH_URL: 'https://www.strava.com/oauth/deauthorize',
  ACTIVITIES_URL: 'https://www.strava.com/api/v3/athlete/activities',
  SCOPE: 'read,activity:read_all',
};

// Fixed column order. 'id' and 'day' first, as in the wearable_* tabs.
const STRAVA_COLUMNS = ['id', 'day', 'source', 'start_local', 'name', 'sport_type', 'trainer', 'commute',
  'manual', 'workout_type', 'moving_min', 'elapsed_min', 'distance_km', 'elevation_m', 'avg_speed_kmh',
  'avg_watts', 'weighted_watts', 'max_watts', 'power_meter', 'kilojoules', 'avg_hr', 'max_hr',
  'avg_cadence', 'relative_effort', 'efficiency_factor', 'variability_index', 'gear_id', 'timezone'];

// Strava's workout_type codes: runs 0-3, rides 10-12.
const STRAVA_WORKOUT_TYPES = {1: 'race', 2: 'long run', 3: 'workout', 11: 'race', 12: 'workout'};

const STRAVA_DAY_MS = 24 * 3600 * 1000;
let STRAVA_TZ_ = null;

class StravaRateLimit_ extends Error {}

/* ---------------------------------------------------------------- menu */

function addStravaMenu_() {
  SpreadsheetApp.getUi().createMenu('Strava')
    .addItem('1. Set Strava app credentials', 'stravaSetCredentials')
    .addItem('2. Connect Strava account', 'stravaConnect')
    .addItem('3. Backfill history', 'stravaStartBackfill')
    .addItem('4. Install sync schedule', 'stravaInstallTriggers')
    .addSeparator()
    .addItem('Sync last ' + STRAVA_CONFIG.RECENT_WINDOW_DAYS + ' days now', 'stravaSyncRecent')
    .addItem('Show callback domain', 'stravaShowCallback')
    .addItem('Disconnect Strava', 'stravaDisconnect')
    .addToUi();
}

/* ---------------------------------------------------------------- auth */

function stravaProps_() {
  return PropertiesService.getUserProperties();
}

function stravaRedirectUri_() {
  return 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback';
}

function stravaShowCallback() {
  SpreadsheetApp.getUi().alert('In your Strava API application (strava.com/settings/api), set\n' +
    'Authorization Callback Domain to:\n\nscript.google.com');
}

function stravaSetCredentials() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Strava client ID', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Strava client secret', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  stravaProps_().setProperties({
    STRAVA_CLIENT_ID: id.getResponseText().trim(),
    STRAVA_CLIENT_SECRET: secret.getResponseText().trim(),
  });
  ui.alert('Saved. Next: Strava > Connect Strava account.');
}

function stravaConnect() {
  const clientId = stravaProps_().getProperty('STRAVA_CLIENT_ID');
  if (!clientId) throw new Error('Set credentials first: Strava > Set Strava app credentials.');
  const state = ScriptApp.newStateToken().withMethod('stravaAuthCallback').withTimeout(600).createToken();
  const url = STRAVA.AUTH_URL + '?' + stravaQuery_({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: stravaRedirectUri_(),
    approval_prompt: 'force',
    scope: STRAVA.SCOPE,
    state: state,
  });
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px">' +
    '<p>Leave "View data about your private activities" ticked, so rides set to private or followers-only are included.</p>' +
    '<p><a href="' + url + '" target="_blank">Authorise Strava</a></p></div>')
    .setWidth(380).setHeight(160);
  SpreadsheetApp.getUi().showModalDialog(html, 'Connect Strava');
}

function stravaAuthCallback(request) {
  const code = request.parameter.code;
  if (!code) {
    return HtmlService.createHtmlOutput('Strava did not return a code: ' +
      stravaEscapeHtml_(JSON.stringify(request.parameter)));
  }
  stravaTokenRequest_({grant_type: 'authorization_code', code: code});
  const scope = request.parameter.scope || '';
  const warn = scope.indexOf('activity:read_all') < 0
    ? '<br><b>Private activities were not granted</b>, so they will be missing. Connect again and leave that box ticked.'
    : '';
  return HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif">Strava connected. Scopes granted: ' + stravaEscapeHtml_(scope || 'not reported') +
    '.' + warn + '<br>You can close this tab and run Strava > Backfill history.</div>');
}

function stravaTokenRequest_(params) {
  const p = stravaProps_();
  params.client_id = p.getProperty('STRAVA_CLIENT_ID');
  params.client_secret = p.getProperty('STRAVA_CLIENT_SECRET');
  const res = UrlFetchApp.fetch(STRAVA.TOKEN_URL, {method: 'post', payload: params, muteHttpExceptions: true});
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) {
    throw new Error('Strava token request failed (' + res.getResponseCode() + '): ' + body.slice(0, 300));
  }
  const t = JSON.parse(body);
  const store = {
    STRAVA_ACCESS_TOKEN: t.access_token,
    // expires_at is epoch seconds; refresh a minute early.
    STRAVA_EXPIRES_AT: String((t.expires_at ? t.expires_at * 1000 : Date.now() + 6 * 3600 * 1000) - 60 * 1000),
  };
  if (t.refresh_token) store.STRAVA_REFRESH_TOKEN = t.refresh_token;   // can rotate: keep the newest
  p.setProperties(store);
  return t;
}

function stravaAccessToken_() {
  const p = stravaProps_();
  const token = p.getProperty('STRAVA_ACCESS_TOKEN');
  const expiresAt = Number(p.getProperty('STRAVA_EXPIRES_AT') || 0);
  if (token && Date.now() < expiresAt) return token;
  const refresh = p.getProperty('STRAVA_REFRESH_TOKEN');
  if (!refresh) throw new Error('Not connected to Strava. Use Strava > Connect Strava account.');
  return stravaTokenRequest_({grant_type: 'refresh_token', refresh_token: refresh}).access_token;
}

function stravaDisconnect() {
  const p = stravaProps_();
  const t = p.getProperty('STRAVA_ACCESS_TOKEN');
  if (t) UrlFetchApp.fetch(STRAVA.DEAUTH_URL, {method: 'post', payload: {access_token: t}, muteHttpExceptions: true});
  ['STRAVA_ACCESS_TOKEN', 'STRAVA_REFRESH_TOKEN', 'STRAVA_EXPIRES_AT', 'STRAVA_BACKFILL_CURSOR']
    .forEach(k => p.deleteProperty(k));
  stravaClearTriggers_('stravaContinueBackfill');
  SpreadsheetApp.getUi().alert('Disconnected from Strava. strava_activities is untouched.');
}

/* ---------------------------------------------------------------- API */

// Every activity that started between two local days (inclusive). Strava filters on
// UTC epoch seconds, so ask for a day either side and keep the window by local date.
function stravaFetchWindow_(start, end) {
  const after = Math.floor(stravaDayToDate_(stravaAddDays_(start, -1)).getTime() / 1000);
  const before = Math.floor(stravaDayToDate_(stravaAddDays_(end, 2)).getTime() / 1000);
  const out = [];
  for (let page = 1; page < 500; page++) {
    const batch = stravaFetchJson_(STRAVA.ACTIVITIES_URL + '?' + stravaQuery_({
      after: after, before: before, page: page, per_page: STRAVA_CONFIG.PER_PAGE,
    }));
    batch.forEach(a => out.push(a));
    if (batch.length < STRAVA_CONFIG.PER_PAGE) break;
  }
  return out.filter(a => {
    const k = String(a.start_date_local || '').slice(0, 10);
    return k >= start && k <= end;
  });
}

function stravaFetchJson_(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = UrlFetchApp.fetch(url, {
      headers: {Authorization: 'Bearer ' + stravaAccessToken_()},
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) return JSON.parse(res.getContentText());
    if (code === 401 && attempt === 0) { stravaProps_().deleteProperty('STRAVA_EXPIRES_AT'); continue; }
    if (code === 429) throw new StravaRateLimit_('Strava rate limit reached');
    if (code >= 500) { Utilities.sleep(2000 * Math.pow(2, attempt)); continue; }
    throw new Error(code + ' ' + res.getContentText().slice(0, 200));
  }
  throw new Error('request kept failing after retries');
}

/* ---------------------------------------------------------------- rows */

function stravaRow_(a) {
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
  const powerMeter = a.device_watts === true;
  const np = num(a.weighted_average_watts);
  const avgW = num(a.average_watts);
  const avgHr = a.has_heartrate === false ? null : num(a.average_heartrate);
  const local = String(a.start_date_local || '');
  return {
    id: String(a.id),
    day: local.slice(0, 10),
    source: 'strava',
    start_local: local,
    name: a.name || '',
    sport_type: a.sport_type || a.type || '',
    trainer: a.trainer === true,
    commute: a.commute === true,
    manual: a.manual === true,
    workout_type: STRAVA_WORKOUT_TYPES[a.workout_type] || '',
    moving_min: stravaRound_(num(a.moving_time) / 60, 1),
    elapsed_min: stravaRound_(num(a.elapsed_time) / 60, 1),
    distance_km: stravaRound_(num(a.distance) / 1000, 2),
    elevation_m: stravaRound_(num(a.total_elevation_gain), 0),
    avg_speed_kmh: stravaRound_(num(a.average_speed) * 3.6, 1),
    avg_watts: stravaRound_(avgW, 0),
    weighted_watts: stravaRound_(np, 0),
    max_watts: stravaRound_(num(a.max_watts), 0),
    power_meter: powerMeter,
    kilojoules: stravaRound_(num(a.kilojoules), 0),
    avg_hr: stravaRound_(avgHr, 0),
    max_hr: a.has_heartrate === false ? '' : stravaRound_(num(a.max_heartrate), 0),
    avg_cadence: stravaRound_(num(a.average_cadence), 0),
    relative_effort: stravaRound_(num(a.suffer_score), 0),
    // Measured power only: Strava's estimated watts would make these meaningless.
    efficiency_factor: powerMeter && np && avgHr ? stravaRound_(np / avgHr, 2) : '',
    variability_index: powerMeter && np && avgW ? stravaRound_(np / avgW, 2) : '',
    gear_id: a.gear_id || '',
    timezone: String(a.timezone || '').replace(/^\(GMT[^)]*\)\s*/, ''),
  };
}

function stravaToCell_(key, v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (key === 'day') return stravaDayToDate_(v);
  // start_date_local ends in Z but is the wall-clock time where the ride happened.
  if (key === 'start_local') return Utilities.parseDate(v.slice(0, 19), stravaTz_(), "yyyy-MM-dd'T'HH:mm:ss");
  if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v;   // never let a ride name become a formula
  return v;
}

/* ---------------------------------------------------------------- write */

// Replace every row whose day is in [start, end] (so deleted activities disappear),
// plus any row whose id came back again, and keep everything else.
function stravaMerge_(ss, activities, start, end) {
  let sh = ss.getSheetByName(STRAVA_CONFIG.TAB);
  const values = sh ? sh.getDataRange().getValues() : [[]];
  const headers = (values[0] || []).map(String);
  const iId = headers.indexOf('id');
  const iDay = headers.indexOf('day');
  const freshIds = new Set(activities.map(a => String(a.id)));
  const kept = (iId < 0 || iDay < 0) ? [] : values.slice(1)
    .filter(r => r[iId] !== '' && r[iId] !== null)
    .filter(r => {
      const k = stravaDateKey_(r[iDay]);
      return !(k >= start && k <= end) && !freshIds.has(String(r[iId]));
    })
    // getValues drops the protective apostrophe, so re-apply it to text read back.
    .map(r => STRAVA_COLUMNS.map(h => { const i = headers.indexOf(h); return i < 0 ? '' : stravaToCell_(h, r[i]); }));
  const removed = Math.max(0, values.length - 1 - kept.length);
  if (!activities.length && !removed) return {written: 0, total: kept.length};

  const fresh = activities.map(stravaRow_).map(o => STRAVA_COLUMNS.map(h => stravaToCell_(h, o[h])));
  const iStart = STRAVA_COLUMNS.indexOf('start_local');
  const time = r => (r[iStart] instanceof Date ? r[iStart].getTime() : 0);
  const all = kept.concat(fresh).sort((a, b) => time(a) - time(b) || String(a[0]).localeCompare(String(b[0])));

  if (!sh) sh = ss.insertSheet(STRAVA_CONFIG.TAB, ss.getSheets().length);
  stravaWriteGrid_(sh, [STRAVA_COLUMNS].concat(all));
  return {written: fresh.length, total: all.length};
}

function stravaWriteGrid_(sh, grid) {
  const nRows = grid.length;
  const nCols = grid[0].length;
  if (sh.getMaxRows() < nRows) sh.insertRowsAfter(sh.getMaxRows(), nRows - sh.getMaxRows());
  if (sh.getMaxColumns() < nCols) sh.insertColumnsAfter(sh.getMaxColumns(), nCols - sh.getMaxColumns());
  sh.clearContents();
  sh.getRange(1, 1, nRows, nCols).setValues(grid);
  sh.getRange(1, 1, 1, nCols).setFontWeight('bold');
  sh.setFrozenRows(1);
  if (nRows < 2) return;
  sh.getRange(2, 1, nRows - 1, 1).setNumberFormat('0');   // ids are long integers
  sh.getRange(2, STRAVA_COLUMNS.indexOf('day') + 1, nRows - 1, 1).setNumberFormat(STRAVA_CONFIG.DAY_FORMAT);
  sh.getRange(2, STRAVA_COLUMNS.indexOf('start_local') + 1, nRows - 1, 1).setNumberFormat(STRAVA_CONFIG.DATETIME_FORMAT);
}

function stravaLog_(ss, label, start, end, text) {
  let sh = ss.getSheetByName(STRAVA_CONFIG.LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(STRAVA_CONFIG.LOG_TAB, ss.getSheets().length);
    sh.appendRow(['run_at', 'type', 'start', 'end', 'result']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  sh.appendRow([new Date(), label, "'" + start, "'" + end, text]);
  const extra = sh.getLastRow() - 1 - STRAVA_CONFIG.LOG_MAX_ROWS;
  if (extra > 0) sh.deleteRows(2, extra);
}

/* ---------------------------------------------------------------- sync */

function stravaSyncRange_(start, end, label) {
  const ss = SpreadsheetApp.getActive();
  try {
    const acts = stravaFetchWindow_(start, end);
    const r = stravaMerge_(ss, acts, start, end);
    stravaLog_(ss, label, start, end, r.written + ' activities, ' + r.total + ' in tab');
    return r;
  } catch (e) {
    stravaLog_(ss, label, start, end, (e instanceof StravaRateLimit_ ? 'RATE LIMIT ' : 'ERROR ') + e.message);
    throw e;
  }
}

function stravaSyncLatest() {
  const lock = LockService.getDocumentLock();   // separate from Oura's script lock
  if (!lock.tryLock(5 * 1000)) return;
  try {
    if (stravaProps_().getProperty('STRAVA_BACKFILL_CURSOR')) return;   // backfill owns the API budget
    const today = stravaTodayKey_();
    stravaSyncRange_(stravaAddDays_(today, -STRAVA_CONFIG.LATEST_WINDOW_DAYS), today, 'hourly');
  } catch (e) {
    if (!(e instanceof StravaRateLimit_)) throw e;   // a rate limit just waits for the next hour
  } finally {
    lock.releaseLock();
  }
}

function stravaSyncRecent() {
  const today = stravaTodayKey_();
  stravaWithLock_(() => stravaSyncRange_(stravaAddDays_(today, -STRAVA_CONFIG.RECENT_WINDOW_DAYS), today, 'nightly'));
}

/* ------------------------------------------------------------ backfill */

function stravaStartBackfill() {
  stravaProps_().setProperty('STRAVA_BACKFILL_CURSOR', STRAVA_CONFIG.BACKFILL_START);
  stravaToast_('Backfill started from ' + STRAVA_CONFIG.BACKFILL_START + '. It continues in the background; ' +
    'progress is in ' + STRAVA_CONFIG.LOG_TAB + '.');
  stravaContinueBackfill();
}

function stravaContinueBackfill() {
  stravaClearTriggers_('stravaContinueBackfill');
  const p = stravaProps_();
  let cursor = p.getProperty('STRAVA_BACKFILL_CURSOR');
  if (!cursor) return;
  const t0 = Date.now();
  const today = stravaTodayKey_();
  const resumeIn = mins => ScriptApp.newTrigger('stravaContinueBackfill').timeBased().after(mins * 60 * 1000).create();
  stravaWithLock_(() => {
    while (cursor <= today) {
      if (Date.now() - t0 > STRAVA_CONFIG.MAX_RUN_MS) { resumeIn(1); return; }
      let chunkEnd = stravaAddDays_(cursor, STRAVA_CONFIG.BACKFILL_CHUNK_DAYS - 1);
      if (chunkEnd > today) chunkEnd = today;
      try {
        stravaSyncRange_(cursor, chunkEnd, 'backfill');
      } catch (e) {
        if (e instanceof StravaRateLimit_) { resumeIn(STRAVA_CONFIG.RATE_LIMIT_RETRY_MIN); return; }
        throw e;
      }
      cursor = stravaAddDays_(chunkEnd, 1);
      p.setProperty('STRAVA_BACKFILL_CURSOR', cursor);
    }
    p.deleteProperty('STRAVA_BACKFILL_CURSOR');
    stravaToast_('Strava backfill complete.');
  });
}

/* ------------------------------------------------------------ triggers */

function stravaInstallTriggers() {
  stravaClearTriggers_('stravaSyncLatest');
  stravaClearTriggers_('stravaSyncRecent');
  ScriptApp.newTrigger('stravaSyncLatest').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('stravaSyncRecent').timeBased().everyDays(1)
    .atHour(STRAVA_CONFIG.NIGHTLY_AT.hour).nearMinute(STRAVA_CONFIG.NIGHTLY_AT.minute).inTimezone(stravaTz_()).create();
  SpreadsheetApp.getUi().alert('Strava sync installed: hourly for the last ' + STRAVA_CONFIG.LATEST_WINDOW_DAYS +
    ' days, plus a ' + STRAVA_CONFIG.RECENT_WINDOW_DAYS + '-day re-pull around 21:45 (' + stravaTz_() + ').');
}

function stravaClearTriggers_(fnName) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === fnName)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function stravaWithLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30 * 1000)) throw new Error('Another Strava sync is still running.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------- helpers */

function stravaTz_() {
  return STRAVA_TZ_ || (STRAVA_TZ_ = SpreadsheetApp.getActive().getSpreadsheetTimeZone());
}

function stravaTodayKey_() {
  return Utilities.formatDate(new Date(), stravaTz_(), 'yyyy-MM-dd');
}

function stravaAddDays_(dayKey, n) {
  const d = Utilities.parseDate(dayKey + ' 12', stravaTz_(), 'yyyy-MM-dd HH');   // noon: safe across DST
  return Utilities.formatDate(new Date(d.getTime() + n * STRAVA_DAY_MS), stravaTz_(), 'yyyy-MM-dd');
}

function stravaDayToDate_(dayKey) {
  return Utilities.parseDate(dayKey, stravaTz_(), 'yyyy-MM-dd');
}

function stravaDateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, stravaTz_(), 'yyyy-MM-dd');
  return v ? String(v).slice(0, 10) : '';
}

function stravaRound_(x, dp) {
  if (x === null || x === undefined || isNaN(x)) return '';
  const f = Math.pow(10, dp);
  return Math.round(x * f) / f;
}

function stravaQuery_(obj) {
  return Object.keys(obj)
    .filter(k => obj[k] !== undefined && obj[k] !== null)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
    .join('&');
}

function stravaEscapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function stravaToast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Strava', 10); } catch (e) { /* no UI when run by a trigger */ }
}
