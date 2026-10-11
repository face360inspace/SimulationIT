/* =========================================================================
   Zero-Touch IT Simulator – Ablauflogik
   Ablauf: Start → Planen (Budget auf Handlungsfelder verteilen) → Simulieren
   (ein Arbeitstag in der 3D-Szene) → Auswerten (Wirkung der Maßnahmen).
   Dazu zwei Wissensseiten: Reifegrade und Ihr Weg (Selbsteinschätzung).
   Erwartet data.js und game.js (window.Scene3D).
   ========================================================================= */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MS_PER_MIN = 170;   // Echtzeit je simulierter Minute bei 1×

  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kein Speicher */ } }
  };

  const allOne = () => { const o = {}; FIELDS.forEach(f => { o[f.id] = 1; }); return o; };
  const state = {
    view: 'game', screen: 'start',
    budgetIdx: store.get('zt.budget', 1),
    useAssessment: store.get('zt.useAssessment', false),
    base: allOne(), levels: allOne(),
    speed: 1, playing: false, ended: false, sim: DAY_START, day: null,
    follow: true, runs: [], levelView: 3,
    assessment: store.get('zt.assessment', null), assessed: store.get('zt.assessed', false),
    target: store.get('zt.target', 5),
    params: Object.assign({}, PARAMS, store.get('zt.params', {})),
    frameIdx: store.get('zt.frame', null),
    vary: store.get('zt.vary', false),
    runCount: 0
  };
  (function () { const fo = store.get('zt.freq', {}); EVENTS.forEach(e => { if (typeof fo[e.id] === 'number') e.freq = fo[e.id]; }); })();
  if (!state.assessment) { state.assessment = {}; FIELDS.forEach(f => { state.assessment[f.id] = 2; }); }
  const savedLevels = store.get('zt.levels', null);

  /* ---------- Formatierung ---------- */
  const pad = n => String(n).padStart(2, '0');
  const fmtTime = min => pad(Math.floor(min / 60) % 24) + ':' + pad(Math.floor(min % 60));
  const fmtNum = (n, d) => n.toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const fmtHours = min => min < 60 ? fmtNum(min) + ' Min' : fmtNum(min / 60, min % 60 === 0 ? 0 : 1) + ' h';
  const fmtH = min => fmtNum(min / 60, min / 60 < 10 && min % 60 !== 0 ? 1 : 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fieldName = id => FIELDS.find(f => f.id === id).name;

  /* ---------- Kosten & Stufen ---------- */
  const cum = s => { let c = 0; for (let k = 2; k <= s; k++) c += STAGE_COST[k - 1]; return c; };
  const spent = () => FIELDS.reduce((sum, f) => sum + Math.max(0, cum(state.levels[f.id]) - cum(state.base[f.id])), 0);
  const budget = () => BUDGETS[state.budgetIdx].points;

  function normalizeLevels() {
    let changed = true;
    while (changed) {
      changed = false;
      FIELDS.forEach(f => {
        while (state.levels[f.id] > state.base[f.id] && stageBlocker(f.id, state.levels[f.id], state.levels)) { state.levels[f.id]--; changed = true; }
      });
    }
  }
  function applyBase() {
    state.base = state.useAssessment ? Object.assign({}, state.assessment) : allOne();
    FIELDS.forEach(f => { if (state.levels[f.id] < state.base[f.id]) state.levels[f.id] = state.base[f.id]; });
    normalizeLevels();
    while (spent() > budget()) { // teuerstes Feld absenken, bis das Budget passt
      const f = FIELDS.slice().sort((a, b) => state.levels[b.id] - state.levels[a.id]).find(f => state.levels[f.id] > state.base[f.id]);
      if (!f) break; state.levels[f.id]--; normalizeLevels();
    }
  }

  function setStage(fieldId, stage) {
    if (stage < state.base[fieldId]) { toast('Diese Stufe ist bereits Ihre Ausgangslage.'); return; }
    const trial = Object.assign({}, state.levels);
    if (stage > trial[fieldId]) {
      for (let s = trial[fieldId] + 1; s <= stage; s++) {
        const why = stageBlocker(fieldId, s, trial);
        if (why) { toast('Stufe ' + s + ' in „' + fieldName(fieldId) + '“ ' + why + '.'); return; }
        trial[fieldId] = s;
      }
      const cost = FIELDS.reduce((sum, f) => sum + Math.max(0, cum(trial[f.id]) - cum(state.base[f.id])), 0);
      if (cost > budget()) { toast('Budget reicht nicht: ' + cost + ' von ' + budget() + ' Punkten nötig.'); return; }
      state.levels = trial;
    } else {
      state.levels[fieldId] = stage;
      normalizeLevels();
    }
    store.set('zt.levels', state.levels);
    renderPlan();
  }

  /* ---------- Totale ---------- */
  function totalsFor(levels) {
    const t = { it: 0, user: 0, touches: 0, tickets: 0, prevented: 0, auto: 0, events: [] };
    EVENTS.forEach(e => {
      const eff = effectiveLevel(e, levels); const v = e.v[eff.level - 1];
      t.it += v.it; t.user += v.user; t.touches += v.touches;
      if (v.ticket) t.tickets++;
      if (v.prevented) t.prevented++; else if (v.touches === 0) t.auto++;
      t.events.push({ def: e, level: eff.level, limiters: eff.limiters, v });
    });
    t.index = experienceIndex(t.user, t.tickets, t.touches);
    return t;
  }
  const BASE1 = (() => { const l = allOne(); const t = { it: 0, user: 0, touches: 0, tickets: 0 }; EVENTS.forEach(e => { const v = e.v[0]; t.it += v.it; t.user += v.user; t.touches += v.touches; if (v.ticket) t.tickets++; }); return t; })();
  function experienceIndex(user, tickets, touches) {
    const v = 100 - 50 * Math.min(1, user / BASE1.user) - 25 * Math.min(1, tickets / BASE1.tickets) - 15 * Math.min(1, touches / BASE1.touches);
    return Math.max(0, Math.round(v));
  }
  const outcomeOf = v => v.prevented ? 'verhindert' : (v.touches === 0 ? 'autonom gelöst' : (v.ticket ? 'Ticket, gelöst' : 'gelöst'));
  const outcomeCls = v => v.prevented ? 'prevented' : (v.touches === 0 ? 'auto' : (v.ticket ? 'ticket' : 'done'));

  /* ---------- Bildschirme ---------- */
  function showScreen(name) {
    state.screen = name;
    ['start', 'plan', 'result', 'analysis'].forEach(s => { $('#screen-' + s).hidden = s !== name; });
    $('#hud').classList.toggle('dim', name !== 'run');
    document.body.classList.toggle('in-run', name === 'run');
    if (name === 'plan') renderPlan();
    if (name === 'analysis') renderAnalysis();
  }
  function showView(v) {
    state.view = v;
    $('#game').hidden = v !== 'game';
    $('#view-levels').hidden = v !== 'levels';
    $('#view-path').hidden = v !== 'path';
    $('#knowledge-nav').hidden = v === 'game';
    $$('[data-view]').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.Scene3D.setRunning(v === 'game');
    if (v !== 'game' && state.playing) { state.playing = false; renderClock(); }
    if (v === 'levels') renderLevelsView();
    if (v === 'path') renderMatrix();
    window.scrollTo({ top: 0 });
  }

  /* ---------- Planung ---------- */
  function renderPlan() {
    const b = budget(), sp = spent();
    $('#budgetSeg').innerHTML = BUDGETS.map((bd, i) => '<button type="button" data-budget="' + i + '" aria-pressed="' + (i === state.budgetIdx) + '"><span class="n">' + bd.points + '</span><span class="lbl">' + bd.name + '</span></button>').join('');
    $('#budgetDesc').textContent = BUDGETS[state.budgetIdx].desc;
    $('#budgetBar').style.width = Math.min(100, sp / b * 100) + '%';
    $('#budgetText').innerHTML = '<b>' + sp + '</b> von ' + b + ' Punkten eingesetzt · ' + (b - sp) + ' frei';
    $('#baseToggle').setAttribute('aria-pressed', state.useAssessment);
    $('#baseToggle').textContent = state.useAssessment ? 'Ausgangslage: Ihre Einschätzung' : 'Ausgangslage: alles auf Stufe 1';

    let html = '<thead><tr><th>Handlungsfeld</th>' + LEVELS.map(l => '<th class="lv">Stufe ' + l.n + '<small>' + l.name + '</small></th>').join('') + '</tr></thead><tbody>';
    FIELDS.forEach(f => {
      const cur = state.levels[f.id], base = state.base[f.id];
      html += '<tr><td class="field">' + f.name + '<small>' + esc(f.short[cur - 1]) + '</small></td>';
      for (let s = 1; s <= 5; s++) {
        let cls = 'inv', sub = '';
        const why = s > cur ? stageBlocker(f.id, s, state.levels) : null;
        if (s <= base) { cls += ' base'; sub = 'vorhanden'; }
        else if (s <= cur) { cls += ' bought'; sub = (cum(s) - cum(base)) + ' P'; }
        else if (why) { cls += ' locked'; sub = 'gesperrt'; }
        else { const c = cum(s) - cum(base); sub = c + ' P' + (c - (cum(cur) - cum(base)) > b - sp ? ' · zu teuer' : ''); if (c - (cum(cur) - cum(base)) > b - sp) cls += ' pricey'; }
        if (s === cur) cls += ' sel';
        html += '<td><button type="button" class="' + cls + '" data-field="' + f.id + '" data-stage="' + s + '" aria-pressed="' + (s === cur) + '"' + (why ? ' title="' + esc(why) + '"' : '') + '><span class="ttl">' + esc(f.short[s - 1]) + '</span><span class="sub">' + sub + '</span></button></td>';
      }
      html += '</tr>';
    });
    html += '</tbody>';
    $('#invMatrix').innerHTML = html;

    const t = totalsFor(state.levels);
    $('#previewList').innerHTML = t.events.map(e =>
      '<li><span class="lv-badge l' + e.level + '">' + e.level + '</span><span class="pv-body"><span class="pv-title">' + esc(e.def.title) + '</span><span class="pv-sub">' + outcomeOf(e.v) + ' · begrenzt durch ' + e.limiters.map(fieldName).join(', ') + '</span></span></li>'
    ).join('');
    $('#previewSummary').innerHTML =
      '<div class="tile"><div class="lbl">Erwarteter Experience-Index</div><div class="val">' + t.index + '</div></div>' +
      '<div class="tile"><div class="lbl">Verhindert oder autonom</div><div class="val">' + (t.prevented + t.auto) + '<small>/ ' + EVENTS.length + '</small></div></div>' +
      '<div class="tile"><div class="lbl">Tickets</div><div class="val">' + t.tickets + '</div></div>';
  }

  /* ---------- Simulationstag ---------- */
  function seededRandom(seed) { let x = seed >>> 0; return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function buildDay() {
    const rand = seededRandom(1000 + state.runCount * 7919);
    const items = EVENTS.filter(() => !state.vary || rand() < 0.75).map(def => {
      const eff = effectiveLevel(def, state.levels);
      let v = def.v[eff.level - 1];
      let start = (def.startByLevel && def.startByLevel[eff.level]) || def.start;
      if (state.vary) {
        const f = 1 - state.params.spread + rand() * 2 * state.params.spread;
        v = Object.assign({}, v, { it: Math.round(v.it * f), user: Math.round(v.user * f) });
        start = Math.max(DAY_START + 15, Math.min(DAY_END - 90, Math.round(start + (rand() - .5) * 120)));
      }
      let acc = start;
      const steps = v.steps.map(s => { const at = acc; acc += s.d; return Object.assign({}, s, { at }); });
      return { def, v, level: eff.level, limiters: eff.limiters, start, steps, endAt: acc, shown: 0, started: false, finished: false, el: null, blocked: false };
    });
    items.sort((a, b) => a.start - b.start);
    return items;
  }

  function startRun() {
    state.runCount++;
    state.day = buildDay();
    state.sim = DAY_START; state.ended = false; state.playing = true;
    $('#feed').innerHTML = '';
    window.Scene3D.reset();
    renderDayline(); renderFieldSummary();
    showScreen('run');
    update();
  }

  const isBlocked = inst => inst.started && !inst.finished && inst.v.user > 0 && !inst.v.prevented;

  function update() {
    const feed = $('#feed');
    state.day.forEach(inst => {
      if (!inst.started && state.sim >= inst.start) {
        inst.started = true;
        feed.prepend(createCard(inst));
        inst.blocked = isBlocked(inst);
        window.Scene3D.eventStart(inst.def.id, inst.blocked);
      }
      if (!inst.started) return;
      while (inst.shown < inst.steps.length && inst.steps[inst.shown].at <= state.sim) {
        const st = inst.steps[inst.shown];
        appendStep(inst, st); inst.shown++;
        window.Scene3D.eventStep(inst.def.id, st.a, inst.blocked);
      }
      if (inst.shown === inst.steps.length) {
        if (!inst.finished) {
          inst.finished = true; finishCard(inst);
          window.Scene3D.eventFinish(inst.def.id, inst.v.prevented ? 'prevented' : 'done');
        }
      } else {
        ensurePending(inst);
        if (state.ended) { inst.statusEl.className = 'status night'; inst.statusEl.textContent = 'offen über Nacht'; }
      }
    });
    const open = state.day.filter(i => i.started && !i.finished);
    window.Scene3D.setTickets(open.filter(i => i.v.ticket).length);
    renderClock(); renderKpis();
    if (state.ended) onDayEnd();
  }

  let endHandled = false;
  function onDayEnd() {
    if (endHandled) return; endHandled = true;
    window.Scene3D.setDayEnd();
    setTimeout(() => { if (state.screen === 'run') showResult(); }, 1400);
  }

  let lastTs = null;
  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(200, ts - lastTs); lastTs = ts;
    if (state.screen === 'run' && state.playing && !state.ended) {
      state.sim += dt * state.speed / MS_PER_MIN;
      if (state.sim >= DAY_END) { state.sim = DAY_END; state.ended = true; state.playing = false; }
      update();
    }
    if (state.view === 'game') window.Scene3D.setTime(state.screen === 'run' ? state.sim : 10 * 60 + (ts / 400) % (8 * 60));
    requestAnimationFrame(loop);
  }

  /* ---------- HUD ---------- */
  function createCard(inst) {
    const card = document.createElement('article');
    card.className = 'card compact';
    card.innerHTML =
      '<div class="card-head"><div class="time">' + fmtTime(inst.start) + '</div>' +
      '<div><h3>' + esc(inst.v.title) + '</h3><div class="sub">' + esc(inst.def.title) + '</div></div>' +
      '<span class="status open">Stufe ' + inst.level + '</span></div>' +
      '<ol class="steps"></ol>' +
      '<div class="card-foot"><span class="m">IT <b>' + fmtHours(inst.v.it) + '</b></span><span class="m">Ausfall <b>' + fmtHours(inst.v.user) + '</b></span><span class="m">Eingriffe <b>' + inst.v.touches + '</b></span>' +
      (inst.v.risk ? '<span class="risk">' + esc(inst.v.risk) + '</span>' : '') + '</div>';
    inst.el = card; inst.stepsEl = $('.steps', card); inst.statusEl = $('.status', card);
    card.addEventListener('click', () => window.Scene3D.focusEvent(inst.def.id, 6));
    return card;
  }
  function appendStep(inst, step) {
    const li = document.createElement('li'); li.className = 'step';
    li.innerHTML = '<div class="t">' + fmtTime(step.at) + '</div><div class="rail"><i class="' + ACTORS[step.a].cls + '"></i></div><div class="body"><span class="who ' + ACTORS[step.a].cls + '">' + ACTORS[step.a].label + '</span><span class="text">' + esc(step.t) + '</span></div>';
    inst.stepsEl.appendChild(li);
  }
  function ensurePending(inst) {
    if (!inst.pendingEl) {
      const li = document.createElement('li'); li.className = 'step pending';
      li.innerHTML = '<div class="t"></div><div class="rail"><i></i></div><div class="body"><span class="text"></span></div>';
      inst.pendingEl = li;
    }
    if (inst.stepsEl.lastChild !== inst.pendingEl) inst.stepsEl.appendChild(inst.pendingEl);
    const last = inst.steps[inst.shown - 1];
    const waited = Math.max(0, Math.floor(state.sim - last.at));
    $('.text', inst.pendingEl).textContent = (last.w || 'wartet …') + (waited >= 1 ? ' (seit ' + fmtHours(waited) + ')' : '');
    $('.t', inst.pendingEl).textContent = fmtTime(state.sim);
  }
  function finishCard(inst) {
    if (inst.pendingEl && inst.pendingEl.parentNode) inst.pendingEl.remove();
    const dur = inst.endAt - inst.start;
    if (inst.v.prevented) { inst.statusEl.className = 'status prevented'; inst.statusEl.textContent = 'verhindert'; }
    else if (inst.v.touches === 0) { inst.statusEl.className = 'status done'; inst.statusEl.textContent = 'autonom · ' + fmtHours(dur); }
    else { inst.statusEl.className = 'status done'; inst.statusEl.textContent = 'gelöst · ' + fmtHours(dur); }
  }
  function renderClock() {
    $('#clock').textContent = fmtTime(state.sim);
    $('#clockState').textContent = state.ended ? 'Feierabend' : (state.playing ? 'läuft' : 'Pause');
    const pct = (state.sim - DAY_START) / (DAY_END - DAY_START) * 100;
    const fill = $('#dayfill'); if (fill) fill.style.width = pct + '%';
    $$('#dayline .tick').forEach((t, i) => { const inst = state.day[i]; t.className = 'tick' + (inst.finished ? ' done' : (inst.started ? ' open' : '')); });
    $('#playBtn').innerHTML = state.playing ? ICON.pause + 'Pause' : ICON.play + 'Weiter';
  }
  function renderDayline() {
    const span = DAY_END - DAY_START;
    let html = '<div class="track"></div><div class="fill" id="dayfill"></div>';
    state.day.forEach(inst => { html += '<div class="tick" style="left:' + ((inst.start - DAY_START) / span * 100) + '%" title="' + esc(fmtTime(inst.start) + ' ' + inst.def.title) + '"></div>'; });
    for (let h = 7; h <= 19; h += 3) html += '<div class="hour" style="left:' + ((h * 60 - DAY_START) / span * 100) + '%">' + pad(h) + '</div>';
    $('#dayline').innerHTML = html;
  }
  function renderKpis() {
    const started = state.day.filter(i => i.started);
    const open = started.filter(i => !i.finished).length;
    const it = started.reduce((s, i) => s + i.v.it, 0), user = started.reduce((s, i) => s + i.v.user, 0), touches = started.reduce((s, i) => s + i.v.touches, 0);
    const tickets = started.filter(i => i.v.ticket).length;
    const good = started.filter(i => i.finished && (i.v.prevented || i.v.touches === 0)).length;
    const tiles = [
      { l: 'Offen', v: open, cls: open > 2 ? 'hl' : '' }, { l: 'Tickets', v: tickets, cls: tickets > 3 ? 'hl' : '' }, { l: 'Verhindert / autonom', v: good, cls: good ? 'ok' : '' },
      { l: 'IT-Aufwand', v: fmtH(it), u: 'h', cls: it > 240 ? 'hl' : '' }, { l: 'Ausfallzeit', v: fmtH(user), u: 'h', cls: user > 240 ? 'hl' : '' }, { l: 'Eingriffe', v: touches, cls: touches > 10 ? 'hl' : '' }
    ];
    $('#tiles').innerHTML = tiles.map(t => '<div class="tile ' + t.cls + '"><div class="lbl">' + t.l + '</div><div class="val">' + t.v + (t.u ? '<small>' + t.u + '</small>' : '') + '</div></div>').join('');
    const xi = experienceIndex(user, tickets, touches);
    $('#xla').textContent = xi; $('#xlaBar').style.width = xi + '%';
    $('#xlaBar').style.background = xi >= 80 ? 'var(--agent)' : (xi >= 50 ? 'var(--accent)' : 'var(--human)');
  }
  function renderFieldSummary() {
    $('#fieldSummary').innerHTML = FIELDS.map(f => '<div class="fs-row"><span class="nm">' + f.name + '</span><span class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= state.levels[f.id] ? 'on' : '') + '"></i>').join('') + '</span></div>').join('');
  }

  /* ---------- Auswertung ---------- */
  function dayTotals(day) {
    const t = { it: 0, user: 0, touches: 0, tickets: 0, prevented: 0, auto: 0, events: [] };
    day.forEach(i => { t.it += i.v.it; t.user += i.v.user; t.touches += i.v.touches; if (i.v.ticket) t.tickets++; if (i.v.prevented) t.prevented++; else if (i.v.touches === 0) t.auto++; t.events.push({ def: i.def, level: i.level, limiters: i.limiters, v: i.v }); });
    t.index = experienceIndex(t.user, t.tickets, t.touches);
    return t;
  }
  function showResult() {
    const t = state.vary ? dayTotals(state.day) : totalsFor(state.levels);
    const baseT = totalsFor(state.base);
    const prev = state.runs.length ? state.runs[state.runs.length - 1] : null;
    state.runs.push({ levels: Object.assign({}, state.levels), budget: budget(), totals: t });
    const row = (label, f, fmt, lowerBetter, fmtDelta) => {
      const cur = f(t), bs = f(baseT), pv = prev ? f(prev.totals) : null;
      const cell = v => {
        if (v === null) return '<td>–</td>';
        const d = cur - v; if (d === 0) return '<td>' + fmt(v) + '<small>gleich</small></td>';
        const good = lowerBetter ? d < 0 : d > 0;
        return '<td>' + fmt(v) + '<small class="' + (good ? 'good' : 'bad') + '">' + (d > 0 ? '+' : '−') + (fmtDelta || fmt)(Math.abs(d)) + ' heute</small></td>';
      };
      return '<tr><td>' + label + '</td><td class="cur">' + fmt(cur) + '</td>' + cell(bs) + cell(pv) + '</tr>';
    };
    $('#resultHero').innerHTML = '<div class="eyebrow">Feierabend</div><div class="hero-num">' + t.index + '<small>Experience-Index</small></div>' +
      '<p class="muted">' + (t.prevented + t.auto) + ' von ' + t.events.length + ' Ereignissen wurden verhindert oder autonom gelöst, ' + t.tickets + ' wurden zum Ticket. Budget: ' + spent() + ' von ' + budget() + ' Punkten.</p>';
    $('#resultTable').innerHTML = '<thead><tr><th>Kennzahl</th><th>Dieser Durchlauf</th><th>Ohne Investition</th><th>Letzter Durchlauf</th></tr></thead><tbody>' +
      row('Experience-Index', x => x.index, v => v, false) +
      row('IT-Aufwand', x => x.it, fmtHours, true) +
      row('Ausfallzeit Mitarbeiter', x => x.user, fmtHours, true) +
      row('Tickets', x => x.tickets, v => v, true) +
      row('Manuelle Eingriffe', x => x.touches, v => v, true) +
      row('Verhindert oder autonom', x => x.prevented + x.auto, v => v, false) + '</tbody>';
    $('#resultEvents').innerHTML = t.events.map(e =>
      '<li><span class="lv-badge l' + e.level + '">' + e.level + '</span><span class="pv-body"><span class="pv-title">' + esc(e.def.title) + '</span><span class="pv-sub"><span class="oc ' + outcomeCls(e.v) + '">' + outcomeOf(e.v) + '</span> · IT ' + fmtHours(e.v.it) + ' · Ausfall ' + fmtHours(e.v.user) + (e.level < 5 ? ' · begrenzt durch ' + e.limiters.map(fieldName).join(', ') : '') + '</span></span></li>'
    ).join('');
    // Nächste beste Investition
    const options = [];
    FIELDS.forEach(f => {
      const cur = state.levels[f.id]; if (cur >= 5) return;
      const trial = Object.assign({}, state.levels); trial[f.id] = cur + 1;
      const why = stageBlocker(f.id, cur + 1, state.levels);
      const tt = totalsFor(trial);
      options.push({ f, stage: cur + 1, cost: STAGE_COST[cur], why, dUser: t.user - tt.user, dIt: t.it - tt.it, dIdx: tt.index - t.index, dTickets: t.tickets - tt.tickets });
    });
    options.sort((a, b) => (b.dUser + b.dIt) - (a.dUser + a.dIt));
    $('#nextBest').innerHTML = options.slice(0, 4).map(o =>
      '<li class="' + (o.why ? 'locked' : '') + '"><span class="pv-body"><span class="pv-title">' + o.f.name + ' auf Stufe ' + o.stage + ' · ' + esc(o.f.short[o.stage - 1]) + ' <span class="muted">(' + o.cost + ' P)</span></span><span class="pv-sub">' +
      (o.dUser + o.dIt > 0 ? 'spart ' + fmtHours(o.dUser) + ' Ausfall und ' + fmtHours(o.dIt) + ' IT-Aufwand' + (o.dTickets > 0 ? ', ' + o.dTickets + ' Ticket' + (o.dTickets > 1 ? 's' : '') + ' weniger' : '') + ', Index +' + o.dIdx : 'allein noch keine messbare Wirkung, aber Voraussetzung für weitere Stufen') +
      (o.why ? ' · ' + esc(o.why) : '') + '</span></span></li>'
    ).join('');
    showScreen('result');
  }

  /* ---------- Wissensseite: Reifegrade ---------- */
  const TOTALS = [1, 2, 3, 4, 5].map(n => { const l = {}; FIELDS.forEach(f => { l[f.id] = n; }); const t = totalsFor(l); t.steps = { human: 0, auto: 0, agent: 0 }; EVENTS.forEach(e => e.v[n - 1].steps.forEach(s => { if (s.a === 'sd' || s.a === 'tech' || s.a === 'mgr') t.steps.human++; else if (s.a === 'sys') t.steps.auto++; else if (s.a === 'ai') t.steps.agent++; })); return t; });

  function niceStep(max) { const raw = max / 4; const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const c = raw / p; return (c <= 1 ? 1 : c <= 2 ? 2 : c <= 5 ? 5 : 10) * p; }
  function barChart(values, opts) {
    const W = 260, H = 150, L = 34, R = 8, Tm = 16, B = 24;
    const max = Math.max.apply(null, values.concat([1])); const step = niceStep(max); const top = Math.ceil(max / step) * step || step;
    const iw = W - L - R, ih = H - Tm - B; const y = v => Tm + ih - v / top * ih; const band = iw / values.length; const bw = Math.min(24, band * .6);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '"><g class="grid">';
    for (let v = 0; v <= top + 1e-9; v += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + fmtNum(v) + '</text>';
    s += '</g>';
    values.forEach((v, i) => {
      const cx = L + band * i + band / 2, x0 = cx - bw / 2, y0 = y(v), h = Math.max(0, y(0) - y0), r = Math.min(4, h), cur = i + 1 === state.levelView;
      const path = h > 0 ? 'M' + x0 + ' ' + y(0) + ' V' + (y0 + r) + ' Q' + x0 + ' ' + y0 + ' ' + (x0 + r) + ' ' + y0 + ' H' + (x0 + bw - r) + ' Q' + (x0 + bw) + ' ' + y0 + ' ' + (x0 + bw) + ' ' + (y0 + r) + ' V' + y(0) + ' Z' : 'M' + x0 + ' ' + y(0) + ' h' + bw + ' v1 h-' + bw + ' Z';
      s += '<path class="bar' + (cur ? ' cur' : '') + '" d="' + path + '"/>';
      if (cur) s += '<text class="vlabel" x="' + cx + '" y="' + (y0 - 5) + '" text-anchor="middle">' + opts.fmt(v) + '</text>';
      s += '<text class="xl' + (cur ? ' cur' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + (i + 1) + '</text>';
      s += '<rect class="bar hit" x="' + (L + band * i) + '" y="' + Tm + '" width="' + band + '" height="' + ih + '" data-tip="' + esc('Stufe ' + (i + 1) + ' · ' + LEVELS[i].name + ': ' + opts.fmt(v) + ' ' + opts.unit) + '"/>';
    });
    s += '<g class="axis"><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></g></svg>';
    return s;
  }
  function renderLevelsView() {
    const lv = state.levelView;
    $('#ladder').innerHTML = LEVELS.map(l => '<button type="button" data-levelview="' + l.n + '" aria-pressed="' + (l.n === lv) + '" class="' + (l.n < lv ? 'reached' : '') + '"><span class="n">Stufe ' + l.n + '</span><span class="name">' + l.name + '</span><span class="tag">' + l.tagline + '</span></button>').join('');
    const l = LEVELS[lv - 1], q = PERSPECTIVES[lv];
    $('#levelDetail').innerHTML = '<div class="eyebrow">Stufe ' + l.n + '</div><h2 style="margin:4px 0 8px">' + l.name + ' · ' + l.tagline + '</h2><p class="muted">' + esc(l.desc) + '</p>' +
      '<p style="margin-top:10px"><b>Rollenverteilung:</b> ' + esc(l.role) + '</p>' +
      '<div class="kpis">' + Object.keys(KPI_LABELS).map(k => '<div class="tile"><div class="lbl">' + KPI_LABELS[k] + '</div><div class="val">' + l.kpi[k] + '</div></div>').join('') + '</div>' +
      '<p class="note" style="margin-top:8px">Typische Richtwerte zur Orientierung, keine Benchmarks.</p>' +
      '<h3 style="margin-top:18px">So fühlt sich diese Stufe an</h3><div class="quotes" style="margin-top:8px">' + ['ma', 'it', 'mgmt'].map(k => '<div class="quote"><div class="who">' + PERSPECTIVE_LABELS[k] + '</div><p>„' + esc(q[k]) + '“</p></div>').join('') + '</div>' +
      '<div class="actions"><button class="btn primary" type="button" data-play-level="' + lv + '">Diesen Tag in der Simulation erleben</button></div>';
    const series = [{ k: 'it', cap: 'IT-Aufwand in Stunden', unit: 'h' }, { k: 'user', cap: 'Ausfallzeit der Mitarbeiter in Stunden', unit: 'h' }, { k: 'tickets', cap: 'Tickets', unit: 'Tickets' }];
    $('#multiples').innerHTML = series.map(sr => {
      const vals = TOTALS.map(t => sr.k === 'tickets' ? t[sr.k] : t[sr.k] / 60);
      const fmt = sr.k === 'tickets' ? (v => fmtNum(v)) : (v => fmtNum(v, v < 10 ? 1 : 0));
      return '<figure><figcaption>' + sr.cap + '</figcaption>' + barChart(vals, { label: sr.cap + ' je Reifegrad', fmt, unit: sr.unit }) + '</figure>';
    }).join('');
    $('#stack').innerHTML = TOTALS.map((t, i) => {
      const n = t.steps.human + t.steps.auto + t.steps.agent || 1; const p = k => Math.round(t.steps[k] / n * 100);
      return '<div class="stack-row"><div class="lbl">Stufe ' + (i + 1) + '</div><div class="bar" data-tip="' + esc('Stufe ' + (i + 1) + ': Mensch ' + p('human') + ' %, Automatisierung ' + p('auto') + ' %, KI-Agent ' + p('agent') + ' %') + '">' +
        (t.steps.human ? '<i class="human" style="flex:' + t.steps.human + '"></i>' : '') + (t.steps.auto ? '<i class="auto" style="flex:' + t.steps.auto + '"></i>' : '') + (t.steps.agent ? '<i class="agent" style="flex:' + t.steps.agent + '"></i>' : '') +
        '</div><div class="val">' + p('human') + ' % Mensch</div></div>';
    }).join('');
  }

  /* ---------- Wissensseite: Ihr Weg ---------- */
  const avgLevel = () => FIELDS.reduce((a, f) => a + (state.assessment[f.id] || 1), 0) / FIELDS.length;
  const minLevel = () => Math.min.apply(null, FIELDS.map(f => state.assessment[f.id] || 1));
  function renderMatrix() {
    const tgt = state.target;
    let html = '<thead><tr><th>Handlungsfeld</th>' + LEVELS.map(l => '<th class="lv">Stufe ' + l.n + ' · ' + l.name + '<small>' + l.tagline + '</small></th>').join('') + '</tr></thead><tbody>';
    FIELDS.forEach(f => {
      const cur = state.assessment[f.id] || 1;
      html += '<tr><td class="field">' + f.name + '</td>';
      f.stages.forEach((txt, i) => {
        const n = i + 1; let cls = 'cell';
        if (n === cur) cls += ' sel'; else if (n < cur) cls += ' reached'; else if (n === cur + 1 && n <= tgt) cls += ' next';
        if (n > tgt) cls += ' beyond';
        html += '<td><button type="button" class="' + cls + '" data-afield="' + f.id + '" data-astage="' + n + '" aria-pressed="' + (n === cur) + '">' + esc(txt) + '</button></td>';
      });
      html += '</tr>';
    });
    $('#matrix').innerHTML = html + '</tbody>';
    $('#targetSeg').innerHTML = [3, 4, 5].map(n => '<button type="button" data-target="' + n + '" aria-pressed="' + (n === tgt) + '"><span class="n">' + n + '</span><span class="lbl">' + LEVELS[n - 1].name + '</span></button>').join('');
    renderStandort(); renderPhases();
  }
  function renderStandort() {
    const avg = avgLevel(), mn = minLevel(), tgt = state.target;
    const bottleneck = FIELDS.filter(f => (state.assessment[f.id] || 1) === mn);
    const box = $('#standort');
    box.innerHTML = '<div class="eyebrow">Ihr Standort' + (state.assessed ? '' : ' · Beispielwerte, bitte anpassen') + '</div>' +
      '<div class="hero-num" style="margin-top:6px">' + fmtNum(avg, 1) + '<small>von 5</small></div>' +
      '<p class="muted small" style="margin-top:6px">Durchschnitt über sieben Handlungsfelder. Wirksam wird Automatisierung erst, wenn das schwächste Feld mitzieht: ' + (bottleneck.length === FIELDS.length ? 'alle Felder stehen auf Stufe ' + mn + '.' : '<b>' + bottleneck.map(b => b.name).join(', ') + '</b> auf Stufe ' + mn + '.') + '</p>' +
      '<div class="fieldbars">' + FIELDS.map(f => { const v = state.assessment[f.id] || 1; return '<div class="fieldbar' + (v === mn && bottleneck.length < FIELDS.length ? ' bottleneck' : '') + '"><div class="nm">' + f.name + '</div><div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= v ? 'on' : '') + (n <= tgt && n > v ? ' target' : '') + '"></i>').join('') + '</div><div class="v">' + v + ' → ' + tgt + '</div></div>'; }).join('') + '</div>' +
      '<div class="actions"><button class="btn primary" type="button" data-play-assessment>Als Ausgangslage in die Simulation übernehmen</button><button class="btn" type="button" data-copy>Ergebnis kopieren</button><button class="btn" type="button" data-reset-assess>Zurücksetzen</button></div>';
    $('[data-play-assessment]', box).onclick = () => { state.useAssessment = true; store.set('zt.useAssessment', true); applyBase(); showView('game'); showScreen('plan'); toast('Ausgangslage übernommen. Verteilen Sie jetzt Ihr Budget.'); };
    $('[data-copy]', box).onclick = copyResult;
    $('[data-reset-assess]', box).onclick = () => { FIELDS.forEach(f => { state.assessment[f.id] = 2; }); state.assessed = false; store.set('zt.assessment', state.assessment); store.set('zt.assessed', false); renderMatrix(); toast('Einschätzung zurückgesetzt'); };
  }
  function roadmap() {
    const phases = [];
    for (let lv = minLevel() + 1; lv <= state.target; lv++) {
      const items = FIELDS.filter(f => (state.assessment[f.id] || 1) < lv).map(f => ({ field: f, text: f.stages[lv - 1] }));
      if (items.length) phases.push({ lv, tr: TRANSITIONS[lv - 2], items });
    }
    return phases;
  }
  function renderPhases() {
    const phases = roadmap(), box = $('#phases');
    if (!phases.length) { box.innerHTML = '<div class="panel"><h3>Ziel erreicht</h3><p class="muted">Alle Handlungsfelder stehen auf oder über der Zielstufe ' + state.target + '.</p></div>'; return; }
    box.innerHTML = phases.map((p, i) => '<div class="phase"><div class="num">' + (i + 1) + '<small>Schritt</small></div><div style="min-width:0"><h3>' + esc(p.tr.title) + ' <span class="muted" style="font-weight:400">· auf Stufe ' + p.lv + '</span></h3>' +
      '<div class="meta">Typische Dauer ' + p.tr.duration + ' · ' + p.items.length + ' von ' + FIELDS.length + ' Handlungsfeldern betroffen</div><p class="focus">' + esc(p.tr.focus) + '</p>' +
      '<ul>' + p.items.map(it => '<li><span class="f">' + esc(it.field.name) + '</span><span>' + esc(it.text) + '</span></li>').join('') + '</ul>' +
      '<details><summary>Typische Maßnahmen in diesem Schritt</summary><ul>' + p.tr.actions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></details>' +
      '<div class="success"><b>Erfolgskriterium</b><span>' + esc(p.tr.success) + '</span></div></div></div>').join('');
  }
  function copyResult() {
    let txt = 'Zero-Touch IT Simulator – Standortbestimmung\nReifegrad im Durchschnitt: ' + fmtNum(avgLevel(), 1) + ' von 5, Zielstufe ' + state.target + '\n\nHandlungsfelder heute:\n';
    FIELDS.forEach(f => { txt += '- ' + f.name + ': Stufe ' + (state.assessment[f.id] || 1) + '\n'; });
    txt += '\nRoadmap:\n';
    roadmap().forEach((p, i) => { txt += '\nSchritt ' + (i + 1) + ': ' + p.tr.title + ' (auf Stufe ' + p.lv + ', ' + p.tr.duration + ')\n'; p.items.forEach(it => { txt += '  - ' + it.field.name + ': ' + it.text + '\n'; }); txt += '  Erfolgskriterium: ' + p.tr.success + '\n'; });
    const done = () => toast('Ergebnis in die Zwischenablage kopiert');
    const fail = () => { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Kopieren nicht möglich.'); } ta.remove(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail); else fail();
  }


  /* ---------- Prognose & Roadmap ---------- */
  const fmtEur = n => (Math.abs(n) >= 1e6 ? fmtNum(n / 1e6, 2) + ' Mio. €' : fmtNum(Math.round(n)) + ' €');
  const fmtMonths = m => !isFinite(m) ? 'nie' : (m < 1 ? '< 1 Monat' : m < 24 ? fmtNum(m, 0) + ' Monate' : fmtNum(m / 12, 1) + ' Jahre');
  const PCT_PARAMS = { coverage: 1, opexShare: 1, spread: 1 };
  let analysisTimer = null;

  function frameIndex() { return state.frameIdx === null ? state.budgetIdx : state.frameIdx; }

  function renderParams() {
    $('#paramsGrid').innerHTML = Object.keys(PARAM_LABELS).map(k => {
      const v = PCT_PARAMS[k] ? Math.round(state.params[k] * 100) : state.params[k];
      return '<label>' + PARAM_LABELS[k][0] + (PARAM_LABELS[k][1] ? ' (' + PARAM_LABELS[k][1] + ')' : '') + '<input type="number" id="p_' + k + '" data-param="' + k + '" value="' + v + '" step="' + (k === 'runs' || k === 'employees' || k === 'workdays' ? 1 : 'any') + '" min="0"></label>';
    }).join('');
    $('#freqGrid').innerHTML = EVENTS.map(e => '<label>' + esc(e.title) + (e.perCompany ? ' (je Unternehmen)' : '') + '<input type="number" id="f_' + e.id + '" data-freq="' + e.id + '" value="' + e.freq + '" step="0.1" min="0"></label>').join('');
  }

  function rangeBar(sv, lo, hi) {
    const span = hi - lo || 1;
    const x = v => Math.max(0, Math.min(100, (v - lo) / span * 100));
    const neg = sv.mean < 0;
    return '<div class="range' + (neg ? ' neg' : '') + '" data-tip="' + esc('Ersparnis je Jahr: ' + fmtEur(sv.p10) + ' bis ' + fmtEur(sv.p90) + ', Mittel ' + fmtEur(sv.mean)) + '">' +
      '<div class="zero" style="left:' + x(0) + '%"></div>' +
      '<div class="band" style="left:' + x(Math.min(sv.p10, sv.p90)) + '%;width:' + Math.max(.8, Math.abs(x(sv.p90) - x(sv.p10))) + '%"></div>' +
      '<div class="mean" style="left:' + x(sv.mean) + '%"></div></div>';
  }

  function roadChart(road) {
    const pts = [{ i: 0, inv: 0, net: 0 }].concat(road.steps.map((s, i) => ({ i: i + 1, inv: s.cumInvest, net: s.cumNet })));
    const W = 320, H = 190, L = 54, R = 10, Tm = 12, B = 26;
    const max = Math.max.apply(null, pts.map(p => Math.max(p.inv, p.net)).concat([1]));
    const min = Math.min(0, Math.min.apply(null, pts.map(p => p.net)));
    const step = niceStep(max - min); const top = Math.ceil(max / step) * step || step; const bottom = Math.floor(min / step) * step;
    const iw = W - L - R, ih = H - Tm - B;
    const x = i => L + (pts.length === 1 ? 0 : i / (pts.length - 1) * iw);
    const y = v => Tm + ih - (v - bottom) / (top - bottom) * ih;
    const kfmt = v => Math.abs(v) >= 1e6 ? fmtNum(v / 1e6, 1) + ' M' : Math.abs(v) >= 1000 ? fmtNum(v / 1000) + ' k' : fmtNum(v);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Kumulierte Investition und Nettoersparnis je Roadmap-Schritt"><g class="grid">';
    for (let v = bottom; v <= top + 1e-9; v += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + kfmt(v) + '</text>';
    s += '</g>';
    const path = key => pts.map((p, i) => (i ? 'L' : 'M') + x(p.i) + ' ' + y(p[key])).join(' ');
    s += '<path class="area-auto" d="' + path('net') + ' L' + x(pts[pts.length - 1].i) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z"/>';
    s += '<path class="line-human" d="' + path('inv') + '"/><path class="line-auto" d="' + path('net') + '"/>';
    pts.forEach(p => { s += '<circle class="dot-h" cx="' + x(p.i) + '" cy="' + y(p.inv) + '" r="3.5"><title>' + esc('Schritt ' + p.i + ': Investition ' + fmtEur(p.inv)) + '</title></circle><circle class="dot-a" cx="' + x(p.i) + '" cy="' + y(p.net) + '" r="3.5"><title>' + esc('Schritt ' + p.i + ': Nettoersparnis je Jahr ' + fmtEur(p.net)) + '</title></circle>'; });
    pts.forEach(p => { if (p.i === 0 || p.i === pts.length - 1 || pts.length <= 8 || p.i % 2 === 0) s += '<text class="xl" x="' + x(p.i) + '" y="' + (H - 8) + '" text-anchor="middle">' + p.i + '</text>'; });
    s += '<g class="axis"><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></g></svg>';
    return s;
  }

  let lastRoad = null;
  function renderAnalysis() {
    const P = state.params, L = state.levels, A = window.Analysis;
    const frames = BUDGETS;
    $('#frameSeg').innerHTML = frames.map((b, i) => '<button type="button" data-frame="' + i + '" aria-pressed="' + (i === frameIndex()) + '"><span class="n">' + b.points + '</span><span class="lbl">' + b.name + '</span></button>').join('');
    if (!$('#p_employees')) renderParams();
    const base = A.summary(L, P, 7);
    $('#baseChips').innerHTML = FIELDS.map(f => '<span>' + f.name + ' <b>' + L[f.id] + '</b></span>').join('');
    const tile = (l, v, rng) => '<div class="tile"><div class="lbl">' + l + '</div><div class="val">' + v + '</div>' + (rng ? '<div class="rng">' + rng + '</div>' : '') + '</div>';
    $('#baseTiles').innerHTML =
      tile('Vorfälle und Anfragen je Jahr', fmtNum(Math.round(base.exp.occurrences)), fmtNum(Math.round(base.occurrences.p10)) + ' – ' + fmtNum(Math.round(base.occurrences.p90))) +
      tile('IT-Aufwand je Jahr', fmtNum(Math.round(base.exp.it / 60)) + ' h', fmtNum(Math.round(base.it.p10 / 60)) + ' – ' + fmtNum(Math.round(base.it.p90 / 60)) + ' h') +
      tile('Ausfallzeit je Jahr', fmtNum(Math.round(base.exp.user / 60)) + ' h', fmtNum(Math.round(base.user.p10 / 60)) + ' – ' + fmtNum(Math.round(base.user.p90 / 60)) + ' h') +
      tile('Tickets je Jahr', fmtNum(Math.round(base.exp.tickets)), fmtNum(Math.round(base.tickets.p10)) + ' – ' + fmtNum(Math.round(base.tickets.p90))) +
      tile('Kosten je Jahr', fmtEur(base.exp.cost), fmtEur(base.cost.p10) + ' – ' + fmtEur(base.cost.p90));

    const cands = A.candidates(L, P, base);
    const lo = Math.min(0, Math.min.apply(null, cands.map(c => c.savingMC.p10)));
    const hi = Math.max(1, Math.max.apply(null, cands.map(c => c.savingMC.p90)));
    const bestRatio = Math.max.apply(null, cands.filter(c => !c.blocker).map(c => c.ratio));
    $('#candTable').innerHTML = '<thead><tr><th>Maßnahme</th><th>Investition</th><th>Ersparnis je Jahr</th><th>Bandbreite</th><th>Nettonutzen je Jahr</th><th>Nutzen je € Invest</th><th>Amortisation</th><th style="text-align:left">Wirkung</th></tr></thead><tbody>' +
      cands.map(c => {
        const eff = c.changes.length ? c.changes.length + ' Ereignistyp' + (c.changes.length > 1 ? 'en' : '') + ' auf Stufe ' + c.changes[0].to + ': ' + c.changes.map(x => x.title).join('; ') : 'allein keine Wirkung';
        const unl = c.unlocks.length ? '<small>schaltet frei: ' + c.unlocks.join(', ') + '</small>' : '';
        const pair = c.pair && c.pair.net > c.net + 1 ? '<small>zusammen mit ' + c.pair.field.name + ' auf Stufe ' + c.pair.stage + ' (' + c.pair.points + ' P): Nettonutzen ' + fmtEur(c.pair.net) + '/Jahr</small>' : '';
        const blk = c.blocker ? '<small>' + esc(c.blocker) + '</small>' : '';
        return '<tr class="' + (c.blocker ? 'locked' : (c.ratio === bestRatio && c.ratio > 0 ? 'top' : '')) + '"><td class="name">' + c.field.name + ' auf Stufe ' + c.stage + '<small>' + esc(c.title) + '</small>' + blk + '</td>' +
          '<td>' + c.cost.points + ' P<small>' + fmtEur(c.cost.invest) + ' + ' + fmtEur(c.cost.opex) + '/Jahr</small></td>' +
          '<td>' + fmtEur(c.saving) + '</td><td>' + rangeBar(c.savingMC, lo, hi) + '</td>' +
          '<td>' + fmtEur(c.net) + '</td><td>' + fmtNum(c.ratio, 2) + '</td><td>' + fmtMonths(c.payback) + '</td>' +
          '<td style="text-align:left;max-width:300px"><span class="small">' + esc(eff) + '</span>' + pair + unl + '</td></tr>';
      }).join('') + '</tbody>';

    const road = A.roadmap(L, frames[frameIndex()].points, P);
    lastRoad = road;
    if (!road.steps.length) {
      $('#roadSummary').textContent = 'Innerhalb dieses Rahmens gibt es keine Maßnahme mit positivem Nettonutzen. Erhöhen Sie den Rahmen oder prüfen Sie die Annahmen.';
      $('#roadTable').innerHTML = ''; $('#roadChart').innerHTML = '';
    } else {
      const last = road.steps[road.steps.length - 1];
      const pct = Math.round((1 - last.costAfter / road.startCost) * 100);
      $('#roadSummary').innerHTML = '<b>' + road.steps.length + ' Schritte, ' + road.spent + ' Punkte, ' + fmtEur(last.cumInvest) + ' Investition.</b> Die jährlichen Kosten sinken von ' + fmtEur(road.startCost) + ' auf ' + fmtEur(last.costAfter) + ' (−' + pct + ' %). Nettoersparnis ' + fmtEur(last.cumNet) + ' je Jahr, Amortisation der gesamten Roadmap nach ' + fmtMonths(last.payback) + '.';
      $('#roadTable').innerHTML = '<thead><tr><th>Nr.</th><th>Maßnahme</th><th>Investition</th><th>Ersparnis dieses Schritts</th><th>Investition kumuliert</th><th>Nettoersparnis je Jahr kumuliert</th><th>Amortisation</th></tr></thead><tbody>' +
        road.steps.map((s, i) => '<tr class="' + (s.payback <= 12 ? 'pay' : '') + '"><td class="num">' + (i + 1) + '</td><td>' + s.field.name + ' auf Stufe ' + s.stage + '<small>' + esc(s.title) + (s.stepSaving <= 0 ? ' · Voraussetzung für spätere Schritte' : '') + '</small></td><td>' + s.points + ' P<small>' + fmtEur(s.invest) + '</small></td><td>' + fmtEur(s.stepSaving) + '</td><td>' + fmtEur(s.cumInvest) + '</td><td>' + fmtEur(s.cumNet) + '</td><td>' + fmtMonths(s.payback) + '</td></tr>').join('') + '</tbody>';
      $('#roadChart').innerHTML = roadChart(road);
    }
  }

  function adoptLevels(levels) {
    state.levels = Object.assign({}, levels);
    const need = spent();
    let idx = BUDGETS.findIndex(b => b.points >= need); if (idx < 0) idx = BUDGETS.length - 1;
    if (BUDGETS[state.budgetIdx].points < need) state.budgetIdx = idx;
    store.set('zt.levels', state.levels); store.set('zt.budget', state.budgetIdx);
  }
  function scheduleAnalysis() { clearTimeout(analysisTimer); analysisTimer = setTimeout(renderAnalysis, 250); }

  /* ---------- Sonstiges ---------- */
  let toastTimer = null;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
  const ICON = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>'
  };
  function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); store.set('zt.theme', t || ''); }

  function bind() {
    document.addEventListener('click', e => {
      const t = e.target;
      const nav = t.closest('[data-view]'); if (nav) { showView(nav.dataset.view); return; }
      const fr = t.closest('[data-frame]'); if (fr) { state.frameIdx = parseInt(fr.dataset.frame, 10); store.set('zt.frame', state.frameIdx); renderAnalysis(); return; }
      const bd = t.closest('[data-budget]'); if (bd) { state.budgetIdx = parseInt(bd.dataset.budget, 10); store.set('zt.budget', state.budgetIdx); applyBase(); renderPlan(); return; }
      const inv = t.closest('.inv'); if (inv) { setStage(inv.dataset.field, parseInt(inv.dataset.stage, 10)); return; }
      const sp = t.closest('#speed button'); if (sp) { state.speed = parseInt(sp.dataset.s, 10); $$('#speed button').forEach(b => b.setAttribute('aria-pressed', b === sp)); return; }
      const lvv = t.closest('[data-levelview]'); if (lvv) { state.levelView = parseInt(lvv.dataset.levelview, 10); renderLevelsView(); return; }
      const pl = t.closest('[data-play-level]'); if (pl) { const n = parseInt(pl.dataset.playLevel, 10); state.useAssessment = false; state.base = allOne(); state.budgetIdx = 3; FIELDS.forEach(f => { state.levels[f.id] = n; }); showView('game'); showScreen('plan'); toast('Alle Felder auf Stufe ' + n + ' gesetzt. Starten Sie den Tag oder passen Sie die Verteilung an.'); return; }
      const cell = t.closest('.cell'); if (cell) { state.assessment[cell.dataset.afield] = parseInt(cell.dataset.astage, 10); state.assessed = true; store.set('zt.assessment', state.assessment); store.set('zt.assessed', true); renderMatrix(); return; }
      const tg = t.closest('[data-target]'); if (tg) { state.target = parseInt(tg.dataset.target, 10); store.set('zt.target', state.target); renderMatrix(); return; }
    });
    $('#startBtn').addEventListener('click', () => showScreen('plan'));
    $('#analysisBtn').addEventListener('click', () => showScreen('analysis'));
    $('#resultAnalysisBtn').addEventListener('click', () => { endHandled = true; showScreen('analysis'); });
    $('#analysisBack').addEventListener('click', () => showScreen('plan'));
    $('#paramsToggle').addEventListener('click', () => { const p = $('#paramsPanel'); p.hidden = !p.hidden; $('#paramsToggle').setAttribute('aria-expanded', !p.hidden); });
    $('#varyBtn').addEventListener('click', () => { state.vary = !state.vary; store.set('zt.vary', state.vary); $('#varyBtn').setAttribute('aria-pressed', state.vary); toast(state.vary ? 'Jeder Durchlauf wählt Ereignisse, Zeiten und Aufwände zufällig.' : 'Jeder Durchlauf zeigt denselben Referenztag.'); });
    $('#adoptRoadBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.end); showScreen('plan'); toast('Roadmap übernommen: ' + lastRoad.steps.length + ' Schritte in der Planung gesetzt.'); });
    $('#adoptStepBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.steps[0].levels); renderAnalysis(); toast('Erster Schritt übernommen. Die Prognose geht jetzt von der neuen Ausgangslage aus.'); });
    $('#roadRunBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.end); endHandled = false; startRun(); });
    document.addEventListener('input', e => {
      const p = e.target.dataset && e.target.dataset.param;
      if (p) { let v = parseFloat(e.target.value); if (isNaN(v)) return; if (PCT_PARAMS[p]) v = v / 100; if (p === 'runs') v = Math.max(20, Math.min(2000, Math.round(v))); state.params[p] = v; store.set('zt.params', state.params); scheduleAnalysis(); return; }
      const f = e.target.dataset && e.target.dataset.freq;
      if (f) { const v = parseFloat(e.target.value); if (isNaN(v) || v < 0) return; const ev = EVENTS.find(x => x.id === f); ev.freq = v; const fo = store.get('zt.freq', {}); fo[f] = v; store.set('zt.freq', fo); scheduleAnalysis(); }
    });
    $('#runBtn').addEventListener('click', () => { if (spent() === 0 && !state.useAssessment) toast('Ohne Investition läuft der Tag auf Stufe 1. Gut als Vergleich.'); startRun(); endHandled = false; });
    $('#resetPlanBtn').addEventListener('click', () => { state.levels = Object.assign({}, state.base); store.set('zt.levels', state.levels); renderPlan(); });
    $('#baseToggle').addEventListener('click', () => { state.useAssessment = !state.useAssessment; store.set('zt.useAssessment', state.useAssessment); applyBase(); renderPlan(); });
    $('#playBtn').addEventListener('click', () => { if (state.ended) return; state.playing = !state.playing; renderClock(); });
    $('#skipBtn').addEventListener('click', () => { state.sim = DAY_END; state.ended = true; state.playing = false; update(); });
    $('#stopBtn').addEventListener('click', () => { state.playing = false; endHandled = true; showScreen('plan'); });
    $('#followBtn').addEventListener('click', () => { state.follow = !state.follow; window.Scene3D.setFollow(state.follow); $('#followBtn').setAttribute('aria-pressed', state.follow); });
    $$('.replanBtn').forEach(b => b.addEventListener('click', () => { endHandled = true; showScreen('plan'); }));
    $('#rerunBtn').addEventListener('click', () => { endHandled = false; startRun(); });
    $$('.themeBtn').forEach(b => b.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme((cur ? cur === 'dark' : sysDark) ? 'light' : 'dark');
    }));
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      if (state.view !== 'game' || state.screen !== 'run') return;
      if (e.key === ' ') { e.preventDefault(); $('#playBtn').click(); }
      else if (e.key === 'ArrowRight') $('#skipBtn').click();
      else if (e.key === 'Escape') $('#stopBtn').click();
    });
    const tip = $('#tooltip');
    document.addEventListener('mousemove', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.classList.remove('show'); return; }
      tip.textContent = t.dataset.tip; tip.classList.add('show');
      tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12) + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
  }

  function init() {
    const th = store.get('zt.theme', ''); if (th) applyTheme(th);
    if (savedLevels) FIELDS.forEach(f => { if (savedLevels[f.id]) state.levels[f.id] = savedLevels[f.id]; });
    applyBase();
    let ok = false;
    if (window.THREE) { try { window.Scene3D.init($('#c3d')); ok = true; } catch (e) { console.error(e); } }
    if (!ok) { $('#webglWarn').hidden = false; const noop = () => {}; window.Scene3D = new Proxy({}, { get: () => noop }); }
    bind();
    showView('game'); showScreen('start');
    $('#playBtn').innerHTML = ICON.pause + 'Pause';
    $('#varyBtn').setAttribute('aria-pressed', state.vary);
    renderPlan();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
