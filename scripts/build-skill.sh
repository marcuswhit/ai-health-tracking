#!/usr/bin/env bash
# Builds dist/ai-health-tracking-setup.zip for upload at claude.ai > Customize > Skills.
set -euo pipefail
cd "$(dirname "$0")/.."
out=dist/ai-health-tracking-setup
rm -rf dist && mkdir -p "$out/references" "$out/assets"
cp skill/SKILL.md "$out/"
cp docs/setup-guide.md docs/data-dictionary.md docs/sheet-formulas.md docs/troubleshooting.md "$out/references/"
cp dashboard/index.html dashboard/datasets.json apps-script/Oura_sync.gs apps-script/Strava_sync.gs apps-script/FitNotes_import.gs "$out/assets/"
(cd dist && zip -qr ai-health-tracking-setup.zip ai-health-tracking-setup)
echo "Built dist/ai-health-tracking-setup.zip"
