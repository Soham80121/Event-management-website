/* =========================================================================
   STYLEGUIDE — renders live token values on styleguide.html so the page can
   never drift from css/tokens.css. Not loaded by index.html.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var root = getComputedStyle(document.documentElement);
  var dom = Eventora.dom;

  function token(name) { return root.getPropertyValue(name).trim(); }

  function names(el, attr) { return el.getAttribute(attr).split(/\s+/).filter(Boolean); }

  function make(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function renderSwatches() {
    dom.all('[data-swatches]').forEach(function (box) {
      names(box, 'data-swatches').forEach(function (name) {
        var card = make('div', 'sg-swatch');
        var chip = make('i');
        chip.style.background = 'var(' + name + ')';
        card.appendChild(chip);
        card.appendChild(make('b', '', name));
        card.appendChild(make('span', '', token(name)));
        box.appendChild(card);
      });
    });
  }

  function renderSpaces() {
    dom.all('[data-spaces]').forEach(function (box) {
      names(box, 'data-spaces').forEach(function (name) {
        var row = make('div', 'sg-space');
        row.appendChild(make('span', '', name + ' · ' + token(name)));
        var bar = make('i');
        bar.style.width = 'var(' + name + ')';
        row.appendChild(bar);
        box.appendChild(row);
      });
    });
    dom.all('[data-radii]').forEach(function (box) {
      names(box, 'data-radii').forEach(function (name) {
        var cell = make('div', 'sg-radius');
        var shape = make('i');
        shape.style.borderRadius = 'var(' + name + ')';
        cell.appendChild(shape);
        cell.appendChild(document.createTextNode(name + ' · ' + token(name)));
        box.appendChild(cell);
      });
    });
  }

  /* Confirms every face the design depends on actually loaded. */
  function renderFontCheck() {
    var list = dom.byId('sgWeights');
    if (!list || !document.fonts) return;
    var faces = [400, 500, 600, 700, 800, 900].map(function (w) { return { label: 'Poppins ' + w, css: w + ' 16px Poppins' }; })
      .concat([{ label: 'Playfair 600', css: '600 16px "Playfair Display"' },
               { label: 'Playfair 600 italic', css: 'italic 600 16px "Playfair Display"' }]);
    document.fonts.ready.then(function () {
      return Promise.all(faces.map(function (f) { return document.fonts.load(f.css); }));
    }).then(function () {
      faces.forEach(function (f) {
        var ok = document.fonts.check(f.css);
        var li = make('li', '', (ok ? '✓ ' : '✗ ') + f.label);
        li.setAttribute('data-ok', String(ok));
        list.appendChild(li);
      });
    });
  }

  function renderMotion() {
    var dl = dom.byId('sgMotion');
    if (!dl) return;
    var rows = [
      ['--ease-expo', 'entrances'], ['--ease-soft', 'follow-throughs'], ['--ease-std', 'state changes'],
      ['--dur-instant', ''], ['--dur-fast', ''], ['--dur-base', 'hover'], ['--dur-slow', 'menus'],
      ['prefers-reduced-motion', Eventora.motion.reduced() ? 'reduce — motion disabled' : 'no-preference']
    ];
    rows.forEach(function (r) {
      dl.appendChild(make('dt', '', r[0]));
      var v = r[0].indexOf('--') === 0 ? token(r[0]) : '';
      dl.appendChild(make('dd', '', [v, r[1]].filter(Boolean).join(' — ')));
    });
  }

  Eventora.starfield.init();
  renderSwatches();
  renderSpaces();
  renderFontCheck();
  renderMotion();
})(window.Eventora);
