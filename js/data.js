/* =========================================================================
   EVENTORA — presentation content for the hero showcase (ring posters and
   the app preview). Event facts — titles, dates, venues, photos, prices —
   come from the catalogue in js/events.js; nothing here duplicates them.
   Requires js/core.js and js/events.js.
   ========================================================================= */
(function () {
  'use strict';

  var Eventora = window.Eventora;
  var catalogue = Eventora.events;

  /** Builds a sized, compressed Unsplash photo URL. */
  function photo(id, w, h) {
    return 'https://images.unsplash.com/photo-' + id +
      '?auto=format&fit=crop&w=' + w + '&h=' + h + '&q=72';
  }

  /* Posters on the 3D ring cycle through these ten creatives (card i uses
     POSTERS[i % 10]). `v` selects the layout in js/carousel.js. Card faces are
     130x300 design px, rendered up to ~2x, so 300x690 source is plenty.
     Posters that advertise a catalogue event take its photo from the
     catalogue (same Unsplash image and size, so they render identically);
     the rest are pure mood artwork. */
  var POSTER_W = 300, POSTER_H = 690;
  function eventPhoto(id, h) { return catalogue.imageUrl(catalogue.byId(id), POSTER_W, h); }

  var POSTERS = [
    { v: 'ticket',   url: photo('1464375117522-1311d6a5b81f', POSTER_W, 420) },
    { v: 'gala',     url: eventPhoto('winter-gala-2026', 460) },
    { v: 'workshop', url: eventPhoto('design-sprint-workshop', 340) },
    { v: 'summit',   url: photo('1540575467063-178a50c2df87', POSTER_W, 480) },
    { v: 'fest',     url: photo('1496024840928-4c417adf211d', POSTER_W, 360) },
    { v: 'plain', t: 'JAZZ NIGHTS',  url: eventPhoto('jazz-nights', POSTER_H) },
    { v: 'stage',    url: eventPhoto('night-of-pure-soul', POSTER_H) },
    { v: 'plain', t: 'FOOD & WINE',  url: photo('1517457373958-b7bdd4587205', POSTER_W, POSTER_H) },
    { v: 'early',    url: photo('1514525253161-7a46d19cd819', POSTER_W, POSTER_H) },
    { v: 'plain', t: 'TECH SUMMIT',  url: photo('1531058020387-3be344556be6', POSTER_W, POSTER_H) }
  ];

  /* The app preview's "Trending near you" cards are built from catalogue
     events, so their dates and weekdays can never drift from the data. */
  function money(n) { return '$ ' + n.toFixed(2); }
  function previewCard(id) {
    var e = catalogue.byId(id);
    var p = e.price;
    var tag = e.promo || (p && p.compareAt ? '-' + Math.round((1 - p.amount / p.compareAt) * 100) + '%' : '');
    return {
      tag: tag,
      name: e.title,
      meta: catalogue.dateLabel(e) + ' · ' + e.venue.name,
      price: p ? money(p.amount) : '',
      was: p && p.compareAt ? money(p.compareAt) : '',
      url: catalogue.imageUrl(e, 400, 416),
      alt: e.image.alt
    };
  }

  /* The app preview inside the browser mock. */
  var MOCK = {
    hero: {
      url: photo('1524368535928-5b5e00ddc76b', 1400, 600),
      alt: 'Crowd with raised hands in front of a stage washed in warm amber light',
      kicker: 'This weekend',
      title: 'Feel the music<br>come alive.',
      cta: 'GET TICKETS'
    },
    sectionTitle: 'Trending near you',
    sectionLink: 'see all',
    events: ['neon-pulse-live', 'future-of-ai-summit', 'chefs-table-series', 'salsa-social-night'].map(previewCard),
    perks: ['Instant e-tickets', 'Secure checkout', 'Free cancellation', 'Verified organizers']
  };

  Eventora.data = { posters: POSTERS, mock: MOCK };
})();
