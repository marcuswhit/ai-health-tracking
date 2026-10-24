# Food log: data dictionary

Template for the project doc **"Food log - data dictionary"**. During setup (Phase 4) Claude fills in every [BRACKETED] value and saves it to the user's Claude Project. Project instructions point Claude here before it analyses the data or changes the sheet; routine food logging follows the fast path in the instructions and doesn't need this doc. If the sheet's structure changes, update this doc and its change log in the same chat.

**Filled-in values:** sheet ID [SHEET_ID] · timezone [TIMEZONE] · start date [START_DATE] · standard drink [COUNTRY], [GRAMS] g alcohol · usual big day [BIG_DAY] · early-hours window [WINDOW, e.g. 1:30-4:15am]

## 1. Sources and how data flows

| Source | Where it lands | How | Freshness |
|---|---|---|---|
| Food and drink (logged in chat) | `Log` tab | Claude appends one row per item | As logged |
| Oura ring (API v2) | `oura_*` raw tabs, plus the standard `wearable_*` tabs | Apps Script bound to the sheet (Extensions > Apps Script, menu "Oura") | Hourly re-pull of the last 2 days; 7-day re-pull around 10:00 and 21:30 |
| Strava (API v3, optional) | `strava_activities`, one row per activity | Apps Script `Strava_sync.gs` in the same project (menu "Strava"). No Strava subscription needed | Hourly re-pull of the last 3 days; 30-day re-pull around 21:45 |
| FitNotes (optional) | `gym_sets`, one row per set | Apps Script `FitNotes_import.gs` reads the newest FitNotes CSV export in Drive (menu "FitNotes") | Daily check around 22:00; as fresh as the last export |
| Strava connector (optional) | Not stored | Read live by Claude and the dashboard; needs a Strava subscription | Live |
| Weigh-ins | `Daily` column K | Typed by hand or by Claude | As entered |
| Big-day override | `Daily` column Y | Typed (by the user, or by Claude when the long session moves) | As entered |

- Spreadsheet: **Food log**, ID `[SHEET_ID]`, timezone [TIMEZONE].
- Dashboard: **Food & training** artifact ([DASHBOARD_URL]). It reads the sheet (and the Strava connector, if on) live; it stores no numbers of its own.
- `Daily` pulls from `Log` and the standard `wearable_*` tabs with formulas (never from `oura_*` directly); `Weekly` summarises `Daily`. Never type over formula cells. The only typed `Daily` columns are K (weight), O (notes) and Y (big-day override).

## 2. Tabs and columns

**Log** (input, one row per food or drink item). Append only; rows don't need to be in time order. Write all 13 columns.

| Col | Header | Type and unit | Rule |
|---|---|---|---|
| A | Date and time | Date-time, local | Real date-time value, displayed as `Fri 16 Oct 2026, 2:30 pm`. Never plain text: every `Daily` formula filters on it |
| B | Meal | One of: Breakfast, Lunch, Dinner, Snack, Drink, Ride fuel | `Ride fuel` = anything taken during a training session (or immediately before). Counts toward calories and carbs; excluded from added sugar |
| C | Description | Text | Food, brand and portion |
| D | Calories (kcal) | Number | |
| E | Protein (g) | Number | |
| F | Carbs (g) | Number | Total carbohydrate |
| G | Fat (g) | Number | Total fat |
| H | Fibre (g) | Number | |
| I | Added sugar (g) | Number | Sugars added in processing or by you: honey, syrups, lollies, sweetened drinks. Not fruit or plain milk/yoghurt sugars |
| J | Notes | Text | Assumptions behind the estimate (portion, label values, "estimated from photo") |
| K | Saturated fat (g) | Number | From the label where possible, otherwise a typical value |
| L | Alcohol (std drinks) | Number, 1 decimal | [COUNTRY] standard drink = [GRAMS] g alcohol; drinks = ml x ABV x 0.789 / [GRAMS]. Blank if none |
| M | Glycaemic load | Number, whole | GI x available carbs (carbs minus fibre) / 100. 0 for foods with no carbs |

Zero is entered as 0 and displays as `-`.

**Daily** (formulas, one row per date from the start date; copy the last row down to extend). The row for a date is 2 + days since the start date, so a day's summary is one read of `Daily!A{row}:AC{row}`.

| Col | Header | Meaning |
|---|---|---|
| A | Date | Start date from `Targets`, then +1 per row |
| B | Exercise calories (Oura) | `wearable_daily.active_calories`: workouts (Strava imports included) plus everyday movement |
| C | Calorie target | rest-day calories + eat-back share x B, + big-day top-up x 4 if Z = Yes, rounded to 10 |
| D | Calories eaten | Sum of `Log` D for the date |
| E | Calories left | C - D (negative = over target, shown in brackets) |
| F, G | Protein, Protein left (g) | Sum of `Log` E; protein target - F |
| H, I, J | Carbs, Fat, Fibre (g) | Sums of `Log` F, G, H |
| K | Weight (kg) | **Input**, morning weigh-in |
| L, M | Oura sleep, Oura readiness | `wearable_daily.sleep_score` and `readiness_score` for this date (the night before and this morning) |
| N | Calories from 5pm | Sum of `Log` D from 17:00 |
| O | Notes | **Input** |
| P | Added sugar (g) | Sum of `Log` I, excluding `Ride fuel` |
| Q | Oura activity | `wearable_daily.activity_score`; builds through the day, final next morning |
| R | Saturated fat (g) | Sum of `Log` K |
| S | Alcohol (std drinks) | Sum of `Log` L |
| T | Glycaemic load | Sum of `Log` M |
| U | Bedtime that night | `wearable_sleep.bedtime_start` of the main sleep (`type` = `main`) that follows this date |
| V | Early-hours awake that night (min) | Minutes awake in the early-hours window ([WINDOW]) of that sleep |
| W | Early-hours wakes that night | Separate wakes (5 min or more) in the same window |
| X | Total burn (Oura, kcal) | `wearable_daily.total_calories`: resting burn plus activity |
| Y | Big day tomorrow (override) | **Input**: blank, Yes or No. Blank uses `Targets` B17 |
| Z | Big-day eve | Y if filled, otherwise Yes when tomorrow's weekday = `Targets` B17 |
| AA | Carb target (g) | B14 + B15 x B / 100, + B16 if Z = Yes, rounded to 10 |
| AB | Carbs left (g) | AA - H |
| AC | Carbs (g per kg) | H / latest weigh-in on or before this date (start weight if none yet) |

**Weekly** (formulas, Monday-start weeks): days logged, average calories eaten and target, average protein, fibre, added sugar, saturated fat and calories from 5pm, exercise calories, weigh-ins, average weight, change from start, kg left to goal, weekly alcohol.

**Targets** (inputs in column B; column C records where each value came from): 2 rest-day calories, 3 eat-back share, 4 protein, 5 fibre, 6 minimum fat, 7 start weight, 8 goal weight, 9 start date, 10 max fat %, 11 max added sugar %, 12 max saturated fat %, 13 evening GL limit, 14 rest-day carbs, 15 extra carbs per 100 exercise calories, 16 big-day eve carb top-up, 17 usual big day, 18 weekly alcohol guideline (standard drinks, used by the Insights tab). Always read live values rather than relying on this list.

**Suggestions** (written by Claude when the user asks what to eat; rows 2 onward replaced each time): A written at (date-time), B for (Breakfast, Lunch, Dinner or Snack), C food with portion, D source (`Your log` or `New idea`), E kcal, F protein, G carbs, H fat, I fibre (g), J glycaemic load, K why it fits. Three rows: options that fit the calories left and close the biggest gap (protein, then the carb target, then fibre), low glycaemic load within 3 hours of bed, at least one nutritious repeat from the log and at least one new idea. The dashboard shows them only on the day they were written, beside its own ranking of foods from the log.

**wearable_* tabs** (standard tabs written by the sync; never edit). `wearable_daily` (one row per day), `wearable_sleep` (one row per sleep period; `type` is `main` or `nap`) and `wearable_workouts` (one row per workout). Column A is `id`, column B is `day`. Full column list: [wearable-layer.md](wearable-layer.md). These are what `Daily` and the dashboard read, whatever the device.

**oura_* tabs** (raw Oura data, written by the sync; never edit). Use them for deeper analysis, such as readiness contributors or stress. Each sync replaces the rows in its date window. Columns can move as Oura adds fields: **find columns by header name, never by letter.** `day` = the Oura day.

| Tab | Grain | Key columns |
|---|---|---|
| `oura_sleep` | One row per sleep period | `day` (date you woke), `type` (`long_sleep` = main sleep), `bedtime_start`, `bedtime_end`, `total_sleep_duration` (s), `average_hrv`, `lowest_heart_rate`, `lowest_hr_pct_of_night`, `hrv_first_half_avg`, `hrv_second_half_avg`, `pre_bed_hr_avg`, `early_wake_min`, `early_wake_count`, `readiness_temperature_deviation` |
| `oura_daily_sleep` | Per day | `score`, `contributors_*` |
| `oura_daily_readiness` | Per day | `score`, `temperature_deviation`, `contributors_*` |
| `oura_daily_activity` | Per day (4am to 4am) | `active_calories`, `total_calories`, `score`, `steps`, `high_activity_time` (s) |
| `oura_workout` | Per workout | `activity`, `calories`, `start_datetime`, `end_datetime`, `source`, `duplicate_of` |
| `oura_daily_stress`, `oura_daily_resilience`, `oura_daily_spo2`, `oura_daily_cardiovascular_age`, `oura_vo2_max`, `oura_sleep_time`, `oura_enhanced_tag` | Daily or per event | As named; tags are the user's own Oura tags |
| `oura_sync_log` | Per sync run | Rows written per tab and any errors |

**strava_activities** (written by `Strava_sync.gs`; never edit). One row per Strava activity of any sport, oldest first; each sync replaces the rows in its date window, so edits and deletions in Strava carry through. Columns are fixed:

| Column | Meaning |
|---|---|
| `id`, `day`, `source` | Strava activity id; local start date; always `strava` |
| `start_local` | Local start date-time where the activity happened |
| `name`, `sport_type`, `workout_type` | As in Strava; `workout_type` is `race`, `workout`, `long run` or blank |
| `trainer`, `commute`, `manual` | TRUE for indoor trainer, commute, or manually entered |
| `moving_min`, `elapsed_min`, `distance_km`, `elevation_m`, `avg_speed_kmh` | Duration and distance |
| `avg_watts`, `weighted_watts`, `max_watts` | Average, weighted (normalised-style) and max power |
| `power_meter` | TRUE if power was measured. When FALSE, Strava's power and kJ are estimates: leave them out of power trends |
| `kilojoules` | Work done. Roughly equal to kcal burned on the bike, and comparable across all years without an FTP |
| `avg_hr`, `max_hr`, `avg_cadence` | Heart rate and cadence; blank without a sensor |
| `relative_effort` | Strava's heart-rate-based load score |
| `efficiency_factor` | `weighted_watts / avg_hr`, measured power only. Rising on similar rides = fitter |
| `variability_index` | `weighted_watts / avg_watts`, measured power only. Near 1.0 = steady; 1.1+ = surgy (group rides, hills) |
| `gear_id`, `timezone` | Bike id; activity time zone |

**gym_sets** (written by `FitNotes_import.gs` from the newest FitNotes CSV export in Drive; never edit). One row per set, full history; every import replaces the tab.

| Column | Meaning |
|---|---|
| `day` | Session date |
| `lift` | Normalised name (`Deadlift` covers "Deadlift" and "Conventional Deadlift"; `Squat`, `Bench press`, `Chin-up` and so on). Group by this |
| `exercise`, `category` | As logged in FitNotes |
| `set_no` | Set number within that lift on that day |
| `weight_kg`, `reps` | Load (lbs converted) and reps. For body-weight lifts (`bodyweight` TRUE) the weight is added load only |
| `volume_kg` | weight x reps |
| `est_1rm_kg` | Estimated one-rep max (Epley), from sets of 1-12 reps; blank for body-weight lifts |
| `distance_km`, `time_min`, `comment` | Cardio entries and notes |

`strava_sync_log` holds one row per sync run, with a RATE LIMIT line if a backfill paused for Strava's 15-minute limit.

## 3. Keys and lags
- Join key is the local date: `Log` A, `Daily` A, `wearable_*` and Oura `day`, and Strava `start_local` are all in [TIMEZONE].
- Food on day D affects the sleep Oura labels D+1 and readiness on D+1. `Daily` U-W already apply this shift; L and M don't.
- Strava activities imported into Oura are inside `active_calories` and `total_calories`. Use `strava_activities` (or the Strava connector) for ride detail; cycling rows in `wearable_workouts` are unreliable. Don't add Strava kJ to Oura burn: it's already counted. Other Oura workouts are reliable if the user curates them.
- Targets for day D depend on D's own exercise calories, so on a morning-training day they rise as Oura syncs the session. The big-day top-up applies to the day before.
- Training windows = 2 hours either side of each Strava activity, and of each Oura workout of 20+ minutes other than walking.
- Evening window = the 3 hours before that night's Oura bedtime; before the night happens, the median bedtime of the previous 14 nights.

## 4. Glossary
- **Glycaemic load (GL):** carbs adjusted for how fast they raise blood glucose; GI x available carbs / 100. An estimate.
- **Active calories:** Oura's energy above resting, including workouts and everyday movement.
- **Total burn:** Oura's estimate of all energy used (resting plus active). About 10-15% uncertain either way.
- **Calorie target:** what to eat for the planned loss; it already contains the deficit.
- **Carb target:** a minimum to reach within the calorie target. Close a shortfall by swapping fat for carbs.
- **Big-day eve:** the day before the long session (`Daily` Z = Yes): carb target +B16 g, calorie target +B16 x 4.
- **Deficit vs target:** target - eaten (adherence). **Deficit vs burn:** total burn - eaten (actual balance). Weight change uses the second, at 7,700 kcal per kg.
- **Early-hours waking:** awake time in [WINDOW], ending 15 minutes before the planned alarm so it doesn't count.
- **Lowest HR % of night:** how far through the sleep heart rate bottomed out; later than usual suggests digestion or alcohol still working.
- **Efficiency factor (EF):** weighted power / average HR for one ride. Compare only like with like (steady endurance rides, or indoor trainer rides), never across ride types.
- **W/kg:** weighted power / the 7-day average weight (`Daily` K) around that ride.
- **Standard drink:** [GRAMS] g alcohol ([COUNTRY] definition).

## 5. Thresholds

| Measure | Bands |
|---|---|
| Carbs | Reach `Daily` AA without exceeding the calorie target. Rest days about 2 g/kg; endurance training days roughly 3.5-5 g/kg |
| Evening GL (3 h before bed) | Up to 15 low; 16-30 moderate; over 30 high |
| Single food GL | Under 10 low; 10-19 medium; 20+ high. Only flag in the evening window |
| Saturated fat | Under 10% of calories (`Targets` row 12) |
| Added sugar | Under 10% of calories, excluding ride fuel |
| Alcohol | [National low-risk guideline, e.g. Australia: no more than 10 a week and 4 on any day] |
| Oura scores | 85+ optimal; 70-84 fine; under 70 pay attention |
| Weekly pace | 0.3-1.0 kg/week loss is on plan |
| Power trend | Efficiency factor change under about 3% between months is noise; at least 8 comparable rides per period |

## 6. Rules for analysis
1. Use `Daily` for daily totals rather than re-summing `Log`, so figures match the sheet and dashboard.
2. Leave out today from averages and pace while it's in progress.
3. Weight-loss pace comes from total burn - eaten, never target - eaten.
4. The 7-day weigh-in average is the ground truth; single weigh-ins swing with glycogen, creatine and sodium. Expect a 0.5-1 kg bump after a big-day eve.
5. Logged nutrition is an estimate; favour patterns over single numbers.
6. Don't draw food-and-sleep conclusions from fewer than about 2-3 weeks, and say how many days a comparison rests on.
7. Before attributing a sleep or HRV change to food, check alcohol (`Daily` S), the previous day's training load, late meals (`Daily` N), bedtime (`Daily` U) and illness signs (temperature deviation).
8. API values arrive as display text: `-` = 0, `(370)` = -370, `1,234` has a separator, dates read like `Mon 12 Oct 2026`.
9. The evening-carbs effect on sleep is a hypothesis being tested, not an established fact for fit, insulin-sensitive people. Report the comparison honestly, including no difference.
10. Routine food logging is two sheet calls: append the items to `Log` in one call, then read today's `Daily` row. Rewrite the `Suggestions` tab (section 2) only when the user asks what to eat. Never suggest a food the user has said they dislike or can't eat.
11. For power and fitness trends use `strava_activities` rows with `power_meter` TRUE, grouped by type: outdoor (`sport_type` Ride, with `variability_index` under 1.10 as steady) and indoor (`sport_type` VirtualRide or `trainer` TRUE; apps like MyWhoosh and Zwift often leave `trainer` FALSE). Without a heart-rate strap, `efficiency_factor` is blank: compare weighted power and W/kg on repeat routes or repeated indoor workouts instead. Weather, heat and fatigue move a single ride; trends need 8+ rides per period.
12. For strength trends use the best `est_1rm_kg` per `lift` per session, and its 4-week rolling best; one heavy day isn't a trend. Strength holding while weight falls is the goal; volume (`volume_kg`) dips during a deficit are expected.
13. When the long session moves, set `Daily` Y = Yes the day before it, and No on the usual eve if that week's usual one isn't happening. Never type into `Daily` Z-AC.

## 7. Change log
- [DATE]: sheet created from template.
