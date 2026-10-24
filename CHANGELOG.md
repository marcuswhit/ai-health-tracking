# Changelog

## 0.1.0 - 2026-10-24

First public version.

- Google Sheet template: Log, Daily (one year), Weekly, Suggestions, Targets, standard wearable_* tabs and raw oura_* tabs.
- Wearable layer: Daily and the dashboard read only the standard wearable_daily, wearable_sleep and wearable_workouts tabs, so other devices need only an adapter.
- Oura sync (Apps Script): OAuth, hourly 2-day and twice-daily 7-day re-pulls, backfill, workout duplicate flagging, and derived sleep measures (lowest HR timing, HRV by half of the night, pre-bed HR, early-hours waking).
- Strava sync (optional, Apps Script): every Strava activity in a `strava_activities` tab with power, heart rate, kJ, efficiency factor and variability index. Backfills years of history around Strava's rate limits, then re-pulls hourly (3 days) and nightly (30 days). Uses the free Strava API, so no subscription is needed.
- FitNotes import (optional, Apps Script): the newest FitNotes CSV export in Drive becomes a `gym_sets` tab, one row per set, with lift names normalised and an estimated one-rep max. A daily check picks up new exports; a manual-import tab works where a Google Workspace blocks Drive access.
- Food & training dashboard for Claude's Dashboard artifact type.
  - Today: metric tiles, your day against your usual and target, carbs by glycaemic load, what you ate, what fits now (ranked from your own log plus 3 suggestions Claude writes to the Suggestions tab after every log) and the last 7 days.
  - Insights: colour-tagged top takeaways ranked by impact, patterns across sleep, training and food, whether it's working and your goal date, holding power and strength (with the Strava sync and FitNotes import), where the surplus comes from, what moves your sleep score, deficit vs recovery, and a colour-coded week by week. Bedtimes are compared as earlier or later than usual rather than shown as clock times.
- Targets row 18: weekly alcohol guideline.
- Setup guide, data dictionary template, formula reference, troubleshooting, and a Claude skill that runs the setup.
- Licence: PolyForm Noncommercial 1.0.0.
