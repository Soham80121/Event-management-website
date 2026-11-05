/* =========================================================================
   SECTIONS — in-page navigation for the scrolling home page.
   - Jump links: the browser does the (CSS smooth / reduced-motion instant)
     scroll; we move keyboard + screen-reader focus to the destination so the
     next Tab continues from there, not from the nav.
   - Scroll spy: marks the nav link for the section in view with
     aria-current="true" (Explore Events covers Featured and Upcoming).
   - Hero visibility: pauses the 3D ring while the hero is off-screen.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var dom = Eventora.dom;
  var currentKey = null;

  /** Marks the nav links whose data-nav matches `key`. */
  function setCurrent(key) {
    if (key === currentKey) return;
    currentKey = key;
    dom.all('#links a[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === key) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  function targetFor(link) {
    var href = link.getAttribute('href');
    if (!href || href.charAt(0) !== '#' || href.length < 2) return null;
    return document.getElementById(href.slice(1));
  }

  function bindJumpLinks() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var target = targetFor(link);
      if (!target) return;
      // Let the browser perform the scroll (and update the URL); only move
      // focus, without a second scroll, so assistive tech lands on the section.
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      var key = target.getAttribute('data-nav-key');
      if (key) setCurrent(key);
    });
  }

  function watchSections() {
    var sections = dom.all('[data-nav-key]');
    if (!sections.length || !('IntersectionObserver' in window)) return;

    // A section is "current" while it crosses a thin band just below the
    // nav (40%–45% down the viewport), which reads naturally while scrolling.
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setCurrent(entry.target.getAttribute('data-nav-key'));
      });
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    sections.forEach(function (s) { spy.observe(s); });
  }

  function watchHero() {
    var hero = dom.one('.stage');
    if (!hero || !Eventora.carousel || !('IntersectionObserver' in window)) return;
    new IntersectionObserver(function (entries) {
      Eventora.carousel.setActive(entries[0].isIntersecting);
    }).observe(hero);
  }

  /* Arriving from another page (e.g. host.html -> index.html#about): the
     browser jumps before --nav-offset exists, so re-align once it does. */
  function alignInitialHash() {
    var target = location.hash.length > 1 ? document.getElementById(location.hash.slice(1)) : null;
    if (!target || !target.hasAttribute('data-nav-key')) return;
    setCurrent(target.getAttribute('data-nav-key'));
    requestAnimationFrame(function () {
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      target.focus({ preventScroll: true });
    });
  }

  Eventora.sections = {
    init: function () {
      if (dom.one('[data-nav-key]')) setCurrent('home');
      bindJumpLinks();
      watchSections();
      watchHero();
      alignInitialHash();
    },
    current: function () { return currentKey; }
  };
})(window.Eventora);
