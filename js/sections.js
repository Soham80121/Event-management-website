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
  var holdUntil = 0;            // a jump to a nav target keeps its link marked meanwhile

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

  /* ---------- precise jumps ----------
     A section's own top padding (and the centring of the short placeholder
     sections) would leave its heading far below the fixed nav. So a jump
     lines up what the visitor came for: a section's first content (its
     heading block), or the target itself (the search bar), exactly
     --nav-offset (nav bottom + 16px) from the top. Home goes to the very top. */
  function navOffset() {
    var v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-offset'));
    return isNaN(v) ? 96 : v;
  }
  function anchorOf(target) {
    if (!target.hasAttribute('data-nav-key')) return target;
    var box = target.querySelector('.container') || target;
    var kids = Array.prototype.filter.call(box.children, function (n) { return n.offsetHeight > 0; });
    return kids[0] || target;
  }
  function jumpY(target) {
    if (target.id === 'top' || target.classList.contains('stage')) return 0;
    var y = anchorOf(target).getBoundingClientRect().top + window.pageYOffset - navOffset();
    return Math.max(0, Math.round(y));
  }
  function isJumpTarget(target, link) {
    return target.hasAttribute('data-nav-key') || !!(link && link.closest('#links'));
  }

  function bindJumpLinks() {
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      var target = targetFor(link);
      if (!target) return;
      if (isJumpTarget(target, link)) {
        // scroll to the exact spot ourselves (smooth unless reduced motion)
        e.preventDefault();
        if (location.hash !== link.getAttribute('href')) history.pushState(null, '', link.getAttribute('href'));
        var reduced = Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false;
        window.scrollTo({ top: jumpY(target), behavior: reduced ? 'auto' : 'smooth' });
      }
      // focus moves without a second scroll, so assistive tech lands on the section
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      // a section marks itself; a jump target inside a section (the search
      // bar) marks the nav link that was used
      var key = target.getAttribute('data-nav-key') || (link.closest('#links') && link.getAttribute('data-nav'));
      if (key) setCurrent(key);
      // the search bar sits inside "Upcoming": keep "Search" marked while the
      // smooth scroll passes the surrounding sections
      if (key && !target.hasAttribute('data-nav-key')) holdUntil = Date.now() + 1500;
    });
  }

  function watchSections() {
    var sections = dom.all('[data-nav-key]');
    if (!sections.length || !('IntersectionObserver' in window)) return;

    // A section is "current" while it crosses a thin band just below the
    // nav (40%–45% down the viewport), which reads naturally while scrolling.
    var spy = new IntersectionObserver(function (entries) {
      if (Date.now() < holdUntil) return;
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

  /* Arriving from another page (e.g. host.html -> index.html#about or
     #search): the browser jumps before --nav-offset exists, so re-align once
     it does. Targets are sections, or anything a nav link points at. */
  function alignInitialHash() {
    var id = location.hash.length > 1 ? location.hash.slice(1) : '';
    var target = id && /^[A-Za-z][\w-]*$/.test(id) ? document.getElementById(id) : null;
    var navLink = target ? dom.one('#links a[data-nav][href="#' + id + '"]') : null;
    if (!target || !(target.hasAttribute('data-nav-key') || navLink)) return;
    setCurrent(target.getAttribute('data-nav-key') || navLink.getAttribute('data-nav'));
    if (!target.hasAttribute('data-nav-key')) holdUntil = Date.now() + 1500;
    var placed = null;
    requestAnimationFrame(function () {
      placed = jumpY(target);
      window.scrollTo({ top: placed, behavior: 'instant' });
      target.focus({ preventScroll: true });
    });
    // images above may change heights while loading: line up again once,
    // unless the visitor has scrolled in the meantime
    window.addEventListener('load', function () {
      if (placed !== null && Math.abs(window.pageYOffset - placed) < 2) {
        placed = jumpY(target);
        window.scrollTo({ top: placed, behavior: 'instant' });
      }
    }, { once: true });
  }

  /* Same-page hash changes the click handler didn't make (Back / Forward, a
     typed #hash, links elsewhere on the page): line the target up too. */
  function watchHash() {
    window.addEventListener('hashchange', function () {
      var id = location.hash.slice(1);
      var target = /^[A-Za-z][\w-]*$/.test(id) ? document.getElementById(id) : null;
      var navLink = target ? dom.one('#links a[data-nav][href="#' + id + '"]') : null;
      if (!target || !(target.hasAttribute('data-nav-key') || navLink)) return;
      if (target.getAttribute('data-nav-key') || navLink) setCurrent(target.getAttribute('data-nav-key') || navLink.getAttribute('data-nav'));
      if (!target.hasAttribute('data-nav-key')) holdUntil = Date.now() + 1500;
      var reduced = Eventora.motion && Eventora.motion.reduced ? Eventora.motion.reduced() : false;
      window.scrollTo({ top: jumpY(target), behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  Eventora.sections = {
    init: function () {
      watchHash();
      if (dom.one('[data-nav-key]')) setCurrent('home');
      bindJumpLinks();
      watchSections();
      watchHero();
      alignInitialHash();
    },
    current: function () { return currentKey; }
  };
})(window.Eventora);
