/* =========================================================================
   QR CODE — a small, dependency-free QR encoder (ISO/IEC 18004).

   Scope (all EvAtlas needs, kept deliberately small):
   - error correction level M (~15% damage tolerance)
   - versions 1–6 (21–41 modules): up to 106 bytes / 154 alphanumeric chars
   - alphanumeric mode when the text allows it (registration IDs such as
     EVR-7K3M-Q9TD fit in a version 1 code), otherwise UTF-8 byte mode
   - all 8 masks are tried and the one with the lowest penalty is used

   API:
     Eventora.qr.matrix(text)        -> array of rows of booleans (true = dark)
     Eventora.qr.svg(text, options)  -> <svg> element, 4-module quiet zone
   ========================================================================= */
(function (Eventora) {
  'use strict';

  /* Level M block structure per version: [ec codewords per block, [data codewords per block...]] */
  var BLOCKS = {
    1: [10, [16]],
    2: [16, [28]],
    3: [26, [44]],
    4: [18, [32, 32]],
    5: [24, [43, 43]],
    6: [16, [27, 27, 27, 27]]
  };
  var ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  /* ---------- Galois field GF(256), primitive polynomial 0x11D ---------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  function generator(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var next = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  /** Reed–Solomon remainder: the n error-correction codewords for `data`. */
  function rsEncode(data, n) {
    var gen = generator(n);
    var rem = data.concat(new Array(n).fill(0));
    for (var i = 0; i < data.length; i++) {
      var c = rem[i];
      if (c) for (var j = 0; j < gen.length; j++) rem[i + j] ^= mul(gen[j], c);
    }
    return rem.slice(data.length);
  }

  /* ---------- data encoding ---------- */
  function utf8(text) {
    var out = [], s = unescape(encodeURIComponent(text));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function BitBuffer() { this.bits = []; }
  BitBuffer.prototype.put = function (value, len) {
    for (var i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  };

  function capacity(v) {
    return BLOCKS[v][1].reduce(function (a, b) { return a + b; }, 0);
  }

  function encodeData(text) {
    var alnum = text.split('').every(function (ch) { return ALNUM.indexOf(ch) !== -1; });
    var bytes = alnum ? null : utf8(text);
    var len = alnum ? text.length : bytes.length;
    // bits needed (character-count field is 9 / 8 bits for versions 1–9)
    var need = 4 + (alnum ? 9 + 11 * Math.floor(len / 2) + 6 * (len % 2) : 8 + 8 * len);
    var version = 0;
    for (var v = 1; v <= 6; v++) if (need <= capacity(v) * 8) { version = v; break; }
    if (!version) throw new Error('Text too long for a QR code: ' + text.length + ' characters');

    var buf = new BitBuffer();
    if (alnum) {
      buf.put(2, 4); buf.put(len, 9);
      for (var i = 0; i + 1 < len; i += 2) buf.put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
      if (len % 2) buf.put(ALNUM.indexOf(text[len - 1]), 6);
    } else {
      buf.put(4, 4); buf.put(len, 8);
      bytes.forEach(function (b) { buf.put(b, 8); });
    }
    var cap = capacity(version) * 8;
    buf.put(0, Math.min(4, cap - buf.bits.length));          // terminator
    while (buf.bits.length % 8) buf.bits.push(0);              // byte align
    var words = [];
    for (var k = 0; k < buf.bits.length; k += 8) {
      var w = 0;
      for (var b = 0; b < 8; b++) w = (w << 1) | buf.bits[k + b];
      words.push(w);
    }
    for (var p = 0; words.length < capacity(version); p++) words.push(p % 2 ? 0x11 : 0xEC);
    return { version: version, words: words };
  }

  /** Split into blocks, add error correction, interleave. */
  function codewords(version, data) {
    var ecLen = BLOCKS[version][0], sizes = BLOCKS[version][1];
    var blocks = [], ecs = [], pos = 0;
    sizes.forEach(function (size) {
      var block = data.slice(pos, pos + size);
      pos += size;
      blocks.push(block);
      ecs.push(rsEncode(block, ecLen));
    });
    var out = [], max = Math.max.apply(null, sizes);
    for (var i = 0; i < max; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (var j = 0; j < ecLen; j++) ecs.forEach(function (e) { out.push(e[j]); });
    return out;
  }

  /* ---------- matrix ---------- */
  function Grid(size) {
    this.size = size;
    this.dark = [];
    this.fixed = [];          // function patterns: not data, not masked
    for (var r = 0; r < size; r++) {
      this.dark.push(new Array(size).fill(false));
      this.fixed.push(new Array(size).fill(false));
    }
  }
  Grid.prototype.set = function (r, c, on) { this.dark[r][c] = on; this.fixed[r][c] = true; };

  function placeFunctionPatterns(g, version) {
    var n = g.size;
    // finder patterns + separators
    [[0, 0], [0, n - 7], [n - 7, 0]].forEach(function (o) {
      for (var r = -1; r <= 7; r++) {
        for (var c = -1; c <= 7; c++) {
          var rr = o[0] + r, cc = o[1] + c;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          var ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          g.set(rr, cc, ring !== 2 && ring !== 4);
        }
      }
    });
    // timing patterns
    for (var i = 8; i < n - 8; i++) {
      g.set(6, i, i % 2 === 0);
      g.set(i, 6, i % 2 === 0);
    }
    // alignment patterns (not over the finders)
    var a = ALIGN[version];
    a.forEach(function (r) {
      a.forEach(function (c) {
        if (g.fixed[r][c]) return;
        for (var dr = -2; dr <= 2; dr++) {
          for (var dc = -2; dc <= 2; dc++) {
            g.set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
          }
        }
      });
    });
    // dark module + reserve the format-information areas
    g.set(n - 8, 8, true);
    for (var k = 0; k < 9; k++) {
      if (!g.fixed[8][k]) g.set(8, k, false);
      if (!g.fixed[k][8]) g.set(k, 8, false);
    }
    for (var m = 0; m < 8; m++) {
      if (!g.fixed[8][n - 1 - m]) g.set(8, n - 1 - m, false);
      if (!g.fixed[n - 1 - m][8]) g.set(n - 1 - m, 8, false);
    }
  }

  /** Zigzag the codeword bits into the free modules, bottom-right first. */
  function placeData(g, words) {
    var n = g.size, bit = 0, total = words.length * 8, up = true;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;                     // skip the vertical timing column
      for (var i = 0; i < n; i++) {
        var r = up ? n - 1 - i : i;
        for (var j = 0; j < 2; j++) {
          var c = right - j;
          if (g.fixed[r][c]) continue;
          var on = false;
          if (bit < total) on = ((words[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
          g.dark[r][c] = on;
          bit++;
        }
      }
      up = !up;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
    function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }
  ];

  /** 15-bit format information: level M (00) + mask, BCH(15,5), XOR mask 0x5412. */
  function formatBits(mask) {
    var data = (0 << 3) | mask;             // level M = 0b00
    var rem = data << 10;
    for (var i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    return ((data << 10) | rem) ^ 0x5412;
  }

  function placeFormat(g, mask) {
    var n = g.size, bits = formatBits(mask);
    function bit(i) { return ((bits >>> i) & 1) === 1; }
    var i;
    // copy 1, around the top-left finder (bit 0 = least significant)
    for (i = 0; i <= 5; i++) g.dark[i][8] = bit(i);
    g.dark[7][8] = bit(6);
    g.dark[8][8] = bit(7);
    g.dark[8][7] = bit(8);
    for (i = 9; i < 15; i++) g.dark[8][14 - i] = bit(i);
    // copy 2, split between the top-right and bottom-left finders
    for (i = 0; i < 8; i++) g.dark[8][n - 1 - i] = bit(i);
    for (i = 8; i < 15; i++) g.dark[n - 15 + i][8] = bit(i);
    g.dark[n - 8][8] = true;                 // the dark module always stays dark
  }

  function applyMask(g, mask) {
    var f = MASKS[mask], out = [];
    for (var r = 0; r < g.size; r++) {
      var row = [];
      for (var c = 0; c < g.size; c++) row.push(g.fixed[r][c] ? g.dark[r][c] : g.dark[r][c] !== f(r, c));
      out.push(row);
    }
    return out;
  }

  /** Standard penalty score: runs, 2×2 blocks, finder-like patterns, balance. */
  function penalty(m) {
    var n = m.length, score = 0, r, c;
    function runs(get) {
      for (var a = 0; a < n; a++) {
        var len = 1;
        for (var b = 1; b < n; b++) {
          if (get(a, b) === get(a, b - 1)) len++;
          else { if (len >= 5) score += len - 2; len = 1; }
        }
        if (len >= 5) score += len - 2;
      }
    }
    runs(function (a, b) { return m[a][b]; });
    runs(function (a, b) { return m[b][a]; });
    for (r = 0; r < n - 1; r++) {
      for (c = 0; c < n - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    var p1 = [true, false, true, true, true, false, true, false, false, false, false];
    var p2 = p1.slice().reverse();
    function matches(get, a, b, pat) {
      for (var k = 0; k < 11; k++) if (get(a, b + k) !== pat[k]) return false;
      return true;
    }
    var rowGet = function (a, b) { return m[a][b]; }, colGet = function (a, b) { return m[b][a]; };
    for (r = 0; r < n; r++) {
      for (c = 0; c <= n - 11; c++) {
        if (matches(rowGet, r, c, p1) || matches(rowGet, r, c, p2)) score += 40;
        if (matches(colGet, r, c, p1) || matches(colGet, r, c, p2)) score += 40;
      }
    }
    var dark = 0;
    for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) dark++;
    score += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
    return score;
  }

  function build(text, forceMask) {
    var enc = encodeData(String(text));
    var words = codewords(enc.version, enc.words);
    var g = new Grid(17 + 4 * enc.version);
    placeFunctionPatterns(g, enc.version);
    placeData(g, words);
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask !== undefined && mask !== forceMask) continue;
      placeFormat(g, mask);
      var m = applyMask(g, mask);
      var s = forceMask !== undefined ? 0 : penalty(m);
      if (!best || s < best.score) best = { score: s, matrix: m, mask: mask, version: enc.version };
    }
    return best;
  }

  Eventora.qr = {
    /** Dark/light modules, without quiet zone. */
    matrix: function (text) { return build(text).matrix; },

    /** Details for tests: { matrix, mask, version }. */
    encode: function (text, mask) { return build(text, mask); },

    /** An <svg> drawing the code as one path, with a 4-module quiet zone. */
    svg: function (text, opts) {
      opts = opts || {};
      var m = build(text).matrix, n = m.length, q = 4, size = n + q * 2;
      var d = '';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
        }
      }
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + size + ' ' + size);
      svg.setAttribute('shape-rendering', 'crispEdges');
      if (opts.label) { svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', opts.label); }
      else svg.setAttribute('aria-hidden', 'true');
      var bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('width', size); bg.setAttribute('height', size);
      bg.setAttribute('fill', opts.light || '#fff');
      var path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', opts.dark || '#000');
      svg.appendChild(bg);
      svg.appendChild(path);
      return svg;
    }
  };
})(typeof window !== 'undefined' ? window.Eventora : globalThis.Eventora);
