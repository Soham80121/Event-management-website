/* =========================================================================
   CONFIRM — the one confirmation dialog for event actions (Delete, Cancel,
   Unpublish, Publish, Approve, Reject), used by the Host Dashboard and the
   Admin panel.
   - Wording comes from MESSAGES, so every page says the same thing.
   - While the request runs, both buttons are disabled and the confirm
     button reads "Working…", so an action can't be sent twice.
   - The dialog closes only after the server has confirmed; an error is shown
     inside it and the person can try again or close it.
   Usage:
     Eventora.confirmAction('delete', { title: e.title, detail: '3 registrations' },
       function () { return hosting.deleteEvent(id); })   // -> Promise of the result
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var MESSAGES = {
    'delete': {
      heading: 'Delete event permanently?', confirm: 'Delete permanently', danger: true,
      text: 'Are you sure you want to permanently delete this event? All associated registrations and QR tickets will also be deleted. This action cannot be undone.'
    },
    cancel: {
      heading: 'Cancel this event?', confirm: 'Cancel event', danger: true,
      text: 'Are you sure you want to cancel this event? Historical registrations and QR tickets will be preserved.'
    },
    unpublish: {
      heading: 'Unpublish this event?', confirm: 'Unpublish',
      text: 'This event will no longer appear publicly. You can publish it again later.'
    },
    publish: {
      heading: 'Publish this event?', confirm: 'Publish',
      text: 'This event will become publicly visible and available for registration.'
    },
    approve: {
      heading: 'Approve and publish this event?', confirm: 'Approve & publish',
      text: 'This event will become publicly visible and available for registration.'
    },
    reject: {
      heading: 'Reject this submission?', confirm: 'Reject', danger: true,
      text: 'The host will see your reason and can edit and resubmit the event. It stays in their event history and is not deleted.'
    }
  };

  var dlg, els, pending = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function build() {
    dlg = el('dialog', 'mr-dialog confirm-dialog');
    dlg.setAttribute('aria-labelledby', 'confirmHeading');
    dlg.setAttribute('aria-describedby', 'confirmText');
    var sheet = el('div', 'mr-dialog__sheet confirm-dialog__sheet');
    els = {
      heading: el('h2', 'heading-3'), event: el('p', 'confirm-dialog__event'),
      text: el('p', 'confirm-dialog__text'), detail: el('p', 'field__hint'),
      alert: el('p', 'form-alert'), row: el('div', 'confirm-dialog__actions'),
      back: el('button', 'btn-ghost', 'Go back'), ok: el('button', 'btn-ghost')
    };
    els.heading.id = 'confirmHeading';
    els.text.id = 'confirmText';
    els.alert.setAttribute('role', 'alert');
    els.alert.hidden = true;
    els.back.type = els.ok.type = 'button';
    els.row.appendChild(els.back);
    els.row.appendChild(els.ok);
    ['heading', 'event', 'text', 'detail', 'alert', 'row'].forEach(function (k) { sheet.appendChild(els[k]); });
    dlg.appendChild(sheet);
    document.body.appendChild(dlg);

    els.back.addEventListener('click', function () { if (!dlg.hasAttribute('data-busy')) close(null); });
    // Esc: same as Go back, but never while the request is running
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); if (!dlg.hasAttribute('data-busy')) close(null); });
    els.ok.addEventListener('click', run);
  }

  function busy(on) {
    if (on) dlg.setAttribute('data-busy', 'true'); else dlg.removeAttribute('data-busy');
    els.ok.disabled = els.back.disabled = on;
    els.ok.textContent = on ? 'Working…' : els.ok.getAttribute('data-label');
  }

  function run() {
    if (!pending || dlg.hasAttribute('data-busy')) return;
    els.alert.hidden = true;
    busy(true);
    var result;
    try { result = pending.action(); } catch (err) { result = { ok: false, error: err.message }; }
    Promise.resolve(result).then(function (res) {
      busy(false);
      if (res && res.ok) { close(res); return; }
      els.alert.className = 'form-alert form-alert--error';
      els.alert.textContent = (res && res.error) || 'That didn’t work. Try again.';
      els.alert.hidden = false;
      els.ok.focus();
    }, function () {
      busy(false);
      els.alert.className = 'form-alert form-alert--error';
      els.alert.textContent = 'That didn’t work. Try again.';
      els.alert.hidden = false;
    });
  }

  function close(result) {
    var p = pending;
    pending = null;
    if (dlg.open) dlg.close();
    if (p) {
      if (p.opener && document.contains(p.opener)) p.opener.focus();
      p.resolve(result);
    }
  }

  /**
   * kind: 'delete' | 'cancel' | 'unpublish' | 'publish' | 'approve' | 'reject'
   * info: { title, detail? } · action: function returning a result or a Promise of one
   * -> Promise: the action's result once it succeeded, or null if the person went back.
   */
  function confirmAction(kind, info, action) {
    var m = MESSAGES[kind];
    if (!m) throw new Error('Unknown action: ' + kind);
    if (!dlg) build();
    if (pending) close(null);
    return new Promise(function (resolve) {
      pending = { action: action, resolve: resolve, opener: document.activeElement };
      els.heading.textContent = m.heading;
      els.event.textContent = info && info.title ? '“' + info.title + '”' : '';
      els.event.hidden = !els.event.textContent;
      els.text.textContent = m.text;
      els.detail.textContent = (info && info.detail) || '';
      els.detail.hidden = !els.detail.textContent;
      els.alert.hidden = true;
      els.ok.className = 'btn-ghost ' + (m.danger ? 'btn-danger' : 'btn-ok');
      els.ok.setAttribute('data-label', m.confirm);
      busy(false);
      dlg.showModal();
      els.back.focus();          // the safe choice has focus
    });
  }

  Eventora.confirmAction = confirmAction;
  Eventora.confirmAction.MESSAGES = MESSAGES;
})(window.Eventora);
