# Changelog

Notable changes are recorded here. The project has not yet published a signed
desktop release.

## Unreleased

- Rebrand the product to **Wigo Studio** (UI, Electron shell, package metadata,
  and docs). Project schema keys (`wiggleFps`, etc.) and the GitHub repo slug
  stay stable for compatibility.
- Add linear and radial color gradients for draw and raster layers, plus
  reversible linear/radial density fades for manga tones.
- Add deterministic manga FX brushes with denser radius-scaled action, focus,
  impact, speed-line, and progressive scatter behavior.
- Add nested and freely stackable comic sub-panels, custom cut-panel geometry,
  editor-only reference images, panel annotations, and expanded selection tools.
- Improve stylus recovery, brush previews and presets, installed-font handling,
  timeline timing controls, inspector layout, and infinite-board navigation.
- Reduce layer-heavy render cost with cropped layer caching, byte-budgeted
  cache eviction, tick-independent cache keys, clip snapshot gating, and
  pipelined export staging; add performance fixtures and regression checks.
- Refresh the TikTok feed visibility guide and export pipeline behavior.
- Prepare public contribution, security, CI, licensing, and release workflows.
- Move the supported development/runtime toolchain to Node.js 24 and Electron 43.
