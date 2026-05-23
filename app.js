/* ============================================================
 * PokéMystery Challenge — app.js
 * SPA · jQuery + GSAP · PokéAPI
 *
 * imágenes provienen de https://pokeapi.co/.
 * ============================================================ */

(function ($) {
  "use strict";

  // ============================================================
  // Config & State
  // ============================================================
  const CONFIG = {
    ROUNDS: 10,
    OPTIONS_PER_ROUND: 5,
    POKEMON_RANGE: 1025, // generations 1-9 + extras
    API_BASE: "https://pokeapi.co/api/v2",
    SOUND_KEY: "pokomyst:sound",
    BEST_KEY: "pokomyst:best",
  };

  const State = {
    masterList: null, // [{name, url}]
    pool: [],         // 10 detailed pokemon for this run
    round: 0,         // 0-indexed
    score: 0,
    history: [],      // per-round: true/false
    selected: false,
    soundOn: true,
    transitioning: false,
  };

  // ============================================================
  // Utilities
  // ============================================================
  const rand = (n) => Math.floor(Math.random() * n);
  const pickRandom = (arr) => arr[rand(arr.length)];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (_) { }
    }
  }

  // ============================================================
  // Tiny synth (WebAudio) — soft button + correct/error pings
  // ============================================================
  const Sound = (function () {
    let ctx = null;
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (_) { ctx = null; }
      }
      return ctx;
    }
    function tone(freq, dur, type, gain) {
      if (!State.soundOn) return;
      const c = ensure(); if (!c) return;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || "sine";
      o.frequency.value = freq;
      g.gain.value = 0;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(gain || 0.08, c.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur + 0.02);
    }
    return {
      tap() { tone(620, 0.08, "triangle", 0.05); },
      hover() { tone(880, 0.05, "sine", 0.025); },
      correct() {
        tone(660, 0.12, "triangle", 0.08);
        setTimeout(() => tone(990, 0.18, "triangle", 0.08), 90);
        setTimeout(() => tone(1320, 0.26, "triangle", 0.07), 200);
      },
      wrong() {
        tone(220, 0.18, "sawtooth", 0.06);
        setTimeout(() => tone(160, 0.30, "sawtooth", 0.06), 120);
      },
      win() {
        const seq = [523, 659, 784, 1046, 1318];
        seq.forEach((f, i) => setTimeout(() => tone(f, 0.22, "triangle", 0.08), i * 110));
      }
    };
  })();

  // ============================================================
  // Particles background
  // ============================================================
  (function initParticles() {
    const canvas = document.getElementById("particles");
    const ctx = canvas.getContext("2d");
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let particles = [];

    function resize() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const count = Math.min(80, Math.max(28, Math.floor((w * h) / 22000)));
      particles = new Array(count).fill(0).map(() => spawn());
    }
    function spawn() {
      const colors = ["#00e5ff", "#ff2e92", "#ffd84d", "#7b5cff", "#5cffa8"];
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.6 + Math.random() * 2.4,
        vx: (Math.random() - 0.5) * 0.18,
        vy: -0.05 - Math.random() * 0.28,
        a: 0.25 + Math.random() * 0.55,
        c: colors[rand(colors.length)],
        t: Math.random() * Math.PI * 2,
      };
    }
    function step() {
      ctx.clearRect(0, 0, w, h);
      for (let p of particles) {
        p.t += 0.01;
        p.x += p.vx + Math.sin(p.t) * 0.12;
        p.y += p.vy;
        if (p.y < -10 || p.x < -20 || p.x > w + 20) {
          Object.assign(p, spawn(), { y: h + 10 });
        }
        ctx.beginPath();
        ctx.fillStyle = p.c;
        ctx.globalAlpha = p.a;
        ctx.shadowBlur = 14;
        ctx.shadowColor = p.c;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(step);
    }

    window.addEventListener("resize", resize);
    resize();
    step();
  })();

  // ============================================================
  // Loader
  // ============================================================
  const Loader = {
    show(label) {
      $("#loader-label").text(label || "Cargando…");
      $("#loader").prop("hidden", false);
    },
    hide() { $("#loader").prop("hidden", true); }
  };

  // ============================================================
  // Toast
  // ============================================================
  function toast(msg, kind) {
    const $t = $('<div class="toast"></div>').text(msg);
    if (kind) $t.addClass("is-" + kind);
    $("#toast-wrap").append($t);
    setTimeout(() => {
      $t.css({ animation: "toastOut .35s ease forwards" });
      setTimeout(() => $t.remove(), 350);
    }, 2400);
  }

  // ============================================================
  // Sound toggle
  // ============================================================
  (function initSoundToggle() {
    State.soundOn = localStorage.getItem(CONFIG.SOUND_KEY) !== "0";
    function paint() {
      const $b = $("#sound-toggle");
      $b.toggleClass("is-off", !State.soundOn);
      $b.find("i")
        .removeClass()
        .addClass(State.soundOn ? "fa-solid fa-volume-high" : "fa-solid fa-volume-xmark");
    }
    paint();
    $("#sound-toggle").on("click", function () {
      State.soundOn = !State.soundOn;
      localStorage.setItem(CONFIG.SOUND_KEY, State.soundOn ? "1" : "0");
      paint();
      if (State.soundOn) Sound.tap();
    });
  })();

  // ============================================================
  // Screens
  // ============================================================
  function showScreen(id) {
    if (State.transitioning) return;
    State.transitioning = true;
    const $curr = $(".screen.is-active");
    const $next = $("#" + id);

    if ($curr.length === 0 || $curr.attr("id") === id) {
      $next.addClass("is-active");
      State.transitioning = false;
      return;
    }

    gsap.to($curr[0], {
      opacity: 0, y: -8, scale: .985, filter: "blur(6px)", duration: .32, ease: "power2.in",
      onComplete: () => {
        $curr.removeClass("is-active").css({ opacity: "", transform: "", filter: "" });
        $next.addClass("is-active");
        gsap.fromTo($next[0],
          { opacity: 0, y: 12, scale: .985, filter: "blur(6px)" },
          {
            opacity: 1, y: 0, scale: 1, filter: "blur(0px)", duration: .45, ease: "power3.out",
            onComplete: () => {
              gsap.set($next[0], { clearProps: "filter,transform,opacity" });
              State.transitioning = false;
            }
          });
      }
    });
  }

  // ============================================================
  // PokéAPI
  // ============================================================
  async function loadMasterList() {
    if (State.masterList) return State.masterList;
    const res = await fetch(`${CONFIG.API_BASE}/pokemon?limit=${CONFIG.POKEMON_RANGE}&offset=0`);
    if (!res.ok) throw new Error("No se pudo cargar la lista de Pokémon");
    const data = await res.json();
    State.masterList = data.results.map((r) => {
      // id from url
      const m = r.url.match(/\/pokemon\/(\d+)\/?$/);
      return { name: r.name, id: m ? Number(m[1]) : null };
    }).filter(p => p.id && p.id <= CONFIG.POKEMON_RANGE);
    return State.masterList;
  }

  async function fetchPokemon(idOrName) {
    const res = await fetch(`${CONFIG.API_BASE}/pokemon/${idOrName}`);
    if (!res.ok) throw new Error("Error cargando pokémon " + idOrName);
    const p = await res.json();

    const stats = {};
    p.stats.forEach((s) => { stats[s.stat.name] = s.base_stat; });
    const types = p.types.map((t) => t.type.name);

    const img =
      p.sprites?.other?.["official-artwork"]?.front_default ||
      p.sprites?.other?.home?.front_default ||
      p.sprites?.front_default ||
      "";

    return {
      id: p.id,
      name: p.name,
      img,
      types,
      hp: stats.hp ?? 0,
      atk: stats.attack ?? 0,
      def: stats.defense ?? 0,
      spd: stats.speed ?? 0,
      height: (p.height ?? 0) / 10, // dm → m
      weight: (p.weight ?? 0) / 10, // hg → kg
    };
  }

  function preloadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve();
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = src;
    });
  }

  // Build the run: 10 unique pokemon details, preload images
  async function buildRun() {
    const list = await loadMasterList();
    // pick 10 unique
    const picked = [];
    const seen = new Set();
    while (picked.length < CONFIG.ROUNDS) {
      const c = pickRandom(list);
      if (!seen.has(c.id)) { seen.add(c.id); picked.push(c); }
    }
    const details = await Promise.all(picked.map((c) => fetchPokemon(c.id)));
    // preload images
    await Promise.all(details.map((d) => preloadImage(d.img)));
    return details;
  }

  // ============================================================
  // Game flow
  // ============================================================
  async function startGame() {
    if (State.transitioning) return;
    Sound.tap();
    Loader.show("Atrapando Pokémon…");
    try {
      State.pool = await buildRun();
      State.round = 0;
      State.score = 0;
      State.history = [];
      Loader.hide();
      showScreen("screen-question");
      // wait a beat for screen transition
      setTimeout(renderRound, 380);
    } catch (e) {
      console.error(e);
      Loader.hide();
      toast("No se pudo conectar con PokéAPI. Reintenta.", "error");
    }
  }

  function buildOptionsForRound(answer) {
    const list = State.masterList || [];
    const distractors = [];
    const seen = new Set([answer.name]);
    let safety = 0;
    while (distractors.length < CONFIG.OPTIONS_PER_ROUND - 1 && safety < 200) {
      safety++;
      const c = pickRandom(list);
      if (!seen.has(c.name)) { seen.add(c.name); distractors.push(c.name); }
    }
    const all = shuffle([answer.name, ...distractors]);
    return all;
  }

  function renderRound() {
    const idx = State.round;
    const poke = State.pool[idx];
    if (!poke) return endGame();

    State.selected = false;

    // Header
    $("#round-now").text(idx + 1);
    $("#round-total").text(CONFIG.ROUNDS);
    $("#score-now").text(State.score);

    // Progress bar (% completed BEFORE this round)
    const pct = Math.round((idx / CONFIG.ROUNDS) * 100);
    $("#progress-fill").css("width", pct + "%");

    // Ticks
    if ($("#progress-ticks").children().length !== CONFIG.ROUNDS - 1) {
      $("#progress-ticks").empty();
      for (let i = 0; i < CONFIG.ROUNDS - 1; i++) $("#progress-ticks").append("<span></span>");
    }

    // Restaurar silo, prompt, qstage y estados de la carta para la nueva ronda
    gsap.set("#silo", { clearProps: "all" });
    gsap.set(".qprompt", { clearProps: "all" });
    gsap.set(".qstage", { clearProps: "marginTop,rowGap" });
    gsap.set("#poke-card .card__flip-wrapper", { clearProps: "all" });
    gsap.set("#poke-card .card__back", { clearProps: "all" });
    gsap.set("#poke-card .card__inner", { clearProps: "visibility" });
    const $silo = $("#silo").removeClass("is-revealed");
    $("#silo-img").attr("src", poke.img).attr("alt", "");

    // Reveal hidden, options visible
    $("#reveal").prop("hidden", true);
    const $opts = $("#options").empty().show();

    const optionNames = buildOptionsForRound(poke);
    const keys = ["A", "B", "C", "D", "E"];
    optionNames.forEach((name, i) => {
      const $b = $('<button class="opt"></button>')
        .attr("data-key", keys[i])
        .attr("data-name", name)
        .text(cap(name).replace(/-/g, " "));
      $opts.append($b);
    });

    // entrance animation
    gsap.fromTo("#silo",
      { opacity: 0, y: 16, scale: .96 },
      { opacity: 1, y: 0, scale: 1, duration: .55, ease: "back.out(1.2)" });
    gsap.fromTo(".qprompt",
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: .4, delay: .15, ease: "power2.out" });
    gsap.fromTo("#options .opt",
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: .35, delay: .25, stagger: .06, ease: "power2.out" });

    // bind options
    $opts.find(".opt").on("click", function () {
      if (State.selected) return;
      handleAnswer($(this), poke);
    });
    $opts.find(".opt").on("mouseenter", function () { Sound.hover(); });
  }

  function handleAnswer($btn, poke) {
    State.selected = true;
    const guess = $btn.attr("data-name");
    const correct = guess === poke.name;
    State.history.push(correct);

    if (correct) {
      State.score++;
      $("#score-now").text(State.score);
      $btn.addClass("is-correct");
      $("#options .opt").not($btn).addClass("is-dim").prop("disabled", true);
      Sound.correct();
      vibrate([18, 40, 24]);
      sparkleBurst();
    } else {
      $btn.addClass("is-wrong");
      $("#options .opt").each(function () {
        const $b = $(this);
        if ($b.attr("data-name") === poke.name) $b.addClass("is-correct");
        else if ($b[0] !== $btn[0]) $b.addClass("is-dim");
        $b.prop("disabled", true);
      });
      Sound.wrong();
      vibrate([60, 30, 60]);
    }

    // reveal silhouette
    setTimeout(() => {
      $("#silo").addClass("is-revealed");
    }, 250);

    // progress bar update (this round counted)
    const pct = Math.round(((State.round + 1) / CONFIG.ROUNDS) * 100);
    $("#progress-fill").css("width", pct + "%");

    // reveal card after a moment
    setTimeout(() => revealCard(poke, correct), 850);
  }

  function sparkleBurst() {
    const $stage = $("#silo-sparkles").empty();
    const N = 14;
    for (let i = 0; i < N; i++) {
      const $s = $('<span class="spark"></span>');
      $stage.append($s);
      const angle = (i / N) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 80 + Math.random() * 110;
      const dx = Math.cos(angle) * dist;
      const dy = Math.sin(angle) * dist;
      gsap.fromTo($s[0],
        { x: 0, y: 0, opacity: 0, scale: .5, left: "50%", top: "50%" },
        {
          x: dx, y: dy, opacity: 1, scale: 1, duration: .35, ease: "power2.out",
          onComplete: () => gsap.to($s[0], { opacity: 0, scale: .2, duration: .45, ease: "power2.in", onComplete: () => $s.remove() })
        });
    }
  }

  function typeChip(t) {
    const safe = (t || "normal").toLowerCase().replace(/[^a-z]/g, "");
    return `<span class="type-chip type-${safe}">${cap(t)}</span>`;
  }

  function revealCard(poke, correct) {
    // Card content
    $("#card-name").text(cap(poke.name).replace(/-/g, " "));
    $("#card-hp").text(poke.hp);
    $("#card-img").attr("src", poke.img).attr("alt", poke.name);
    $("#card-atk").text(poke.atk);
    $("#card-def").text(poke.def);
    $("#card-spd").text(poke.spd);
    $("#card-h").text(poke.height.toFixed(1) + " m");
    $("#card-w").text(poke.weight.toFixed(1) + " kg");
    $("#card-id").text("#" + String(poke.id).padStart(4, "0"));

    const $types = $("#card-types").empty();
    poke.types.forEach((t) => $types.append(typeChip(t)));

    // Verdict text
    const $v = $("#reveal-verdict");
    if (correct) {
      $v.html(`<span class="v-ok">¡Correcto!</span><small>Era ${cap(poke.name).replace(/-/g, " ")}</small>`);
    } else {
      $v.html(`<span class="v-no">¡Casi!</span><small>Era ${cap(poke.name).replace(/-/g, " ")}</small>`);
    }

    // Next button label
    const isLast = (State.round + 1) >= CONFIG.ROUNDS;
    $("#btn-next-label").text(isLast ? "Ver resultado" : "Siguiente Pokémon");

    // Preparar elementos del reveal: ocultos hasta que la carta se voltee
    gsap.set("#reveal-verdict", { opacity: 0, y: 10 });
    gsap.set("#btn-next", { opacity: 0, y: 10 });

    const $wrapper = $("#poke-card .card__flip-wrapper")[0];
    const backEl = document.querySelector("#poke-card .card__back");
    const frontEl = document.querySelector("#poke-card .card__inner");

    // Estado inicial: trasera visible, frente oculto (visibility mantiene altura para el layout)
    gsap.set($wrapper, { y: 60, opacity: 0, scaleX: 1 });
    gsap.set(backEl, { autoAlpha: 1 });
    gsap.set(frontEl, { visibility: "hidden" });

    // Mostrar el panel reveal
    $("#options").hide();
    $("#reveal").prop("hidden", false);

    // Fijar alturas actuales para que GSAP pueda animar el colapso de espacio
    const siloEl = document.getElementById("silo");
    const promptEl = document.querySelector(".qprompt");
    gsap.set(siloEl, { height: siloEl.offsetHeight, overflow: "hidden" });
    gsap.set(promptEl, { height: promptEl.offsetHeight, overflow: "hidden" });

    // Fase A: desvanecer visualmente
    gsap.to(siloEl, { opacity: 0, scale: 0.84, duration: 0.36, ease: "power2.in" });
    gsap.to(promptEl, { opacity: 0, y: -5, duration: 0.22, ease: "power2.in" });

    // Fase B: colapsar altura + gaps del flex + margen superior del stage
    gsap.to(siloEl, { height: 0, duration: 0.44, delay: 0.22, ease: "power2.inOut" });
    gsap.to(promptEl, { height: 0, duration: 0.30, delay: 0.14, ease: "power2.inOut" });
    gsap.to(".qstage", { marginTop: 6, rowGap: 0, duration: 0.44, delay: 0.22, ease: "power2.inOut" });

    // Fase 1 — carta sube mostrando la trasera (pokéball)
    gsap.to($wrapper, {
      y: 0, opacity: 1, duration: 0.52, delay: 0.36, ease: "back.out(1.3)",
      onComplete() {
        // Fase 2 — flip: aplanar con scaleX→0, intercambiar cara, expandir scaleX→1
        gsap.to($wrapper, {
          scaleX: 0, duration: 0.22, delay: 0.28, ease: "power2.in",
          onComplete() {
            gsap.set(backEl, { autoAlpha: 0 });
            gsap.set(frontEl, { visibility: "visible" });
            gsap.to($wrapper, {
              scaleX: 1, duration: 0.30, ease: "power2.out",
              onComplete() {
                bindCardTilt("#poke-card");
                gsap.to("#reveal-verdict", { opacity: 1, y: 0, duration: 0.35, ease: "power2.out" });
                gsap.to("#btn-next", { opacity: 1, y: 0, duration: 0.35, delay: 0.12, ease: "power2.out" });
              }
            });
          }
        });
      }
    });
  }

  // 3D tilt for any card by selector
  function bindCardTilt(sel) {
    const el = document.querySelector(sel);
    if (!el) return;
    const inner = el.querySelector(".card__inner, .holo-card__inner");
    if (!inner) return;
    let raf = null;

    function handle(x, y, rect) {
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (x - cx) / (rect.width / 2);
      const dy = (y - cy) / (rect.height / 2);
      const maxRot = 14;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        inner.style.transform = `rotateY(${dx * maxRot}deg) rotateX(${-dy * maxRot}deg) translateZ(0)`;
        // foil offset
        const foil = inner.querySelector(".holo-card__foil");
        if (foil) foil.style.transform = `translateX(${dx * 30 - 10}%) translateY(${dy * 20}%)`;
        const rainbow = inner.querySelector(".holo-card__rainbow");
        if (rainbow) rainbow.style.backgroundPosition = `${dx * 80}px ${dy * 80}px`;
      });
    }
    function reset() {
      cancelAnimationFrame(raf);
      inner.style.transform = "";
      const foil = inner.querySelector(".holo-card__foil");
      if (foil) foil.style.transform = "";
    }

    el.onmousemove = (e) => handle(e.clientX, e.clientY, el.getBoundingClientRect());
    el.onmouseleave = reset;
    el.ontouchmove = (e) => {
      if (!e.touches[0]) return;
      e.preventDefault();
      const t = e.touches[0];
      handle(t.clientX, t.clientY, el.getBoundingClientRect());
    };
    el.ontouchend = reset;

    // Device orientation for mobile holo
    if (el.classList.contains("holo-card")) {
      window.addEventListener("deviceorientation", function (ev) {
        if (!ev || ev.beta == null || ev.gamma == null) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = Math.max(-1, Math.min(1, ev.gamma / 30));
        const dy = Math.max(-1, Math.min(1, ev.beta / 60));
        handle(cx + dx * rect.width / 2, cy + dy * rect.height / 2, rect);
      }, { passive: true });
    }
  }

  function nextRound() {
    Sound.tap();
    State.round++;
    if (State.round >= CONFIG.ROUNDS) {
      endGame();
    } else {
      gsap.to("#reveal", {
        opacity: 0, y: -12, duration: .28, ease: "power2.in",
        onComplete: () => { renderRound(); }
      });
    }
  }

  // ============================================================
  // Final screen
  // ============================================================
  function endGame() {
    // Save best
    const best = Number(localStorage.getItem(CONFIG.BEST_KEY) || 0);
    if (State.score > best) localStorage.setItem(CONFIG.BEST_KEY, String(State.score));

    const isWin = State.score === CONFIG.ROUNDS;
    const $head = $("#final-head").removeClass("--win --lose");
    if (isWin) {
      $head.addClass("--win").html(`¡Eres un Maestro Mystery!<small>Has descifrado los 10 Pokémon secretos.</small>`);
    } else if (State.score >= 7) {
      $head.addClass("--lose").html(`¡Casi perfecto!<small>${State.score} aciertos. Vas en camino a la maestría.</small>`);
    } else if (State.score >= 4) {
      $head.addClass("--lose").html(`Buen intento<small>Sigue entrenando, entrenador.</small>`);
    } else {
      $head.addClass("--lose").html(`Hay que entrenar más<small>No te rindas — la próxima caen todos.</small>`);
    }

    $("#final-score").text(State.score);

    // Rank label
    const ranks = ["Aprendiz", "Aprendiz", "Iniciado", "Iniciado", "Explorador", "Explorador",
      "Veterano", "Veterano", "Élite", "Élite", "MAESTRO"];
    $("#final-rank").text(ranks[State.score] || "Aprendiz");

    // Chips
    const $chips = $("#final-chips").empty();
    State.history.forEach((ok, i) => {
      $chips.append(`<span class="${ok ? "is-hit" : "is-miss"}">${i + 1}</span>`);
    });

    // Premio (10/10 only)
    if (isWin) {
      $("#btn-again-label").text("Jugar de Nuevo");
      Sound.win();
      vibrate([40, 60, 40, 60, 80]);
      setTimeout(() => fireConfetti(2000), 420);   // esperar a que termine la transición de pantalla (~770ms)
      setTimeout(showBirthdayMsg, 3500);

      // Ocultar premio y caja inicialmente para evitar clics a través del overlay
      $("#prize").prop("hidden", true);
      $("#ns2-box").prop("hidden", true);
      const wrap = document.getElementById("ns2-box-wrap");
      if (wrap) {
        delete wrap.dataset.flipped;
        gsap.killTweensOf(wrap);
        gsap.set(wrap, { clearProps: "all" });
      }
    } else {
      $("#prize").prop("hidden", true);
      $("#btn-again-label").text("Reintentar");
    }

    showScreen("screen-final");
  }

  function fireConfetti(duration) {
    if (typeof confetti !== "function") return;
    const myConfetti = confetti;
    const colors = ["#00e5ff", "#ff2e92", "#ffd84d", "#7b5cff", "#5cffa8", "#ffffff", "#ff9b3d"];
    const end = Date.now() + (duration || 2500);
    (function frame() {
      // Esquinas inferiores hacia arriba — cubren toda la pantalla
      myConfetti({ particleCount: 3, angle: 58, spread: 80, startVelocity: 52, origin: { x: 0, y: 1 }, colors });
      myConfetti({ particleCount: 2, angle: 122, spread: 80, startVelocity: 52, origin: { x: 1, y: 1 }, colors });
      // Lateral inferior interno
      myConfetti({ particleCount: 1, angle: 72, spread: 65, startVelocity: 46, origin: { x: 0.18, y: 1 }, colors });
      myConfetti({ particleCount: 1, angle: 108, spread: 65, startVelocity: 46, origin: { x: 0.82, y: 1 }, colors });
      // Centro inferior — sube al centro y cubre la parte media
      myConfetti({ particleCount: 2, angle: 90, spread: 130, startVelocity: 55, origin: { x: 0.5, y: 1 }, colors });
      // Laterales medios — partículas laterales
      myConfetti({ particleCount: 3, angle: 65, spread: 50, startVelocity: 34, origin: { x: 0, y: 0.55 }, colors });
      myConfetti({ particleCount: 4, angle: 115, spread: 50, startVelocity: 34, origin: { x: 1, y: 0.55 }, colors });
      if (Date.now() < end) requestAnimationFrame(frame);
    })();
  }

  function showBirthdayMsg() {
    const $msg = $("#bday-msg").prop("hidden", false);
    // Cada línea entra desde su dirección con rebote
    gsap.fromTo("#bday-l1",
      { opacity: 0, y: -60, scale: 0.6 },
      { opacity: 1, y: 0, scale: 1, duration: 0.75, ease: "back.out(2.2)" });
    gsap.fromTo("#bday-l2",
      { opacity: 0, y: 60, scale: 0.6 },
      { opacity: 1, y: 0, scale: 1, duration: 0.75, delay: 0.18, ease: "back.out(2.2)" });
    gsap.fromTo("#bday-msg",
      { opacity: 0 },
      { opacity: 1, duration: 0.4 });

    // Después de 3.4s salir y mostrar la caja
    setTimeout(() => {
      gsap.to("#bday-msg", {
        opacity: 0, scale: 1.12, filter: "blur(14px)", duration: 0.55, ease: "power2.in",
        onComplete() {
          $("#bday-msg").prop("hidden", true);
          gsap.set("#bday-msg", { clearProps: "all" });
          showNs2Box();
        }
      });
    }, 2600);
  }

  function showNs2Box() {
    const $prize = $("#prize").prop("hidden", false);
    const $box = $("#ns2-box").prop("hidden", false);

    // Clonar el contenedor para limpiar acumulaciones de listeners (de click, touchend, keydown) y efectos de inclinación (tilt)
    const oldWrap = document.getElementById("ns2-box-wrap");
    const wrap = oldWrap.cloneNode(true);
    oldWrap.parentNode.replaceChild(wrap, oldWrap);

    const backEl = wrap.querySelector(".ns2-back");
    const frontEl = wrap.querySelector(".ns2-front");

    // Limpiar el estado de volteo y reiniciar el texto caption
    delete wrap.dataset.flipped;
    gsap.set("#ns2-caption", { clearProps: "all" });

    // Estado inicial: trasera visible, frontal oculta
    gsap.set(frontEl, { visibility: "hidden" });
    gsap.set(backEl, { autoAlpha: 1 });
    gsap.set(wrap, { clearProps: "all" });

    // Caja entra desde abajo con rebote
    gsap.fromTo("#ns2-box",
      { opacity: 0, y: 40, scale: 0.82 },
      { opacity: 1, y: 0, scale: 1, duration: 0.72, ease: "back.out(1.6)" });

    // Balanceo suave para invitar a hacer clic
    gsap.to(wrap, { y: -10, duration: 1.6, ease: "sine.inOut", yoyo: true, repeat: -1 });

    function flipBox() {
      if (wrap.dataset.flipped) return;
      wrap.dataset.flipped = "1";
      gsap.killTweensOf(wrap);
      gsap.set(wrap, { y: 0 });
      Sound.correct();
      vibrate([25, 45, 25]);

      // Flip scaleX: aplanar → swap caras → expandir
      gsap.to(wrap, {
        scaleX: 0, duration: 0.22, ease: "power2.in",
        onComplete() {
          gsap.set(backEl, { autoAlpha: 0 });
          gsap.set(frontEl, { visibility: "visible" });
          gsap.to(wrap, {
            scaleX: 1, duration: 0.30, ease: "power2.out",
            onComplete() {
              gsap.to("#ns2-caption", { opacity: 0, duration: 0.3 });
              // Mini confeti al revelar la portada
              setTimeout(() => fireConfetti(1800), 100);
              // Efecto tilt en la caja revelada
              bindNs2Tilt(wrap);
            }
          });
        }
      });
    }

    wrap.addEventListener("click", flipBox, { once: true });
    wrap.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") flipBox(); }, { once: true });
    wrap.addEventListener("touchend", (e) => { e.preventDefault(); flipBox(); }, { once: true, passive: false });
  }

  function bindNs2Tilt(el) {
    let raf = null;
    function handle(x, y, rect) {
      const dx = (x - (rect.left + rect.width / 2)) / (rect.width / 2);
      const dy = (y - (rect.top + rect.height / 2)) / (rect.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `perspective(900px) rotateY(${dx * 12}deg) rotateX(${-dy * 12}deg) translateZ(0)`;
      });
    }
    function reset() { cancelAnimationFrame(raf); el.style.transform = ""; }
    el.onmousemove = (e) => handle(e.clientX, e.clientY, el.getBoundingClientRect());
    el.onmouseleave = reset;
    el.ontouchmove = (e) => { if (!e.touches[0]) return; e.preventDefault(); const t = e.touches[0]; handle(t.clientX, t.clientY, el.getBoundingClientRect()); };
    el.ontouchend = reset;
  }

  // ============================================================
  // Bindings
  // ============================================================
  $(function () {
    // Best label on home
    const best = Number(localStorage.getItem(CONFIG.BEST_KEY) || 0);
    if (best > 0) {
      $("#home-best-val").text(best);
      $("#home-best").prop("hidden", false);
    }

    $("#btn-start").on("click", startGame);
    $("#btn-next").on("click", nextRound);
    $("#btn-again").on("click", function () {
      Sound.tap();
      // start a fresh run, reuse master list
      startGame();
    });
    $("#btn-home").on("click", function () {
      Sound.tap();
      showScreen("screen-home");
    });

    // Hover sound on big buttons (desktop)
    $(document).on("mouseenter", ".btn", function () { Sound.hover(); });

    // Entrance animation for home
    gsap.from(".home-inner > *", {
      opacity: 0, y: 16, duration: .55, stagger: .07, ease: "power3.out", delay: .15,
    });
  });

})(jQuery);
