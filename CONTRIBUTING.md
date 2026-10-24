# Contributing

Thanks for helping. The most useful contributions, ranked:

1. **Setup fixes.** If a step in [docs/setup-guide.md](docs/setup-guide.md) was unclear or wrong for you, open an issue or a pull request with the fix.
2. **Wearable adapters** (WHOOP, Apple Health and others). Read [docs/wearable-layer.md](docs/wearable-layer.md) first: an adapter only has to write the few columns listed there, and the sheet and dashboard work unchanged. Use official, user-authorised APIs only.
3. **Sports other than cycling.** Better default targets and wording for runners, team sports and gym-first training.
4. **Dashboard improvements**, especially new Insights rules. Keep `dashboard/index.html` working as a Claude Dashboard artifact page: every number must come from a data source in `dashboard/datasets.json`.

## Ground rules

- Never commit personal data: no real sheet IDs, food logs, Oura exports, tokens or secrets.
- If you change the sheet's structure, update `docs/data-dictionary.md`, `docs/sheet-formulas.md` and the template sheet together, and add a line to [CHANGELOG.md](CHANGELOG.md).
- Script changes: run `node apps-script/test/test_harness.js` and add a test for the new behaviour.
- Dashboard changes: run `npm i jsdom d3@7` once, then `node dashboard/test/render_test.js dashboard/index.html`. It renders both tabs with sample data and lists any errors.
- Writing style: plain English, short sentences, hyphens rather than em dashes.

## Licence for contributions

By opening a pull request you agree that your contribution is licensed under the repo's [PolyForm Noncommercial 1.0.0](LICENSE) licence, and that the maintainer may also distribute it under other terms, including commercial ones.

## Releasing the skill

Run `scripts/build-skill.sh` and attach `dist/ai-health-tracking-setup.zip` to a GitHub release.
