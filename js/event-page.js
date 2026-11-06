/* =========================================================================
   EVENT DETAILS PAGE — renders event.html?id=<event id> from the catalogue
   (js/events.js). One template serves every event; an unknown or missing id
   shows a friendly "not found" state instead of an empty page.
   Built with DOM APIs (textContent only).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function fact(dl, label, valueNode) {
    dl.appendChild(el('dt', '', label));
    var dd = el('dd');
    dd.appendChild(valueNode);
    dl.appendChild(dd);
  }

  function statusChip(e) {
    var s = el('p', 'status status--' + e.registration.status);
    var dot = el('span', 'status__dot');
    dot.setAttribute('aria-hidden', 'true');
    s.appendChild(dot);
    s.appendChild(document.createTextNode(cat.statusLabel(e)));
    return s;
  }

  function renderEvent(root, e) {
    document.title = e.title + ' — EVENTORA';
    var desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', e.description);

    var grid = el('div', 'event-detail__grid');

    // Photo (graceful fallback: gradient + category label if it fails)
    var fig = el('figure', 'event-detail__media');
    fig.setAttribute('data-fallback', e.category);
    var img = new Image();
    img.alt = e.image.alt;
    img.decoding = 'async';
    img.width = 1200; img.height = 800;
    img.sizes = '(min-width: 900px) 55vw, 100vw';
    img.srcset = cat.imageUrl(e, 800, 534) + ' 800w, ' + cat.imageUrl(e, 1400, 934) + ' 1400w';
    img.src = cat.imageUrl(e, 1200, 800);
    img.addEventListener('error', function () { fig.classList.add('is-broken'); img.remove(); });
    fig.appendChild(img);
    if (e.featured) fig.appendChild(el('span', 'event-card__badge', 'Featured'));
    grid.appendChild(fig);

    // Information column
    var info = el('div', 'event-detail__info');
    info.appendChild(el('p', 'eyebrow', e.category));
    var h1 = el('h1', 'heading-1 event-detail__title', e.title);
    h1.id = 'event-title';
    info.appendChild(h1);
    info.appendChild(statusChip(e));

    var dl = el('dl', 'event-detail__facts');
    var date = el('time', '', cat.dateLabel(e, true));
    date.setAttribute('datetime', e.date);
    fact(dl, 'Date', date);
    var time = el('time', '', cat.timeLabel(e));
    time.setAttribute('datetime', cat.datetime(e));
    fact(dl, 'Time', time);
    fact(dl, 'Venue', document.createTextNode(e.venue.name + ', ' + e.venue.city));
    if (e.price) {
      var price = el('span', '', cat.priceLabel(e));
      if (e.price.compareAt) {
        var was = el('s', 'event-card__was');
        was.appendChild(el('span', 'visually-hidden', 'was '));
        was.appendChild(document.createTextNode(cat.priceLabel({ price: { amount: e.price.compareAt, currency: e.price.currency } })));
        price.appendChild(document.createTextNode(' '));
        price.appendChild(was);
      }
      fact(dl, 'Price', price);
    }
    info.appendChild(dl);

    info.appendChild(el('p', 'lead event-detail__desc', e.description));
    var slot = el('div', 'register-cta');   // filled by js/registration-form.js
    slot.id = 'registerCta';
    info.appendChild(slot);
    if (cat.isSample) info.appendChild(el('p', 'demo-note', 'Sample event · demo data'));

    grid.appendChild(info);
    root.appendChild(grid);
    root.setAttribute('aria-labelledby', 'event-title');
  }

  function renderNotFound(root) {
    document.title = 'Event not found — EVENTORA';
    var box = el('div', 'event-detail__missing');
    box.appendChild(el('p', 'eyebrow', 'Event not found'));
    var h1 = el('h1', 'heading-1', 'We couldn’t find that event');
    h1.id = 'event-title';
    box.appendChild(h1);
    box.appendChild(el('p', 'lead', 'The link may be out of date, or the event is no longer listed.'));
    var back = el('a', 'btn btn--lg', null);
    back.href = 'index.html#featured';
    back.appendChild(el('span', '', 'Explore Events'));
    box.appendChild(back);
    root.appendChild(box);
    root.setAttribute('aria-labelledby', 'event-title');
  }

  Eventora.eventPage = {
    current: null,   // the rendered event, for js/registration-form.js
    init: function () {
      var root = document.getElementById('eventDetail');
      if (!root || !cat) return;
      var id = new URLSearchParams(location.search).get('id');
      var e = id ? cat.byId(id) : null;
      root.textContent = '';
      if (e) renderEvent(root, e); else renderNotFound(root);
      this.current = e || null;
      root.removeAttribute('aria-busy');
    }
  };
})(window.Eventora);
