# Project instructions

- Maintain the directly installable userscript in `src/script.user.js`; no build step is required.
- Preserve the `local.netflix-blurred-bars` namespace for existing installations.
- Add failing regression tests before behavior changes. Tests belong in `test/` and use Node's built-in runner and simulated browser objects.
- Run `npm test`, `npm run check`, and `git diff --check` for source changes. Prose-only changes require factual and link review.
- Keep README settings, shortcuts, version descriptions, and browser limitations consistent with the source.
- Local changes do not authorize installation, browser configuration changes, or GitHub publishing. Report simulated checks separately from live browser checks.
