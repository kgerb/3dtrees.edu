// ForestVerse hero: an endless walk through a procedurally generated point-cloud forest.
// Plain WebGL, no dependencies. Illustration only: the trees are generated, not scanned.
(function () {
  'use strict';

  var hero = document.getElementById('hero-forest');
  var canvas = document.getElementById('forest-canvas');
  if (!hero || !canvas) return;

  var GL_OPTS = { antialias: false, alpha: false, powerPreference: 'high-performance' };
  var gl = canvas.getContext('webgl2', GL_OPTS) || canvas.getContext('webgl', GL_OPTS); // WebGL2 lets the depth pass drop its depth buffer early
  if (!gl) { hero.classList.add('no-webgl'); return; }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Phones and small tablets get the light scans. Not decided by window size: a laptop at 150 % scaling has a
  // window only ~600 px tall but a desktop GPU.
  function isSmall() {
    var mm = window.matchMedia, touchOnly = mm && mm('(pointer: coarse)').matches && !mm('(any-pointer: fine)').matches;
    return touchOnly || Math.min(screen.width, screen.height) < 600;
  }
  var small = isSmall();

  // ---------------------------------------------------------------- random
  var seed = 1;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
  function rr(a, b) { return a + (b - a) * rnd(); }
  function gauss() { var u = rnd() || 1e-9, v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v); }

  // ---------------------------------------------------------------- biomes
  // Heights in metres. Numbers are rough, chosen to make the five forests look different.
  var VIRIDIS = [[0.2, 0.46, 0.52], [0.18, 0.72, 0.48], [1.0, 0.92, 0.2]];
  var BG = [0.035, 0.045, 0.07];
  // viridis from blue to yellow (the darkest purple is left out so the lowest leaves stay visible on the dark sky)
  var SCAN_RAMP = [[0.23, 0.32, 0.55], [0.13, 0.57, 0.55], [0.37, 0.79, 0.38], [0.99, 0.91, 0.15]];
  function ramp(stops, t) {
    t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    var i = Math.min(stops.length - 2, Math.floor(t)), u = t - i, a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }
  var BIOMES = {
    'black-forest': {
      bg: BG, stems: 150, budget: 1.0,
      ground: [[0.25, 0.22, 0.14], [0.18, 0.3, 0.16]],
      leaf: VIRIDIS,
      mix: [
        { w: 0.6, kind: 'conifer', h: [24, 38], crown: [0.55, 0.75], r: [2.2, 3.4] },
        { w: 0.3, kind: 'broadleaf', h: [20, 32], crown: [0.45, 0.6], r: [3.5, 6] },
        { w: 0.25, kind: 'shrub', h: [1, 4], crown: [0.8, 1], r: [0.8, 2] }
      ]
    },
    'boreal': {
      bg: BG, stems: 210, budget: 0.75,
      ground: [[0.42, 0.42, 0.3], [0.55, 0.6, 0.5]],
      leaf: VIRIDIS,
      mix: [
        { w: 0.85, kind: 'conifer', h: [10, 20], crown: [0.6, 0.9], r: [0.8, 1.5] },
        { w: 0.15, kind: 'broadleaf', h: [8, 15], crown: [0.5, 0.7], r: [1.5, 2.5] }
      ]
    },
    'congo': {
      bg: BG, stems: 230, budget: 1.25,
      ground: [[0.24, 0.17, 0.1], [0.15, 0.25, 0.1]],
      leaf: VIRIDIS,
      mix: [
        { w: 0.12, kind: 'emergent', h: [42, 55], crown: [0.2, 0.3], r: [8, 13] },
        { w: 0.45, kind: 'broadleaf', h: [18, 32], crown: [0.35, 0.55], r: [3, 6] },
        { w: 0.6, kind: 'shrub', h: [2, 8], crown: [0.6, 0.9], r: [1, 2.6] }
      ]
    },
    'borneo': {
      bg: BG, stems: 240, budget: 1.3,
      ground: [[0.26, 0.19, 0.12], [0.14, 0.24, 0.12]],
      leaf: VIRIDIS,
      mix: [
        { w: 0.14, kind: 'emergent', h: [50, 68], crown: [0.18, 0.28], r: [7, 12] },
        { w: 0.5, kind: 'broadleaf', h: [22, 38], crown: [0.3, 0.5], r: [3, 6.5] },
        { w: 0.3, kind: 'broadleaf', h: [8, 16], crown: [0.5, 0.7], r: [2, 3.5] },
        { w: 0.5, kind: 'shrub', h: [1.5, 6], crown: [0.6, 0.9], r: [0.8, 2.2] }
      ]
    },
    'australia': {
      bg: BG, stems: 120, budget: 0.9,
      ground: [[0.5, 0.42, 0.24], [0.42, 0.4, 0.2]],
      leaf: VIRIDIS,
      mix: [
        { w: 0.55, kind: 'broadleaf', h: [28, 45], crown: [0.3, 0.45], r: [4, 7] },
        { w: 0.25, kind: 'broadleaf', h: [10, 18], crown: [0.4, 0.6], r: [2, 3.5] },
        { w: 0.4, kind: 'shrub', h: [0.6, 2.5], crown: [0.8, 1], r: [0.6, 1.6] }
      ]
    }
  };

  var W = 46;        // half width of the forest strip
  var L = 190;       // length of the repeating strip
  var TRAIL = 2.6;   // half width of the open trail the camera walks along

  function terrain(x, z) {
    return 0.6 * Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.0330693) + 0.35 * Math.sin(z * 0.0661388 + x * 0.05);
  }

  // ---------------------------------------------------------------- generation
  function generate(name) {
    var B = biome(name);
    seed = 4242 + name.length * 977;
    var maxPts = Math.round((small ? 90000 : 190000) * B.budget);
    var pos = new Float32Array(maxPts * 3), col = new Uint8Array(maxPts * 4);
    var n = 0;
    var maxH = 0;
    B.mix.forEach(function (m) { maxH = Math.max(maxH, m.h[1]); });

    function put(x, y, z, r, g, b) {
      if (n >= maxPts) return;
      var j = n * 3;
      // wrap z so the strip repeats seamlessly
      z = ((z % L) + L) % L;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      var k = 0.85 + 0.3 * rnd(), jc = n * 4;
      col[jc] = Math.min(255, r * k * 255); col[jc + 1] = Math.min(255, g * k * 255); col[jc + 2] = Math.min(255, b * k * 255);
      n++;
    }
    function leafColor(y) {
      var t = Math.max(0, Math.min(1, y / maxH));
      var a = t < 0.5 ? B.leaf[0] : B.leaf[1], c = t < 0.5 ? B.leaf[1] : B.leaf[2];
      var u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      return [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u, a[2] + (c[2] - a[2]) * u];
    }
    var bark = [0.55, 0.42, 0.3];

    // ground
    var groundPts = Math.round(maxPts * 0.26);
    for (var i = 0; i < groundPts; i++) {
      var gx = i % 2 ? rr(-W, W) : Math.max(-W, Math.min(W, gauss() * 9)), gz = rr(0, L);
      var gy = terrain(gx, gz) + Math.abs(gauss()) * 0.06;
      var gc = rnd() < 0.55 ? B.ground[0] : B.ground[1];
      if (Math.abs(gx) < TRAIL * 0.8) gc = [gc[0] * 1.15 + 0.05, gc[1] * 1.05 + 0.03, gc[2] * 1.0 + 0.02];
      put(gx, gy, gz, gc[0] * 1.6, gc[1] * 1.6, gc[2] * 1.6);
    }

    // trees
    var wsum = 0; B.mix.forEach(function (m) { wsum += m.w; });
    var stems = Math.round(B.stems * (small ? 0.8 : 1));
    var perTree = Math.floor((maxPts - groundPts) / stems);
    for (var s = 0; s < stems; s++) {
      var pick = rnd() * wsum, m = B.mix[0];
      for (var q = 0; q < B.mix.length; q++) { pick -= B.mix[q].w; if (pick <= 0) { m = B.mix[q]; break; } }
      var tx = rr(-W, W);
      var trailGap = m.kind === 'shrub' ? TRAIL * 0.9 : TRAIL + 0.8;
      if (Math.abs(tx) < trailGap) tx = (tx < 0 ? -1 : 1) * (trailGap + rnd() * 3);
      var tz = rr(0, L), base = terrain(tx, tz);
      var h = rr(m.h[0], m.h[1]), cr = rr(m.crown[0], m.crown[1]), R = rr(m.r[0], m.r[1]);
      var hb = h * (1 - cr);
      var budget = Math.round(perTree * (m.kind === 'shrub' ? 0.35 : m.kind === 'emergent' ? 2.4 : 1) * (0.7 + 0.6 * rnd()));
      var trunkR = m.kind === 'shrub' ? 0 : Math.max(0.12, h * 0.012) * (m.kind === 'emergent' ? 1.8 : 1);

      // trunk
      if (trunkR > 0) {
        var tn = Math.round(budget * 0.14);
        for (var t = 0; t < tn; t++) {
          var ty = rnd() * (hb + (h - hb) * 0.5), a = rnd() * 6.2831853;
          var rad = trunkR * (1 - 0.6 * ty / h) * (ty < 1 && m.kind === 'emergent' ? 2.2 - ty : 1);
          put(tx + Math.cos(a) * rad, base + ty, tz + Math.sin(a) * rad, bark[0], bark[1], bark[2]);
        }
      }

      var cn = budget - (trunkR > 0 ? Math.round(budget * 0.14) : 0);
      if (m.kind === 'conifer') {
        var whorls = 0.55 + rnd() * 0.25;
        for (var c = 0; c < cn; c++) {
          var y = hb + (h - hb) * Math.pow(rnd(), 0.8);
          var rmax = R * (h - y) / (h - hb);
          // denser at branch whorls
          if (Math.sin(y * 3.1 / whorls) < -0.2 && rnd() < 0.6) continue;
          var ang = rnd() * 6.2831853, rf = Math.sqrt(rnd()) * rmax;
          var droop = -0.25 * rf;
          var lc = leafColor(y);
          put(tx + Math.cos(ang) * rf, base + y + droop, tz + Math.sin(ang) * rf, lc[0], lc[1], lc[2]);
        }
      } else {
        // broadleaf, emergent and shrub: clumped ellipsoid crowns
        var flat = m.kind === 'emergent' ? 0.35 : m.kind === 'shrub' ? 0.8 : 0.6;
        var cy = hb + (h - hb) * 0.55, ry = Math.max(0.6, (h - hb) * 0.5) * (m.kind === 'emergent' ? 1 : 1) , rx = R;
        if (m.kind === 'emergent') ry = Math.max(2.5, R * flat);
        var clumps = m.kind === 'shrub' ? 5 : m.kind === 'emergent' ? 26 : 14;
        var centers = [];
        for (var k = 0; k < clumps; k++) {
          var u = rnd() * 6.2831853, v = Math.acos(rr(-0.4, 1)), f = rr(0.55, 0.95);
          centers.push([tx + Math.cos(u) * Math.sin(v) * rx * f, base + cy + Math.cos(v) * ry * f, tz + Math.sin(u) * Math.sin(v) * rx * f]);
        }
        // a few branches from the trunk top to the clumps
        if (trunkR > 0) {
          for (var b = 0; b < centers.length; b += 2) {
            var c0 = centers[b], top = base + hb;
            for (var bt = 0; bt < 18; bt++) {
              var tt = rnd();
              put(tx + (c0[0] - tx) * tt, top + (c0[1] - top) * tt, tz + (c0[2] - tz) * tt, bark[0], bark[1], bark[2]);
            }
          }
        }
        var spread = Math.max(0.5, rx * 0.28);
        for (var c2 = 0; c2 < cn; c2++) {
          var ce = centers[(rnd() * centers.length) | 0];
          var px = ce[0] + gauss() * spread, py = ce[1] + gauss() * spread * 0.6, pz = ce[2] + gauss() * spread;
          if (py < base + 0.2) py = base + 0.2 + rnd() * 0.3;
          var lc2 = leafColor(py - base);
          put(px, py, pz, lc2[0], lc2[1], lc2[2]);
        }
      }
    }
    return { pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 4), count: n, bg: B.bg };
  }

  // ---------------------------------------------------------------- real scans
  // assets/hero/<key>.json + .lo.bin (250k points) + .hi.bin (2M), written by tools/make_hero_clouds.py on geos.
  // File layout: uint16 x, y, z in cm (each a block of n), then n uint8 ground flags; points in random order.
  // Each scan appears from the light file first; on desktops the full file follows and replaces it.
  var ASSET_V = '20261126-3'; // bump when assets/hero files change, so browsers don't keep old ones

  // Self-contained (also runs as a Web Worker): turns a file into GPU-ready arrays.
  // pos: uint16 x, height, y, 0 per point (cm); col: rgba bytes. Optionally picks the walking path.
  function decodeScan(buf, n, o) {
    var xs = new Uint16Array(buf, 0, n), ys = new Uint16Array(buf, n * 2, n), zs = new Uint16Array(buf, n * 4, n);
    var flag = new Uint8Array(buf, n * 6, n), i;
    var lo = o.lo, hi = o.hi;
    if (lo == null) { // colour range: 2nd to 98th percentile of vegetation height, so every scan uses the whole ramp
      var hs = [];
      for (i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) if (!flag[i]) hs.push(zs[i] / 100);
      hs.sort(function (a, b) { return a - b; });
      lo = hs.length ? hs[Math.floor(hs.length * 0.02)] : 0; hi = hs.length ? hs[Math.floor(hs.length * 0.98)] : (o.zmax || 30);
      if (hi - lo < 1) hi = lo + 1;
    }
    var pos = new Uint16Array(n * 4), col = new Uint8Array(n * 4), R = o.ramp, last = R.length - 1, g0 = o.ground[0], g1 = o.ground[1];
    var s = 99, span = 1 / (hi - lo);
    for (i = 0; i < n; i++) {
      var j = i * 4, z = zs[i];
      pos[j] = xs[i]; pos[j + 1] = z; pos[j + 2] = ys[i];
      s = (s * 16807) % 2147483647;
      var k = 255 * (0.85 + 0.3 * (s - 1) / 2147483646), r, g, b;
      if (flag[i]) { var gc = i & 1 ? g1 : g0; k *= 1.6; r = gc[0]; g = gc[1]; b = gc[2]; }
      else {
        var t = (z / 100 - lo) * span; t = (t < 0 ? 0 : t > 1 ? 1 : t) * last;
        var a = t < last ? t | 0 : last - 1, u = t - a, A = R[a], B = R[a + 1];
        r = A[0] + (B[0] - A[0]) * u; g = A[1] + (B[1] - A[1]) * u; b = A[2] + (B[2] - A[2]) * u;
      }
      col[j] = Math.min(255, r * k); col[j + 1] = Math.min(255, g * k); col[j + 2] = Math.min(255, b * k); col[j + 3] = 255;
    }
    var out = { pos: pos, col: col, n: n, lo: lo, hi: hi };
    if (o.wantPath) {
      // Walking circle and eye height with the least vegetation around the camera, so it walks through open
      // forest instead of brushing through shrubs. Eye level (1.7 m) is preferred; in dense forests the camera
      // rises into a sparser layer between the understory and the crowns.
      var size = o.size, gsz = Math.ceil(size), maxH = Math.max(3, Math.min(30, Math.floor(0.5 * hi))), nz = maxH + 3;
      var dens = new Float32Array(gsz * gsz * nz);
      for (i = 0; i < n; i++) {
        if (flag[i]) continue;
        var hz = zs[i] / 100 | 0;
        if (hz >= nz) continue;
        dens[(hz * gsz + Math.min(gsz - 1, ys[i] / 100 | 0)) * gsz + Math.min(gsz - 1, xs[i] / 100 | 0)]++;
      }
      var heights = [1.7];
      for (var hh = 3; hh <= maxH; hh++) heights.push(hh);
      var best = { r: 0.38 * size, h: 1.7 }, bestCost = Infinity, half = size / 2;
      for (var f = 0.12; f <= 0.42; f += 0.02) {
        var rad = f * size;
        for (var hi2 = 0; hi2 < heights.length; hi2++) {
          var H = heights[hi2], z0 = Math.max(0, Math.round(H - 1.5)), z1 = Math.min(nz - 1, Math.round(H + 1.5)), cost = 0;
          if (H < 2) z0 = 0; // at eye level count from just above the ground: 0.4 m shrubs block the view too
          for (var q = 0; q < 96; q++) {
            var ang = q / 96 * 6.2831853, px = Math.cos(ang) * rad + half, pz = Math.sin(ang) * rad + half;
            for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
              var gx = (px | 0) + dx, gz = (pz | 0) + dz;
              if (gx < 0 || gz < 0 || gx >= gsz || gz >= gsz) continue;
              for (var zz = z0; zz <= z1; zz++) cost += dens[(zz * gsz + gz) * gsz + gx];
            }
          }
          cost /= (z1 - z0 + 1);
          if (f > 0.3) cost *= 1 + (f - 0.3); // slight preference for staying inside the plot
          cost *= 1 + 0.03 * (H - 1.7); // and for eye level, unless higher up is clearly more open
          if (cost < bestCost) { bestCost = cost; best = { r: rad, h: H }; }
        }
      }
      out.path = best;
    }
    return out;
  }
  // .bin on the website; the claude.ai preview only serves web file types, so it gets the same bytes as .wasm
  function fetchScan(url) {
    function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }); }
    return get(url + '.bin?v=' + ASSET_V).catch(function () { return get(url + '.wasm?v=' + ASSET_V); });
  }
  // Decoding 2M points takes a few hundred ms; in a worker the walk keeps running meanwhile.
  var worker = null, jobs = {}, jobId = 0;
  try {
    var src = 'var ASSET_V=' + JSON.stringify(ASSET_V) + ';' + decodeScan.toString() + fetchScan.toString() +
      'onmessage=function(e){var d=e.data;fetchScan(d.url).then(function(b){var r=decodeScan(b,d.n,d.o);r.id=d.id;postMessage(r,[r.pos.buffer,r.col.buffer]);})' +
      '.catch(function(err){postMessage({id:d.id,error:String(err)});});};';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = function (e) { var j = jobs[e.data.id]; delete jobs[e.data.id]; if (j) (e.data.error ? j.retry : j.ok)(e.data); }; // on a worker error, try once more without it
    worker.onerror = function () { worker = null; Object.keys(jobs).forEach(function (k) { var j = jobs[k]; delete jobs[k]; j.retry(); }); };
  } catch (e) { worker = null; }
  function scanJob(url, n, o) {
    var direct = function () { return fetchScan(url).then(function (b) { return decodeScan(b, n, o); }); };
    if (!worker) return direct();
    return new Promise(function (ok, no) {
      var id = ++jobId;
      jobs[id] = { ok: ok, no: no, retry: function () { direct().then(ok, no); } };
      worker.postMessage({ id: id, url: new URL(url, location.href).href, n: n, o: o });
    });
  }
  var metaCache = {};
  function loadMeta(name) {
    return metaCache[name] || (metaCache[name] = fetch('assets/hero/' + name + '.json?v=' + ASSET_V)
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .catch(function (e) { delete metaCache[name]; throw e; }));
  }
  function scanOpts(name, meta) {
    var B = biome(name), v = meta.view || {};
    return { ramp: SCAN_RAMP, ground: B.ground, size: meta.size, zmax: meta.zmax, wantPath: !(v.r && v.height) };
  }
  function loadReal(name) { // the light file, with camera path and colour range
    return loadMeta(name).then(function (meta) {
      return scanJob('assets/hero/' + name + '.lo', meta.lo.n, scanOpts(name, meta)).then(function (d) {
        var v = meta.view || {}, B = biome(name);
        var r = v.r ? v.r * meta.size : d.path.r, eyeH = v.height || (d.path ? d.path.h : 1.7);
        return { pos: d.pos, col: d.col, count: d.n, full: !small && meta.hi ? meta.hi.n : d.n, bg: B.bg, real: true, half: meta.size / 2,
          size: meta.size, dataset: meta.dataset, license: meta.license, credit: meta.credit, meta: meta, range: [d.lo, d.hi],
          view: { r: r, turn: v.turn != null ? v.turn : 0.55, height: eyeH,
                  pitch: v.pitch != null ? v.pitch : Math.max(0.04, Math.min(0.32, Math.atan((0.3 * d.hi - eyeH) / r))) } };
      });
    });
  }
  function loadDetail(name, c) { // the full file, same colours as the light one
    var o = scanOpts(name, c.meta); o.wantPath = false; o.lo = c.range[0]; o.hi = c.range[1];
    return scanJob('assets/hero/' + name + '.hi', c.meta.hi.n, o);
  }

  // ---------------------------------------------------------------- GL setup
  var VS = [
    'attribute vec3 aPos; attribute vec3 aCol;',
    'uniform mat4 uView; uniform mat4 uProj; uniform float uCamZ; uniform float uL; uniform float uFocal; uniform float uSize; uniform float uMaxPx; uniform float uNear; uniform float uFogFar; uniform float uPosScale; uniform vec3 uPosOff;',
    'varying vec3 vCol; varying float vFog; varying float vLd;',
    'void main(){',
    '  vec3 p = aPos * uPosScale + uPosOff;',
    '  p.z = mod(p.z - uCamZ + 0.12 * uL, uL) - 0.12 * uL;',
    '  vec4 v = uView * vec4(p, 1.0);',
    '  gl_Position = uProj * v;',
    '  float d = max(0.1, -v.z);',
    '  gl_PointSize = clamp(uSize * uFocal / d, 1.5, uMaxPx);',
    '  if (d < uNear) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);', // hide leaves brushing the camera
    '  vCol = aCol; vFog = smoothstep(uFogFar * 0.3, uFogFar, d) * 0.92;',
    '  vLd = clamp((log2(d) - 1.0) / 7.0, 0.004, 1.0);', // log depth 2 m .. 256 m in alpha, read by the depth pass
    '}'
  ].join('\n');
  var FS = [
    'precision mediump float;',
    'varying vec3 vCol; varying float vFog; varying float vLd;',
    'uniform vec3 uBg;',
    'void main(){',
    '  gl_FragColor = vec4(mix(vCol, uBg, vFog), vLd);',
    '}'
  ].join('\n');

  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aCol');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { hero.classList.add('no-webgl'); return; }
  gl.useProgram(prog);
  var U = {};
  ['uView', 'uProj', 'uCamZ', 'uL', 'uFocal', 'uSize', 'uMaxPx', 'uNear', 'uBg', 'uFogFar', 'uPosScale', 'uPosOff'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
  var aPos = gl.getAttribLocation(prog, 'aPos'), aCol = gl.getAttribLocation(prog, 'aCol');
  // two buffer pairs: the scan on screen, and the one being uploaded in slices to replace it
  var BUF = [{ pos: gl.createBuffer(), col: gl.createBuffer() }, { pos: gl.createBuffer(), col: gl.createBuffer() }], front = 0;
  gl.enable(gl.DEPTH_TEST);

  // ---------------------------------------------------------------- eye-dome lighting
  // Depth cue for real scans: points are rendered into one RGBA texture whose alpha holds log depth, then a
  // single full-screen pass darkens each pixel by how much its four neighbours sit in front of it. Edges of
  // stems and crowns get a dark rim, so you can see which branch is in front. One texture, five reads per
  // pixel, no depth texture: about as cheap as a depth cue gets.
  var EDL_FS = [
    'precision highp float;',
    'uniform sampler2D uColor; uniform vec2 uPx; uniform float uK;',
    'varying vec2 vUv;',
    'float nb(float d, vec2 o){ float dn = texture2D(uColor, vUv + o * uPx).a; return dn == 0.0 ? 0.0 : (d == 0.0 ? 100.0 : min(1.0, max(0.0, (d - dn) * 7.0))); }',
    'void main(){',
    '  vec4 c = texture2D(uColor, vUv); float d = c.a;', // capped per neighbour: a twig 10 m in front shades no harder than one 2x closer
    '  float sum = nb(d, vec2(1.0, 0.0)) + nb(d, vec2(-1.0, 0.0)) + nb(d, vec2(0.0, 1.0)) + nb(d, vec2(0.0, -1.0));',
    '  float e = exp(-sum * uK);',
    '  gl_FragColor = vec4(c.rgb * (d == 0.0 ? e : mix(0.3, 1.0, e)), 1.0);',
    '}'
  ].join('\n');
  var EDL_VS = 'attribute vec2 aXY; varying vec2 vUv; void main(){ vUv = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.0, 1.0); }';
  var edl = null;
  (function () {
    var p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, EDL_VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, EDL_FS));
    gl.bindAttribLocation(p, 0, 'aXY');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return;
    var e = { prog: p, U: {}, quad: gl.createBuffer(), fbo: gl.createFramebuffer(), color: gl.createTexture(), depth: gl.createRenderbuffer(), w: 0, h: 0 };
    ['uColor', 'uPx', 'uK'].forEach(function (k) { e.U[k] = gl.getUniformLocation(p, k); });
    gl.bindBuffer(gl.ARRAY_BUFFER, e.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, e.color);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    edl = e;
  })();
  function edlTarget(w, h) {
    if (edl.w !== w || edl.h !== h) {
      edl.w = w; edl.h = h;
      gl.bindTexture(gl.TEXTURE_2D, edl.color);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindRenderbuffer(gl.RENDERBUFFER, edl.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, edl.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, edl.color, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, edl.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); edl = null; return false; }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, edl.fbo);
    return true;
  }
  function edlResolve(w, h) {
    if (gl.invalidateFramebuffer) gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_ATTACHMENT]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(edl.prog);
    gl.bindTexture(gl.TEXTURE_2D, edl.color);
    gl.uniform1i(edl.U.uColor, 0);
    var r = EDL_RADIUS * renderScale;
    gl.uniform2f(edl.U.uPx, r / w, r / h);
    gl.uniform1f(edl.U.uK, 300 / 4 * EDL_STRENGTH);
    gl.disableVertexAttribArray(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, edl.quad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
    bindCloud();
  }
  // On by default. ?edl=0 turns it off, ?edl=0.05,2 sets strength and radius for testing.
  var EDL_RADIUS = 1.4, EDL_STRENGTH = 0.025;
  (function () {
    if (/[?&]edl=on\b/.test(location.search)) { EDL_STRENGTH = 0.025; return; }
    var q = /[?&]edl=([\d.]+)(?:,([\d.]+))?/.exec(location.search); if (q) { EDL_STRENGTH = +q[1]; if (q[2]) EDL_RADIUS = +q[2]; }
  })();

  var cloud = null;
  // Vertex layout. Default: uint16 x3 positions, 3 colour bytes (measured smooth on a Radeon laptop).
  // ?vf=4 tries 4 normalised components instead, which Direct3D reads without conversion; on that laptop
  // it measured worse, kept switchable for comparison.
  var VF4 = /[?&]vf=4\b/.test(location.search);
  var pending = null; // full-detail scan being copied to the GPU, a slice per frame
  function upload(c) {
    cloud = c; pending = null;
    var b = BUF[front];
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferData(gl.ARRAY_BUFFER, c.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.bufferData(gl.ARRAY_BUFFER, c.col, gl.STATIC_DRAW);
    c.pos = c.col = null; // the GPU has them now
    bindCloud();
  }
  // Copying 24 MB to the GPU in one go stalls a frame; slices of 100k points (1.2 MB) don't.
  function uploadDetail(c, d) {
    pending = { c: c, d: d, at: -1 };
  }
  function stepUpload() {
    var p = pending, b = BUF[1 - front], n = p.d.n;
    if (p.at < 0) { // first frame: only reserve the GPU memory
      gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferData(gl.ARRAY_BUFFER, p.d.pos.byteLength, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.bufferData(gl.ARRAY_BUFFER, p.d.col.byteLength, gl.STATIC_DRAW);
      p.at = 0; bindCloud(); return;
    }
    var end = Math.min(n, p.at + 100000);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.bufferSubData(gl.ARRAY_BUFFER, p.at * 8, p.d.pos.subarray(p.at * 4, end * 4));
    gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.bufferSubData(gl.ARRAY_BUFFER, p.at * 4, p.d.col.subarray(p.at * 4, end * 4));
    p.at = end;
    if (end >= n) { front = 1 - front; p.c.reveal = { from: p.c.count, t0: performance.now() }; p.c.count = n; pending = null; settle = Math.max(settle, 2); }
    bindCloud();
  }
  function bindCloud() {
    var b = BUF[front], real = cloud && cloud.real;
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(aPos);
    if (real) { if (VF4) gl.vertexAttribPointer(aPos, 4, gl.UNSIGNED_SHORT, true, 8, 0); else gl.vertexAttribPointer(aPos, 3, gl.UNSIGNED_SHORT, false, 8, 0); } else gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, VF4 ? 4 : 3, gl.UNSIGNED_BYTE, true, 4, 0);
  }

  // ---------------------------------------------------------------- math
  var NEAR = 0.3, FAR = 400;
  var PM = new Float32Array(16), VM = new Float32Array(16);
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    PM[0] = f / aspect; PM[5] = f; PM[10] = (far + near) * nf; PM[11] = -1; PM[14] = 2 * far * near * nf;
    return PM;
  }
  function setM(m, a) { for (var i = 0; i < 16; i++) m[i] = a[i]; return m; }
  function view(e, fw) {
    var s = [fw[1] * 0 - fw[2] * 1, fw[2] * 0 - fw[0] * 0, fw[0] * 1 - fw[1] * 0]; // cross(fw, up)
    var sl = Math.hypot(s[0], s[1], s[2]) || 1; s = [s[0] / sl, s[1] / sl, s[2] / sl];
    var u = [s[1] * fw[2] - s[2] * fw[1], s[2] * fw[0] - s[0] * fw[2], s[0] * fw[1] - s[1] * fw[0]];
    return {
      m: setM(VM, [
        s[0], u[0], -fw[0], 0,
        s[1], u[1], -fw[1], 0,
        s[2], u[2], -fw[2], 0,
        -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]), -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]), fw[0] * e[0] + fw[1] * e[1] + fw[2] * e[2], 1
      ]), s: s
    };
  }

  // ---------------------------------------------------------------- state
  var FOV = 70 * Math.PI / 180;
  var camZ = 0, speed = reduceMotion ? 0 : 0.5; // m/s, a slow stroll
  var yaw = 0, pitch = 0.06, tYaw = 0, tPitch = 0.06, basePitch = 0.06, dragYaw = 0, dragPitch = 0;
  var fogFar = 0, fogTarget = 120;
  var stereo = false, orient = null, orient0 = null;
  var visible = true, running = false, last = 0;
  var current = 'black-forest', loadToken = 0;
  var DATASETS = { 'black-forest': '2909', 'boreal': '1069', 'congo': '3140', 'borneo': '1477', 'australia': '1875', 'gabon': '1481' };
  // extra scans can borrow a palette: <button data-biome="my-scan" data-palette="congo">
  function biome(name) {
    if (BIOMES[name]) return BIOMES[name];
    var b = document.querySelector('button[data-biome="' + name + '"]');
    return b && BIOMES[b.dataset.palette];
  }

  // ---------------------------------------------------------------- adaptive quality
  // Goal: every frame on time. When frames start to miss the display's refresh, fewer points are drawn;
  // the points are stored in random order, so drawing the first part of the buffer thins the whole scan
  // evenly, and each point grows a little to keep the crowns closed. Changing the point count costs
  // nothing, unlike resizing the canvas, so resolution is lowered only as a last resort and never raised
  // again mid-walk (each resize reallocates buffers and stalls a frame).
  // ?q=0.5 fixes the share of points for testing; ?fps=1 shows frame rate, points and resolution.
  var Q_FIXED = (function () { var m = /[?&]q=([\d.]+)/.exec(location.search); return m ? Math.max(0.2, Math.min(1, +m[1])) : 0; })();
  var pts = Q_FIXED || 1, resLevel = 1, renderScale = 1;
  var vsync = 16.7, frameEma = 16.7, winT = 0, seen = 0, late = 0, bad = 0, calm = 0, settle = 0, ceiling = 1, ceilingAge = 0;
  function maxDpr() { return Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.5); }
  function adapt(rawMs, sec) {
    if (Q_FIXED || !cloud || !cloud.real) return;
    if (settle > 0) { settle -= sec; return; } // after a switch or a hidden tab, the first frames are not representative
    // refresh interval of the display: follows fast frames quickly, slow ones hardly at all (60 to 144 Hz)
    vsync += (rawMs - vsync) * (rawMs < vsync ? 0.3 : 0.002);
    vsync = Math.max(6.9, Math.min(17.5, vsync));
    // a single long stall (garbage collection, a tab switch) is not a sign of too many points: only count
    // frames that are steadily a bit too slow
    frameEma += (Math.min(rawMs, 250) - frameEma) * 0.1;
    seen++; if (rawMs > vsync * 1.6 && (rawMs < vsync * 3.5 || frameEma > vsync * 2)) late++;
    ceilingAge += sec; if (ceilingAge > 20) { ceiling = Math.min(1, ceiling + 0.1); ceilingAge = 10; }
    winT += sec;
    if (seen < 30 && (winT < 0.5 || seen < 3)) return; // a window is 30 frames or half a second
    bad = late * 10 >= seen ? bad + 1 : 0; // more than one frame in ten missed the refresh...
    if (bad >= 2) { // ...twice in a row (about one second)
      bad = 0; ceiling = pts; ceilingAge = 0; calm = 0; settle = 0.25;
      if (pts > 0.3) pts = Math.max(0.3, pts * (late * 2 >= seen ? 0.7 : 0.85));
      else if (resLevel > 0.7) resLevel = Math.max(0.7, resLevel - 0.15);
    } else if (late === 0 && !bad) {
      calm += seen * vsync / 1000;
      if (calm > 3 && pts < ceiling - 0.04) { pts = Math.min(1, ceiling - 0.04, pts + 0.05); calm = 0; }
    }
    seen = 0; late = 0; winT = 0;
  }
  function resize() {
    var dpr = Math.max(0.75, maxDpr() * resLevel);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    renderScale = canvas.width / Math.max(1, canvas.clientWidth);
  }
  // The full scan trickles in: the number of points drawn grows from the light scan's to all of them over
  // 3 s, and the points shrink as they get denser (see thin), so detail fills in instead of popping.
  function drawCount() {
    if (!cloud.real) return cloud.count;
    var n = Math.round(cloud.count * pts), rv = cloud.reveal;
    if (rv) {
      var k = Math.min(1, (performance.now() - rv.t0) / 3000), e = k * k * (3 - 2 * k);
      n = Math.min(n, Math.round(rv.from + (cloud.count - rv.from) * e));
      if (k >= 1) cloud.reveal = null;
    }
    return n;
  }
  var fpsBox = /[?&]fps=1/.test(location.search) ? document.createElement('div') : null, fpsN = 0, fpsT = 0;
  if (fpsBox) { fpsBox.style.cssText = 'position:fixed;left:8px;top:64px;z-index:99;font:12px/1.3 monospace;color:#fff;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:4px;pointer-events:none'; document.body.appendChild(fpsBox); }
  var fpsMax = 0, fpsPrev = 0;
  function fpsTick(t) {
    fpsN++; fpsMax = Math.max(fpsMax, t - fpsPrev); fpsPrev = t; if (t - fpsT < 500) return;
    fpsBox.textContent = Math.round(fpsN * 1000 / (t - fpsT)) + ' fps · longest ' + Math.round(fpsMax) + ' ms · ' + (cloud.count / 1e6).toFixed(2) + 'M × ' + Math.round(pts * 100) + '% points · ' +
      canvas.width + '×' + canvas.height + (edl && EDL_STRENGTH > 0 ? ' · depth on' : ' · depth off') + (worker ? '' : ' · no worker');
    fpsN = 0; fpsT = t; fpsMax = 0;
  }

  function drawEye(x0, w, h, eyeOffset) {
    gl.viewport(x0, 0, w, h);
    var bob = reduceMotion ? 0 : Math.sin(camZ * 1.9) * 0.025;
    var eye, yw = yaw;
    if (cloud.real) {
      var V = cloud.view, r = V.r, th = camZ / r;
      eye = [Math.cos(th) * r, V.height + bob, Math.sin(th) * r];
      yw = Math.atan2(-Math.sin(th), Math.cos(th)) + yaw - V.turn; // along the path around the plot, turned towards its centre
    } else {
      eye = [Math.sin(camZ * 0.05) * 0.6, 1.7 + bob + terrain(0, camZ), 0];
    }
    var fw = [Math.sin(yw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yw) * Math.cos(pitch)];
    var vv = view(eye, fw);
    if (eyeOffset) { eye = [eye[0] + vv.s[0] * eyeOffset, eye[1], eye[2] + vv.s[2] * eyeOffset]; vv = view(eye, fw); }
    var aspect = w / h;
    var fov = stereo ? 90 * Math.PI / 180 : (aspect < 0.8 ? 80 * Math.PI / 180 : FOV);
    gl.uniformMatrix4fv(U.uView, false, vv.m);
    gl.uniformMatrix4fv(U.uProj, false, perspective(fov, aspect, NEAR, FAR));
    gl.uniform1f(U.uFocal, (h / 2) / Math.tan(fov / 2));
    gl.drawArrays(gl.POINTS, 0, drawCount());
  }

  function frame(t) {
    if (!running || !cloud) { running = false; return; }
    var rawMs = t - last, dt = Math.min(0.05, rawMs / 1000 || 0); last = t;
    adapt(rawMs, Math.min(0.25, rawMs / 1000 || 0)); // real time, so a slow device is noticed quickly
    if (fpsBox) fpsTick(t);
    camZ += speed * dt;
    fogFar += (fogTarget - fogFar) * Math.min(1, dt * 1.6);
    if (orient) {
      yaw = orient.yaw; pitch = orient.pitch;
    } else {
      var sway = reduceMotion ? 0 : Math.sin(t / 9000) * 0.18;
      yaw += (tYaw + dragYaw + sway - yaw) * Math.min(1, dt * 3);
      pitch += (tPitch + dragPitch - pitch) * Math.min(1, dt * 3);
      pitch = Math.max(-0.9, Math.min(1.2, pitch));
    }
    resize();
    var bg = cloud.bg, W2 = canvas.width, H2 = canvas.height;
    var useEdl = !!(edl && cloud.real && EDL_STRENGTH > 0 && edlTarget(W2, H2));
    gl.clearColor(bg[0], bg[1], bg[2], useEdl ? 0 : 1); // alpha 0 marks sky for the depth pass
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (pending) stepUpload();
    if (cloud.real) { gl.uniform1f(U.uCamZ, 0); gl.uniform1f(U.uL, 100000); gl.uniform1f(U.uPosScale, VF4 ? 655.35 : 0.01); gl.uniform3f(U.uPosOff, -cloud.half, 0, -cloud.half); } // positions: uint16 cm -> m
    else { gl.uniform1f(U.uCamZ, camZ); gl.uniform1f(U.uL, L); gl.uniform1f(U.uPosScale, 1); gl.uniform3f(U.uPosOff, 0, 0, 0); }
    if (cloud.real) {
      var thin = Math.min(2, Math.sqrt(cloud.full / drawCount())); // fewer points drawn: make each a little larger so the crowns stay closed
      gl.uniform1f(U.uSize, (small ? 0.08 : 0.07) * thin); gl.uniform1f(U.uMaxPx, (small ? 4.0 : 5.0) * renderScale / maxDpr() * thin); gl.uniform1f(U.uNear, 2.2);
    }
    else { gl.uniform1f(U.uSize, small ? 0.11 : 0.13); gl.uniform1f(U.uMaxPx, 10.0); gl.uniform1f(U.uNear, 0.0); }
    gl.uniform3fv(U.uBg, bg); gl.uniform1f(U.uFogFar, fogFar);
    if (stereo) { drawEye(0, W2 / 2, H2, -0.032); drawEye(W2 / 2, W2 / 2, H2, 0.032); }
    else drawEye(0, W2, H2, 0);
    if (useEdl) edlResolve(W2, H2);
    if (reduceMotion && !stereo && Math.abs(fogTarget - fogFar) < 0.5 && !dragging) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible && !document.hidden) { running = true; last = performance.now(); settle = 0.6; requestAnimationFrame(frame); } }
  function stop() { running = false; }

  // ---------------------------------------------------------------- biome switch
  function setBiome(name) {
    if (!biome(name)) return;
    current = name;
    var token = ++loadToken;
    loadReal(name).catch(function () { return generate(name); }).then(function (c) {
      if (token !== loadToken) return;
      upload(c); settle = 2; idleSince = performance.now(); // the first frames after a new scan include buffer uploads
      if (c.real && c.full > c.count) loadDetail(name, c).then(function (d) { if (token === loadToken) { uploadDetail(c, d); prefetchOthers(); } }, function () {});
      else prefetchOthers();
      camZ = 0; // every scan starts at its chosen viewpoint
      basePitch = c.real ? c.view.pitch : 0.06; tPitch = basePitch; tYaw = 0; dragYaw = 0; dragPitch = 0;
      fogFar = 2; // forest emerges from the fog
      fogTarget = c.real ? Math.max(60, c.size * 0.9) : 120;
      hero.classList.toggle('is-real', !!c.real);
      document.querySelectorAll('[data-hero-dataset]').forEach(function (el) {
        var id = c.dataset || DATASETS[name] || '';
        if (el.tagName === 'A') el.href = 'https://3dtrees.earth/datasets/' + id; else el.textContent = id;
      });
      document.querySelectorAll('[data-hero-license]').forEach(function (el) { el.textContent = c.license || 'CC BY 4.0'; });
      document.querySelectorAll('[data-hero-credit]').forEach(function (el) { el.textContent = c.credit ? c.credit + ', ' : ''; });
      hero.classList.add('ready');
      start();
    });
    hero.dataset.biome = name;
    document.querySelectorAll('[data-biome]').forEach(function (b) {
      if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.biome === name));
    });
  }
  // Once the first scan is in, quietly fetch the light files of the other forests, so switching is quick.
  var prefetched = false;
  function prefetchOthers() {
    if (prefetched || small || (navigator.connection && navigator.connection.saveData)) return;
    prefetched = true;
    var keys = Array.prototype.map.call(document.querySelectorAll('button[data-biome]'), function (b) { return b.dataset.biome; });
    var later = window.requestIdleCallback ? function (f) { requestIdleCallback(f, { timeout: 4000 }); } : function (f) { setTimeout(f, 1500); };
    later(function () {
      keys.reduce(function (p, k) {
        return p.then(function () { return loadMeta(k).then(function () { return fetchScan('assets/hero/' + k + '.lo'); }).catch(function () {}); });
      }, Promise.resolve());
    });
  }
  document.querySelectorAll('button[data-biome]').forEach(function (b) {
    b.addEventListener('click', function () {
      setBiome(b.dataset.biome);
      if (b.dataset.scrollHero !== undefined) hero.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

  // ---------------------------------------------------------------- idle tour
  // With nothing clicked, moved or typed for 10 s, show the next forest. ?auto=0 switches this off.
  var AUTO = !/[?&]auto=0\b/.test(location.search) && !reduceMotion && !(navigator.connection && navigator.connection.saveData);
  var idleSince = performance.now(), IDLE_MS = 10000;
  function poke() { idleSince = performance.now(); }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (ev) {
    window.addEventListener(ev, poke, { passive: true, capture: true });
  });
  if (AUTO) setInterval(function () {
    if (!cloud || !cloud.real || stereo || dragging || !visible || document.hidden) { poke(); return; }
    if (performance.now() - idleSince < IDLE_MS) return;
    var keys = [];
    document.querySelectorAll('button[data-biome]').forEach(function (b) { if (keys.indexOf(b.dataset.biome) < 0) keys.push(b.dataset.biome); });
    if (keys.length > 1) setBiome(keys[(keys.indexOf(current) + 1) % keys.length]);
    poke();
  }, 500);

  // ---------------------------------------------------------------- look around
  var dragging = false, dx0 = 0, dy0 = 0, y0 = 0, p0 = 0;
  hero.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse' && !dragging) {
      var r = hero.getBoundingClientRect();
      tYaw = -((e.clientX - r.left) / r.width - 0.5) * 0.6;
      tPitch = basePitch - ((e.clientY - r.top) / r.height - 0.5) * 0.3;
    }
    if (dragging) {
      dragYaw = y0 + (e.clientX - dx0) * 0.004;
      dragPitch = p0 + (e.clientY - dy0) * 0.003;
      start();
    }
  });
  canvas.addEventListener('pointerdown', function (e) { dragging = true; dx0 = e.clientX; dy0 = e.clientY; y0 = dragYaw; p0 = dragPitch; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', function () { dragging = false; });
  canvas.addEventListener('pointercancel', function () { dragging = false; });

  // ---------------------------------------------------------------- cardboard mode
  function onOrient(e) {
    if (e.alpha == null) return;
    var d = Math.PI / 180, a = e.alpha * d, b = e.beta * d, g = e.gamma * d;
    var ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    // direction the back of the phone points to (east, north, up)
    var fx = -(ca * sg + sa * sb * cg), fy = -(sa * sg - ca * sb * cg), fz = -cb * cg;
    var heading = Math.atan2(fx, fy), elev = Math.asin(Math.max(-1, Math.min(1, fz)));
    if (orient0 === null) orient0 = heading;
    orient = { yaw: -(heading - orient0), pitch: elev };
  }
  var vrBtn = document.getElementById('vr-enter'), vrExit = document.getElementById('vr-exit');
  function enterVR() {
    stereo = true; hero.classList.add('vr');
    document.body.classList.add('vr-lock');
    var go = function () { orient0 = null; window.addEventListener('deviceorientation', onOrient); };
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(function (s) { if (s === 'granted') go(); }).catch(function () {});
    } else go();
    if (hero.requestFullscreen) hero.requestFullscreen().catch(function () {});
    try { screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
    start();
  }
  function exitVR() {
    stereo = false; orient = null; hero.classList.remove('vr');
    document.body.classList.remove('vr-lock');
    window.removeEventListener('deviceorientation', onOrient);
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }
  if (vrBtn) vrBtn.addEventListener('click', enterVR);
  if (vrExit) vrExit.addEventListener('click', exitVR);
  document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement && stereo) exitVR(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && stereo) exitVR(); });

  // ---------------------------------------------------------------- lifecycle
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) start(); else if (!stereo) stop();
    }).observe(hero);
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
  window.addEventListener('resize', function () { start(); });

  // Draw one point through every program once before the scan arrives: some drivers (ANGLE on Windows)
  // compile shaders on first use, which froze the first frame of the forest for ~200 ms.
  (function warmUp() {
    var p = gl.createBuffer(), c = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, p); gl.bufferData(gl.ARRAY_BUFFER, new Uint16Array(4), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos); if (VF4) gl.vertexAttribPointer(aPos, 4, gl.UNSIGNED_SHORT, true, 8, 0); else gl.vertexAttribPointer(aPos, 3, gl.UNSIGNED_SHORT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, c); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(4), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, VF4 ? 4 : 3, gl.UNSIGNED_BYTE, true, 4, 0);
    resize();
    var w = canvas.width, h = canvas.height, useEdl = !!(edl && EDL_STRENGTH > 0 && edlTarget(w, h));
    gl.viewport(0, 0, w, h); gl.clearColor(BG[0], BG[1], BG[2], useEdl ? 0 : 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, 1);
    if (useEdl) edlResolve(w, h);
    gl.deleteBuffer(p); gl.deleteBuffer(c);
  })();
  setBiome(current);
})();
