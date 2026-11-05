/* =========================================================================
   EVENTORA — static content for the hero showcase.
   Creates the single app namespace `window.Eventora`; every other module
   attaches to it instead of adding globals.
   ========================================================================= */
(function () {
  'use strict';

  var Eventora = window.Eventora = window.Eventora || {};

  /** Builds a sized, compressed Unsplash photo URL. */
  function photo(id, w, h) {
    return 'https://images.unsplash.com/photo-' + id +
      '?auto=format&fit=crop&w=' + w + '&h=' + h + '&q=72';
  }

  /* Posters on the 3D ring cycle through these ten creatives (card i uses
     POSTERS[i % 10]). `v` selects the layout in js/carousel.js. Card faces are
     130x300 design px, rendered up to ~2x, so 300x690 source is plenty. */
  var POSTER_W = 300, POSTER_H = 690;
  var POSTERS = [
    { v: 'ticket',   url: photo('1464375117522-1311d6a5b81f', POSTER_W, 420) },
    { v: 'gala',     url: photo('1519671482749-fd09be7ccebf', POSTER_W, 460) },
    { v: 'workshop', url: photo('1556761175-5973dc0f32e7', POSTER_W, 340) },
    { v: 'summit',   url: photo('1540575467063-178a50c2df87', POSTER_W, 480) },
    { v: 'fest',     url: photo('1496024840928-4c417adf211d', POSTER_W, 360) },
    { v: 'plain', t: 'JAZZ NIGHTS',  url: photo('1475721027785-f74eccf877e2', POSTER_W, POSTER_H) },
    { v: 'stage',    url: photo('1493225457124-a3eb161ffa5f', POSTER_W, POSTER_H) },
    { v: 'plain', t: 'FOOD & WINE',  url: photo('1517457373958-b7bdd4587205', POSTER_W, POSTER_H) },
    { v: 'early',    url: photo('1514525253161-7a46d19cd819', POSTER_W, POSTER_H) },
    { v: 'plain', t: 'TECH SUMMIT',  url: photo('1531058020387-3be344556be6', POSTER_W, POSTER_H) }
  ];

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
    events: [
      { tag: '-20%',  name: 'Neon Pulse Live',      meta: 'Fri 14 Nov · Arena 9',     price: '$ 48.00', was: '$ 60.00',
        url: photo('1506157786151-b8491531f063', 400, 416), alt: 'Concert crowd under violet stage lights' },
      { tag: '',      name: 'Future of AI Summit',  meta: 'Tue 18 Nov · Hall B',      price: '$ 129.00', was: '',
        url: photo('1523580494863-6f3031224c94', 400, 416), alt: 'Audience seated in a modern conference hall' },
      { tag: 'NEW',   name: 'Chef’s Table Series',  meta: 'Sat 22 Nov · 7 courses',   price: '$ 95.00', was: '',
        url: photo('1414235077428-338989a2e8c0', 400, 416), alt: 'Plated fine-dining course on a candlelit table' },
      { tag: 'HOT',   name: 'Salsa Social Night',   meta: 'Sun 23 Nov · Studio 4',    price: '$ 22.00', was: '$ 30.00',
        url: photo('1504609813442-a8924e83f76e', 400, 416), alt: 'Couples dancing seen from above' }
    ],
    perks: ['Instant e-tickets', 'Secure checkout', 'Free cancellation', 'Verified organizers']
  };

  Eventora.data = { posters: POSTERS, mock: MOCK };
})();
