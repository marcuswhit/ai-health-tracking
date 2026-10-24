---
name: ai-health-tracking-setup
description: Set up the ai-health-tracking system - a Google Sheet food log, Oura ring sync, optional Strava and FitNotes syncs, a Claude Project and a live Food & training dashboard. Use when the user says "set me up", asks to set up the food tracker, food log, Oura or Strava sync, FitNotes import or Food & training dashboard, or wants to repair or re-run part of that setup.
---

# ai-health-tracking setup

You are setting up a food, training and recovery tracker for the user. Follow `references/setup-guide.md` from top to bottom. It has six phases: interview, sheet, Oura sync (plus optional Strava and FitNotes, Phases 3b and 3c), project doc and instructions, dashboard, first log.

## Files in this skill

| Path in this skill | Called in the guide | Use |
|---|---|---|
| `references/setup-guide.md` | (this guide) | The step-by-step setup |
| `references/data-dictionary.md` | `docs/data-dictionary.md` | Fill in and save as the project doc "Food log - data dictionary" |
| `references/sheet-formulas.md` | `docs/sheet-formulas.md` | Repairing formulas, or building the sheet without the template |
| `references/troubleshooting.md` | `docs/troubleshooting.md` | When a step fails |
| `assets/index.html` | `dashboard/index.html` | The dashboard page |
| `assets/datasets.json` | `dashboard/datasets.json` | The dashboard's data sources |
| `assets/Oura_sync.gs` | `apps-script/Oura_sync.gs` | The Oura sync script, if the user's sheet doesn't already have it or has an older version |
| `assets/Strava_sync.gs` | `apps-script/Strava_sync.gs` | Optional Strava sync (Phase 3b) |
| `assets/FitNotes_import.gs` | `apps-script/FitNotes_import.gs` | Optional FitNotes import (Phase 3c) |

## Before you start

- The user needs: a Google account with the Google Drive / Sheets connector on in Claude, an Oura ring with an active Oura Membership, and optionally Strava (the sync uses the free API; the Strava connector needs a subscription) and FitNotes.
- The user needs their own copy of the template sheet. The template link is in the repo README: https://github.com/marcuswhit/ai-health-tracking
- If they only want one part (for example "repair my Oura sync" or "rebuild my dashboard"), go straight to that phase and read the data dictionary doc first if their project has one.

Keep replies short, ask before writing targets, and never type over formula cells.
