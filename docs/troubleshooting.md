# Troubleshooting

Ranked by how often they come up.

## Oura connection

| Symptom | Cause and fix |
|---|---|
| Oura says **redirect_uri mismatch** | The redirect URI registered at cloud.ouraring.com doesn't match the script's exactly. Run **Oura > Show redirect URI** again and paste it with no spaces. Each copy of the sheet has its own script ID, so a URI from someone else's copy won't work |
| **"Google hasn't verified this app"** | Expected for any personal Apps Script. Choose **Advanced > Go to (project) (unsafe) > Allow**. The code is in `apps-script/Oura_sync.gs` if you want to read it first |
| **No Oura menu** | Reload the sheet and wait 5-10 seconds. If still missing, open Extensions > Apps Script and check `Oura_sync.gs` is there and saved |
| **401 / Not connected to Oura** | Run **Oura > 2. Connect Oura account** again. If it keeps happening, re-enter credentials with **Oura > 1** |
| **403** or a membership message | Oura's API needs an active Oura Membership on Gen3 and newer rings |
| **403 on one data type only** (e.g. resilience) | That scope wasn't ticked on Oura's consent screen. Run **Oura > 2** again and tick everything. Other data types keep syncing meanwhile |
| **Emails saying the sync failed** | Read the newest rows of `oura_sync_log`; the error text is there. One-off 429 or 5xx errors clear on the next hourly run |
| **Backfill seems stuck** | It runs in 4.5-minute chunks and schedules its own next chunk. Check `oura_sync_log` for new "backfill" rows every few minutes |

## Sheet

| Symptom | Cause and fix |
|---|---|
| `Daily` blank, but `oura_*` tabs are full and `wearable_*` tabs are empty | The sheet has an old copy of the script that doesn't write the standard tabs. Replace it with `apps-script/Oura_sync.gs` from the repo, then run **Oura > Sync last 7 days now** and **Oura > 3. Backfill history** |
| `Daily` sleep and readiness blank, but `wearable_*` tabs are full | Timezone mismatch. Set **File > Settings > Time zone** to yours, then **Oura > Sync last 7 days now** |
| A day's exercise calories are missing | Oura hadn't synced the ring yet. Open the Oura app to sync, then wait for the next hourly run |
| Dates in `Daily` show as numbers or `#VALUE!` | `Targets!B9` was entered as text. Re-enter the start date as a real date |
| Food logged but `Daily` doesn't change | `Log` column A was written as text, not a date-time. Ask Claude to rewrite that row's column A as a real date-time |
| Formulas show as text | They were written with `update_values`. Rewrite them with `update_formulas` |

## Dashboard

| Symptom | Cause and fix |
|---|---|
| A source "didn't load" | Open the dashboard's Sources panel. Usually the Google Sheets connector needs reconnecting, or the sheet ID in a data source is wrong |
| Strava section asks to connect | The Strava connector isn't on, or the account has no Strava subscription. The rest of the dashboard still works |
| No **Dashboard** type when Claude lists artifact types | Artifact types vary by account. Ask Claude for a simpler self-contained dashboard built from the same sheet ranges |
| Wrong day shown in the morning | The page's timezone line wasn't changed from `Australia/Brisbane`. Ask Claude to update it |

Still stuck? Open an issue with the **Setup help** template, and paste the error text (never your client secret or tokens).

## FitNotes: "Exception: Access denied: DriveApp"

The Google Workspace the account belongs to has turned off Drive access for scripts. Either a Workspace admin turns on **Allow users to access Google Drive with the Drive SDK API** (Admin console > Apps > Google Workspace > Drive and Docs > Features and Applications; changes can take a few minutes, up to 24 hours), or import the CSV into the sheet yourself: **File > Import > Upload > Insert new sheet(s)**, rename the tab `fitnotes_export`, then **FitNotes > Import latest export now**. Repeat the manual import for each new export.
