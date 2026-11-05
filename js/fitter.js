/* =========================================================================
   TYPE FITTER (desktop + tablet only)
   Scales each text run so its cap height and ink width hit exact design
   targets, and drops its baseline on an exact design y. Font metrics come
   from a detached <canvas> 2D context, so the result is exact whichever
   face (Poppins or a fallback) actually loaded.
   ========================================================================= */
(function (Eventora) {
  'use strict';

  var ctx = document.createElement('canvas').getContext('2d');
  var BUTTON_LABEL_BIAS = 1.1;   // reference labels sit ~0.6px below true centre

  function fontOf(el) {
    var cs = getComputedStyle(el);
    return {
      css: cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily,
      weight: cs.fontWeight,
      family: cs.fontFamily,
      size: parseFloat(cs.fontSize)
    };
  }

  /** Cap height per 1px of font-size for el's face. */
  function capRatio(el) {
    var f = fontOf(el);
    ctx.font = f.weight + ' 100px ' + f.family;
    var m = ctx.measureText('H');
    return (m.actualBoundingBoxAscent || 70) / 100;
  }

  /** Rendered width in design px (undo the canvas scale k). */
  function inkWidth(el, k) {
    return el.getBoundingClientRect().width / k;
  }

  /** Exact cap height (tc) AND exact ink width (tw), keeping `pre` transform. */
  function fitBox(el, tw, tc, pre, k) {
    pre = pre || '';
    el.style.transform = pre || 'none';
    el.style.fontSize = (tc / capRatio(el)) + 'px';
    var w = inkWidth(el, k);
    if (w > 0) el.style.transform = (pre ? pre + ' ' : '') + 'scaleX(' + (tw / w) + ')';
  }

  /** Puts el's first baseline on design y (assumes line-height:1). */
  function baseline(el, y) {
    var f = fontOf(el);
    ctx.font = f.css;
    var m = ctx.measureText('H');
    var A = m.fontBoundingBoxAscent || f.size * 0.8;
    var D = m.fontBoundingBoxDescent || f.size * 0.2;
    el.style.top = (y - ((f.size - (A + D)) / 2 + A)) + 'px';
  }

  /** Optically centres a label's caps inside its button. */
  function centreLabel(btn, el, capPx, k) {
    el.style.top = '';
    var probe = document.createElement('i');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.appendChild(probe);
    var base = (probe.getBoundingClientRect().top - btn.getBoundingClientRect().top) / k;
    el.removeChild(probe);
    var btnH = btn.offsetHeight;
    el.style.position = 'relative';
    el.style.top = (btnH / 2 - (base - capPx / 2) + BUTTON_LABEL_BIAS) + 'px';
  }

  /** Clears every inline style the fitter writes (used on phones). */
  function reset(els) {
    els.forEach(function (el) {
      if (!el) return;
      el.style.fontSize = '';
      el.style.top = '';
      el.style.transform = '';
    });
  }

  Eventora.fitter = {
    fontOf: fontOf,
    capRatio: capRatio,
    inkWidth: inkWidth,
    fitBox: fitBox,
    baseline: baseline,
    centreLabel: centreLabel,
    reset: reset
  };
})(window.Eventora);
