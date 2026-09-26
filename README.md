# TCG Alert dashboards — static deploy

This folder is a fully static site: plain HTML/CSS/JS, no build step, no
server-side code, and no dependency on any Claude-artifact-only runtime.

## Files

- `index.html` — Spellwatch (MTG price/alert dashboard)
- `lorcana.html` — Inkwatch (Disney Lorcana price/alert dashboard)
- `runtime.js` — shared template engine used by both pages (see the big
  comment block at the top of the file for how it works)
- `img/` — local product images referenced by `index.html`
- `screenshot-spellwatch.png`, `screenshot-lorcana.png` — hero-section
  screenshots taken during verification, for the human reviewer's benefit
  only. **Safe (and recommended) to delete these two files before actually
  deploying** — they aren't referenced by either page.

## Hosting

No build step of any kind. Push this folder's contents to a GitHub repo and
point GitHub Pages (or Cloudflare Pages) at it with the repo root (or this
folder) as the site root — `index.html` is the home page and it links to
`lorcana.html`, which links back.

If you deploy from a subfolder of a larger repo (e.g. this `deploy/` folder
inside a bigger project), just make sure `index.html`, `lorcana.html`,
`runtime.js`, and `img/` stay together in the same directory — every
reference between them is a plain relative path.

## What changed vs. the original `.dc.html` files

The two dashboards were originally built for Claude's artifact-only runtime
(`<x-dc>`, `{{ }}` interpolation, `<sc-if>`/`<sc-for>` directives, a custom
`<image-slot>` element, and `support.js`/`image-slot.js`, none of which exist
outside Claude). `runtime.js` reimplements just enough of that (a `DCLogic`
base class, live DOM compiling/patching for `{{ }}`, `sc-if`, `sc-for`,
`style-hover`, and `image-slot`) using only standard browser APIs, so the
exact same markup and the exact same component script (state, computed
values, event handlers, the 1-second countdown clock, etc.) now run anywhere.

No prices, dates, URLs, or copy were changed — every data array
(`ALL_DEALS`, `EVENTS`, `LOCAL`, `CONS`, etc.) and the whole `class Component
extends DCLogic { ... }` script is carried over byte-for-byte from the
source files. The only content edits are the cross-links between the two
pages (`./Lorcana Dashboard.dc.html` → `lorcana.html`, and
`./Spellwatch Dashboard.dc.html` → `index.html`) so navigation works on the
deployed site.
