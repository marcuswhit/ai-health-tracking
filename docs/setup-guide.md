# ai-health-tracking: setup guide for Claude

This guide sets up a food log, wearable sync, optional Strava and FitNotes syncs and a live "Food & training" dashboard, all run through Claude. It is written for **Claude to follow** step by step with the person it is helping ("the user" below). The human-facing overview is the repo [README](../README.md).

Files this guide uses (all in this repo, and bundled in the setup skill):

| File | What it is |
|---|---|
| `docs/data-dictionary.md` | Template for the project doc that tells Claude how to read and write the sheet |
| `dashboard/index.html` | The dashboard page |
| `dashboard/datasets.json` | The dashboard's data sources |
| `apps-script/Oura_sync.gs` | The Oura sync script (already inside the template sheet) |
| `apps-script/Strava_sync.gs` | Optional Strava sync (Phase 3b) |
| `apps-script/FitNotes_import.gs` | Optional FitNotes import (Phase 3c) |

---

## Ground rules for Claude

- Set up a task list with the six phases so the user can see progress. Keep messages short; give one or two click-steps at a time when the user has to act.
- Ask the Phase 1 questions before changing anything. Show the computed targets and get a yes before writing them.
- Never type over formula cells. In `Daily`, only columns K (weight), O (notes) and Y (big-day override) are inputs. `Weekly`, the `wearable_*` tabs, all `oura_*` tabs, `strava_activities` and `gym_sets` are never edited by hand.
- Write formulas with the Sheets `update_formulas` tool, not `update_values` (which stores them as text).
- Values read through the Sheets API arrive as display text: `-` means 0, `(370)` means -370, `1,234` has a thousands separator.
- After each phase, read the sheet back and check the result before moving on.
- Nutrition figures are estimates. This is not medical or dietetic advice: if the user mentions a condition, medication, pregnancy, an eating disorder history or an injury, record it as a constraint, keep targets conservative and suggest they check anything that depends on it with their clinician.
- Use hyphens, not em dashes, in what you write for the user. The long-dash placeholders inside the dashboard page are code and stay as they are.

---

## Phase 1 - Interview

Ask in 3-4 short batches, not one long form. Use multiple-choice where it helps. Items marked **required** must be answered.

**About them**
1. **Required:** first name, sex, age, height, current weight, and units they prefer (kg or lb).
2. **Required:** goal weight and pace (0.25-1% of body weight per week is the sensible range; default about 0.5 kg / 1 lb a week).
3. **Required:** country and city or timezone. This sets the sheet timezone, the standard-drink definition and the alcohol guideline.
4. Any injury, condition or medication that affects training or food (constraint only).
5. Dietary pattern or exclusions (vegetarian, no dairy, allergies, religious rules).
6. Daily supplements (protein powder, creatine and so on).
7. Typical alcohol per week.
8. Habits they want help with (sugar, evening snacking, low protein, skipped meals).

**Training**
9. **Required:** main sports and a typical week (days, durations, intensity).
10. **Required:** a usual **big session day** (long ride, long run, match day)? Which weekday? None switches the big-day carb top-up off.
11. Do they wake early on purpose for training, and at what time? This sets the early-hours waking window.
12. Do they eat before early sessions and fuel during long ones?
13. Strava: do they use it, and do they ride with a power meter or heart-rate strap? The Strava sync (Phase 3b) is free and stores every activity for power trends; the Strava connector in Claude needs a Strava subscription and only adds live detail. Do Strava activities import into Oura? Importing is recommended so Oura's calorie burn includes them.
13b. Gym: do they log sessions in FitNotes (Phase 3c)? Which lifts matter most to them?

**Setup**
14. **Required:** the link to their copy of the template sheet (the ID is between `/d/` and `/edit`).
15. **Required:** start date (default next Monday, or today).
16. How much history to pull from Oura (default 90 days before the start date).
17. Foods they like, dislike or won't eat, and a few meals they eat often (this seeds suggestions until their log has history).
18. How they like replies (brief, ranked lists, metric or imperial).

### Standard drink by country (for Log column L)

| Country | 1 standard drink | Low-risk guideline to quote |
|---|---|---|
| Australia | 10 g alcohol | No more than 10 a week and 4 on any day |
| New Zealand | 10 g | No more than 10 a week (women), 15 (men); no more than 4 / 5 on any day |
| UK | 8 g (1 unit) | No more than 14 units a week, spread over 3+ days |
| USA | 14 g | No more than 1 a day (women), 2 (men) |
| Canada | 13.45 g | 2 or fewer a week is low risk (2023 guidance) |

Guidelines change, so check the current national advice before quoting it. Other countries: use the national definition if there is one, otherwise 10 g, and say which you used. Record it in the data dictionary.

### Starting targets (show the working, then confirm)

| Targets row | Method |
|---|---|
| B2 Rest-day calories | Mifflin-St Jeor BMR x 1.3 (desk job) to 1.4 (active job), minus the deficit for the pace (0.5 kg/week = about 550 kcal/day). Round to 50. With 2+ weeks of Oura history, use the average Oura `total_calories` on non-training days instead. Don't go below about 1,500 (women) or 1,800 (men) without saying why |
| B3 Eat-back share | 70% |
| B4 Protein | 1.8 g per kg (1.6 if they don't lift; 2.0 if lean and lifting hard), rounded to 5 |
| B5 Fibre | 25-30 g women, 30-38 g men |
| B6 Minimum fat | 0.6 g per kg, rounded to 5 |
| B7, B8 Start and goal weight | As given, in kg (convert from lb) |
| B9 Start date | As agreed; must land as a real date |
| B10-B12 Max fat, added sugar, saturated fat | 30%, 10%, 10% of calories |
| B13 Evening glycaemic load limit | 30 |
| B14 Rest-day carbs | About 2 g per kg, rounded to 10. Check B4 x 4 + B6 x 9 + B14 x 4 does not exceed B2; lower B14 if it does |
| B15 Extra carbs per 100 exercise calories | 15 for endurance; 10 if mostly gym |
| B16 Big-day eve top-up | 150 if they do a 2+ hour session most weeks, else 0 |
| B17 Usual big day | Mon, Tue, Wed, Thu, Fri, Sat or Sun |
| B18 Weekly alcohol guideline | The weekly low-risk limit from the standard-drink table, in that country's drinks (Australia 10, UK 14 units). Where the guideline differs by sex, use theirs |

Explain in one line each: the calorie target already contains the deficit; it rises on active days with Oura's active calories; the carb target is a **minimum to reach within** the calorie target, reached by swapping fat for carbs rather than adding calories.

---

## Phase 2 - Sheet

1. Read the tabs. Expect `Log`, `Daily`, `Weekly`, `Suggestions`, `Targets`, 3 `wearable_*` tabs and 14 `oura_*` tabs. If not, they copied the wrong file: stop and say so.
2. **Timezone:** set the spreadsheet timezone to the user's IANA zone with `update_spreadsheet` (`updateSpreadsheetProperties`, `fields: "timeZone"`), then ask them to confirm it under **File > Settings**. Every date join depends on this.
3. **Targets:** write the confirmed values to `Targets!B2:B18`. Read `Daily!A2:A3` back: two consecutive dates such as `Mon 2 Nov 2026` and `Tue 3 Nov 2026`. Replace each "SET DURING SETUP" note in column C with where the value came from and today's date.
4. **Suggestions:** leave the `Suggestions` tab empty apart from its header. Claude rewrites it with 3 options for what to eat next whenever the user asks (the rule is in the project instructions below). It isn't rewritten on every log, which keeps logging to two sheet calls. The dashboard's "What fits now" shows them beside picks it ranks from the user's own log.
5. **Check** `Daily` runs a year from the start date (copy the last row down later to extend) and `Weekly` starts on the start date.
6. Keep the meal value `Ride fuel` even for non-cyclists: it means anything eaten during a session, and formulas depend on that exact text.

---

## Phase 3 - Oura sync (the user clicks; Claude guides)

The script `Oura_sync.gs` is already in the template and adds an **Oura** menu to the sheet. Credentials and tokens are kept in the user's own Apps Script user properties, which nobody they share the sheet with can see.

1. **Check the script.** In the sheet: **Extensions > Apps Script**. `Oura_sync.gs` should be listed, and its header comment should mention `wearable_daily`. If it's missing or older, replace its contents with `apps-script/Oura_sync.gs` from the repo (or create a file named `Oura_sync` and paste it in), and save.
2. **Settings.** In the `CONFIG` block near the top:
   - `BACKFILL_START`: the history date agreed in Phase 1 (`YYYY-MM-DD`).
   - `EARLY_WAKE_TO`: 15 minutes before their usual alarm (`'04:15'` for a 4:30 alarm). Without an early alarm, use `'05:45'`. Keep `EARLY_WAKE_FROM` at `'01:30'` unless they ask.
   Save (Ctrl/Cmd + S), close the tab, reload the sheet. The **Oura** menu appears after a few seconds.
3. **Oura > Show redirect URI.** Google asks for authorisation the first time: choose their account, **Advanced > Go to (project) (unsafe) > Allow**. Google shows this for any personal script it hasn't reviewed; the code is theirs to read. Copy the address shown (it ends in `/usercallback`).
4. **Register a personal Oura API application** at **cloud.ouraring.com** (the OAuth applications page linked from the API docs at api.ouraring.com/docs):
   - Name: "My food tracker"; description: "Personal sync to my own Google Sheet".
   - Contact email: theirs. Website, privacy policy and terms URLs: their sheet URL is fine for personal use.
   - **Redirect URI:** the address from step 3, exactly.
   - Save, and copy the **Client ID** and **Client Secret**.
5. **Oura > 1. Set Oura app credentials:** paste the ID, then the secret.
6. **Oura > 2. Connect Oura account:** click "Authorise Oura", sign in, **tick every data type**, approve. The tab says "Oura connected".
7. **Oura > 3. Backfill history:** runs in the background in chunks and resumes itself. Progress is in `oura_sync_log`.
8. **Oura > 4. Install sync schedule:** hourly re-pull of the last 2 days, plus a 7-day re-pull around 10:00 and 21:30.

**Check:** `oura_sync_log` has no ERROR lines, the three `wearable_*` tabs have rows, and `Daily` columns B (exercise calories), L (sleep), M (readiness) and X (total burn) fill for dates with Oura data. Today's figures rise through the day.

If something fails, use [troubleshooting.md](troubleshooting.md).

### Phase 3b - Strava sync (optional)

For riders and runners who want power, heart-rate and load trends against food and sleep. It uses Strava's free API, so no Strava subscription is needed (only the Strava *connector* needs one). Skip it if they don't use Strava or only want calories, which Oura already has.

1. **Add the script.** In **Extensions > Apps Script**, click **+ > Script**, name it `Strava_sync`, paste in `apps-script/Strava_sync.gs` from the repo and save. Check `Oura_sync.gs` has the line `if (typeof addStravaMenu_ === 'function') addStravaMenu_();` at the end of `onOpen` (current versions do); without Oura, add a file with `function onOpen() { addStravaMenu_(); }`.
2. **Settings.** In `STRAVA_CONFIG`, set `BACKFILL_START` to how far back they want history (`'2011-01-01'` takes everything; one call per year with no rides). Save and reload the sheet. A **Strava** menu appears.
3. **Register a personal Strava API application** at **strava.com/settings/api**: name "My food tracker", category "Data Importer", website: their sheet URL, **Authorization Callback Domain: `script.google.com`**. Strava asks for an icon: any image will do. Copy the **Client ID** and **Client Secret**.
4. **Strava > 1. Set Strava app credentials:** paste the ID, then the secret. Google may ask to authorise the new permissions: allow as before.
5. **Strava > 2. Connect Strava account:** click "Authorise Strava" and approve, leaving private activities ticked.
6. **Strava > 3. Backfill history:** a year at a time in the background. If it hits Strava's 15-minute rate limit, it waits and resumes on its own. Progress is in `strava_sync_log`.
7. **Strava > 4. Install sync schedule:** hourly re-pull of the last 3 days, plus a 30-day re-pull around 21:45.

**Check:** `strava_activities` has rows back to the backfill start, rides with a power meter show `power_meter` TRUE and an `efficiency_factor`, and `strava_sync_log` has no ERROR lines.

### Phase 3c - FitNotes import (optional)

For people who log gym sessions in the FitNotes app (Android). Skip it otherwise.

1. **Export from FitNotes:** Settings > Export, choose the spreadsheet (CSV) export and save it to Google Drive. The file name starts with `FitNotes`. (FitNotes' own Drive backup is a database file the sheet can't read.)
2. **Add the script:** in **Extensions > Apps Script**, **+ > Script**, name it `FitNotes_import`, paste in `apps-script/FitNotes_import.gs`, save and reload the sheet. Google asks for Drive access so the script can find the export.
   If the import says Drive access is turned off ("Access denied: DriveApp"), their Google Workspace blocks scripts from Drive. Either a Workspace admin turns on **Allow users to access Google Drive with the Drive SDK API** (Admin console > Apps > Google Workspace > Drive and Docs > Features and Applications), or they import the CSV by hand: **File > Import > Upload > Insert new sheet(s)**, rename the new tab `fitnotes_export`, and repeat that for each new export. The script reads that tab whenever it exists; the daily check then has nothing to do.
3. **FitNotes > Import latest export now:** the alert shows how many sets and sessions came in. Check `gym_sets` and adjust `LIFTS` in the script's settings if an exercise was logged under several names.
4. **FitNotes > Install daily check:** a new export in Drive is then imported automatically. Re-export every few weeks.

---

## Phase 4 - Project doc and instructions

1. **Data dictionary.** Fill in `docs/data-dictionary.md` (sheet ID, timezone, start date, standard-drink definition, big day, early-hours window, live Targets values) and save it as a project doc named **"Food log - data dictionary"**. Add a change-log line with today's date.
2. **Project instructions.** Fill in the template below and ask the user to paste it into the project's **Instructions** (Project settings). Claude can't set these itself.

```
About me: [height], [sex], [age]. Current weight is in the Food log (Daily tab, column K). [Typical training week]. [Other activities]. [Habits to work on]. [Supplements]. [Constraints, if any].

Goal: [lose X kg (start to goal)] while [keeping performance / strength / other].

My data:
- Google Sheet "Food log" (ID [SHEET_ID]) is the single source of truth for food, Oura and targets. [Every Strava activity is in the strava_activities tab, synced hourly; use the Strava connector only for detail that isn't there.] [Gym sets are in gym_sets, imported from my FitNotes CSV export.] Dashboard: [DASHBOARD_URL]
- Before analysing the data or changing the sheet, read the project doc "Food log - data dictionary" for the schema, glossary, date lags and thresholds. Routine food logging doesn't need it.

Logging food (fast path: two sheet calls, no doc reads):
- Don't read the data dictionary for routine logging; these rules are enough.
- Append all items in one call to the Log tab, one row per item, columns A to M: A real date-time (e.g. Fri 16 Oct 2026, 2:30 pm); B Breakfast, Lunch, Dinner, Snack, Drink or Ride fuel; C description with brand and portion; D kcal; E protein g; F carbs g; G fat g; H fibre g; I added sugar g; J assumptions; K saturated fat g; L standard drinks ([country] definition, [g] g alcohol; blank if none); M glycaemic load (GI x available carbs / 100; 0 if no carbs).
- Ride fuel = anything eaten or drunk during a training session. It counts toward carbs and calories but not added sugar.
- Never type over formula tabs (Weekly, Daily except K, O and Y) or the wearable_*, oura_*, strava_activities and gym_sets tabs. Daily Z-AC are formulas.
- Then read today's Daily row in one call: row = 2 + days since [START_DATE], range A:AC. Give me the day so far in two lines: calories eaten vs target (D vs C), protein left (G), carbs vs carb target (H vs AA). On a big-day eve (Z = Yes), say so and nudge me toward the higher target. If items fall within 3 hours of bed, flag evening glycaemic load over the limit in Targets.
- Treat the carb target as a minimum to reach within the calorie target. Suggest getting there by swapping fat for carbs, not by adding calories.
- If I say my big session is on a different day, set Daily Y to Yes on the day before it, and No on the usual eve if that week's usual one isn't happening.
- Only when I ask what to eat, rewrite the Suggestions tab (rows 2 onward; clear the old rows first) with 3 options for the next meal or snack: what fits the calories left and closes the biggest gap (protein first, then the carb target, then fibre), within 3 hours of bed only low glycaemic load. At least one from my log history that was nutritious, and at least one new idea I haven't logged. Fill all 11 columns: A written at (real date-time), B for (Breakfast, Lunch, Dinner or Snack), C food with portion, D source (Your log or New idea), E-J kcal, protein, carbs, fat, fibre, glycaemic load, K why it fits in one short line. [Likes and dislikes: ...]

Interpreting:
- Weight-loss pace = Oura total burn minus calories eaten (Daily X minus D), never target minus eaten. The target already includes the deficit.
- Food on day D affects the sleep and readiness Oura labels D+1.
- Only flag glycaemic load in the 3 hours before bed (evening limit in Targets); daytime and post-training carbs are fine.
- Leave out today from averages while it's in progress. Treat logged nutrition as estimates, check confounders (alcohol, training load, bedtime) before linking food to sleep, and say how many days a conclusion rests on.
[- For power trends use strava_activities rides with a power meter, comparing like with like (outdoor vs virtual, repeat routes and workouts).]
[- For strength use the best estimated one-rep max per lift per session and its 4-week rolling best; body-weight lifts by reps.]

Maintenance: if you change the sheet's structure, update the data dictionary doc (including its change log) in the same chat.

Style: [their preferences].
```

---

## Phase 5 - Dashboard

The dashboard is a Claude **Dashboard** artifact. It reads the sheet (and Strava, if connected) live on each open and stores no numbers itself.

1. Get `dashboard/index.html` and `dashboard/datasets.json` (from the skill bundle, the project files, or ask the user to attach them).
2. **Adapt the page.** Replace `timeZone: 'Australia/Brisbane'` (one place, the `nowBne` line) and the comment above it with the user's IANA timezone. If `EARLY_WAKE_TO` isn't `04:15`, change every `1:30-4:15` label to match. Change nothing else.
3. **Adapt the data sources.** Replace every `YOUR_SHEET_ID` in `datasets.json` with their sheet ID. Set `dash/params.since` to 60 days before today as `YYYY-MM-DDT00:00:00`.
4. **Create it.** Call the Artifact tool's list action with `scope: "types"`. If a **Dashboard** type is listed, create one artifact from it titled **"Food & training"** (with `auto_open: "after_first_write"` if offered) and follow the instructions the type returns.
5. **Write it in one batch** with `ArtifactData` (`action: "batch"`, the new dashboard's `url`): `dash/meta`, `dash/params`, the entries under `datasets` as `datasets/<key>` (daily, log, rides, sleep, suggestions, targets, workouts, plus power if they set up the Strava sync and gym if they set up the FitNotes import), and `files/index.html` as `{"text": <the adapted page>}`. Leaving out power or gym is fine: those cards then say which setup step fills them. The page is about 190 KB, inside the 256 KB limit; for large documents write a local JSON file and pass `file_path`.
6. Run the type's own check (`data/users/me`, doc `check`) and fix only what it reports. Then run each dataset's call once (Sheets `get_values` per range; Strava `list_activities`) to confirm data comes back.
7. Give the user the link in one line, offer to pin it, and put the link in the project instructions.

**No Dashboard type listed?** The page depends on that type's runtime, so it can't be published as a plain page. Tell the user, and offer a simpler self-contained dashboard built from the same sheet ranges instead.

**No Strava?** Leave the `rides` source in place. That part shows a connect prompt, and training windows fall back to Oura workouts. Say so once.

Most cards fill after a few days of logging. Weight pace needs a week of weigh-ins; the evening-carbs and sleep comparison needs 2-3 weeks.

---

## Phase 6 - First log and hand-over

1. Ask what they've eaten today (text or photo). Log each item as its own `Log` row with all 13 columns. Read today's `Daily` row back and report calories vs target, protein left, and carbs vs carb target. Then write the first 3 suggestions to the `Suggestions` tab, using the likes and dislikes from Phase 1 while the log is still short. After this, suggestions are rewritten only when they ask what to eat.
2. Ask them to weigh in each morning and type it in `Daily` column K or tell you.
3. Hand over a short "how to use it" list:
   - *"Log: 2 eggs on toast and a flat white"*, or a photo.
   - *"Weight 82.4"*.
   - Start a new chat each day for logging: a long chat gets slower every turn. A faster model with extended thinking off is plenty for logging.
   - *"My long ride is Sunday this week."*
   - *"How's my week going?"*, *"What should I eat for dinner?"*, *"Did evening carbs affect my sleep?"* (after 2-3 weeks).
   - After 2-3 weeks of weigh-ins: if the 7-day average isn't moving at about the planned pace, adjust `Targets!B2` by 100-150 kcal.
