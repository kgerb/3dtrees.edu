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
  var small = Math.min(window.innerWidth, window.innerHeight) < 700;

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
  // Pick the walking circle and eye height with the least vegetation around the camera, so it walks
  // through open forest instead of brushing through shrubs. Eye level (1.7 m) is preferred; in dense
  // forests the camera rises into a sparser layer between the understory and the crowns.
  function openPath(xs, ys, zs, flag, n, size, top) {
    var g = Math.ceil(size), maxH = Math.max(3, Math.min(30, Math.floor(0.5 * top))), nz = maxH + 3;
    var dens = new Float32Array(g * g * nz);
    for (var i = 0; i < n; i++) {
      if (flag[i]) continue;
      var hz = zs[i] / 100 | 0;
      if (hz >= nz) continue;
      var cx = Math.min(g - 1, xs[i] / 100 | 0), cy = Math.min(g - 1, ys[i] / 100 | 0);
      dens[(hz * g + cy) * g + cx]++;
    }
    var heights = [1.7];
    for (var hh = 3; hh <= maxH; hh++) heights.push(hh);
    var best = { r: 0.38 * size, h: 1.7 }, bestCost = Infinity, half = size / 2;
    for (var f = 0.12; f <= 0.42; f += 0.02) {
      var r = f * size;
      for (var hi = 0; hi < heights.length; hi++) {
        var H = heights[hi], z0 = Math.max(0, Math.round(H - 1.5)), z1 = Math.min(nz - 1, Math.round(H + 1.5)), cost = 0;
        if (H < 2) z0 = 0; // at eye level count from just above the ground: 0.4 m shrubs block the view too
        for (var k = 0; k < 96; k++) {
          var a = k / 96 * 6.2831853, px = Math.cos(a) * r + half, pz = Math.sin(a) * r + half;
          for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
            var gx = (px | 0) + dx, gz = (pz | 0) + dz;
            if (gx < 0 || gz < 0 || gx >= g || gz >= g) continue;
            for (var z = z0; z <= z1; z++) cost += dens[(z * g + gz) * g + gx];
          }
        }
        cost /= (z1 - z0 + 1);
        if (f > 0.3) cost *= 1 + (f - 0.3); // slight preference for staying inside the plot
        cost *= 1 + 0.03 * (H - 1.7); // and for eye level, unless higher up is clearly more open
        if (cost < bestCost) { bestCost = cost; best = { r: r, h: H }; }
      }
    }
    return best;
  }
  // assets/hero/<key>.json + .bin, written by tools/make_hero_clouds.py from 3Dtrees.earth datasets.
  var ASSET_V = '20261126-3'; // bump when assets/hero files change, so browsers don't keep old ones
  function loadReal(name) {
    var base = 'assets/hero/' + name;
    return fetch(base + '.json?v=' + ASSET_V).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (meta) {
      var lod = small || !meta.hi ? 'lo' : 'hi';
      // .bin on the website; the claude.ai preview only serves web file types, so it gets the same bytes as .wasm
      function get(ext) { return fetch(base + '.' + lod + ext + '?v=' + ASSET_V).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }); }
      return get('.bin').catch(function () { return get('.wasm'); }).then(function (buf) {
        var n = meta[lod].n, xs = new Uint16Array(buf, 0, n), ys = new Uint16Array(buf, n * 2, n), zs = new Uint16Array(buf, n * 4, n);
        var flag = new Uint8Array(buf, n * 6, n);
        var B = biome(name), half = meta.size / 2;
        // colour range: 2nd to 98th percentile of vegetation height in this scan, so every scan uses the whole ramp
        var hs = [];
        for (var q = 0; q < n; q += Math.max(1, Math.floor(n / 20000))) if (!flag[q]) hs.push(zs[q] / 100);
        hs.sort(function (a, b) { return a - b; });
        var lo = hs.length ? hs[Math.floor(hs.length * 0.02)] : 0, hi = hs.length ? hs[Math.floor(hs.length * 0.98)] : (meta.zmax || 30);
        if (hi - lo < 1) hi = lo + 1;
        var pos = new Float32Array(n * 3), col = new Uint8Array(n * 4);
        seed = 99;
        for (var i = 0; i < n; i++) {
          var j = i * 3, h = zs[i] / 100;
          pos[j] = xs[i] / 100 - half; pos[j + 1] = h; pos[j + 2] = ys[i] / 100 - half;
          var c, k = 0.85 + 0.3 * rnd();
          if (flag[i]) { c = B.ground[i & 1]; k *= 1.6; }
          else {
            c = ramp(SCAN_RAMP, (h - lo) / (hi - lo));
          }
          var jc = i * 4;
          col[jc] = Math.min(255, c[0] * k * 255); col[jc + 1] = Math.min(255, c[1] * k * 255); col[jc + 2] = Math.min(255, c[2] * k * 255);
        }
        var v = meta.view || {}, op = v.r && v.height ? null : openPath(xs, ys, zs, flag, n, meta.size, hi);
        var r = v.r ? v.r * meta.size : op.r, eyeH = v.height || (op ? op.h : 1.7);
        return { pos: pos, col: col, count: n, bg: B.bg, real: true, size: meta.size, dataset: meta.dataset, license: meta.license, credit: meta.credit,
          view: { r: r, turn: v.turn != null ? v.turn : 0.55, height: eyeH,
                  pitch: v.pitch != null ? v.pitch : Math.max(0.04, Math.min(0.32, Math.atan((0.3 * hi - eyeH) / r))) } };
      });
    });
  }

  // ---------------------------------------------------------------- GL setup
  var VS = [
    'attribute vec3 aPos; attribute vec3 aCol;',
    'uniform mat4 uView; uniform mat4 uProj; uniform float uCamZ; uniform float uL; uniform float uFocal; uniform float uSize; uniform float uMaxPx; uniform float uNear; uniform float uFogFar;',
    'varying vec3 vCol; varying float vFog; varying float vLd;',
    'void main(){',
    '  vec3 p = aPos;',
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
  ['uView', 'uProj', 'uCamZ', 'uL', 'uFocal', 'uSize', 'uMaxPx', 'uNear', 'uBg', 'uFogFar'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
  var aPos = gl.getAttribLocation(prog, 'aPos'), aCol = gl.getAttribLocation(prog, 'aCol');
  var bufPos = gl.createBuffer(), bufCol = gl.createBuffer();
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
  var EDL_RADIUS = 1.4, EDL_STRENGTH = 0.025; // ?edl=0 in the URL turns it off, ?edl=0.05,2 sets strength and radius for testing
  (function () { var q = /[?&]edl=([\d.]+)(?:,([\d.]+))?/.exec(location.search); if (q) { EDL_STRENGTH = +q[1]; if (q[2]) EDL_RADIUS = +q[2]; } })();

  var cloud = null;
  function upload(c) {
    cloud = c;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.bufferData(gl.ARRAY_BUFFER, c.pos, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol); gl.bufferData(gl.ARRAY_BUFFER, c.col, gl.STATIC_DRAW);
    bindCloud();
  }
  function bindCloud() {
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol); gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.UNSIGNED_BYTE, true, 4, 0);
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
  var vsync = 16.7, seen = 0, late = 0, calm = 0, settle = 0, ceiling = 1, ceilingAge = 0;
  function maxDpr() { return Math.min(window.devicePixelRatio || 1, small || EDL_STRENGTH > 0 ? 1.25 : 1.5); }
  function adapt(rawMs, sec) {
    if (Q_FIXED || !cloud || !cloud.real) return;
    if (settle > 0) { settle -= sec; return; } // after a switch or a hidden tab, the first frames are not representative
    // refresh interval of the display: follows fast frames quickly, slow ones hardly at all (60 to 144 Hz)
    vsync += (rawMs - vsync) * (rawMs < vsync ? 0.3 : 0.002);
    vsync = Math.max(6.9, Math.min(17.5, vsync));
    seen++; if (rawMs > vsync * 1.6) late++;
    ceilingAge += sec; if (ceilingAge > 20) { ceiling = Math.min(1, ceiling + 0.1); ceilingAge = 10; }
    if (seen < 30) return;
    if (late >= 3) { // more than one frame in ten missed the refresh
      ceiling = pts; ceilingAge = 0; calm = 0; settle = 0.25;
      if (pts > 0.3) pts = Math.max(0.3, pts * (late > 12 ? 0.7 : 0.85));
      else if (resLevel > 0.7) resLevel = Math.max(0.7, resLevel - 0.15);
    } else if (late === 0) {
      calm += seen * vsync / 1000;
      if (calm > 3 && pts < ceiling - 0.04) { pts = Math.min(1, ceiling - 0.04, pts + 0.05); calm = 0; }
    }
    seen = 0; late = 0;
  }
  function resize() {
    var dpr = Math.max(0.75, maxDpr() * resLevel);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    renderScale = canvas.width / Math.max(1, canvas.clientWidth);
  }
  function drawCount() { return cloud.real ? Math.round(cloud.count * pts) : cloud.count; }
  var fpsBox = /[?&]fps=1/.test(location.search) ? document.createElement('div') : null, fpsN = 0, fpsT = 0;
  if (fpsBox) { fpsBox.style.cssText = 'position:fixed;left:8px;top:64px;z-index:99;font:12px/1.3 monospace;color:#fff;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:4px;pointer-events:none'; document.body.appendChild(fpsBox); }
  function fpsTick(t) {
    fpsN++; if (t - fpsT < 500) return;
    fpsBox.textContent = Math.round(fpsN * 1000 / (t - fpsT)) + ' fps · ' + Math.round(pts * 100) + '% points · ' + canvas.width + '×' + canvas.height + (edl && EDL_STRENGTH > 0 ? ' · depth on' : ' · depth off');
    fpsN = 0; fpsT = t;
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
    if (cloud.real) { gl.uniform1f(U.uCamZ, 0); gl.uniform1f(U.uL, 100000); } else { gl.uniform1f(U.uCamZ, camZ); gl.uniform1f(U.uL, L); }
    if (cloud.real) {
      var thin = Math.sqrt(cloud.count / drawCount()); // fewer points drawn: make each a little larger so the crowns stay closed
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
      upload(c); settle = 0.8;
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
  document.querySelectorAll('button[data-biome]').forEach(function (b) {
    b.addEventListener('click', function () {
      setBiome(b.dataset.biome);
      if (b.dataset.scrollHero !== undefined) hero.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    });
  });

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
  window.addEventListener('resize', function () { small = Math.min(window.innerWidth, window.innerHeight) < 700; start(); });

  setBiome(current);
})();
