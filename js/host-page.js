/* =========================================================================
   HOST AN EVENT — host.html.

   Visitors: the existing "Host an event" intro with sign-in buttons.
   Users:    sent to "Become an Event Host" on their profile (js/account-nav.js).
   Event Hosts and the Admin: a simple submission page, with a heading, a short
   introduction and the shared event form (js/event-form.js). Submitting saves
   the event on the server through hosting.createEvent(): always Pending,
   owned by the signed-in account, never published automatically.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function showForm(u) {
    var main = $('main');
    if (main) main.className = 'acct-wrap';              // page spacing like the other account pages
    $('hostIntro').hidden = true;
    $('hostSubmit').hidden = false;

    var panel = $('hsFormPanel'), done = $('hsDone');
    var form = Eventora.eventForm.render($('hsForm'), { prefix: 'hs', create: 'Submit Event' });
    var api = Eventora.eventForm.create(form, {
      titleEl: document.createElement('span'),           // the page heading stays "Host an Event"
      labels: { create: 'Submit Event', edit: 'Submit Event', createTitle: '', editTitle: '' },
      submit: function (v) { return Eventora.hosting.createEvent(v); },
      saved: function (res) {
        var e = res.event;
        done.querySelector('[data-a="title"]').textContent = '“' + e.title + '”';
        done.querySelector('[data-a="id"]').textContent = e.id;
        done.querySelector('[data-a="track"]').hidden = u.role !== 'host';
        panel.hidden = true;
        done.hidden = false;
        done.focus();
        done.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
    done.querySelector('[data-a="again"]').addEventListener('click', function () {
      api.cancel();
      form.reset();
      done.hidden = true;
      panel.hidden = false;
      form.elements.title.focus();
    });
  }

  Eventora.hostPage = {
    init: function () {
      if (!$('hostSubmit') || !Eventora.auth || !Eventora.eventForm) return;
      var auth = Eventora.auth;
      if (!auth.current()) return;                       // visitor: keep the intro
      auth.ready().then(function (u) {
        if (u && auth.can('manageOwnEvents')) showForm(u);
      });
    }
  };
})(window.Eventora);
