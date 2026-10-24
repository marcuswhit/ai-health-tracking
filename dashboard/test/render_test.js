// Loads the dashboard page in jsdom with a stub of the Dashboard type's `dash` runtime,
// computes every calc from fixture data, renders both tabs and reports errors and key text.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(process.argv[2], 'utf8');
const d3src = fs.readFileSync(path.join(__dirname, 'node_modules/d3/dist/d3.min.js'), 'utf8');

const dom = new JSDOM(`<!doctype html><html><body><div id="dash-root">${html.replace(/<script>[\s\S]*<\/script>/, '')}</div></body></html>`, { runScripts: 'outside-only', url: 'https://example.test/#trends' });
const w = dom.window;
w.SVGElement.prototype.getComputedTextLength = function () { return (this.textContent || '').length * 6; };
w.eval(d3src);

// ---- fixture base datasets (loader output shapes)
const D = [
  ['2026-10-12', 940, 2660, 3000, 109, 224, 26, null, 81, 87, 1830, 3148], ['2026-10-13', 1409, 2990, 2853, 178, 260, 32, 96.3, 89, 82, 785, 3676],
  ['2026-10-14', 1747, 3220, 2915, 189, 212, 28, 96.1, 83, 83, 1085, 3976], ['2026-10-15', 1410, 2990, 2913, 185, 234, 23, null, 82, 83, 965, 3670],
  ['2026-10-16', 324, 2830, 2632, 152, 240, 13, null, 83, 82, 1195, 2528], ['2026-10-17', 2599, 3820, 3550, 197, 360, 17, null, 78, 78, 1125, 4917],
  ['2026-10-18', 1317, 2920, 1922, 113, 193, 12, null, 92, 84, 0, 3571], ['2026-10-19', 473, 2330, 2840, 203, 187, 29, null, 88, 88, 1089, 2713],
  ['2026-10-20', 1552, 3090, 3485, 161, 400, 27, 95.7, 77, 76, 930, 3847], ['2026-10-21', 148, 2100, 2568, 63, 278, 15, null, 85, 81, 1289, 2342],
  ['2026-10-22', 418, 2290, 2774, 86, 238, 15, null, 83, 84, 1189, 2635], ['2026-10-23', 777, 2540, 2700, 155, 260, 26, null, 85, 83, 788, 3030],
  ['2026-10-24', 4, 2000, null, null, null, null, null, 94, 90, null, 1949],
];
const daily = D.map(([date, ex, target, eaten, protein, carbs, fibre, weight, sleep, readiness, after5, burn]) => ({ date, exercise_kcal: ex, target, eaten, left: eaten == null ? null : target - eaten, protein, protein_left: null, carbs, fat: 90, fibre, weight, sleep, readiness, after5, notes: '', activity_score: 85, burn, big_override: '', big_eve: date === '2026-10-16' || date === '2026-10-23', carb_target: 230 }));
// one log row per day carrying that day's totals, split across a few meals
const log = [];
let row = 2;
D.forEach(([date, , , eaten, protein, carbs, fibre]) => {
  if (eaten == null) return;
  [['Breakfast', '07:30', 0.15], ['Lunch', '12:30', 0.3], ['Snack', '15:30', 0.2], ['Dinner', '18:45', 0.3], ['Drink', '18:00', 0.05]].forEach(([meal, time, f]) => {
    log.push({ sheet_row: row++, date, time, meal, description: meal + ' item', kcal: Math.round(eaten * f), protein: Math.round(protein * f), carbs: Math.round(carbs * f), fat: 25, fibre: Math.round(fibre * f), sugar: 8, notes: '', sat_fat: 9, alcohol: meal === 'Drink' && date > '2026-10-19' ? 2.5 : 0, gl: Math.round(carbs * f * 0.5) });
  });
});
const targets = [['Rest-day calories (kcal)', 2000], ['Share of exercise calories eaten back', 0.7], ['Protein target (g)', 170], ['Fibre target (g)', 35], ['Minimum fat (g)', 60], ['Start weight (kg)', 97], ['Goal weight (kg)', 90], ['Start date', '2026-10-12'], ['Maximum fat (% of calories)', 0.3], ['Maximum added sugar (% of calories)', 0.1], ['Maximum saturated fat (% of calories)', 0.1], ['Evening glycaemic load limit', 30], ['Rest-day carbs (g)', 190], ['Extra carbs per 100 exercise calories (g)', 15], ['Big-ride eve carb top-up (g)', 150], ['Usual big-ride day', 'Sat'], ['Weekly alcohol guideline (standard drinks)', 10]].map(([setting, value]) => ({ setting, value }));
const rides = [['2026-10-12', '05:42', 3388, 756], ['2026-10-13', '05:13', 4325, 1049], ['2026-10-14', '05:03', 6512, 1638], ['2026-10-15', '05:01', 4664, 1246], ['2026-10-17', '05:32', 8663, 2130], ['2026-10-18', '06:45', 3794, 822], ['2026-10-19', '07:03', 1437, 325], ['2026-10-20', '06:18', 4690, 1072]]
  .map(([date, t, moving_s, kcal], i) => ({ id: String(i), date, start_local: `${date}T${t}:00`, name: 'Ride', sport_type: 'Ride', distance_m: 30000, moving_s, elevation_m: 300, kcal, elapsed_s: moving_s }));
const workouts = [{ date: '2026-10-16', activity: 'surfing', minutes: 60, kcal: 300, start_min: 960, end_min: 1020 }];
const prev = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const sleep = [['2026-10-13', 1226, 42, 46, 10], ['2026-10-14', 1267, 46, 45, 5], ['2026-10-15', 1215, 42, 46, 5], ['2026-10-16', 1247, 40, 47, 0], ['2026-10-17', 1259, 38, 47, 0], ['2026-10-18', 1250, 61, 45, 5], ['2026-10-19', 1290, 59, 46, 5], ['2026-10-20', 1256, 40, 47, 0], ['2026-10-21', 1230, 44, 46, 5], ['2026-10-22', 1251, 38, 48, 0], ['2026-10-23', 1239, 46, 46, 0], ['2026-10-24', 1236, 50, 45, 0]]
  .map(([day, bed_min, hrv, lowest_hr, ew]) => ({ day, evening: prev(day), bedtime: '8:45 pm', bed_min, early_wake_min: ew, early_wake_count: ew ? 1 : 0, hrv_first: hrv - 5, hrv_second: hrv + 5, lowest_pct: 0.6, lowest_hr, hrv }));
const gotos = [{ row: 2, category: 'Dinner', item: 'Salmon, potatoes, greens', kcal: 500, protein: 38, carbs: 38, fat: 20, fibre: 8, notes: '', gl: 9 }];
// power: a 40 km loop on Tue/Fri and a 60 km ride on Sat for 30 weeks, a little weaker since the start date
const power = [];
for (let i = 0; i < 210; i++) {
  const d = new Date(Date.UTC(2026, 2, 28) + i * 864e5), date = d.toISOString().slice(0, 10), wd = d.getUTCDay();
  if (![2, 5, 6].includes(wd) || date >= '2026-10-24') continue;
  const long = wd === 6, drift = date >= '2026-10-12' ? -0.03 : 0, wobble = ((i * 37) % 11 - 5) / 100;
  power.push({ id: 'p' + i, date, sport_type: 'Ride', trainer: false, moving_min: long ? 140 : 75, distance_km: long ? 62 : 40, elevation_m: long ? 950 : 220, avg_watts: 200, weighted_watts: Math.round((long ? 225 : 240) * (1 + drift + wobble)), power_meter: true, kj: long ? 1700 : 1000 });
}
power.push({ id: 'mtb', date: '2026-10-01', sport_type: 'MountainBikeRide', trainer: false, moving_min: 66, distance_km: 20, elevation_m: 420, avg_watts: 195, weighted_watts: null, power_meter: false, kj: 780 });
// gym: bench twice a week and squat once, chin-ups by reps
const gym = [];
for (let i = 0; i < 200; i += 4) {
  const date = new Date(Date.UTC(2026, 3, 1) + i * 864e5).toISOString().slice(0, 10);
  if (date > '2026-10-23') break;
  const after = date >= '2026-10-12';
  gym.push({ date, lift: 'Bench press', weight_kg: after ? 85 : 90, reps: 4, e1rm: after ? 96.3 : 102, bodyweight: false });
  if (i % 8 === 0) gym.push({ date, lift: 'Squat', weight_kg: 120, reps: 3, e1rm: 132, bodyweight: false });
  gym.push({ date, lift: 'Chin-up', weight_kg: 0, reps: after ? 10 : 9, e1rm: null, bodyweight: true });
}
const base = { log, daily, targets, rides, workouts, sleep, gotos, power, gym };

const calcs = {};
const results = {};
w.dash = {
  loader() {}, calc(id, def) { calcs[id] = def; }, setParams() {}, params: () => ({}), setLink() {}, refresh() {},
  colors: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8'],
  data: (id) => (id in results ? { status: 'ok', data: results[id], columns: [], meta: [] } : id in base ? { status: 'ok', data: base[id] } : { status: 'missing', data: [] }),
  onData(fn) { w.__render = fn; },
};
// freeze "today" as Sat 24 Oct 2026, 9:00 am Brisbane
const RealDate = w.Date;
const fixed = RealDate.parse('2026-10-23T23:00:00Z');
w.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
const scriptSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const errors = [];
const T0 = Date.now(); const step = (m) => process.stderr.write(m + ' ' + (Date.now() - T0) + 'ms\n');
step('eval'); try { w.eval(scriptSrc); } catch (e) { errors.push('load: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
step('calcs');
const pending = new Set(Object.keys(calcs));
let guard = 0;
while (pending.size && guard++ < 50) {
  for (const id of [...pending]) {
    const def = calcs[id];
    if (def.inputs.every((i) => i in base || i in results)) {
      try { results[id] = def.fn(...def.inputs.map((i) => (i in results ? results[i] : base[i]))); } catch (e) { errors.push(`calc ${id}: ${e.message}`); results[id] = []; }
      pending.delete(id);
    }
  }
}
if (pending.size) errors.push('unresolved calcs: ' + [...pending].join(', '));
step('render'); const doc = w.document;
for (const t of ['tab-today', 'tab-trends']) {
  try { doc.getElementById(t).click(); } catch (e) { errors.push(`render ${t}: ${e.stack.split('\n').slice(0, 4).join(' | ')}`); }
}
w.addEventListener('error', (e) => errors.push('window: ' + e.message));
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors');
const txt = (id) => (doc.getElementById(id) ? doc.getElementById(id).textContent.replace(/\s+/g, ' ').trim() : '(missing #' + id + ')');
['pw-note', 'pw-since', 'pw-before', 'pw-wkg', 'pw-wkg0', 'pw-chip', 'st-note', 'st-table', 'st-chip', 'st-legend', 'take-list', 'o-pace', 'o-date', 'o-weigh', 'bf-note', 'px-list', 'ss-note', 'lv-note', 'lv-table', 'rc-note', 'rc-chip', 'rf-table', 'rf-note', 'weeks'].forEach((id) => console.log(`#${id}: ${txt(id).slice(0, 400)}`));
['ch-daytype','ch-protein','ch-surplus','ch-levers','ch-power','ch-strength'].forEach((id)=>console.log('svg in #'+id+':', !!doc.querySelector('#'+id+' svg'), (doc.querySelector('#'+id+' svg')||{textContent:''}).textContent.replace(/\s+/g,' ').slice(0,160)));
console.log('tones in take-list:', [...doc.querySelectorAll('#take-list li')].map((l)=>l.className+':'+l.querySelector('.ft-tag').textContent).join(' | '));
console.log('tones in px-list:', [...doc.querySelectorAll('#px-list li')].map((l)=>l.className+':'+l.querySelector('.ft-tag').textContent).join(' | '));
console.log('svg in #ch-recovery:', !!doc.querySelector('#ch-recovery svg'), '| #ch-progress:', !!doc.querySelector('#ch-progress svg'), '| #ch-carb:', !!doc.querySelector('#ch-carb svg'));
// marks with no value in the data (a rough version of the type's own check)
const unmarked = [...doc.querySelectorAll('#trends [data-source]')].filter((el) => !(el.dataset.source.split(' ').every((s) => s in results || s in base)));
console.log('marks naming unknown sources:', unmarked.map((e) => e.dataset.source).join(', ') || 'none');
process.exit(0);
