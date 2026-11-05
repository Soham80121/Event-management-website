/* =========================================================================
   EVENT CARDS — one reusable renderer for every event listing.

     Eventora.eventCards.create(event, { variant, lead, headingLevel })
       variant 'feature' : image-led card (Featured section)
       variant 'row'     : agenda row with a calendar tile (Upcoming section)
     Eventora.eventCards.mount()  fills #featuredEvents and #upcomingEvents

   Built with DOM APIs (textContent only), never by concatenating data into
   HTML. Cards are informational: no links or buttons until detail pages and
   registration exist (later phases), so they are not focusable.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;

  /* Decorative inline icons (static strings — no data inside). */
  var ICONS = {
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3.2 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8L12 3.2Z"/></svg>'
  };

  /* Image sizes per variant: [width, height] pairs for srcset. */
  var SIZES = {
    lead:    { set: [[720, 450], [1200, 750]], sizes: '(min-width: 1081px) 640px, (min-width: 701px) 50vw, 100vw' },
    feature: { set: [[560, 350], [960, 600]],  sizes: '(min-width: 1081px) 220px, (min-width: 701px) 50vw, 100vw' },
    row:     { set: [[320, 240], [640, 480]],  sizes: '(min-width: 701px) 200px, 100vw' }
  };

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function icon(name) {
    var wrap = el('span', 'event-card__icon');
    wrap.innerHTML = ICONS[name];
    return wrap;
  }

  /* Photo with srcset, fixed aspect (no layout shift), lazy below the fold,
     and a graceful fallback: on error the <img> is removed and the media box
     shows its gradient + category label instead of a broken-image icon. */
  function media(e, sizeKey, eager) {
    var box = el('div', 'event-card__media');
    box.setAttribute('data-fallback', e.category);
    var spec = SIZES[sizeKey];
    var img = new Image();
    img.alt = e.image.alt;
    img.decoding = 'async';
    img.loading = eager ? 'eager' : 'lazy';
    img.width = spec.set[0][0];
    img.height = spec.set[0][1];
    img.sizes = spec.sizes;
    img.srcset = spec.set.map(function (s) { return cat.imageUrl(e, s[0], s[1]) + ' ' + s[0] + 'w'; }).join(', ');
    img.src = cat.imageUrl(e, spec.set[0][0], spec.set[0][1]);
    img.addEventListener('error', function () {
      box.classList.add('is-broken');
      img.remove();
    });
    box.appendChild(img);
    if (e.featured) {
      var badge = el('span', 'event-card__badge');
      badge.appendChild(icon('star'));
      badge.appendChild(document.createTextNode('Featured'));
      box.appendChild(badge);
    }
    return box;
  }

  function whenLine(e, withYear) {
    var p = el('p', 'event-card__line');
    p.appendChild(icon('calendar'));
    var t = el('time', '', cat.dateLabel(e, withYear) + ' · ' + cat.timeLabel(e));
    t.setAttribute('datetime', cat.datetime(e));
    p.appendChild(t);
    return p;
  }

  function whereLine(e) {
    var p = el('p', 'event-card__line');
    p.appendChild(icon('pin'));
    p.appendChild(el('span', '', e.venue.name + ', ' + e.venue.city));
    return p;
  }

  function status(e) {
    var s = el('p', 'status status--' + e.registration.status);
    s.appendChild(el('span', 'status__dot'));
    s.lastChild.setAttribute('aria-hidden', 'true');
    s.appendChild(document.createTextNode(cat.statusLabel(e)));
    return s;
  }

  function price(e) {
    if (!e.price) return null;
    var p = el('p', 'event-card__price');
    p.appendChild(el('span', 'visually-hidden', 'Price from '));
    p.appendChild(document.createTextNode(cat.priceLabel(e)));
    if (e.price.compareAt) {
      var was = el('s', 'event-card__was');
      was.appendChild(el('span', 'visually-hidden', ', was '));
      was.appendChild(document.createTextNode(cat.priceLabel({ price: { amount: e.price.compareAt, currency: e.price.currency } })));
      p.appendChild(was);
    }
    return p;
  }

  /* Calendar tile for agenda rows. Decorative: the full date is also in the
     row's <time>, so screen readers hear it once. */
  function dateTile(e) {
    var parts = cat.dateParts(e);
    var tile = el('div', 'date-tile');
    tile.setAttribute('aria-hidden', 'true');
    tile.appendChild(el('span', 'date-tile__month', parts.month));
    tile.appendChild(el('span', 'date-tile__day', parts.day));
    tile.appendChild(el('span', 'date-tile__weekday', parts.weekday));
    return tile;
  }

  /**
   * Builds one event card.
   * @param {object} e  catalogue event
   * @param {{variant?: 'feature'|'row', lead?: boolean, headingLevel?: number, eager?: boolean}} opts
   * @returns {HTMLElement} <article>
   */
  function create(e, opts) {
    opts = opts || {};
    var variant = opts.variant || 'feature';
    var level = Math.min(6, Math.max(2, opts.headingLevel || 3));
    var titleId = 'event-' + e.id + '-title';

    var card = el('article', 'event-card event-card--' + variant + (opts.lead ? ' event-card--lead' : ''));
    card.setAttribute('aria-labelledby', titleId);
    card.setAttribute('data-event-id', e.id);
    card.setAttribute('data-category', e.category);
    card.setAttribute('data-status', e.registration.status);

    if (variant === 'row') card.appendChild(dateTile(e));
    card.appendChild(media(e, variant === 'row' ? 'row' : (opts.lead ? 'lead' : 'feature'), opts.eager));

    var body = el('div', 'event-card__body');
    body.appendChild(el('p', 'event-card__category', e.category));
    var h = el('h' + level, 'event-card__title', e.title);
    h.id = titleId;
    body.appendChild(h);
    var meta = el('div', 'event-card__meta');
    meta.appendChild(whenLine(e, true));
    meta.appendChild(whereLine(e));
    body.appendChild(meta);
    body.appendChild(el('p', 'event-card__desc', e.description));
    card.appendChild(body);

    var foot = el('div', 'event-card__foot');
    foot.appendChild(status(e));
    var pr = price(e);
    if (pr) foot.appendChild(pr);
    card.appendChild(foot);

    return card;
  }

  /** Renders a list of events into a <ul>, one <li> per card. */
  function renderList(listEl, events, opts) {
    if (!listEl) return 0;
    var frag = document.createDocumentFragment();
    events.forEach(function (e, i) {
      var li = el('li', 'event-grid__item');
      li.appendChild(create(e, {
        variant: opts.variant,
        lead: opts.leadFirst && i === 0,
        headingLevel: 3
      }));
      frag.appendChild(li);
    });
    listEl.textContent = '';
    listEl.appendChild(frag);
    listEl.removeAttribute('aria-busy');
    return events.length;
  }

  Eventora.eventCards = {
    create: create,
    renderList: renderList,
    mount: function () {
      if (!cat) return;
      renderList(document.getElementById('featuredEvents'), cat.featured(), { variant: 'feature', leadFirst: true });
      renderList(document.getElementById('upcomingEvents'), cat.upcoming(), { variant: 'row' });
    }
  };
})(window.Eventora);
