// ForestVerse hero: an endless walk through a procedurally generated point-cloud forest.
// Plain WebGL, no dependencies. Illustration only: the trees are generated, not scanned.
(function () {
  'use strict';

  var hero = document.getElementById('hero-forest');
  var canvas = document.getElementById('forest-canvas');
  if (!hero || !canvas) return;

  var gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
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
    var B = BIOMES[name];
    seed = 4242 + name.length * 977;
    var maxPts = Math.round((small ? 90000 : 190000) * B.budget);
    var pos = new Float32Array(maxPts * 3), col = new Float32Array(maxPts * 3);
    var n = 0;
    var maxH = 0;
    B.mix.forEach(function (m) { maxH = Math.max(maxH, m.h[1]); });

    function put(x, y, z, r, g, b) {
      if (n >= maxPts) return;
      var j = n * 3;
      // wrap z so the strip repeats seamlessly
      z = ((z % L) + L) % L;
      pos[j] = x; pos[j + 1] = y; pos[j + 2] = z;
      var k = 0.85 + 0.3 * rnd();
      col[j] = Math.min(1, r * k); col[j + 1] = Math.min(1, g * k); col[j + 2] = Math.min(1, b * k);
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
    return { pos: pos.subarray(0, n * 3), col: col.subarray(0, n * 3), count: n, bg: B.bg };
  }

  // ---------------------------------------------------------------- real scans
  // assets/hero/<key>.json + .bin, written by tools/make_hero_clouds.py from 3Dtrees.earth datasets.
  function loadReal(name) {
    var base = 'assets/hero/' + name;
    return fetch(base + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (meta) {
      var lod = small || !meta.hi ? 'lo' : 'hi';
      return fetch(base + '.' + lod + '.bin').then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); }).then(function (buf) {
        var n = meta[lod].n, xs = new Uint16Array(buf, 0, n), ys = new Uint16Array(buf, n * 2, n), zs = new Uint16Array(buf, n * 4, n);
        var flag = new Uint8Array(buf, n * 6, n);
        var B = BIOMES[name], half = meta.size / 2, zmax = meta.zmax || 30;
        var pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
        seed = 99;
        for (var i = 0; i < n; i++) {
          var j = i * 3, h = zs[i] / 100;
          pos[j] = xs[i] / 100 - half; pos[j + 1] = h; pos[j + 2] = ys[i] / 100 - half;
          var c, k = 0.85 + 0.3 * rnd();
          if (flag[i]) { c = B.ground[i & 1]; k *= 1.6; }
          else {
            var t = Math.min(1, h / zmax), a = t < 0.5 ? VIRIDIS[0] : VIRIDIS[1], b2 = t < 0.5 ? VIRIDIS[1] : VIRIDIS[2], u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
            c = [a[0] + (b2[0] - a[0]) * u, a[1] + (b2[1] - a[1]) * u, a[2] + (b2[2] - a[2]) * u];
          }
          col[j] = Math.min(1, c[0] * k); col[j + 1] = Math.min(1, c[1] * k); col[j + 2] = Math.min(1, c[2] * k);
        }
        return { pos: pos, col: col, count: n, bg: B.bg, real: true, size: meta.size, dataset: meta.dataset, license: meta.license };
      });
    });
  }

  // ---------------------------------------------------------------- GL setup
  var VS = [
    'attribute vec3 aPos; attribute vec3 aCol;',
    'uniform mat4 uView; uniform mat4 uProj; uniform float uCamZ; uniform float uL; uniform float uFocal; uniform float uSize;',
    'varying vec3 vCol; varying float vDepth;',
    'void main(){',
    '  vec3 p = aPos;',
    '  p.z = mod(p.z - uCamZ + 0.12 * uL, uL) - 0.12 * uL;',
    '  vec4 v = uView * vec4(p, 1.0);',
    '  gl_Position = uProj * v;',
    '  float d = max(0.1, -v.z);',
    '  gl_PointSize = clamp(uSize * uFocal / d, 1.5, 10.0);',
    '  vCol = aCol; vDepth = d;',
    '}'
  ].join('\n');
  var FS = [
    'precision mediump float;',
    'varying vec3 vCol; varying float vDepth;',
    'uniform vec3 uBg; uniform float uFogFar;',
    'void main(){',
    '  vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard;',
    '  float f = smoothstep(uFogFar * 0.3, uFogFar, vDepth) * 0.92;',
    '  gl_FragColor = vec4(mix(vCol, uBg, f), 1.0);',
    '}'
  ].join('\n');

  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { hero.classList.add('no-webgl'); return; }
  gl.useProgram(prog);
  var U = {};
  ['uView', 'uProj', 'uCamZ', 'uL', 'uFocal', 'uSize', 'uBg', 'uFogFar'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
  var aPos = gl.getAttribLocation(prog, 'aPos'), aCol = gl.getAttribLocation(prog, 'aCol');
  var bufPos = gl.createBuffer(), bufCol = gl.createBuffer();
  gl.enable(gl.DEPTH_TEST);

  var cloud = null;
  function upload(c) {
    cloud = c;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufPos); gl.bufferData(gl.ARRAY_BUFFER, c.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCol); gl.bufferData(gl.ARRAY_BUFFER, c.col, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);
  }

  // ---------------------------------------------------------------- math
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function view(e, fw) {
    var s = [fw[1] * 0 - fw[2] * 1, fw[2] * 0 - fw[0] * 0, fw[0] * 1 - fw[1] * 0]; // cross(fw, up)
    var sl = Math.hypot(s[0], s[1], s[2]) || 1; s = [s[0] / sl, s[1] / sl, s[2] / sl];
    var u = [s[1] * fw[2] - s[2] * fw[1], s[2] * fw[0] - s[0] * fw[2], s[0] * fw[1] - s[1] * fw[0]];
    return {
      m: new Float32Array([
        s[0], u[0], -fw[0], 0,
        s[1], u[1], -fw[1], 0,
        s[2], u[2], -fw[2], 0,
        -(s[0] * e[0] + s[1] * e[1] + s[2] * e[2]), -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]), fw[0] * e[0] + fw[1] * e[1] + fw[2] * e[2], 1
      ]), s: s
    };
  }

  // ---------------------------------------------------------------- state
  var FOV = 70 * Math.PI / 180;
  var camZ = 0, speed = reduceMotion ? 0 : 1.25; // m/s, a slow walk
  var yaw = 0, pitch = 0.06, tYaw = 0, tPitch = 0.06, dragYaw = 0, dragPitch = 0;
  var fogFar = 0, fogTarget = 120;
  var stereo = false, orient = null, orient0 = null;
  var visible = true, running = false, last = 0;
  var current = 'black-forest', loadToken = 0;
  var DATASETS = { 'black-forest': '2909', 'boreal': '1069', 'congo': '3140', 'borneo': '1477', 'australia': '1875' };

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function drawEye(x0, w, h, eyeOffset) {
    gl.viewport(x0, 0, w, h);
    var bob = reduceMotion ? 0 : Math.sin(camZ * 1.9) * 0.025;
    var eye, yw = yaw;
    if (cloud.real) {
      var r = cloud.size * 0.3, th = camZ / r;
      eye = [Math.cos(th) * r, 1.7 + bob, Math.sin(th) * r];
      yw = Math.atan2(-Math.sin(th), Math.cos(th)) + yaw - 0.35; // along the path, turned slightly towards the plot centre
    } else {
      eye = [Math.sin(camZ * 0.05) * 0.6, 1.7 + bob + terrain(0, camZ), 0];
    }
    var fw = [Math.sin(yw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yw) * Math.cos(pitch)];
    var vv = view(eye, fw);
    if (eyeOffset) { eye = [eye[0] + vv.s[0] * eyeOffset, eye[1], eye[2] + vv.s[2] * eyeOffset]; vv = view(eye, fw); }
    var aspect = w / h;
    var fov = stereo ? 90 * Math.PI / 180 : (aspect < 0.8 ? 80 * Math.PI / 180 : FOV);
    gl.uniformMatrix4fv(U.uView, false, vv.m);
    gl.uniformMatrix4fv(U.uProj, false, perspective(fov, aspect, 0.1, 400));
    gl.uniform1f(U.uFocal, (h / 2) / Math.tan(fov / 2));
    gl.drawArrays(gl.POINTS, 0, cloud.count);
  }

  function frame(t) {
    if (!running || !cloud) { running = false; return; }
    var dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
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
    var bg = cloud.bg;
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (cloud.real) { gl.uniform1f(U.uCamZ, 0); gl.uniform1f(U.uL, 100000); } else { gl.uniform1f(U.uCamZ, camZ); gl.uniform1f(U.uL, L); }
    gl.uniform1f(U.uSize, small ? 0.11 : 0.13);
    gl.uniform3fv(U.uBg, bg); gl.uniform1f(U.uFogFar, fogFar);
    var W2 = canvas.width, H2 = canvas.height;
    if (stereo) { drawEye(0, W2 / 2, H2, -0.032); drawEye(W2 / 2, W2 / 2, H2, 0.032); }
    else drawEye(0, W2, H2, 0);
    if (reduceMotion && !stereo && Math.abs(fogTarget - fogFar) < 0.5 && !dragging) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function start() { if (!running && visible && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(frame); } }
  function stop() { running = false; }

  // ---------------------------------------------------------------- biome switch
  function setBiome(name) {
    if (!BIOMES[name]) return;
    current = name;
    var token = ++loadToken;
    loadReal(name).catch(function () { return generate(name); }).then(function (c) {
      if (token !== loadToken) return;
      upload(c);
      fogFar = 2; // forest emerges from the fog
      fogTarget = c.real ? Math.max(60, c.size * 0.9) : 120;
      hero.classList.toggle('is-real', !!c.real);
      document.querySelectorAll('[data-hero-dataset]').forEach(function (el) {
        var id = c.dataset || DATASETS[name] || '';
        if (el.tagName === 'A') el.href = 'https://3dtrees.earth/datasets/' + id; else el.textContent = id;
      });
      document.querySelectorAll('[data-hero-license]').forEach(function (el) { el.textContent = c.license || 'CC BY 4.0'; });
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
      tPitch = 0.06 - ((e.clientY - r.top) / r.height - 0.5) * 0.3;
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
