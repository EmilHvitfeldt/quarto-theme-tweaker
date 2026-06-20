# Quarto Theme Tweaker

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/EmilHvitfeldt.quarto-theme-tweaker?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=EmilHvitfeldt.quarto-theme-tweaker)
[![Open VSX](https://img.shields.io/open-vsx/v/emilhvitfeldt/quarto-theme-tweaker?label=Open%20VSX)](https://open-vsx.org/extension/emilhvitfeldt/quarto-theme-tweaker)

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EmilHvitfeldt.quarto-theme-tweaker) (VS Code) or [Open VSX](https://open-vsx.org/extension/emilhvitfeldt/quarto-theme-tweaker) (Positron, VSCodium, and other editors).

A Positron/VS Code extension for live Sass theming of Quarto documents. Sliders and color pickers bound to Sass variables let you tweak a rendered Quarto document and see the changes instantly, then write the values back into `custom.scss`.

It generalizes the original `hotload_server.py` prototype (kept under `examples/revealjs/`) into a schema-driven, multi-variable, hybrid engine.

## Supported formats

The extension picks a control schema by detecting the output format from the document's YAML front matter:

- **reveal.js decks** (`format: revealjs`) use `presets/quarto-revealjs.json`.
- **HTML documents** use `presets/quarto-html.json` (Bootstrap variables). This is also the fallback for any format that isn't reveal.js.

Because HTML is the catch-all, other formats (`dashboard`, `beamer`/PDF, `docx`, etc.) currently fall through to the HTML/Bootstrap schema rather than having dedicated presets, so its controls may not all map meaningfully. Bundled examples live in `examples/revealjs/`, `examples/html/` (a standalone document), and `examples/website/` (a website project that also renders the navbar/sidebar/footer the navigation variables target).

## How it works

- **Fast path (instant):** variables that map to a runtime CSS custom property (e.g. `$presentation-h2-font-size` -> `--r-heading2-size`) are applied live by pushing a CSS-var patch over a WebSocket. No compile, no re-render.
- **Slow path (fast):** everything else is recompiled with bundled dart-sass (debounced) and the resulting stylesheet is hot-swapped into the preview. Still no Quarto re-render.
- **Commit:** writes the working set as `$var: value;` lines into `custom.scss` (with a diff preview before writing).
- **Full render:** an escape hatch that runs `quarto render` for canonical output.

The extension serves its own copy of the rendered HTML (with a bridge client injected) because Quarto's own preview cannot be injected into. See the design plan for the source audit behind this decision.

## Architecture

| File | Role |
|------|------|
| `src/extension.ts` | Activation, command, session lifecycle, message routing (fast/slow). |
| `src/host/previewServer.ts` | HTTP + WebSocket server; serves rendered files, injects the bridge, broadcasts updates. |
| `src/host/sassEngine.ts` | dart-sass compile + in-memory SCSS assembly (slow path). |
| `src/host/scssWriter.ts` | Read/upsert `$var: value;` lines in `custom.scss`. |
| `src/webview/panel.ts` | Control-panel webview UI, generated from the preset schema. |
| `src/webview/bridgeClient.ts` | Injected into the preview; applies `setCssVar` / `replaceStylesheet`. |
| `presets/quarto-revealjs.json` | Curated control schema for reveal.js decks. |
| `presets/quarto-html.json` | Curated control schema for HTML documents (Bootstrap vars). |
| `examples/revealjs/` | Sample reveal.js `.qmd` + `custom.scss` + `_brand.yml` for testing (plus the original `hotload_server.py` prototype). |
| `examples/html/` | Sample standalone HTML `.qmd` + `custom.scss` + `_brand.yml` exercising the HTML/Bootstrap schema. |
| `examples/website/` | Sample Quarto website project (`_quarto.yml` + pages) exercising the navbar/sidebar/footer variables. |

## Develop

```bash
npm install
npm run build        # production bundle
npm run watch        # rebuild on change
npm run typecheck    # tsc --noEmit
```

Then press **F5** in VS Code/Positron (the bundled `Run Extension` launch config opens `examples/revealjs/index.qmd` in an Extension Development Host) and run **Quarto: Open Theme Tweaker** from the command palette.

## Package

```bash
npm run package      # vsce package -> quarto-theme-tweaker-<version>.vsix
```

`.vscodeignore` keeps the `.vsix` to just `dist/`, `presets/`, `package.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.

## Publish

The extension is published to both the [VS Code Marketplace](https://marketplace.visualstudio.com/) and [Open VSX](https://open-vsx.org/) (used by Positron, VSCodium, and others).

### One-time setup

1. **VS Code Marketplace** — create the `EmilHvitfeldt` publisher at [marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage). Generate an Azure DevOps Personal Access Token (organization-wide, scope **Marketplace → Manage**), then log in:

   ```bash
   npx vsce login EmilHvitfeldt
   ```

2. **Open VSX** — sign in at [open-vsx.org](https://open-vsx.org/) with GitHub, sign the publisher agreement, create the `EmilHvitfeldt` namespace if it doesn't exist, and generate an access token under your profile settings.

### Releasing a new version

```bash
npm version patch                       # or minor / major; updates package.json + git tag
# update CHANGELOG.md with the new version's notes

npm run publish                         # VS Code Marketplace (uses vsce login)
npm run publish:ovsx -- -p <OPEN_VSX_TOKEN>   # Open VSX
```

`vscode:prepublish` runs the production build automatically, so both commands package the latest `dist/` before uploading.

## Settings

- `quartoThemeTweaker.preview` — `internal` (embedded webview, default) or `external` (open the live preview in your browser).
- `quartoThemeTweaker.debounceMs` — slow-path recompile debounce (default 150).
- `quartoThemeTweaker.previewPort` — preview server port (0 = auto).

## Status

Phases 0–4 are implemented:

- Scaffold, control panel, fast path, slow-path recompile, commit/reset/full-render.
- File watcher that reloads the working set when `custom.scss` is edited on disk.
- Format detection: reveal.js decks use the reveal schema, everything else the HTML/Bootstrap schema.
- Internal-webview vs external-browser preview.
- Slow-path compile uses Quarto's bundled SCSS as Sass `loadPaths`, so framework partials imported by `custom.scss` resolve.

Slow-path fidelity remains an explicit approximation (it compiles `custom.scss` + overrides, not the full Quarto pipeline); the canonical output comes from `quarto render` on commit / **Full render**.
