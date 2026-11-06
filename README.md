# EVENTORA

A premium event discovery and event management website, built with plain HTML5, CSS3 and vanilla JavaScript. It has no frameworks, no build step and no package dependencies.

## Run locally

```bash
python tools/dev_server.py
```

Then open http://localhost:5500.

`tools/dev_server.py` uses only the Python standard library. It works like `python -m http.server`, but it sends `Cache-Control: no-store`. The stock server lets browsers reuse stale CSS and JS after you edit a file, which mixes old and new code.

You can also open `index.html` directly, because the scripts are plain (non-module) files.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | The scrolling home page: a full-screen hero, Explore events (curved poster carousel), Upcoming events (the full programme, searchable, filterable and sortable), Event categories, then About, Contact and the footer (placeholders until later phases) |
| `host.html` | The "Host an Event" page (a branded shell for now) |
| `event.html?id=<event id>` | Event details page: one template that renders any catalogue event, with a friendly "not found" state for unknown ids |
| `styleguide.html` | Internal design-system reference that renders the live tokens and reusable recipes. It is `noindex` and not linked from the site |

## Page architecture (since Phase 3)

- **Shared background.** `div.site-bg` is one fixed layer behind every page. It holds the `#020204` base, the blue atmosphere and the two-layer starfield. Content scrolls over it, so the stars never restart, duplicate or jump. It's sized with `100lvh`, so a mobile address bar collapsing doesn't resize it. Sections add depth with low-alpha radial glows (`.section--glow-tl/-tr/-bl/-bottom`) that scroll with them. Event cards use a dense glass base so no star sits behind their text.
- **Hero.** `section.stage#top` is exactly one screen tall (`100vh`/`100svh`) and transparent, so the shared sky shows through. It clips the scaled 1172×657 design canvas.
- **Nav.** The nav lives in `header.navlayer`, a fixed layer that reproduces the canvas coordinate system (same width, origin and `--k` scale). At the top of the page it sits on exactly the pixels it had inside the hero, and it stays pinned while the page scrolls. On phones it becomes an unscaled bar, and the hero column keeps a spacer for it.
- **In-page jumps.** Nav links use `#top`, `#featured`, `#categories`, `#about` and `#contact`. CSS handles smooth scrolling, which is instant under reduced motion. `html { scroll-padding-top: var(--nav-offset) }` keeps destinations below the fixed nav, and `js/layout.js` measures the offset. `js/sections.js` moves focus to the destination, sets `aria-current` on the matching link, and pauses the 3D ring while the hero is off-screen.
- **Scale.** The scale uses `clientWidth`, the space actually available, so a classic Windows scrollbar can't push the hero off-centre. The layout mode uses `innerWidth`, which matches what CSS media queries see.

## Hero poster ring

The ring holds 37 vertical event posters in a 2:3 portrait ratio. Each one is authored on a 130×195 board and scaled as a whole, so every poster keeps its complete design at any size. As in the design reference, the browser mock sits in front of the ring.

- **Desktop and tablet.** The centre poster's lower 35% tucks behind the preview. Edge posters ride higher on the arc and show more. Every title and detail sits in the top ~60% of each poster, so only photography runs into the tucked part.
- **Phones.** Posters are limited by screen width, so they stay fully visible above the preview.

`Eventora.carousel.fit()` derives the geometry for each viewport from the space between the hero CTA and the preview, plus the visible width:

- poster width `W` (height `1.5·W`) and radius `R = 6.54·W`, which is also the CSS perspective, so the camera sits at the ring centre
- the visible arc: about ±33° on desktop and tablet (blended across 1080px) and ±14° on phones
- a horizon `0.6·H` below the posters

The fit accounts for the outermost poster's edge magnification, `cos δ / cos(A + δ)`. No poster rises under the CTA or is cut by the screen edge; posters fade over the last 6° of the arc instead. On tall tablets the ring and preview are lifted together, so the gap under the CTA stays comfortable.

`tests/ring-visibility.js` checks every visible poster: 2:3 portrait, inside the screen, below the CTA, and tucked by no more than the target (or fully above the preview on phones).

## Event data (since Phase 4)

- **Catalogue.** `js/events.js` is the **single source of truth** for event data. It holds 8 fictional demo events, marked as sample content in the code and on the page. Each event has `id`, `title`, `category`, `date` (local `YYYY-MM-DD`), `time` (`HH:MM`), `venue {name, city}`, `image {src, alt}`, `description`, `featured`, and `registration {status, spotsLeft?}`, plus optional `price` and `promo`.
- **Validation.** The catalogue is validated on load (any problems are logged to the console) and deep-frozen, so nothing can modify it at runtime.
- **API.** `Eventora.events` provides `all()`, `byId()`, `featured()`, `upcoming()` (non-featured, soonest first), and formatters for date, time, status, price and image URL.
- **Dates.** Dates are built in local time, never by parsing an ISO string as UTC, so weekdays are always correct.
- **Derived content.** Hero content reads from the catalogue instead of copying it. The ring posters that advertise an event use its photo, and the app preview's four cards are built from catalogue events.
- **localStorage.** The catalogue is **not** stored in localStorage. That's reserved for per-user state such as registrations and favourites, keyed by event `id`.
- **Cards.** `js/event-cards.js` builds the reusable card with DOM APIs. It has two variants: `feature` (with `lead` for the first featured event) and `row` (an agenda row with a date tile).
- **Card interaction:**
  - *Default:* photo, category, title and description, plus the status and price footer.
  - *Hover or keyboard focus:* a glass panel slides up over the photo with the date, time and venue. It overlays the photo, so nothing on the page moves.
  - *Click:* the title is a real link whose `::after` covers the whole card, so a click anywhere opens `event.html?id=…`. Each card is a single Tab stop named by its title, with a cyan focus ring around the whole card.
  - *Touch screens* (`hover: none`): the date and venue panel is always shown, and a tap opens the event.
  - *Screen readers:* they get the date and venue as hidden text after the title (the visual panel is `aria-hidden`).

## Search, categories, filtering and sorting (since Phase 5)

- **Upcoming = the full programme.** All 8 events, soonest first. The Explore carousel above is a separate browsing view and isn't affected by filters.
- **One filter state** (`js/event-filters.js`): `{ query, category, sort }`. Search, category and sort always combine. The list is re-rendered with the shared card renderer, so card interactions and detail links are unchanged.
  - **Search** is live. It matches title, category, venue name and city, and description. It's case- and accent-insensitive, ignores apostrophes, and every typed word must match (as part of any word). The × button or Escape clears it.
  - **Category chips** (with an *All events* option) are built from the catalogue with live counts. The category cards in the Categories section apply the same filter and move to the results.
  - **Sort:** earliest date (default), latest date, or alphabetical.
  - **Reset filters** restores the defaults. It's disabled while they're already in place.
  - **Results count** is announced to screen readers (`role="status"`). When nothing matches, an empty state explains why and offers only the actions that would widen the results.
- **No storage.** Filters aren't stored, in localStorage or anywhere else.

## Explore events: curved poster carousel

The Featured grid is replaced by a curved 3D carousel (`js/explore-carousel.js`, `css/explore.css`). Its motion and interaction ideas are adapted from `LEON_VASARI_CURVED_VHS_REFERENCE.txt.txt`, used only as a motion reference. None of that reference's content, branding or palette is used; the carousel keeps EVENTORA's starfield, cyan glow, glass and type.

- **Content.** It shows all 8 catalogue events in programme order and opens on the soonest featured event. The ring is three loops of copies (24 posters), so it wraps endlessly. Only the poster in the target position is in the Tab order and exposed to screen readers.
- **Geometry.** Posters sit on a curved arc. Side posters shrink, sink back in depth, turn up to 32° and darken. The front poster lifts, gets a cyan edge and follows the pointer with a small tilt. Posters far off the arc are hidden.
- **Motion.** Everything follows one spring (`s → T`, critically damped). The loop sleeps when settled and pauses off-screen. The caption changes with a mask slide in the direction of travel.
- **Input:**
  - Drag or swipe. Horizontal drags only; vertical page scroll still works on touch.
  - The ← → buttons.
  - Keyboard: ← → steps, Home and End jump to the ends, and focus follows the front poster through wrap-around.
  - Horizontal wheel or trackpad swipe. One notch moves at least one poster.
  - Clicking a side poster glides it to the front; clicking the front poster opens it.
  - The timeline under the caption jumps to a date.
- **Details panel.** It grows out of the front poster with a clip-path expansion. The lines rise in, then the photo reveals. Close, Escape or the browser Back button collapse it back into the poster, and focus returns there. While it is open, the page is scroll-locked and inert. `index.html#event=<id>` deep-links straight to it, and *Open event page* goes to `event.html?id=…`. On phones it is a single scrolling column.
- **Reduced motion.** Steps are instant, and the panel opens and closes without animation.

## Event registration (since Phase 6)

- **Where.** Each event page (`event.html?id=…`) has a **Register now** button under the details. Waitlist events show *Join the waitlist* instead, and sold-out events show a "registration closed" notice with no form. The button reveals the form below the details, scrolls to it and focuses *Full name*. `event.html?id=…#register` opens it directly, and the Explore carousel's details panel links there.
- **Form** (`js/registration-form.js`). It has *Selected event* (filled in and read-only), *Full name*, *Email address* and *Phone number*. All fields are required.
  - *Name:* 2–80 characters; letters, spaces, hyphens, apostrophes and periods.
  - *Email:* `name@domain.tld`, at most 254 characters.
  - *Phone:* digits, spaces, `( ) - .`, and an optional leading `+`, with 7–15 digits in total.
  - *Errors appear inline* under the field. A field is checked when you leave it (after typing), while it shows an error (it clears as soon as it's fixed), and on submit. On submit, focus moves to the first problem and a status message announces how many there are. Fields use `aria-invalid` and `aria-describedby`.
- **Submission.** The button locks and reads *Saving…*, so double clicks and repeated Enter presses are ignored. The confirmation then replaces the form in the same card. It shows the registration ID (with a copy button), the event, date and time, venue, name and email.
- **Duplicates.** The same email can register only once per event, ignoring case and spaces. A repeat submission shows *You're already registered* with the existing ID and writes nothing. The same person can still register for other events, and other people can register for the same event (*Register someone else*).
- **Storage** (`js/registrations.js`). Registrations live in localStorage under one key, `eventora:registrations`, separate from the catalogue:
  ```
  { version: 1, registrations: [{ id: 'EVR-7K3M-Q9TD', eventId, type: 'registration'|'waitlist',
                                  name, email, phone, createdAt }] }
  ```
  Only what a booking needs is kept. Event titles, dates and prices are looked up from the catalogue by `eventId`. Emails are stored lower-case and phones as digits with an optional `+`. IDs use 8 random Crockford base-32 characters and are checked against existing IDs.
- **Damaged or missing data.**
  - A missing key means an empty list.
  - Unreadable JSON or the wrong shape is ignored, with one console warning, and the next save writes a clean copy.
  - Malformed records are dropped and the valid ones kept.
  - If storage is blocked, the registration is kept for that page view only, and the confirmation says it wasn't saved.
- **Persistence.** After a reload, the event page shows *Registered on this device · EVR-…* under the button.

## Structure

```
index.html              home page (hero + section placeholders + footer)
host.html               Host an Event page shell
event.html              event details template (?id=<event id>)
styleguide.html         internal design-system page
css/
  tokens.css            ALL design tokens: colour, type, spacing, radii, borders,
                        shadows, glass, gradients, motion, focus, z-order
  base.css              reset, document typography, focus system, a11y helpers,
                        global reduced-motion safety net
  stage.css             shared fixed background (.site-bg), hero section,
                        scaled 1172x657 canvas, fixed nav layer
  components.css        hero instances: nav pill, badge, glow button, concierge FAB
  hero.css              headline + sub-copy
  showcase.css          3D poster ring + app preview (browser mock)
  utilities.css         reusable recipes: .container, type helpers, .glass*,
                        .btn--md/--lg/--block, .btn-ghost, hairlines, hover helpers
  sections.css          active-nav indicator, homepage sections, footer, page shells
  events.css            event card component, Featured grid, Upcoming agenda, details page
  filters.css           search, sort, category chips, empty state, category cards
  explore.css           curved Explore carousel, timeline, expanding details panel
  registration.css      Register CTA, registration form, validation states, confirmation
  responsive.css        tablet (701–1080) and phone (<=700) architectures
  motion.css            entrance resting states + reduced-motion overrides
  styleguide.css        styleguide page layout only
js/                     each file attaches to the single `window.Eventora` namespace
  core.js               namespace, config (breakpoints, canvas), viewport mode,
                        live reduced-motion service, DOM helpers
  events.js             event catalogue (single source of truth) + formatters
  data.js               ring posters + app preview (derives events from catalogue)
  starfield.js          two-layer box-shadow starfield (reference §1)
  carousel.js           37 portrait (2:3) posters on a perspective ring, fitted
                        between hero CTA and app preview (see below)
  mock.js               renders the app preview from data
  event-cards.js        reusable event card renderer (feature / row variants)
  event-page.js         renders event.html from the catalogue
  registrations.js      registration store (localStorage, validation of stored data, ids)
  registration-form.js  Register CTA, form validation, submission, confirmation
  event-filters.js      live search, category filter, sorting, category cards
  explore-carousel.js   curved Explore carousel + expanding details panel
  fitter.js             type fitter (cap height, ink width, baseline)
  layout.js             canvas scale law, tablet height split, phone reset
  nav.js                burger menu (aria-expanded, Escape, outside click, focus-out)
  sections.js           in-page jumps, focus, scroll spy, ring pause
  intro.js              one-shot entrance timeline (Web Animations API)
  main.js               home page bootstrap
  styleguide.js         styleguide renderer
tests/
  hero-snapshot.js      hero regression snapshot (dev tool, see below)
  ring-visibility.js    checks every visible ring poster is 2:3 and placed correctly
tools/
  dev_server.py         no-cache local server
docs/screenshots/       verification screenshots per phase
```

## Design-system rules

- **Tokens first.** New UI reads colour, type, spacing, radii, borders, shadows and motion from `css/tokens.css`. Don't add raw values to components.
- **Reference recipes are verbatim.** The glow-button foot gradient, edge-light mask, badge glass and icon tile are measured light falloffs from the design reference. Never simplify their stops.
- **Fonts.** Poppins is loaded at 400–900. Playfair Display is loaded only at 600 (normal and italic), so always use `var(--fw-serif)` for serif text.
- **Breakpoints.** Phone is ≤700px, tablet is 701–1080px, and desktop is >1080px. CSS hard-codes them in `@media`, and `Eventora.config.breakpoints` mirrors them for JS.
- **Motion.** Read `Eventora.motion.reduced()` before animating in JS. `base.css` also neutralises CSS transitions and animations under `prefers-reduced-motion`.
- **Focus.** Every interactive element gets the cyan `:focus-visible` ring from `base.css`. Don't remove outlines without replacing them.
- **Scrolling.** The document scrolls and the hero stays the first full-screen section. Never apply `overflow:hidden` to `html` or `body`.

## Hero regression test

`tests/hero-snapshot.js` records the geometry and computed styles of every hero element (about 80 nodes, including pseudo-elements and fitter output). Moving parts like ring rotation, random star positions and the pulse are excluded.

To use it, open the page in Chrome, wait for the intro to finish (about 3s), keep the pointer off the hero, and run this in the console. On Windows, add `html{scrollbar-width:none}` first so the scrollbar doesn't change the scale:

```js
await new Promise(r => { const s = document.createElement('script'); s.src = '/tests/hero-snapshot.js'; s.onload = r; document.head.appendChild(s); });
EventoraSnapshot.save('desktop-1440');     // before a change
EventoraSnapshot.compare('desktop-1440');  // after the change: lists every difference
```

## Design reference

`DESIGN_REFERENCE.txt.txt` is the visual reference (Vertex Shops). EVENTORA keeps its layout coordinates, button and badge pixel contracts, 3D ring and motion. It replaces the reference's e-commerce content with event content.

Photography: Unsplash (images.unsplash.com).
