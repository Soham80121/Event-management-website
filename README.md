# EVENTORA

A premium event discovery and event management website, built with plain HTML5, CSS3 and vanilla JavaScript. It has no frameworks and no build step.

## Run locally

```bash
python -m http.server 5500 --bind 127.0.0.1
```

Then open http://localhost:5500. You can also open `index.html` directly, because the scripts are plain (non-module) files.

## Structure

```
index.html            page shell (semantic markup)
css/
  tokens.css          design tokens: colour, type, motion, z-order
  base.css            reset, stage, scaled design canvas, starfield
  components.css      nav pill, badge, glow button, floating concierge button
  hero.css            headline + sub-copy
  showcase.css        3D poster ring + app preview (browser mock)
  responsive.css      tablet (701–1080) and phone (<=700) architectures
  motion.css          entrance resting states + reduced-motion overrides
js/                   each file attaches to the single `window.Eventora` namespace
  data.js             poster + app-preview content
  starfield.js        box-shadow starfield
  carousel.js         37-card perspective ring (R = 891, cull ±42°)
  mock.js             renders the app preview from data
  fitter.js           type fitter (cap height, ink width, baseline)
  layout.js           canvas scale law, tablet height split, phone reset
  nav.js              burger menu (aria-expanded, Escape, outside click)
  intro.js            one-shot entrance timeline (Web Animations API)
  main.js             bootstrap
docs/screenshots/     verification screenshots per phase
```

## Design reference

`DESIGN_REFERENCE.txt.txt` is the visual reference (Vertex Shops). EVENTORA keeps its layout coordinates, button and badge pixel contracts, 3D ring and motion. It replaces the reference's e-commerce content with event content.

Photography: Unsplash (images.unsplash.com).
