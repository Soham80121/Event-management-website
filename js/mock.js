/* =========================================================================
   APP PREVIEW — renders the event-discovery front inside the browser mock
   from Eventora.data.mock, using DOM APIs (no HTML string injection).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function guardedImage(src, alt, onFail) {
    var img = new Image();
    img.alt = alt;
    img.decoding = 'async';
    img.addEventListener('error', onFail);
    img.src = src;
    return img;
  }

  function renderHero(hero) {
    var box = el('div', 'pghero');
    box.appendChild(guardedImage(hero.url, hero.alt, function () { this.remove(); }));
    box.appendChild(el('div', 'scrim'));
    var copy = el('div', 'copy');
    copy.appendChild(el('u', '', hero.kicker));
    var title = el('em');
    // title holds one controlled <br> from our own data file
    hero.title.split('<br>').forEach(function (line, i) {
      if (i) title.appendChild(document.createElement('br'));
      title.appendChild(document.createTextNode(line));
    });
    copy.appendChild(title);
    copy.appendChild(el('i', '', hero.cta));
    box.appendChild(copy);
    return box;
  }

  function renderEvent(ev) {
    var card = el('div', 'pgcard');
    var ph = el('div', 'ph');
    ph.appendChild(guardedImage(ev.url, ev.alt, function () { ph.classList.add('broken'); }));
    if (ev.tag) ph.appendChild(el('span', 'tag', ev.tag));
    card.appendChild(ph);
    card.appendChild(el('b', '', ev.name));
    card.appendChild(el('i', '', ev.meta));
    var price = el('s', '', ev.price + ' ');
    if (ev.was) price.appendChild(el('span', '', ev.was));
    card.appendChild(price);
    return card;
  }

  Eventora.mock = {
    init: function () {
      var body = document.getElementById('mockBody');
      var data = Eventora.data && Eventora.data.mock;
      if (!body || !data) return;

      var frag = document.createDocumentFragment();
      frag.appendChild(renderHero(data.hero));

      var sec = el('div', 'pgsec');
      sec.appendChild(el('b', '', data.sectionTitle));
      sec.appendChild(el('u', '', data.sectionLink));
      frag.appendChild(sec);

      var grid = el('div', 'pggrid');
      data.events.forEach(function (ev) { grid.appendChild(renderEvent(ev)); });
      frag.appendChild(grid);

      var strip = el('div', 'pgstrip');
      data.perks.forEach(function (p) { strip.appendChild(el('span', '', p)); });
      frag.appendChild(strip);

      body.appendChild(frag);
    }
  };
})(window.Eventora);
