# EVENTORA

A premium event discovery and event management website, built with plain HTML5, CSS3 and vanilla JavaScript. It has no frameworks, no build step and no package dependencies.

## Run locally

```bash
python tools/dev_server.py
```

Then open http://localhost:5500.

`tools/dev_server.py` uses only the Python standard library. It works like `python -m http.server`, but with three differences:

- It sends `Cache-Control: no-store`. The stock server lets browsers reuse stale CSS and JS after you edit a file, which mixes old and new code.
- It refuses to serve dotfiles and dot-folders (`.env`, `.git`).
- It runs the development admin sign-in: it checks the admin's email and password and issues admin sessions (see *Admin setup* below).

Use it for anything involving accounts. Opening `index.html` directly still works for browsing, but without the server nobody can be an Admin.

## Pages

| Page | Purpose |
|---|---|
| `my-registrations.html` | My Registrations: the signed-in user's bookings (Upcoming / Past), details with the QR code, print, cancel |
| `signup.html` · `login.html` · `forgot-password.html` | Create an account, sign in (with remember-me), and a password-reset screen (prototype) |
| `profile.html` | Profile: details, photo, password, role, links to dashboards, *Become an Event Host* |
| `host-dashboard.html` | Event Host dashboard: create, edit and track your events; see their registrations |
| `admin.html` | Admin dashboard: users and roles, host applications, event approvals |
| `index.html` | The scrolling home page: a full-screen hero, Explore events (curved poster carousel), Upcoming events (the full programme, searchable, filterable and sortable), Event categories, then About, Contact and the footer (placeholders until later phases) |
| `host.html` | The "Host an Event" page, which explains how to become a host |
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
  - With *Remember me*, the session lasts 30 days in localStorage. Without it, it lasts for the browser session (sessionStorage, 12 h max).
  - Wrong credentials get one generic message, so it never reveals whether the email exists. Suspended accounts are told so.
  - `?next=` returns you to where you were. It accepts only same-site page names.
- **Sign out.** From the profile or *My registrations*.
- **Forgot password** (`forgot-password.html`). A prototype screen: no email is sent, and the reply is identical whether or not the account exists.
- **Profile** (`profile.html`). Shows user ID, name, email, phone, *Member since*, role badge and an optional photo (resized in the browser to 160 px JPEG). You can:
  - edit your name, email and phone (emails stay unique);
  - change your password (current password required; the new one must differ);
  - open My registrations;
  - open the Host or Admin dashboard when your role allows;
  - apply to become an Event Host.
- **Nav.** An account entry sits in the gap between the link row and *Host an Event*: a person icon when signed out, your initial or photo when signed in. Nothing else in the nav moves. On tablet and phone it becomes a row in the menu.
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
- **Admin is never stored, and an email match alone never grants it.**
  - The dev server checks the admin email **and password** against its own configuration: `ADMIN_EMAIL`, plus a PBKDF2 `ADMIN_PASSWORD_HASH` written by `tools/init_admin.py`.
  - It then issues a random admin token that it keeps in memory for 12 hours.
  - On every page load the browser asks whether that token is still valid (`POST /api/auth/admin-check`). With no valid token, the account is a User.
  - Setting `"role": "admin"` in localStorage, forging a session, or inventing a token grants nothing (all three were tested).
  - Signing out revokes the token on the server. Restarting the server ends every admin session.

### Admin setup (development admin account)

> ⚠ **TEMPORARY DEVELOPMENT CREDENTIALS. Do not use them anywhere real.**
> | | |
> |---|---|
> | Email | `admin@Evpedia.com` (stored and compared in lower case) |
> | Password | `Evpedia@Admin123` |
> | Role | Admin, for this development prototype only |
>
> They exist so the admin features can be built and tested locally. Change the password with `tools/init_admin.py` whenever you like. Production authentication and secure Admin authorization arrive with the **Phase 11 backend**, which replaces this mechanism and these credentials.

**1. Initialise the account (one time, or again to change the password).** From the project root:

```powershell
python tools/init_admin.py --email admin@Evpedia.com
```

It asks for the password twice without showing it, checks it (8 or more characters, a letter and a number), and writes two lines to the git-ignored `.env`: `ADMIN_EMAIL=admin@evpedia.com` and `ADMIN_PASSWORD_HASH=pbkdf2_sha256$600000$…`. **Only the hash is stored.** The password is never written to disk, logged or put in frontend code. For scripts you can use `--password-env NAME` to read the password from an environment variable instead of prompting.

**2. Start the dev server.**

```powershell
$env:ADMIN_EMAIL="admin@Evpedia.com"
python tools/dev_server.py
```

Setting `$env:ADMIN_EMAIL` is optional once `.env` exists. The environment variable takes priority over `.env`; the password hash always comes from `.env`, or from an `ADMIN_PASSWORD_HASH` environment variable. The first line of output should end with `admin sign-in configured`.

**3. Sign in** at http://localhost:5500/login.html with the email and password above.
- **First time in this browser:** the server verifies the password, and only then does the browser create the account record (*EVENTORA Admin*). This is the controlled initialisation; there is no admin sign-up form.
- **If someone already signed up with that email:** that record is taken over by the verified admin sign-in, and the old password stops working.
- **Afterwards:** your role badge reads **Admin**, and the profile links to the *Admin dashboard*.

**How it behaves**
- **Session length.** The admin session lasts 12 hours and ends when the dev server restarts. The account then shows as User with a "sign in again" note; sign out and back in to restore Admin.
- **Server-managed details.** The admin account's password and email can't be changed on the profile page; they're managed on the server with `init_admin.py`.
- **Lockout.** Five wrong passwords in a row from one machine lock the admin sign-in for 60 seconds.
- **Ordinary users.** Their passwords are never sent to the server when they sign in successfully. The server is consulted only when a local sign-in fails, or for the admin account.
- **Public sign-up.** It always creates a **User**. Signing up with the admin email gives no admin rights.

### Become an Event Host
1. A **User** opens *Profile → Become an Event Host*. Name, email and phone are prefilled from the profile and read-only. They add an organization (optional), why they want to host (30–1000 characters) and extra information (optional).
2. The application gets an ID like `APP-XXXX-XXXX` and status **Pending**. A second application is blocked while one is pending.
3. An Admin reviews it under *Admin → Host applications*. They see the applicant's details and current role, and can add an optional note.
4. **Approve** changes the user's role from User to **Event Host**. **Reject** leaves them a User; they see the note and can apply again.
5. The profile shows the latest status (Pending, Approved or Rejected) and the application history. Processed applications stay listed for admins.

### Host dashboard
- **Your events.** Stats show events, pending, live and registrations. Each event card shows its status: Pending, Approved, Rejected (with the admin's note) or Unpublished.
- **Creating an event.** Fields: title, category, date (today or later), time, venue, city, whole-dollar price (0 means free), a description of 20–400 characters, and a cover chosen from the catalogue's photography. New events are **Pending** and private.
- **Editing and deleting.** Only while an event is Pending or Rejected; an edit resubmits it. Approved events are locked until an admin unpublishes them.
- **Registrations.** You can see who registered for **your** events only. Another host's events, edits, deletes and attendee lists are refused.
- **Going public.** An approved event joins the public programme through `Eventora.events.addSource()`: the homepage carousel, Upcoming, categories and the event-details panel (`index.html#event=h-…`). Host event IDs start with `h-` and never collide with catalogue IDs; the built-in catalogue is unchanged.

### Admin dashboard
- **Users.** Name, email, role, status, join date and booking count. Actions: *Make host* / *Revoke host*, *Suspend* / *Reactivate*. You can't suspend yourself. The Admin row is marked *Server-configured*.
- **Host applications.** A pending queue with the full details, Approve / Reject (with a note), and a processed history.
- **Events.** Every host-submitted event with its host, status and bookings. Actions: Approve, Reject, Unpublish, Publish. Built-in catalogue events are listed read-only with their booking counts.
- **Confirmations.** Destructive actions need a second click within 4 seconds.

### Data (localStorage, all versioned)
```
eventora:users              { version, users: [{ id: 'usr_…', name, email, phone, createdAt, updatedAt,
                              role: 'user'|'host', status: 'active'|'suspended', avatar?,
                              password: { algo: 'PBKDF2-SHA256', iterations: 600000, salt, hash } }] }
eventora:auth               { version, userId, createdAt, expiresAt }   (localStorage or sessionStorage)
eventora:host-applications  { version, applications: [{ id: 'APP-…', userId, name, email, phone,
                              organization?, reason, info?, status, createdAt, decidedAt?, decidedBy?, note? }] }
eventora:hosted-events      { version, events: [{ …catalogue fields, id: 'h-…', hostId, status, … }] }
eventora:registrations      records gained userId (Phase 6/7 IDs and event IDs unchanged)
```

### What's secured and what's a prototype
| Feature | Status |
|---|---|
| Password storage | **Done properly:** PBKDF2-SHA256, 600,000 iterations, random 16-byte salt (Web Crypto). No plaintext anywhere. The hashes still sit in readable browser storage, though, so weak passwords could be cracked offline. |
| Admin credentials | **Server-side:** `ADMIN_EMAIL` and a PBKDF2 hash of the password live in the git-ignored `.env`, which is never served. The plaintext password isn't stored anywhere, and the email never reaches the browser. |
| Admin sign-in | **Server-verified (development grade).** Email *and* password are checked on the server (constant-time compare). It issues random 12-hour tokens held in server memory and revoked on sign-out, with a 5-failure lockout per client. Forged sessions and made-up tokens don't grant Admin (tested). Still dev-only: plain HTTP on localhost, the token sits in browser storage, and sessions don't survive a restart. |
| What an admin can do once signed in | **Prototype.** The admin *actions* (roles, approvals, suspensions) change browser localStorage, so the server doesn't enforce them, and anyone with DevTools could make the same edits directly. |
| Host and user roles, permissions, approvals | **Prototype.** Stored in localStorage and checked in browser code only. Anyone with DevTools can change them. |
| Registration privacy between users | **Prototype.** The UI shows only your own bookings, but all bookings are in the same browser storage. |
| Sessions and remember-me | **Prototype.** Not HttpOnly cookies, no CSRF protection, no rate limiting or lockout. |
| Email ownership | **Not verified.** Signing up with an email links that email's older bookings, and there is no email confirmation yet. |
| Forgot password | **UI only.** Nothing is sent. |

### Phase 11 backend (the architecture this is shaped for)
- The server owns the users, applications, events and registrations tables. Passwords are hashed with Argon2id or bcrypt on the server.
- Sessions are HttpOnly, Secure, SameSite cookies, with CSRF tokens on state-changing requests and rate limits on sign-in.
- Roles are checked **on the server for every request**. The browser modules (`Eventora.auth`, `Eventora.hosting`, `Eventora.registrations`) keep their function shapes and call the API instead of localStorage, so the pages don't change.
- The first admin is seeded on the server (from configuration like today's `ADMIN_EMAIL` and hash) into a real users table. Admin sign-in uses the same server session as everyone else, with secure cookies and MFA recommended. Further admin grants become audited admin-API operations. The temporary development credentials above are retired.
- New features: email verification before older bookings are claimed, real password-reset emails, and audit logs for role and approval changes.

## Structure

```
index.html              home page (hero + section placeholders + footer)
host.html               Host an Event page shell
event.html              redirect stub: old event.html?id=… links → index.html#event=<id>
my-registrations.html   My Registrations (your bookings, details, print, cancel)
signup.html             create an account
login.html              sign in (remember me)
forgot-password.html    password reset (prototype screen)
profile.html            profile, password, role, Become an Event Host
host-dashboard.html     Event Host dashboard
admin.html              Admin dashboard
.env.example            template for the git-ignored .env (ADMIN_EMAIL)
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
  auth.css              sign-up/in, profile, host + admin dashboards, tables, badges
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
  auth.js               accounts, PBKDF2 passwords, sessions, roles, server admin check
  hosting.js            host applications, host events, admin review, public event source
  forms.js              inline-validation, show/hide password, checklist, alerts, ?next=
  account-nav.js        account entry in the nav (every page)
  auth-pages.js         sign up / sign in / forgot password pages
  profile.js            profile page
  host-dashboard.js     host dashboard
  admin.js              admin dashboard
  my-registrations.js   My Registrations page: tabs, cards, details dialog, print, cancel
  registration-form.js  Register CTA, form validation, submission, confirmation (attaches to the panel)
  qr.js                 dependency-free QR code encoder (SVG output)
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
  dev_server.py         no-cache local server; blocks dotfiles; dev admin sign-in
                        (admin-login / admin-check / admin-logout)
  init_admin.py         initialise the dev admin: writes ADMIN_EMAIL + password hash to .env
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
