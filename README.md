# EVENTORA

A premium event discovery and event management website, built with plain HTML5, CSS3 and vanilla JavaScript. It has no frameworks, no build step and no package dependencies.

## Run locally

```bash
python tools/dev_server.py
```

Then open http://localhost:5500.

`tools/dev_server.py` uses only the Python standard library. It works like `python -m http.server`, but with three differences:

- It sends `Cache-Control: no-store`. The stock server lets browsers reuse stale CSS and JS after you edit a file, which mixes old and new code.
- It refuses to serve dotfiles and dot-folders (`.env`, `.data`, `.git`).
- It runs the development **account API** (`tools/accounts.py`): sign-up, sign-in, sessions, roles and email-OTP password recovery. Accounts and scrypt password hashes live on the server in the git-ignored `.data/accounts.json` (see *Accounts on the dev server* below).

Use it for anything involving accounts. Opening `index.html` directly still works for browsing, but without the server nobody can sign in.

## Pages

| Page | Purpose |
|---|---|
| `my-registrations.html` | My Registrations: the signed-in user's bookings (Upcoming / Past), details with the QR code, print, cancel |
| `signup.html` · `login.html` · `forgot-password.html` | Create an account, sign in (with remember-me), and reset a forgotten password with a 6-digit email code |
| `profile.html` | Account page. Users and hosts: details, photo, role, My registrations, Host dashboard link (hosts), *Become an Event Host* (users). Admins: the **Admin account** page (profile only) |
| `host-dashboard.html` | Event Host dashboard: create, edit and track **your own** events; see their registrations (admins are sent to Host an Event) |
| `admin.html` | Admin panel, the central management interface: overview, host applications, event approvals, all events, users, registrations |
| `index.html` | The scrolling home page: a full-screen hero, Explore events (curved poster carousel), Upcoming events (the full programme, searchable, filterable and sortable), Event categories, then About, Contact and the footer (placeholders until later phases) |
| `host.html` | **Host an Event**. Event Hosts and the Admin: a simple submission form (saved on the server as Pending). Visitors: how to start (sign in). Users: sent to *Become an Event Host* |
| `event.html?id=<event id>` | Redirect only: old links open the event-details panel (`index.html#event=<id>`) |
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
  - *Click:* the title is a real link whose `::after` covers the whole card, so a click anywhere opens the event-details panel, growing out of the card's photo. Each card is a single Tab stop named by its title, with a cyan focus ring around the whole card.
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
- **Details panel.** Selecting the front poster opens the event-details panel, described below.

## Event details: one cinematic panel

There is a single event-details experience: the panel that grows out of the poster or card you selected (`js/event-detail.js`). The separate details page was removed; `event.html?id=…` now only redirects here, so old links, bookmarks and dashboard links keep working.

- **Animation.** This is the Explore panel's original animation, unchanged and simply moved into its own module: a clip-path expansion from the selected element's rectangle (1050 ms), text lines rising in, the photo revealing in a circle, and the same collapse back into that element on close (850 ms). Reduced motion opens and closes instantly.
- **Content.** Category (and "Hosted by …" for host events), title, status, date, time, venue, price, availability (spots left, available, waitlist or sold out), description and poster. There's no *Open event page* button any more.
- **Entry points.** All of them open this same panel:
  - the Explore carousel's front poster;
  - Upcoming cards, including search results and category-filtered results (category chips and cards). Card links are `index.html#event=<id>`; on the homepage a click opens the panel in place, growing from the card's photo;
  - links from other pages: My registrations (*View event*), the host dashboard (*View public page*) and the admin events table (*View*). These load the homepage and open the panel there.
- **Registration happens inside the panel** (`js/registration-form.js` attaches to it):
  - *Register now* (or *Join the waitlist*). Visitors go to sign in, or create an account, and come straight back to this panel with the form open (`index.html#event=<id>&register`).
  - Signed-in users get the form in the panel, prefilled from their profile. The confirmation, registration ID and QR code appear in the panel too.
  - Sold-out events show a closed notice instead.
  - Duplicate, reinstate and privacy rules are unchanged.
- **History.** Opening adds a history entry (`#event=<id>`), so Back closes the panel and Forward reopens it. Close and Escape behave the same.
  - Back and Forward grow the panel from a matching card if one is on screen, otherwise from the carousel poster.
  - A shared link opens the panel on load. Closing it drops the hash so a refresh doesn't reopen it.
  - Focus returns to the poster or card you came from. While the panel is open the page behind it is inert and scroll-locked.
- **Reduced motion.** Steps are instant, and the panel opens and closes without animation.

## Event registration (since Phase 6)

- **Where.** Inside the event-details panel (see *Event details: one cinematic panel*). **Register now** reveals the form under the details, scrolls to it and focuses *Full name*. Waitlist events show *Join the waitlist* instead; sold-out events show a "registration closed" notice with no form. `index.html#event=<id>&register` opens the panel with the form already open.
- **Form** (`js/registration-form.js`). It has *Selected event* (filled in and read-only), *Full name*, *Email address* and *Phone number*. All fields are required.
  - *Name:* 2–80 characters; letters, spaces, hyphens, apostrophes and periods.
  - *Email:* `name@domain.tld`, at most 254 characters.
  - *Phone:* digits, spaces, `( ) - .`, and an optional leading `+`, with 7–15 digits in total.
  - *Errors appear inline* under the field. A field is checked when you leave it (after typing), while it shows an error (it clears as soon as it's fixed), and on submit. On submit, focus moves to the first problem and a status message announces how many there are. Fields use `aria-invalid` and `aria-describedby`.
- **Submission.** The button locks and reads *Saving…*, so double clicks and repeated Enter presses are ignored. The confirmation then replaces the form in the same card. It shows the registration ID with a **check-in QR code** that encodes the ID, plus the event, date and time, venue, name and email. The QR code comes from `js/qr.js`, a small dependency-free encoder (level M, versions 1–6, alphanumeric or UTF-8 byte mode, best of 8 masks). Its output was verified by decoding it with OpenCV across all masks and versions.
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

## My Registrations (since Phase 7)

- **Page.** `my-registrations.html` (`js/my-registrations.js`, `css/my-registrations.css`). You reach it from the registration confirmation, the *You're registered · … My registrations* note, and your profile.
- **Who "you" are** (since Phase 8). You're the signed-in account (`js/identity.js` → `js/auth.js`), and a booking is yours when `record.userId` is your user ID. Signed-out visitors see a *Sign in* prompt. Phase 7's temporary guest-by-email identity is retired, and its `eventora:session` key is removed on load.
- **Dashboard.**
  - Upcoming and Past tabs follow the WAI-ARIA tabs pattern (arrow keys, Home and End). *Past* means the event's date is before today.
  - Cards show the poster, title, date and time, venue, registration ID, a status chip and a *Waitlist* tag when relevant. The whole card opens the details.
  - Upcoming is sorted soonest first and Past most recent first.
  - There are empty states for no bookings at all and for an empty tab.
- **Status.** *Confirmed*, *Cancelled*, or *Completed*. Completed means confirmed with the event date passed. It's derived when displayed, never stored.
- **Details** open in a modal `<dialog>` (focus stays inside; Escape, the backdrop or *Close* closes it, and focus returns to the card).
  - They show the poster, category, title and status, date, time, venue, price and description. Below that: registration ID, QR code, name, email, phone, type, booked time and cancelled time.
  - `my-registrations.html#EVR-…` opens a booking directly, but only one the signed-in user owns.
- **Print / Save as PDF** uses `window.print()`. A print stylesheet prints only the open booking: white page, poster, details and QR code, with no buttons.
- **Cancellation.**
  - Only confirmed upcoming bookings can be cancelled.
  - An inline confirmation step comes first, with focus on *Keep registration*. Confirming sets `status: 'cancelled'` and `cancelledAt`.
  - The record and its ID are kept. The QR code is stamped VOID, and the card and status update in place.
  - Registering again for that event with the same email **reinstates the same record and ID**, so no duplicate is created.
- **Data.**
  - Records gained `status` and an optional `cancelledAt`. Older records without a status read as confirmed.
  - Event details always come from the catalogue by `eventId`. A booking for an event that's no longer listed still shows, with a fallback poster, a note and its booking details.
  - Corrupt account or session data means signed out. Corrupt registration data means an empty list (Phase 6 rules). Other tabs' changes are picked up through the `storage` event.

## Authentication, profiles & roles (since Phase 8)

> **Prototype, not secure.** Accounts, sessions, roles, host applications and host events live in this browser's localStorage. Anyone with access to the browser can read or edit that data in DevTools. Every role check in the browser decides what the pages *show*; none of it is real authorization. Real security needs the backend planned for Phase 11 (see the end of this section).

### What's built
- **Sign up** (`signup.html`). Fields: full name, email, phone, password and confirmation, with *show/hide* on both password fields and a live checklist (8+ characters, a letter, a number).
  - Inline validation uses the same rules as the registration form (`js/validate.js`).
  - Duplicate emails are refused (case and spaces ignored).
  - *Keep me signed in* is on by default.
  - Bookings made before accounts with the same email are linked to the new account. The success screen says how many.
- **Sign in** (`login.html`). Email and password, with show/hide and *Remember me*.
  - The server checks the password and issues a session token. With *Remember me*, the session lasts 30 days (token in localStorage). Without it, it lasts for the browser session (sessionStorage, 12 h max).
  - Five wrong passwords lock sign-in for that email (and that device) for 60 seconds.
  - Wrong credentials get one generic message, so it never reveals whether the email exists. Suspended accounts are told so.
  - `?next=` returns you to where you were. It accepts only same-site page names.
- **Sign out.** From the profile or *My registrations*.
- **Forgot password** (`forgot-password.html`, linked from the sign-in page). The only password-management screen (the account page has no Change Password form); every account type uses it, the Admin included. See *Password recovery* below.
- **Account page** (`profile.html`). Shows user ID, name, email, phone, *Member since*, role badge and an optional photo (resized in the browser to 160 px JPEG). You can:
  - edit your name, email and phone (emails stay unique);
  - open My registrations;
  - Event Hosts: open the Host dashboard;
  - Users: apply to become an Event Host.
- **Admin account page** (`profile.html` for admins, reached from the account icon). It keeps the profile parts (photo, name, email, **Admin** badge, member since, user ID, sign out, profile editing, My registrations) It has no event form, no Host dashboard card, no host application, no Change Password form and no admin-dashboard card: the Admin panel and *Host an Event* are their own navbar items.
- **Nav: role-based navigation** (`js/account-nav.js`). The nav button's label and destination depend on the role; when the label changes, `js/layout.js` re-fits it in the hero's fitted nav (same type size as *Host an Event*):

  | Role | Nav button | Account icon goes to |
  |---|---|---|
  | Visitor | *Host an Event* → Sign in (then `host.html`) | Sign in |
  | User | *Host an Event* → *Become an Event Host* on the profile | My Profile |
  | Event Host | *Host Dashboard* → their own events | My Profile |
  | Admin | *Admin Panel* → `admin.html` | Admin account page |

  Admins also get a **Host an Event** text link after *Contact*, which opens the **Host an Event** submission form (`host.html`, see *Host an Event* below). On desktop the five standard links keep their size and the pill grows by the extra link's width on both sides, staying centred (`--nav-extra`, set by `js/layout.js`); on tablet and phone it is one more menu row.

  `host.html` explains hosting to visitors, sends users to the application, and shows hosts and the admin the event submission form (never the host application). The account entry sits in the gap between the link row and *Host an Event*: a person icon when signed out, your initial or photo when signed in. On tablet and phone it becomes a row in the menu.
- **Registering for events now needs an account.** Visitors see *Sign in to register* / *Create an account*. The form is prefilled from the profile and the booking is saved with your `userId`.
  - If someone types an email that another account has already booked for that event, they get a plain error and never see that booking.
  - The "You're registered" note and My Registrations show only your own bookings.

### Roles
| Role | Who | Can |
|---|---|---|
| Visitor | signed out | browse and explore events |
| User | every new account | register for events, manage own registrations, apply to host |
| Event Host | approved by an admin | the above, plus create and manage **their own** events |
| Admin | the account matching server-side `ADMIN_EMAIL` | manage users, host roles, applications and events |

- New accounts are always **User**. No page or setting lets anyone give themselves Host or Admin.
- **Host** is granted only by an admin action: approving an application, or *Make host* in the admin users table. *Revoke host* takes it away; that host's events are kept.
- **Admin is set only on the server, and an email match alone never grants it.**
  - `tools/init_admin.py` (run on the server machine) is the only way to create the admin account. It needs the admin password; public sign-up always creates a User, and signing up with the admin email is refused because that account already exists.
  - The role counts only while the account's email equals the server's `ADMIN_EMAIL`.
  - Every page load asks the server who is signed in (`POST /api/auth/me`). Editing localStorage, forging a session or inventing a token grants nothing.
  - Account changes made in the Admin panel (Make host, Revoke host, Suspend, approving a host application) are API calls that need a live admin session; the server refuses them for anyone else.

### Accounts on the dev server
Each account has a unique user ID (`usr_…`), a unique email, its own scrypt password hash, a role and a creation date. They are stored in `.data/accounts.json`: git-ignored, never served, written atomically. The browser keeps only the session token and a cache of public profile fields; never a password, hash or code.

**Accounts from the old browser-only prototype** move to the server on their first sign-in: the browser checks the password against its old local hash, the server creates the account with a fresh scrypt hash and the **same user ID, creation date and role** (User or Event Host), and the old local hash is deleted. Bookings, applications and events keep pointing at the same IDs. The old browser-made admin record is not moved; the admin is created on the server instead. Set `LEGACY_IMPORT=off` in `.env` once everyone has moved.

### Admin setup

The initial Admin account is `k.soham.025@gmail.com`. From the project root, on the machine that runs the dev server:

```powershell
python tools/init_admin.py --email k.soham.025@gmail.com --id usr_W2GDP8QYVAXP
```

- It asks for the password twice without showing it (8–128 characters, a letter and a number).
- It writes `ADMIN_EMAIL=k.soham.025@gmail.com` to the git-ignored `.env` and creates the admin in `.data/accounts.json` with a **scrypt hash** of the password. The password is never stored, printed, logged or put in frontend code.
- `--id` is optional: it reuses the user ID of the earlier browser-only admin, so events that admin created stay linked to the admin account.
- Run it again any time to set a new admin password. It is also the **trusted recovery path if the admin loses access to the admin mailbox**: it needs no email, only access to the server machine.
- Then restart `python tools/dev_server.py`. Its first line should say `admin account ready`.

Sign in at http://localhost:5500/login.html. The role badge reads **Admin**, the navbar shows *Admin Panel*, and the account icon opens the Admin account page. The admin's email can't be changed on the profile page (it is `ADMIN_EMAIL` on the server).

### Password recovery (email OTP)
1. **Enter your registered email** on *Forgot password*. Any provider works (Gmail, Outlook, Yahoo, …).
2. **The server creates a 6-digit code** with Python's `secrets` module and keeps only a salted SHA-256 hash of it, tied to that account. The code is never returned by the API, logged or stored in the browser.
3. **It emails the code** through Resend (Python `urllib`, on a background thread) to the address registered on the account, and only that address. The email is EVENTORA-branded: *Password Reset Request*, the code, a 5-minute expiry notice and a "didn't request this?" warning.
4. **Enter the code** in the six boxes (typing, pasting or autofill all work). The server allows **5 wrong attempts**, then the code stops working. Codes expire after **5 minutes** and work **once**. A new code replaces the old one. *Resend code* unlocks after a **60-second** countdown, and each email can get at most 5 codes an hour (20 per device).
5. **Choose a new password** (with show/hide, the live checklist and a confirmation). The verified code is exchanged for a random **reset token** (10 minutes, single use, kept in page memory only). Resetting changes only that account's password hash: **the role and everything else stay the same**, and every session of that account is signed out. The page confirms, then takes you to sign-in.

**No account probing.** Requests for unknown emails get exactly the same answers (the server tracks a decoy code that can never verify), and nothing is emailed to them.

**Email not set up?** Without `RESEND_API_KEY`, the page says that reset emails aren't set up on this server. Nothing is pretended. If Resend rejects a message, the page still gives its normal answer (so it can't be used to probe accounts), and the server console shows `Password reset email to k***@gmail.com FAILED: …`.

### Resend setup (password-reset email)
1. **Create an account** at https://resend.com/ (free tier). Sign up with `k.soham.025@gmail.com` if you can: see step 3.
2. **Create an API key**: *API Keys → Create API Key*, permission *Sending access*. Copy it (it's shown once).
3. **Sending domain.** Without a verified domain Resend only sends from `onboarding@resend.dev`, and **only to the email address that owns your Resend account**. That's enough to test the admin reset if the Resend account is `k.soham.025@gmail.com`. To email any user, verify a domain you own: *Domains → Add Domain*, add the DNS records Resend shows (SPF/DKIM `TXT` and `MX`) at your DNS provider, and wait for *Verified*. Then use a sender on that domain.
4. **Configure the server**: add to the git-ignored `.env` (see `.env.example`):
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=EVENTORA <noreply@your-verified-domain.com>
   ```
   Leave `EMAIL_FROM` empty to use `EVENTORA <onboarding@resend.dev>`. A sender that is malformed or still a placeholder (such as `your-verified-domain.com`) is ignored with a warning, and the server uses `onboarding@resend.dev` instead. Restart the dev server (it reads `.env` only at start-up); its first line should say `reset emails via Resend from …` and name the sender in use. The key stays on the server: it is never sent to the browser or logged, and `.env` is never committed or served.
5. **Test delivery**: open http://localhost:5500/forgot-password.html, enter `k.soham.025@gmail.com`, and check that inbox (and Spam). The server console logs `Password reset email to k***@gmail.com accepted by Resend (id …)` only when Resend answers with a message id; otherwise it logs why it failed (for example `HTTP 401 API key is invalid`, or Resend's testing-mode refusal). Resend's dashboard (*Emails*) shows each message and its delivery status. The page itself never says an email was delivered: it says a code "is being emailed" if the address has an account, because confirming delivery per address would reveal which emails are registered.

### Testing password recovery
- **Admin:** run `init_admin.py`, configure Resend, then on *Forgot password* enter `k.soham.025@gmail.com`. Type the code from that inbox, set a new password, and sign in with it: the badge still reads **Admin** and the Admin panel opens. The old password no longer works.
- **User and Event Host:** sign up (or sign in with an old browser account to move it to the server), make one account a host from the Admin panel, then run *Forgot password* for each. With a verified domain the codes arrive in their inboxes; without one, use the local mock below. Each keeps its role, and resetting one account never changes another.
- **Automated tests:** `python -m unittest tests/test_password_reset.py -v` runs 26 API tests on a throw-away server and data folder: every account type, incorrect, expired, reused and locked codes, resend cooldown and hourly limit, unknown emails, reset-token reuse and expiry, missing API key, invalid API key, delivery failure, a Resend reply without a message id, placeholder sender fallback, independent accounts, role protection, login lockout, migration, and that `.data` and `.env` are never served.
- **Local mock (test only):** `tools/mock_resend.py` stands in for Resend. Start it with `python tools/mock_resend.py 5599 --outbox outbox.jsonl`, then start a dev server with `RESEND_API_KEY=test-key` and `RESEND_API_URL=http://127.0.0.1:5599/emails` (localhost only; the server announces `LOCAL TEST MOCK`). Every "sent" email lands in the outbox file instead of a real inbox. Never use it for real accounts.

### Become an Event Host
1. A **User** opens *Profile → Become an Event Host*. Name, email and phone are prefilled from the profile and read-only. They add an organization (optional), why they want to host (30–1000 characters) and extra information (optional).
2. The application gets an ID like `APP-XXXX-XXXX` and status **Pending**. A second application is blocked while one is pending.
3. An Admin reviews it under *Admin → Host applications*. They see the applicant's details and current role, and can add an optional note.
4. **Approve** changes the user's role from User to **Event Host**. **Reject** leaves them a User; they see the note and can apply again.
5. The profile shows the latest status (Pending, Approved or Rejected) and the application history. Processed applications stay listed for admins.

### Host dashboard
- **Your events.** Stats show events, pending, live and registrations. Each event card shows its status: Pending, Published, Rejected (with the admin's note), Unpublished or Cancelled.
- **Creating an event.** Fields: title, category, date (today or later), time, venue, city, whole-dollar price (0 means free), a description of 20–400 characters, and a cover chosen from the catalogue's photography. New events are **Pending** and private. The form is one shared component (`js/event-form.js`): `render()` builds the fields and `create()` wires validation, cover picking, editing and submit. The host dashboard (hosts and the admin's events) and the Admin panel (edit) use it.

### Host an Event (event submission)
`host.html` for a signed-in **Event Host or Admin** is a simple page: the *Host an Event* heading, a short introduction, the shared event form (same fields and validation, `js/event-form.js`) and **Submit Event**. No stats, lists, admin controls or back button; the navbar handles navigation.
- **Saving.** `POST /api/me/events/submit` saves the event on the dev server (`.data/events.json`): always **Pending**, owned by the signed-in account (`hostId`; admin submissions also get `createdBy: 'admin'` and host name EVENTORA). Nothing is published automatically. The same event (title, date and time) can't be submitted twice while it's pending.
- **Confirmation.** The page shows the event's title, ID and Pending status, with *Submit another event* (hosts also get *Track it in your Host Dashboard*).
- **Review.** Submissions appear in *Admin panel → Event approvals* in any browser. Approving publishes the event on the server; the public pages load published events from the server (`/api/events/public`) before they render, so it shows up for everyone.
- **Hosts** see and edit their submissions (while Pending or Rejected) in the Host Dashboard, and see every submission with its status and the admin's reason under **Applied events** on their account page; both load from the server. Rejecting an event needs a reason (checked on the server).
- **Older pending submissions** saved only in a browser (before server saving) move to the server automatically, keeping their IDs, the next time their host opens the account page or Host Dashboard in that browser (`/api/me/events/carry-over`: own pending events only, once).
- Events created before server saving stay in the browser that made them until the events phase moves them; the pages show both kinds.

### Admin panel (central management interface)
Reached from *Admin Panel* in the navbar. Admins never apply to host; they create events on their account page and review and manage everything here. Sections are tabs (arrow keys, Home and End work; on tablet and phone the tab row scrolls sideways).

- **A. Overview.** Live counts from the stored data: total users, total events, pending host applications, pending event approvals, published events and total registrations. Each card opens the matching section and filter. Below are the two review queues.
- **B. Host applications.** All applications with applicant, organization, date and status, filtered by Pending, Approved, Rejected or All. *Review* opens the full application. Approve makes the user an Event Host; Reject keeps them a User, with an optional note. A decided application can't be decided again, and every record is kept.
- **C. Event approvals.** Every Pending event as a card: poster, title, category, date and venue; submission details (submitted, source, price, event ID); host details (name, email, role, member since); description; and an optional note to the host. Actions: *Approve* (publishes it), *Reject* (host and admin events) and *Edit details*.
- **D. All events.** Every event: the built-in catalogue, host events and admin events (tagged), filtered by Pending, Published, Unpublished, Rejected, Cancelled or All.
  - *Review* opens a dialog with the poster, all fields, host, bookings and ID.
  - *Edit* opens the shared form (edit only); admins may edit any event, including built-in ones. Its status doesn't change.
  - Status actions: Approve, Reject, Publish, Unpublish, Cancel event (hidden from the public, registrations kept) and Remove (host or admin events only; the record is deleted, registrations are kept).
  - Built-in events can't be rejected or removed, only edited, unpublished or cancelled. Their edits and statuses are stored as overrides (`eventora:catalogue-overrides`), so the frozen catalogue and its IDs never change.
- **E. Users.** User ID, name, email, role, status, registration date and bookings. *View* shows contact details, registrations, host applications and hosted events. Actions: *Make host* / *Revoke host*, *Suspend* / *Reactivate*. The initial Admin account is **protected**: no actions in the table, and the data layer refuses to suspend it, demote it or give it the Host role.
- **F. Registrations.** Every booking with registration ID, attendee, event, status (Confirmed, Completed or Cancelled) and booked date, filtered by event and status. *QR code* shows the check-in QR (VOID when cancelled) and the linked account.
- **Confirmations.** Destructive actions (reject, unpublish, cancel, remove, revoke, suspend) need a second click within 4 seconds.

### Data (localStorage, all versioned)
```
eventora:users              { version: 2, users: [public profile cache: id, name, email, phone, createdAt,
                              updatedAt, avatar, status, role], legacy: [old browser-only accounts not yet moved] }
eventora:auth               { version: 2, token, userId, expiresAt }   (localStorage or sessionStorage)
eventora:host-applications  { version, applications: [{ id: 'APP-…', userId, name, email, phone,
                              organization?, reason, info?, status, createdAt, decidedAt?, decidedBy?, note? }] }
eventora:hosted-events      { version, events: [{ …catalogue fields, id: 'h-…', hostId, createdBy?: 'admin',
                              status: 'pending'|'approved'|'rejected'|'unpublished'|'cancelled', … }] }
eventora:catalogue-overrides { version, overrides: { <built-in id>: { status?, fields?, note?, updatedAt } } }
eventora:registrations      records gained userId (Phase 6/7 IDs and event IDs unchanged)
```
Server side (`.data/accounts.json`, git-ignored, never served): `users` (id, email, name, phone, avatar, role, status, createdAt, updatedAt, scrypt `password` hash) and `sessions` (SHA-256 of each token, userId, expiry). Password-reset codes and reset tokens are kept only in the server's memory, so restarting the server cancels any recovery in progress.

### What's secured and what's a prototype
| Feature | Status |
|---|---|
| Password storage | **Server-side (development grade):** scrypt (N=2^15, r=8, p=1, 16-byte salt) in `.data/accounts.json`. No plaintext anywhere; hashes are never sent to the browser. |
| Admin account | **Server-side:** created only by `tools/init_admin.py`; the role counts only for `ADMIN_EMAIL`. Public sign-up can't create or claim it, and password recovery keeps the role. |
| Sign-in and sessions | **Server-verified (development grade).** Random 256-bit tokens (only their hash stored), 5-failure lockout per email and per device, sessions ended by sign-out, suspension or a password reset. Still dev-only: plain HTTP on localhost, the token sits in browser storage (not an HttpOnly cookie), no CSRF tokens. |
| Account roles and suspension | **Server-enforced:** only an admin session can change them. |
| Password recovery | **Done as specified (development grade):** 6-digit `secrets` codes, hashed, 5-minute expiry, 5 attempts, single use, 60 s resend cooldown and hourly limits, identical answers for unknown emails, single-use reset tokens. Codes and tokens live in server memory. |
| Email delivery | **Real once configured:** Resend over HTTPS with the key kept on the server. Without a key the page says so. Delivery failures are logged on the server but not shown to the visitor, so the page can't be used to probe accounts. |
| Events, applications, registrations | **Prototype.** Still in browser localStorage and checked in browser code only; the admin's actions on *these* aren't server-enforced, and anyone with DevTools can edit them. |
| Registration privacy between users | **Prototype.** The UI shows only your own bookings, but all bookings are in the same browser storage. |
| Email ownership at sign-up | **Not verified.** Signing up with an email links that email's older bookings, and there is no sign-up email confirmation yet. Sign-up necessarily says when an email is already registered. |
| Old browser account import | **Trusting by design.** An account from the old browser-only prototype moves to the server with the role the browser reports (User or Host, never Admin). Turn it off with `LEGACY_IMPORT=off` once migration is done. |

### Phase 11 backend (the architecture this is shaped for)
- The server owns the users, applications, events and registrations tables. Passwords are hashed with Argon2id or bcrypt on the server.
- Sessions are HttpOnly, Secure, SameSite cookies, with CSRF tokens on state-changing requests and rate limits on sign-in.
- Roles are checked **on the server for every request**. The browser modules (`Eventora.auth`, `Eventora.hosting`, `Eventora.registrations`) keep their function shapes and call the API instead of localStorage, so the pages don't change.
- The first admin is seeded on the server (from configuration like today's `ADMIN_EMAIL` and hash) into a real users table. Admin sign-in uses the same server session as everyone else, with secure cookies and MFA recommended. Further admin grants become audited admin-API operations. The temporary development credentials above are retired.
- New features: email verification before older bookings are claimed, and audit logs for role and approval changes. Password recovery already follows the production flow; it moves to the real database and HttpOnly-cookie sessions.

## Structure

```
index.html              home page (hero + section placeholders + footer)
host.html               Host an Event: submission form (hosts, admin) or sign-in intro
event.html              redirect stub: old event.html?id=… links → index.html#event=<id>
my-registrations.html   My Registrations (your bookings, details, print, cancel)
signup.html             create an account
login.html              sign in (remember me)
forgot-password.html    password reset: email → 6-digit code → new password → done
profile.html            profile, role, Become an Event Host
host-dashboard.html     Event Host dashboard
admin.html              Admin panel
.env.example            template for the git-ignored .env (ADMIN_EMAIL, RESEND_API_KEY, EMAIL_FROM)
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
  my-registrations.css  My Registrations dashboard, cards, tabs, details dialog, print layout
  auth.css              sign-up/in, profile, host dashboard + admin panel, tables, badges
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
  event-detail.js       THE event-details panel: cinematic open/close from any poster or card,
                        full details, registration inside, history and deep links
  registrations.js      registration store (localStorage, validation of stored data, ids,
                        status, cancel, reinstate)
  identity.js           "current user" adapter for registrations (backed by auth.js)
  validate.js           shared field rules (name, email, phone, password, …)
  auth.js               client of the account API: sign-up/in/out, sessions, roles, profile,
                        password recovery, one-time move of old browser accounts
  hosting.js            host applications, host events, admin review, public event source
  forms.js              inline-validation, show/hide password, checklist, alerts, ?next=
  account-nav.js        account entry in the nav (every page)
  auth-pages.js         sign up / sign in / forgot password pages
  profile.js            profile page
  host-dashboard.js     host dashboard
  host-page.js          Host an Event submission page (host.html)
  admin.js              Admin panel: overview, applications, approvals, events, users, registrations
  my-registrations.js   My Registrations page: tabs, cards, details dialog, print, cancel
  registration-form.js  Register CTA, form validation, submission, confirmation (attaches to the panel)
  qr.js                 dependency-free QR code encoder (SVG output)
  event-form.js         shared event form: render() + create() (host dashboard, admin account, admin panel)
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
  test_password_reset.py  26 API tests: accounts, roles, OTP recovery, Resend handling, security cases
tools/
  dev_server.py         no-cache local server; blocks dotfiles; account API routes
  accounts.py           accounts, scrypt, sessions, roles, OTP recovery, Resend mailer
  init_admin.py         create/update the admin account (ADMIN_EMAIL + scrypt hash)
  mock_resend.py        TEST-ONLY local stand-in for the Resend API
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
