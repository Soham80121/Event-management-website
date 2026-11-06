/* =========================================================================
   BOOTSTRAP — wires the modules a page includes. Each step is isolated so one
   failing module can never leave the page blank, and modules a page does not
   load (inner pages skip the ring, mock and intro) are simply skipped.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function safely(name, fn) {
    try { fn(); }
    catch (err) { console.warn('[Eventora] ' + name + ' failed to initialise:', err); }
  }

  function start(name, method) {
    var mod = Eventora[name];
    if (mod && typeof mod[method] === 'function') safely(name, function () { mod[method](); });
  }

  start('starfield', 'init');
  start('carousel',  'init');
  start('mock',      'init');
  start('eventCards', 'mount');   // before sections: deep links need the final page height
  start('eventFilters', 'init');
  start('exploreCarousel', 'init');
  start('nav',       'init');
  start('layout',    'init');
  start('sections',  'init');
  start('eventPage', 'init');
  start('registrationForm', 'init');   // after eventPage: mounts under the rendered event
  start('myRegistrations', 'init');
  start('intro',     'run');
})(window.Eventora);
