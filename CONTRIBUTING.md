# Contributing

- Branch off `main` and open a pull request; nothing is committed to `main` directly.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org)
  (`feat:`, `fix:`, `docs:`, `chore:` ...).
- Run `pnpm check` (typecheck, lint, tests, store builds) before pushing.
- Write plain words, and use `-` rather than a long dash.
- `src/shared/` is identical in `turbobulls-bridge`. A change there is made in both repositories.
- The extension must never gain a content script, page access or a permission beyond `storage`
  and the provider APIs. A change that needs one is a design discussion first.
- Never paste a real API key into code, tests, fixtures, issues or pull requests.
