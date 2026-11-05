/* =========================================================================
   BOOTSTRAP — wires the modules together. Each step is isolated so one
   failing module can never leave the page blank.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function safely(name, fn) {
    try { fn(); }
    catch (err) { console.warn('[Eventora] ' + name + ' failed to initialise:', err); }
  }

  safely('starfield', function () { Eventora.starfield.init(); });
  safely('carousel',  function () { Eventora.carousel.init(); });
  safely('mock',      function () { Eventora.mock.init(); });
  safely('nav',       function () { Eventora.nav.init(); });
  safely('layout',    function () { Eventora.layout.init(); });
  safely('intro',     function () { Eventora.intro.run(); });
})(window.Eventora);
