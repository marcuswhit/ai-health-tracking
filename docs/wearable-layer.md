# The wearable layer

The sheet and the dashboard never read a device's own data directly. They read three **standard tabs** that have the same columns whatever the wearable:

- `wearable_daily`
- `wearable_sleep`
- `wearable_workouts`

Each device adapter writes those three tabs. It may also write raw tabs of its own (`oura_*` today) for deeper analysis. Adding a device means writing an adapter; the `Daily` formulas, the dashboard and the setup guide stay as they are.

Today there is one adapter, `apps-script/Oura_sync.gs`. See [CONTRIBUTING.md](../CONTRIBUTING.md) to add another.

## The contract

Rules for all three tabs:
- Row 1 holds the headers below. Column A is a unique `id` and column B is `day`. The other columns follow in the order listed.
- `day` is a real date value in the sheet's timezone. Use the date you woke up for sleep, and the start date for workouts.
- Date-times are real date-time values.
- `source` names the device (`oura`, `whoop`, `googlehealth`, `apple`).
- A value the device doesn't provide is left blank. The dashboard then shows a dash or "not available".
- Each sync replaces the rows in the date window it fetched. It never blanks a tab because one call failed; it skips that tab and logs a warning.

### `wearable_daily` (one row per day)

| Column | Meaning | Used by |
|---|---|---|
| `id`, `day`, `source` | Keys | All |
| `active_calories` | Energy above resting for the day, kcal, including workouts | **Required.** Calorie and carb targets |
| `total_calories` | All energy used in the day (resting + active), kcal | **Required.** Weight-loss pace |
| `steps` | Steps | Analysis |
| `activity_score` | Device's daily activity score, 0-100 | Dashboard |
| `sleep_score` | Device's sleep score for the night before, 0-100 | Daily, dashboard |
| `readiness_score` | Readiness or recovery score, 0-100 | Daily, dashboard |
| `temperature_deviation` | Skin temperature vs baseline, °C | Illness check |

### `wearable_sleep` (one row per sleep period)

| Column | Meaning | Used by |
|---|---|---|
| `id`, `day`, `source` | Keys (`day` = the date you woke) | All |
| `type` | `main` for the main overnight sleep, `nap` for anything else | **Required.** Daily, dashboard |
| `bedtime_start`, `bedtime_end` | Date-times | **Required.** Bedtime, evening window |
| `total_sleep_min`, `deep_sleep_min`, `rem_sleep_min`, `light_sleep_min`, `awake_min` | Minutes | Analysis |
| `efficiency` | % of time in bed asleep | Analysis |
| `average_hrv`, `average_heart_rate`, `lowest_heart_rate` | ms, bpm | Dashboard |
| `lowest_hr_pct_of_night` | When HR bottomed out, as a fraction of the night (0-1) | Dashboard |
| `hrv_first_half_avg`, `hrv_second_half_avg` | Mean HRV in each half of the night, ms | Dashboard |
| `pre_bed_hr_avg` | Mean daytime HR in the 3 hours before bed, bpm | Analysis |
| `early_wake_min`, `early_wake_count` | Minutes awake and separate wakes (5+ min) in the early-hours window, ending 15 minutes before the final wake | Daily, dashboard |

`early_wake_*` and the half-night HRV columns are derived from 5-minute stages and HRV samples. `addEarlyWake_` and `enrichSleep_` in the Oura script are the reference implementations. An adapter without stage data leaves them blank.

### `wearable_workouts` (one row per workout)

| Column | Meaning |
|---|---|
| `id`, `day`, `source` | Keys |
| `activity` | Lower-case activity name (`surfing`, `strength_training`, `cycling`) |
| `start_datetime`, `end_datetime` | Date-times |
| `calories` | kcal |
| `intensity` | Device's own label, if any |
| `recorded_by` | How it was recorded (`manual`, `autodetected`, `confirmed`, imported) |
| `duplicate_of` | id of an overlapping workout this one duplicates, else blank |

The dashboard ignores `cycling` rows because ride detail comes from Strava.

## Candidate adapters

| Device | Route | Status | What maps well, and the gaps |
|---|---|---|---|
| Oura | Official API v2, OAuth from Apps Script | **Working** | Everything. Needs an Oura Membership |
| WHOOP | Official developer API, OAuth from Apps Script | Planned, good fit | Recovery → `readiness_score`, sleep performance → `sleep_score`, cycle energy → calories (kJ ÷ 4.184), workouts. No stage-by-stage data, so no `early_wake_*`. Developer apps allow up to 10 members, which is fine for a personal app |
| Fitbit and Pixel Watch | [Google Health API](https://developers.google.com/health/about), OAuth from Apps Script | Planned, to be proven | Sleep stages, HRV, total and active calories, workouts. Its scopes are restricted (Google security review for public apps); a personal copy on your own account should work, but that's untested. The old Fitbit Web API switches off on 30 Oct 2026 |
| Apple Watch | iPhone app [Health Auto Export](https://apps.apple.com/gb/app/health-export-health-data-csv-export-tool/id1115567069) posting JSON to an Apps Script web app on a schedule | Planned, workable | Active and resting energy, sleep stages, HRV, workouts. Apple Health has no cloud API, so the phone has to push. No sleep or readiness score |

**Not supported:**
- **Garmin.** Its official Health API is for approved businesses only, and new applications are paused. Unofficial Garmin Connect libraries break often and sit outside Garmin's terms. Garmin users can still auto-upload activities to Strava, which covers ride detail and training windows, but not calories burned or sleep.
- **Samsung and other Android watches.** Their data sits in Android Health Connect, which is on-device only and has no cloud API for a sheet to call.
