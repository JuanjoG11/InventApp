// xmas.js — Temática navideña para InventApp
// Guardar y servir en UTF-8
// Incluir en <head> con:  <script src="xmas.js?v=1" defer></script>

(function () {
  /* ───────────── CONFIGURACIÓN ───────────── */
  var ENABLED  = true;   // false = desactiva todo sin borrar el archivo
  var SEASONAL = false;  // true = solo activo entre el 1-dic y el 6-ene

  /* ──────────── GUARD ESTACIONAL ─────────── */
  if (!ENABLED) return;
  if (SEASONAL) {
    var now = new Date();
    var m = now.getMonth() + 1; // 1-12
    var d = now.getDate();
    var active = (m === 12) || (m === 1 && d <= 6);
    if (!active) return;
  }

  /* ──────────── GUARD DE DUPLICADOS ──────── */
  if (document.querySelector('[class^="xmas-greet-"]') ||
      document.querySelector('[class*=" xmas-greet-"]')) return;

  /* ──────────── UTILIDADES ────────────────── */
  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function isDark() {
    return document.body.classList.contains('dark-theme') ||
           document.documentElement.classList.contains('dark-theme') ||
           document.documentElement.getAttribute('data-theme') === 'dark';
  }

  /* ══════════════════════════════════════════
     1. NIEVE
  ══════════════════════════════════════════ */
  function initSnow() {
    var canvas = document.createElement('canvas');
    canvas.id = 'xmas-snow-canvas';
    canvas.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:99999',
      'display:block'
    ].join(';');
    document.body.appendChild(canvas);

    var ctx = canvas.getContext('2d');
    var flakes = [];
    var W, H;
    var raf = null;
    var paused = false;

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function createFlakes() {
      flakes = [];
      var count = Math.floor((W * H) / 18000);
      count = Math.max(40, Math.min(count, 120));
      for (var i = 0; i < count; i++) {
        flakes.push({
          x:     Math.random() * W,
          y:     Math.random() * H,
          r:     1.5 + Math.random() * 2.5,
          speed: 0.4 + Math.random() * 0.7,
          swing: Math.random() * Math.PI * 2,
          swingSpeed: 0.008 + Math.random() * 0.012,
          swingAmp:   15 + Math.random() * 25,
          opacity:    0.15 + Math.random() * 0.25
        });
      }
    }

    function step() {
      if (paused) { raf = requestAnimationFrame(step); return; }

      ctx.clearRect(0, 0, W, H);
      var color = isDark() ? '255,255,255' : '80,80,100';

      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.swing += f.swingSpeed;
        f.x += Math.sin(f.swing) * 0.4;
        f.y += f.speed;

        if (f.y > H + 5) {
          f.y = -5;
          f.x = Math.random() * W;
        }
        if (f.x > W + 5) f.x = -5;
        if (f.x < -5)    f.x = W + 5;

        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + color + ',' + f.opacity + ')';
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    }

    function start() {
      resize();
      createFlakes();
      if (!raf) raf = requestAnimationFrame(step);
    }

    document.addEventListener('visibilitychange', function () {
      paused = document.hidden;
    });

    window.addEventListener('resize', function () {
      resize();
      createFlakes();
    });

    start();
  }

  /* ══════════════════════════════════════════
     2. GORRITO DE NAVIDAD
  ══════════════════════════════════════════ */
  function drawHat(canvas) {
    var W = canvas.width;
    var H = canvas.height;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    // Cuerpo del gorro (triángulo redondeado)
    ctx.beginPath();
    ctx.moveTo(W * 0.50, H * 0.08);
    ctx.quadraticCurveTo(W * 0.90, H * 0.35, W * 0.85, H * 0.72);
    ctx.lineTo(W * 0.15, H * 0.72);
    ctx.quadraticCurveTo(W * 0.10, H * 0.35, W * 0.50, H * 0.08);
    ctx.closePath();

    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, '#ef4444');
    grad.addColorStop(1, '#b91c1c');
    ctx.fillStyle = grad;
    ctx.fill();

    // Banda blanca inferior
    ctx.beginPath();
    ctx.rect(W * 0.10, H * 0.68, W * 0.80, H * 0.17);
    ctx.fillStyle = '#f1f5f9';
    ctx.fill();

    // Pompón blanco
    ctx.beginPath();
    ctx.arc(W * 0.50, H * 0.11, W * 0.13, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function initHat() {
    var hatW = 56;
    var hatH = 54;

    // Crear el canvas del gorro una sola vez
    var canvas = document.createElement('canvas');
    canvas.id = 'xmas-hat-canvas';
    canvas.width  = hatW;
    canvas.height = hatH;
    canvas.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:100000',
      'transform:rotate(-45deg)',
      'transform-origin:center center',
      'transition:left .2s,top .2s'
    ].join(';');
    document.body.appendChild(canvas);
    drawHat(canvas);

    // Decide qué elemento anclar: login visible → panel login; dashboard visible → app-header
    function getTarget() {
      var loginScreen = document.getElementById('login-screen');
      var loginVisible = loginScreen &&
        getComputedStyle(loginScreen).display !== 'none';

      if (loginVisible) {
        // Panel de paso 1 visible
        var step1 = document.getElementById('login-step-credentials');
        if (step1 && getComputedStyle(step1).display !== 'none') return step1;
        // Panel de paso 2 visible
        var step2 = document.getElementById('login-step-block');
        if (step2 && getComputedStyle(step2).display !== 'none') return step2;
        return step1 || loginScreen;
      }

      // Dashboard visible
      return document.querySelector('.app-header') ||
             document.querySelector('header') ||
             null;
    }

    // Reposiciona el canvas sobre la esquina superior-izquierda del target actual
    function reposition() {
      var t = getTarget();
      if (!t) {
        canvas.style.display = 'none';
        return;
      }
      canvas.style.display = 'block';
      var r = t.getBoundingClientRect();
      canvas.style.left = (r.left - hatW * 0.5) + 'px';
      canvas.style.top  = (r.top  - hatH * 0.5) + 'px';
    }

    // Repositioning tras un frame de pintura para que getBoundingClientRect sea fiable
    function scheduleReposition() {
      requestAnimationFrame(function () {
        requestAnimationFrame(reposition); // doble rAF: espera layout + paint
      });
    }

    reposition();
    window.addEventListener('resize', scheduleReposition);
    window.addEventListener('scroll', reposition, { passive: true });

    // Observar cambios de estilo en #login-screen y .app-container (hijos directos de body)
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(scheduleReposition);

      // Observar atributo style en los nodos que cambian de display
      var loginScreen   = document.getElementById('login-screen');
      var appContainer  = document.querySelector('.app-container');
      var opts = { attributes: true, attributeFilter: ['style', 'class'] };
      if (loginScreen)  mo.observe(loginScreen,  opts);
      if (appContainer) mo.observe(appContainer, opts);

      // También observar hijos directos de login-screen (los panels)
      var step1 = document.getElementById('login-step-credentials');
      var step2 = document.getElementById('login-step-block');
      if (step1) mo.observe(step1, opts);
      if (step2) mo.observe(step2, opts);
    }
  }

  /* ══════════════════════════════════════════
     3. TEXTO FESTIVO
  ══════════════════════════════════════════ */
  // ¡  → &#161;   ñ → &#241;   ó → &#243;   é → &#233;   á → &#225;
  var GREET_LOGIN = [
    '<span class="xmas-greet-emoji" style="background:none;-webkit-text-fill-color:initial;text-fill-color:initial;">&#127876;</span>',
    '<span class="xmas-greet-text">',
    '&#161;Feliz Navidad!',
    '</span>',
    '<span class="xmas-greet-emoji" style="background:none;-webkit-text-fill-color:initial;text-fill-color:initial;">&#127877;</span>'
  ].join(' ');

  var GREET_DASH = [
    '<span class="xmas-greet-emoji" style="background:none;-webkit-text-fill-color:initial;text-fill-color:initial;">&#127876;</span>',
    '<span class="xmas-greet-text">',
    '&#161;Feliz Navidad y Pr&#243;spero A&#241;o Nuevo!',
    '</span>',
    '<span class="xmas-greet-emoji" style="background:none;-webkit-text-fill-color:initial;text-fill-color:initial;">&#127877;</span>'
  ].join(' ');

  function injectStyles() {
    if (document.getElementById('xmas-styles')) return;
    var s = document.createElement('style');
    s.id = 'xmas-styles';
    s.textContent = [
      '.xmas-greet-login{',
        'display:block;',
        'text-align:center;',
        'margin-top:6px;',
        'margin-bottom:2px;',
        'font-size:0.95rem;',
        'font-weight:600;',
        'letter-spacing:0.01em;',
        'line-height:1.5;',
      '}',
      '.xmas-greet-banner{',
        'display:flex;',
        'align-items:center;',
        'justify-content:center;',
        'gap:6px;',
        'padding:7px 18px;',
        'margin:0 0 1rem 0;',
        'border-radius:10px;',
        'background:rgba(251,191,36,0.07);',
        'border:1px solid rgba(251,191,36,0.18);',
        'font-size:0.88rem;',
        'font-weight:600;',
        'letter-spacing:0.01em;',
        'line-height:1.5;',
      '}',
      '.xmas-greet-text{',
        'background:linear-gradient(90deg,#fbbf24,#ef4444,#22c55e);',
        '-webkit-background-clip:text;',
        'background-clip:text;',
        '-webkit-text-fill-color:transparent;',
        'text-fill-color:transparent;',
      '}',
      '.xmas-greet-emoji{',
        'display:inline-block;',
        'font-style:normal;',
      '}'
    ].join('');
    document.head.appendChild(s);
  }

  function addLoginGreet() {
    var loginHeader = document.querySelector('#login-step-credentials .login-header');
    if (!loginHeader) return;
    if (loginHeader.querySelector('.xmas-greet-login')) return;

    var h2 = loginHeader.querySelector('h2');
    var el = document.createElement('p');
    el.className = 'xmas-greet-login';
    el.innerHTML = GREET_LOGIN;

    if (h2 && h2.nextSibling) {
      loginHeader.insertBefore(el, h2.nextSibling);
    } else {
      loginHeader.appendChild(el);
    }
  }

  function addDashBanner() {
    var main = document.querySelector('.app-main, main');
    if (!main) return;
    if (main.querySelector('.xmas-greet-banner')) return;

    var banner = document.createElement('div');
    banner.className = 'xmas-greet-banner';
    banner.innerHTML = GREET_DASH;
    main.insertBefore(banner, main.firstChild);
  }

  function initGreets() {
    addLoginGreet();

    // Cuando el dashboard aparece, insertar el banner
    if (typeof MutationObserver !== 'undefined') {
      var greetMo = new MutationObserver(function () {
        var appContainer = document.querySelector('.app-container');
        if (appContainer && appContainer.style.display !== 'none' &&
            getComputedStyle(appContainer).display !== 'none') {
          addDashBanner();
        }
      });
      var appContainer = document.querySelector('.app-container');
      if (appContainer) {
        greetMo.observe(appContainer, { attributes: true, attributeFilter: ['style'] });
      }
      // Si el dashboard ya está visible
      if (appContainer && getComputedStyle(appContainer).display !== 'none') {
        addDashBanner();
      }
    }
  }

  /* ══════════════════════════════════════════
     INICIO
  ══════════════════════════════════════════ */
  function init() {
    injectStyles();

    if (!prefersReduced) {
      initSnow();
    }

    initGreets();

    // El gorro se posiciona después de que el layout esté pintado
    requestAnimationFrame(function () {
      setTimeout(initHat, 80);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
