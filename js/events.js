/* =========================================================================
   EVENT CATALOGUE — the single source of truth for event data.

   ⚠ SAMPLE CONTENT: every event below is fictional demo data (names, venues,
   dates, prices). Photography: Unsplash. Do not treat as real listings.

   Storage policy:
   - The catalogue lives here, in code. It is NOT written to localStorage.
   - localStorage is reserved for per-user state in later phases
     (registrations, favourites) keyed by event `id`, so ids are stable.

   Schema (validated on load — see validate()):
     id            string   stable kebab-case key
     title         string
     category      string   one of CATEGORIES
     date          string   ISO 'YYYY-MM-DD' (local calendar date)
     time          string   'HH:MM' 24h, local to the venue
     venue         { name, city }
     image         { src, alt }   src = Unsplash base URL; size via imageUrl()
     description   string
     featured      boolean
     registration  { status: 'open' | 'limited' | 'waitlist' | 'sold-out',
                     spotsLeft?: number }
     price         { amount, currency, compareAt? }   optional
     promo         string   optional short label used by the hero app preview
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var CATEGORIES = Object.freeze(['Music', 'Conference', 'Food & Drink', 'Dance', 'Arts & Culture', 'Workshop']);
  var STATUSES = Object.freeze({
    'open':     'Registration open',
    'limited':  'Few spots left',
    'waitlist': 'Waitlist only',
    'sold-out': 'Sold out'
  });

  function unsplash(id) { return 'https://images.unsplash.com/photo-' + id; }

  var EVENTS = [
    {
      id: 'neon-pulse-live',
      title: 'Neon Pulse Live',
      category: 'Music',
      date: '2026-11-14', time: '20:00',
      venue: { name: 'Arena 9', city: 'Berlin' },
      image: { src: unsplash('1506157786151-b8491531f063'), alt: 'Concert crowd with raised hands under violet stage lights' },
      description: 'A full-scale synthwave show with a 360° light rig, live visuals and a three-act line-up that builds until midnight.',
      featured: true,
      registration: { status: 'limited', spotsLeft: 120 },
      price: { amount: 48, currency: 'USD', compareAt: 60 }
    },
    {
      id: 'future-of-ai-summit',
      title: 'Future of AI Summit',
      category: 'Conference',
      date: '2026-11-18', time: '09:00',
      venue: { name: 'Hall B', city: 'Lisbon' },
      image: { src: unsplash('1523580494863-6f3031224c94'), alt: 'Audience seated in a modern conference hall facing a stage' },
      description: 'A day of keynotes and hands-on labs with researchers and product leaders on where applied AI is heading next.',
      featured: true,
      registration: { status: 'open' },
      price: { amount: 129, currency: 'USD' }
    },
    {
      id: 'chefs-table-series',
      title: 'Chef’s Table Series',
      category: 'Food & Drink',
      date: '2026-11-22', time: '19:00',
      venue: { name: 'The Larder', city: 'London' },
      image: { src: unsplash('1414235077428-338989a2e8c0'), alt: 'Plated fine-dining course on a candlelit table' },
      description: 'Seven seasonal courses served at a single shared table, each introduced by the chef who cooked it.',
      featured: false,
      registration: { status: 'open' },
      price: { amount: 95, currency: 'USD' },
      promo: 'NEW'
    },
    {
      id: 'salsa-social-night',
      title: 'Salsa Social Night',
      category: 'Dance',
      date: '2026-11-23', time: '20:30',
      venue: { name: 'Studio 4', city: 'Madrid' },
      image: { src: unsplash('1504609813442-a8924e83f76e'), alt: 'Couples dancing together, seen from above' },
      description: 'A beginner-friendly class at 8:30, then a live band and an open floor until late. No partner needed.',
      featured: false,
      registration: { status: 'open' },
      price: { amount: 22, currency: 'USD', compareAt: 30 },
      promo: 'HOT'
    },
    {
      id: 'design-sprint-workshop',
      title: 'Design Sprint Workshop',
      category: 'Workshop',
      date: '2026-11-28', time: '10:00',
      venue: { name: 'Loft 21', city: 'Amsterdam' },
      image: { src: unsplash('1556761175-5973dc0f32e7'), alt: 'Speaker presenting to a small group in a bright loft studio' },
      description: 'Take one product idea from problem to tested prototype in a single, facilitated day. Laptops provided.',
      featured: false,
      registration: { status: 'sold-out' },
      price: { amount: 180, currency: 'USD' }
    },
    {
      id: 'jazz-nights',
      title: 'Jazz Nights: Late Session',
      category: 'Music',
      date: '2026-12-04', time: '21:00',
      venue: { name: 'Blue Room', city: 'New York' },
      image: { src: unsplash('1475721027785-f74eccf877e2'), alt: 'Vintage microphone on stage in front of a softly lit crowd' },
      description: 'An intimate trio set in a 90-seat room, followed by an open jam for anyone who brings an instrument.',
      featured: false,
      registration: { status: 'waitlist' },
      price: { amount: 35, currency: 'USD' }
    },
    {
      id: 'winter-gala-2026',
      title: 'Winter Gala 2026',
      category: 'Arts & Culture',
      date: '2026-12-12', time: '19:00',
      venue: { name: 'The Grand Atrium', city: 'Vienna' },
      image: { src: unsplash('1519671482749-fd09be7ccebf'), alt: 'Guests raising glasses in a toast at an evening reception' },
      description: 'Black-tie evening of live strings, a seated dinner and a midnight toast beneath the atrium’s glass dome.',
      featured: true,
      registration: { status: 'open' },
      price: { amount: 210, currency: 'USD' }
    },
    {
      id: 'night-of-pure-soul',
      title: 'A Night of Pure Soul',
      category: 'Music',
      date: '2027-01-16', time: '20:00',
      venue: { name: 'Riverside Hall', city: 'Dublin' },
      image: { src: unsplash('1493225457124-a3eb161ffa5f'), alt: 'Singer performing in stage haze with one hand raised' },
      description: 'One voice, one stage, one evening: a soul and gospel headline set with a twelve-piece choir.',
      featured: false,
      registration: { status: 'limited', spotsLeft: 40 },
      price: { amount: 55, currency: 'USD' }
    }
  ];

  /* ---------- Validation (developer aid) ---------- */
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  /** Returns a list of human-readable schema problems (empty = valid). */
  function validate(list) {
    var problems = [];
    var seen = {};
    list.forEach(function (e, i) {
      var where = 'event[' + i + '] ' + (e && e.id ? e.id : '?') + ': ';
      if (!e || typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) problems.push(where + 'bad id');
      else if (seen[e.id]) problems.push(where + 'duplicate id'); else seen[e.id] = true;
      if (!e.title) problems.push(where + 'missing title');
      if (CATEGORIES.indexOf(e.category) < 0) problems.push(where + 'unknown category ' + e.category);
      if (!DATE_RE.test(e.date) || isNaN(parseDate(e.date))) problems.push(where + 'bad date');
      if (!TIME_RE.test(e.time)) problems.push(where + 'bad time');
      if (!e.venue || !e.venue.name || !e.venue.city) problems.push(where + 'bad venue');
      if (!e.image || !e.image.src || !e.image.alt) problems.push(where + 'image needs src and alt');
      if (!e.description) problems.push(where + 'missing description');
      if (typeof e.featured !== 'boolean') problems.push(where + 'featured must be boolean');
      if (!e.registration || !STATUSES[e.registration.status]) problems.push(where + 'bad registration status');
    });
    return problems;
  }

  /* ---------- Date helpers ----------
     Dates are calendar dates, so they are built in LOCAL time. Parsing the
     ISO string directly (new Date('2026-11-14')) would read it as UTC
     midnight and show the previous day for visitors west of Greenwich. */
  function parseDate(iso) {
    var p = String(iso).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]).getTime();
  }
  function startOf(e) {
    var d = String(e.date).split('-').map(Number), t = String(e.time).split(':').map(Number);
    return new Date(d[0], d[1] - 1, d[2], t[0], t[1]);
  }

  var fmtDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  var fmtDayYear = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  var fmtTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  var fmtMonth = new Intl.DateTimeFormat('en-GB', { month: 'short' });
  var fmtWeekday = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });

  function byDate(a, b) { return startOf(a) - startOf(b); }

  var problems = validate(EVENTS);
  if (problems.length) console.warn('[Eventora] event catalogue problems:\n' + problems.join('\n'));

  // Deep-freeze so no module can mutate the shared catalogue at runtime.
  EVENTS.forEach(function (e) {
    Object.keys(e).forEach(function (k) { if (e[k] && typeof e[k] === 'object') Object.freeze(e[k]); });
    Object.freeze(e);
  });
  Object.freeze(EVENTS);

  Eventora.events = {
    isSample: true,
    categories: CATEGORIES,
    statuses: STATUSES,

    /** Every event, in catalogue order. */
    all: function () { return EVENTS.slice(); },
    byId: function (id) { return EVENTS.filter(function (e) { return e.id === id; })[0] || null; },
    /** Featured events, soonest first. */
    featured: function () { return EVENTS.filter(function (e) { return e.featured; }).sort(byDate); },
    /** The rest of the programme (non-featured), soonest first. */
    upcoming: function () { return EVENTS.filter(function (e) { return !e.featured; }).sort(byDate); },

    validate: function () { return validate(EVENTS); },
    startOf: startOf,

    /** 'Sat 14 Nov' (withYear: 'Sat 14 Nov 2026'). Built from parts so the
        format is identical with and without the year (en-GB would insert a
        comma after the weekday only when the year is present). */
    dateLabel: function (e, withYear) {
      var parts = {};
      (withYear ? fmtDayYear : fmtDay).formatToParts(startOf(e)).forEach(function (p) { parts[p.type] = p.value; });
      return [parts.weekday, parts.day, parts.month, withYear ? parts.year : null].filter(Boolean).join(' ');
    },
    /** '8:00 PM' */
    timeLabel: function (e) { return fmtTime.format(startOf(e)); },
    /** Machine-readable value for <time datetime>. */
    datetime: function (e) { return e.date + 'T' + e.time; },
    /** Parts for a calendar tile: { day: '14', month: 'Nov', weekday: 'Sat' }. */
    dateParts: function (e) {
      var d = startOf(e);
      return { day: String(d.getDate()), month: fmtMonth.format(d), weekday: fmtWeekday.format(d) };
    },
    statusLabel: function (e) {
      var r = e.registration;
      if (r.status === 'limited' && r.spotsLeft) return r.spotsLeft + ' spots left';
      return STATUSES[r.status];
    },
    /** '$48' — whole-dollar demo prices. */
    priceLabel: function (e) {
      if (!e.price) return '';
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: e.price.currency, maximumFractionDigits: 0 })
        .format(e.price.amount);
    },
    /** Sized, compressed Unsplash URL for the event photo. */
    imageUrl: function (e, w, h) {
      return e.image.src + '?auto=format&fit=crop&w=' + w + '&h=' + h + '&q=72';
    }
  };
})(window.Eventora);
