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

  function boot() {
    start('starfield', 'init');
    start('carousel',  'init');
    start('mock',      'init');
    start('eventCards', 'mount');   // before sections: deep links need the final page height
    start('eventFilters', 'init');
    start('exploreCarousel', 'init');
    start('eventDetail', 'init');     // after the carousel: it grows from its posters
    start('nav',       'init');
    start('accountNav', 'init');
    start('layout',    'init');
    start('sections',  'init');
    start('myRegistrations', 'init');
    start('authPages', 'init');
    start('profile', 'init');
    start('hostDashboard', 'init');
    start('hostPage', 'init');
    start('admin', 'init');
    start('intro',     'run');
  }

  // Published events and the signed-in person's bookings live on the server:
  // fetch them (briefly) before the pages render. Offline, pages still render.
  var booted = false;
  function once() { if (!booted) { booted = true; boot(); } }
  var jobs = [];
  if (Eventora.hosting && Eventora.hosting.loadPublic) jobs.push(Eventora.hosting.loadPublic(2500));
  if (Eventora.registrations && Eventora.registrations.sync) jobs.push(Eventora.registrations.sync());
  Promise.race([Promise.all(jobs), new Promise(function (r) { setTimeout(r, 3000); })]).then(once, once);
})(window.Eventora);
