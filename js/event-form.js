/* =========================================================================
   EVENT FORM — the create / edit event form, shared by the host dashboard
   and the admin dashboard (one component, two pages).

   Markup (inside the <form>): inputs named title, category (select), date,
   time, price, venue, city, description; a [data-cover-gallery] container
   for the cover radios; [data-cover-error]; [data-form-alert];
   [data-form-title]; a submit button [data-submit] (label in a <span>) and
   a [data-cancel] button shown while editing.

   Eventora.eventForm.create(form, {
     labels: { create, edit, createTitle, editTitle },
     submit: function (values, editingId) -> { ok, errors?, error?, event? },
     saved:  function (result, wasEditing)
   }) -> { edit(eventLike), cancel(), editing() }
   Validation rules live in js/hosting.js (checkEvent), so both pages agree.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var FIELDS = ['title', 'category', 'date', 'time', 'venue', 'city', 'price', 'description'];

  function create(form, opts) {
    var F = Eventora.forms, hosting = Eventora.hosting, cat = Eventora.events;
    var labels = Object.assign({ create: 'Submit for approval', edit: 'Save changes',
      createTitle: 'Create a new event', editTitle: 'Edit event' }, opts.labels || {});
    var editingId = null;
    var q = function (sel) { return form.querySelector(sel); };
    var gallery = q('[data-cover-gallery]'), coverError = q('[data-cover-error]');
    var alertEl = q('[data-form-alert]'), titleEl = opts.titleEl || document.querySelector('[data-form-title]');
    var submitBtn = q('[data-submit]'), cancelBtn = q('[data-cancel]');

    // categories + cover gallery (the catalogue's own photography)
    var cats = form.elements.category;
    if (cats.options.length <= 1) cat.categories.forEach(function (c) { var o = el('option', '', c); o.value = c; cats.appendChild(o); });
    form.elements.date.min = todayISO();
    if (!gallery.children.length) {
      hosting.coverImages().forEach(function (img, i) {
        var label = el('label', 'cover-option');
        var input = el('input');
        input.type = 'radio'; input.name = 'image'; input.value = img.src;
        input.id = (form.id || 'ef') + 'Cover' + i;
        input.className = 'visually-hidden';
        var pic = new Image(); pic.alt = img.alt; pic.loading = 'lazy';
        pic.src = img.src + '?auto=format&fit=crop&w=160&h=240&q=60';
        label.appendChild(input);
        label.appendChild(pic);
        label.appendChild(el('span', 'cover-option__cat', img.category));
        gallery.appendChild(label);
      });
    }

    function values() {
      var checked = form.querySelector('input[name="image"]:checked');
      var v = {};
      FIELDS.forEach(function (k) { v[k] = form.elements[k].value; });
      v.image = checked ? checked.value : '';
      return v;
    }
    function clearErrors() {
      FIELDS.forEach(function (k) { F.show(form.elements[k], ''); });
      coverError.hidden = true;
    }
    function showErrors(errors) {
      var first = null;
      Object.keys(errors).forEach(function (k) {
        if (k === 'image') {
          coverError.textContent = errors.image; coverError.hidden = false;
          first = first || form.querySelector('input[name="image"]');
        } else if (form.elements[k]) {
          F.show(form.elements[k], errors[k]); first = first || form.elements[k];
        }
      });
      if (first) first.focus();
    }
    function setLabels() {
      submitBtn.querySelector('span').textContent = editingId ? labels.edit : labels.create;
      if (titleEl) titleEl.textContent = editingId ? labels.editTitle.replace('{title}', form.elements.title.value) : labels.createTitle;
      cancelBtn.hidden = !editingId;
    }

    function edit(e) {
      editingId = e.id;
      form.elements.title.value = e.title;
      form.elements.category.value = e.category;
      form.elements.date.value = e.date;
      form.elements.time.value = e.time;
      form.elements.venue.value = e.venue.name;
      form.elements.city.value = e.venue.city;
      form.elements.price.value = e.price ? e.price.amount : '';
      form.elements.description.value = e.description;
      form.elements.date.min = '';                         // existing events may keep their date
      var radio = form.querySelector('input[name="image"][value="' + CSS.escape(e.image.src) + '"]');
      Array.prototype.forEach.call(form.querySelectorAll('input[name="image"]'), function (r) { r.checked = false; });
      if (radio) radio.checked = true;
      clearErrors();
      F.alert(alertEl, '', '');
      setLabels();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.elements.title.focus({ preventScroll: true });
    }
    function cancel() {
      editingId = null;
      form.reset();
      form.elements.date.min = todayISO();
      clearErrors();
      F.alert(alertEl, '', '');
      setLabels();
    }

    form.addEventListener('input', function (ev) {      // re-check a field once it shows an error
      var t = ev.target;
      if (!t.name || !t.closest('.field') || !t.closest('.field').classList.contains('is-invalid')) return;
      var c = hosting.checkEvent(values(), { allowPast: !!editingId });
      F.show(t, c.errors[t.name] || '');
    });
    form.addEventListener('change', function (ev) { if (ev.target.name === 'image') coverError.hidden = true; });
    cancelBtn.addEventListener('click', cancel);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearErrors();
      var wasEditing = editingId;
      var res = opts.submit(values(), editingId, ev.submitter);
      if (!res.ok) {
        if (res.errors) { showErrors(res.errors); F.alert(alertEl, 'error', 'Please fix the highlighted fields.'); }
        else F.alert(alertEl, 'error', res.error);
        return;
      }
      cancel();
      if (opts.saved) opts.saved(res, wasEditing);
    });
    setLabels();
    return { edit: edit, cancel: cancel, editing: function () { return editingId; } };
  }

  Eventora.eventForm = { create: create };
})(window.Eventora);
