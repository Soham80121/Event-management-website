/* =========================================================================
   NAV MENU — burger panel for the <=1080px band. The panel re-lays-out the
   same link and CTA nodes used on desktop; nothing is duplicated.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var nav, burger, menu;

  function isOpen() { return nav.classList.contains('open'); }

  function setOpen(open, returnFocus) {
    if (!nav) return;
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Closes menu' : 'Opens menu');
    if (!open && returnFocus) burger.focus();
  }

  Eventora.nav = {
    init: function () {
      nav = document.getElementById('nav');
      burger = document.getElementById('burger');
      menu = document.getElementById('navmenu');
      if (!nav || !burger || !menu) return;

      burger.addEventListener('click', function (e) {
        e.stopPropagation();
        setOpen(!isOpen(), false);
      });

      // Any link or CTA click inside the panel closes it.
      menu.addEventListener('click', function (e) {
        if (e.target.closest('a') && isOpen()) setOpen(false, false);
      });

      // Outside click closes.
      document.addEventListener('click', function (e) {
        if (isOpen() && !nav.contains(e.target)) setOpen(false, false);
      });

      // Escape closes and returns focus to the burger.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) setOpen(false, true);
      });
    },
    open: function () { setOpen(true, false); },
    close: function (returnFocus) { if (nav && isOpen()) setOpen(false, !!returnFocus); },
    isOpen: function () { return !!nav && isOpen(); }
  };
})(window.Eventora);
