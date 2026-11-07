/* =========================================================================
   EVENT FILTERS — live search, category filter and sorting for the Upcoming
   programme, plus the category cards in the Categories section.

   One state object drives everything:
     { query: '', category: 'all', sort: 'date-asc' }
   Search, category and sort combine (search ∧ category, then sorted).
   Every control writes to the state and calls apply(), which re-renders the
   list with the shared card renderer (so card interactions and detail links
   are untouched) and syncs every control, the count and the empty state.

   Data comes only from js/events.js. Nothing is stored (no localStorage).
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var cat = Eventora.events;
  var DEFAULTS = Object.freeze({ query: '', category: 'all', sort: 'date-asc' });
  var SORTS = {
    'date-asc':  function (a, b) { return cat.startOf(a) - cat.startOf(b); },
    'date-desc': function (a, b) { return cat.startOf(b) - cat.startOf(a); },
    'title':     function (a, b) { return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }); }
  };

  var state = { query: DEFAULTS.query, category: DEFAULTS.category, sort: DEFAULTS.sort };
  var els = {};
  var index = [];          // [{ event, text }] — searchable text per event, built once

  /* ---------- Search ---------- */

  /** Lower-case, accent-free, punctuation-tolerant text for matching. */
  function normalize(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e
      .toLowerCase()
      .replace(/[’'`]/g, '')                             // chef’s → chefs
      .replace(/[^a-z0-9&]+/g, ' ')
      .trim();
  }

  function buildIndex() {
    index = cat.all().map(function (e) {
      return {
        event: e,
        // the four searchable fields: title, category, venue (name + city), description
        text: ' ' + normalize([e.title, e.category, e.venue.name, e.venue.city, e.description].join(' ')) + ' '
      };
    });
  }

  /** Every typed word must appear somewhere in the event's searchable text. */
  function matchesQuery(entry, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      if (entry.text.indexOf(tokens[i]) < 0) return false;
    }
    return true;
  }

  function results() {
    var tokens = normalize(state.query).split(' ').filter(Boolean);
    return index
      .filter(function (x) { return state.category === 'all' || x.event.category === state.category; })
      .filter(function (x) { return !tokens.length || matchesQuery(x, tokens); })
      .map(function (x) { return x.event; })
      .sort(SORTS[state.sort] || SORTS['date-asc']);
  }

  /* ---------- Categories (derived from the catalogue) ---------- */

  function categoryStats() {
    var all = cat.all();
    return cat.categories
      .map(function (name) {
        var list = all.filter(function (e) { return e.category === name; }).sort(SORTS['date-asc']);
        return { name: name, count: list.length, next: list[0] || null };
      })
      .filter(function (c) { return c.count > 0; });
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* Filter chips above the Upcoming list (single-select toggle group). */
  function renderChips(stats) {
    var box = els.chips;
    if (!box) return;
    box.textContent = '';
    [{ name: 'all', label: 'All events', count: index.length }]
      .concat(stats.map(function (c) { return { name: c.name, label: c.name, count: c.count }; }))
      .forEach(function (c) {
        var b = el('button', 'chip');
        b.type = 'button';
        b.setAttribute('data-category', c.name);
        b.setAttribute('aria-pressed', 'false');
        b.appendChild(el('span', 'chip__label', c.label));
        b.appendChild(el('span', 'chip__count', String(c.count)));
        b.lastChild.setAttribute('aria-label', plural(c.count, 'event'));
        box.appendChild(b);
      });
  }

  /* Category cards in the Categories section: photo of the soonest event in
     the category, its name, count and next date. Selecting one filters the
     Upcoming programme and takes the visitor there. */
  function renderCategoryCards(stats) {
    var grid = els.categoryGrid;
    if (!grid) return;
    grid.textContent = '';
    var all = cat.all().sort(SORTS['date-asc']);
    var items = [{ name: 'all', label: 'All events', count: all.length, next: all[0] }]
      .concat(stats.map(function (c) { return { name: c.name, label: c.name, count: c.count, next: c.next }; }));

    items.forEach(function (c) {
      var li = el('li', 'category-grid__item');
      var b = el('button', 'category-card');
      b.type = 'button';
      b.setAttribute('data-category', c.name);
      b.setAttribute('aria-pressed', 'false');

      var media = el('span', 'category-card__media');
      media.setAttribute('aria-hidden', 'true');
      if (c.next) {
        var img = new Image();
        img.alt = '';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.width = 480; img.height = 320;
        img.src = cat.imageUrl(c.next, 480, 320);
        img.addEventListener('error', function () { img.remove(); });
        media.appendChild(img);
      }
      b.appendChild(media);

      var text = el('span', 'category-card__text');
      text.appendChild(el('span', 'category-card__name', c.label));
      text.appendChild(el('span', 'category-card__count', plural(c.count, 'event')));
      if (c.next) text.appendChild(el('span', 'category-card__next', 'Next: ' + cat.dateLabel(c.next)));
      b.appendChild(text);

      li.appendChild(b);
      grid.appendChild(li);
    });
    grid.removeAttribute('aria-busy');
  }

  /* ---------- Rendering + sync ---------- */

  function describeFilters() {
    var parts = [];
    if (state.query.trim()) parts.push('matching “' + state.query.trim() + '”');
    if (state.category !== 'all') parts.push('in ' + state.category);
    return parts.join(' ');
  }

  function syncControls() {
    var q = state.query;
    if (els.search && els.search.value !== q) els.search.value = q;
    if (els.clear) els.clear.hidden = !q;
    if (els.sort && els.sort.value !== state.sort) els.sort.value = state.sort;
    var isDefault = q === DEFAULTS.query && state.category === DEFAULTS.category && state.sort === DEFAULTS.sort;
    if (els.reset) els.reset.disabled = isDefault;

    [els.chips, els.categoryGrid].forEach(function (group) {
      if (!group) return;
      Array.prototype.forEach.call(group.querySelectorAll('[data-category]'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-category') === state.category));
      });
    });
  }

  function renderEmpty(show) {
    var box = els.empty;
    if (!box) return;
    box.hidden = !show;
    if (!show) return;
    var detail = describeFilters();
    els.emptyText.textContent = detail
      ? 'Nothing in the programme ' + detail + '. Try another word, a different category, or start again.'
      : 'Try another word, a different category, or start again.';
    // offer only the actions that would actually widen the results
    els.emptyClearSearch.hidden = !state.query.trim();
    els.emptyAllCategories.hidden = state.category === 'all';
  }

  function apply() {
    var list = results();
    Eventora.eventCards.renderList(els.list, list, { variant: 'row' });
    els.list.hidden = list.length === 0;

    var total = index.length;
    var detail = describeFilters();
    els.count.textContent = list.length === total && !detail
      ? 'Showing all ' + plural(total, 'event')
      : 'Showing ' + list.length + ' of ' + plural(total, 'event') + (detail ? ' ' + detail : '');

    renderEmpty(list.length === 0);
    syncControls();
    return list;
  }

  function set(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    return apply();
  }

  function reset() { return set({ query: DEFAULTS.query, category: DEFAULTS.category, sort: DEFAULTS.sort }); }

  /* Category card → filter, then bring the visitor to the results. Focus
     moves to the Upcoming section so keyboard and screen-reader users land
     on the filtered list too (CSS handles smooth vs reduced-motion scroll). */
  function showResults() {
    var section = document.getElementById('upcoming');
    if (!section) return;
    section.scrollIntoView({ block: 'start' });
    section.focus({ preventScroll: true });
  }

  /* ---------- Wiring ---------- */

  function bind() {
    els.search.addEventListener('input', function () { set({ query: els.search.value }); });
    els.search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.search.value) { e.preventDefault(); set({ query: '' }); }
    });
    els.clear.addEventListener('click', function () { set({ query: '' }); els.search.focus(); });
    els.sort.addEventListener('change', function () { set({ sort: els.sort.value }); });
    els.reset.addEventListener('click', function () { reset(); els.search.focus(); });

    els.chips.addEventListener('click', function (e) {
      var b = e.target.closest('[data-category]');
      if (b) set({ category: b.getAttribute('data-category') });
    });
    if (els.categoryGrid) {
      els.categoryGrid.addEventListener('click', function (e) {
        var b = e.target.closest('[data-category]');
        if (!b) return;
        set({ category: b.getAttribute('data-category') });
        showResults();
      });
    }

    els.emptyClearSearch.addEventListener('click', function () { set({ query: '' }); els.search.focus(); });
    els.emptyAllCategories.addEventListener('click', function () { set({ category: 'all' }); els.search.focus(); });
    els.emptyReset.addEventListener('click', function () { reset(); els.search.focus(); });
  }

  Eventora.eventFilters = {
    init: function () {
      els.list = document.getElementById('upcomingEvents');
      els.search = document.getElementById('eventSearch');
      els.clear = document.getElementById('searchClear');
      els.sort = document.getElementById('eventSort');
      els.reset = document.getElementById('filtersReset');
      els.chips = document.getElementById('categoryChips');
      els.count = document.getElementById('resultsCount');
      els.empty = document.getElementById('eventsEmpty');
      els.emptyText = document.getElementById('eventsEmptyText');
      els.emptyClearSearch = document.getElementById('emptyClearSearch');
      els.emptyAllCategories = document.getElementById('emptyAllCategories');
      els.emptyReset = document.getElementById('emptyReset');
      els.categoryGrid = document.getElementById('categoryGrid');
      if (!cat || !els.list || !els.search || !Eventora.eventCards) return;

      buildIndex();
      var stats = categoryStats();
      renderChips(stats);
      renderCategoryCards(stats);
      bind();
      apply();
    },
    /** Rebuild from the current catalogue (published events changed); keeps search, category and sort. */
    refresh: function () {
      if (!cat || !els.list || !els.search || !Eventora.eventCards) return;
      buildIndex();
      var stats = categoryStats();
      renderChips(stats);
      renderCategoryCards(stats);
      apply();
    },
    // exposed for tests and future phases
    state: function () { return { query: state.query, category: state.category, sort: state.sort }; },
    set: set,
    reset: reset,
    results: results,
    normalize: normalize
  };
})(window.Eventora);
