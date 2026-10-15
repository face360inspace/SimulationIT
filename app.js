/* =========================================================================
   Zero-Touch IT Simulator – Ablauflogik
   Ablauf: Start → Planen (Budget auf Handlungsfelder verteilen) → Simulieren
   (ein Arbeitstag in der 3D-Szene) → Auswerten (Wirkung der Maßnahmen).
   Dazu zwei Wissensseiten: Reifegrade und Standortbestimmung (Selbsteinschätzung).
   Erwartet data.js und game.js (window.Scene3D).
   ========================================================================= */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MS_PER_MIN = 170;   // Echtzeit je simulierter Minute bei 1×
  const ROUTES = { start: 'start', intake: 'ist-aufnahme', istbild: 'ist-bild', plan: 'planen', run: 'arbeitstag', result: 'auswertung', analysis: 'prognose', levels: 'reifegrade', path: 'standort' };
  const STEP_NAMES = { intake: 'Ist-Aufnahme', plan: 'Planung', run: 'Arbeitstag', result: 'Auswertung', analysis: 'Prognose' };

  const STORAGE_VERSION = 2;   // Erhöhen setzt den gespeicherten Zustand aller Nutzer beim nächsten Laden zurück
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kein Speicher */ } },
    clearAll() { try { Object.keys(localStorage).filter(k => k.indexOf('zt.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* kein Speicher */ } }
  };
  (function () { if (store.get('zt.version', 0) !== STORAGE_VERSION) { const theme = store.get('zt.theme', ''); store.clearAll(); if (theme) store.set('zt.theme', theme); store.set('zt.version', STORAGE_VERSION); } })();
  const DEFAULT_FREQ = {}; EVENTS.forEach(e => { DEFAULT_FREQ[e.id] = e.freq; });

  const allOne = () => { const o = {}; FIELDS.forEach(f => { o[f.id] = 1; }); return o; };
  const state = {
    view: 'sim', screen: 'start', returnScreen: 'start', evaluated: false,
    budgetIdx: store.get('zt.budget', 1),
    useAssessment: store.get('zt.useAssessment', false),
    base: allOne(), levels: allOne(),
    speed: 1, playing: false, ended: false, sim: DAY_START, day: null,
    follow: true, runs: [], levelView: 3,
    assessment: store.get('zt.assessment', null), assessed: store.get('zt.assessed', false),
    target: store.get('zt.target', 5),
    params: Object.assign({}, PARAMS, store.get('zt.params', {})),
    intake: Object.assign({ customer: '', employees: 300, metrics: null, counts: null, docText: '', detected: [], manual: {}, answers: {}, overrides: {}, applied: false, extra: {}, agentAnswers: {} }, store.get('zt.intake', {})),
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
  function setRoute(key, replace) {
    const hash = '#' + ROUTES[key];
    if (location.hash === hash) return;
    if (replace) history.replaceState(null, '', hash); else history.pushState(null, '', hash);
  }
  function updateStepper() {
    const active = state.view === 'sim' ? (state.screen === 'istbild' ? 'intake' : state.screen) : null;
    $$('#steps [data-step]').forEach(b => {
      const s = b.dataset.step;
      if (s === active) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.disabled = (s === 'result' && !state.evaluated) || (s === 'run' && state.screen === 'run' && !state.ended && state.view === 'sim');
      b.classList.toggle('done', (s === 'intake' && state.intake.applied) || (s === 'plan' && ['run', 'result', 'analysis'].indexOf(state.screen) >= 0) || (s === 'run' && state.evaluated) || (s === 'result' && state.evaluated && state.screen === 'analysis'));
    });
    const back = $('#backBtn');
    if (state.view !== 'sim') {
      const lbl = { start: 'Zum Start', intake: 'Zurück zur Ist-Aufnahme', istbild: 'Zurück zum Ist-Bild', plan: 'Zurück zur Planung', run: state.ended ? 'Zurück zur Auswertung' : 'Zurück zum Arbeitstag', result: 'Zurück zur Auswertung', analysis: 'Zurück zur Prognose' }[state.returnScreen] || 'Zur Simulation';
      back.textContent = lbl; back.hidden = false;
    } else back.hidden = true;
  }
  function focusHeading(root) {
    const h = $('h2', root); if (!h) return;
    h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }
  function showScreen(name, opts) {
    state.screen = name;
    ['start', 'intake', 'istbild', 'plan', 'result', 'analysis'].forEach(s => { $('#screen-' + s).hidden = s !== name; });
    const hud = $('#hud');
    hud.classList.toggle('dim', name !== 'run');
    hud.inert = name !== 'run';
    document.body.classList.toggle('in-run', name === 'run');
    if (name === 'intake') renderIntake();
    if (name === 'istbild' && !(opts && opts.animate)) { $('#revealRun').hidden = true; $('#revealResult').hidden = false; renderProposal(); }
    if (name === 'plan') renderPlan();
    if (name === 'analysis') renderAnalysis();
    updateStepper();
    setRoute(name, opts && opts.replace);
    if (name !== 'run') focusHeading($('#screen-' + name));
  }
  function showView(v, opts) {
    const leaving = state.view === 'sim' && v !== 'sim';
    if (leaving) {
      state.returnScreen = state.screen;
      if (state.screen === 'run' && state.playing && !state.ended) { state.playing = false; renderClock(); toast('Arbeitstag pausiert. „Weiter“ oder Leertaste setzt fort.'); }
    }
    state.view = v;
    $('#stage').hidden = v !== 'sim';
    $('#view-levels').hidden = v !== 'levels';
    $('#view-path').hidden = v !== 'path';
    document.body.classList.toggle('in-run', v === 'sim' && state.screen === 'run');
    $$('#appbar .nav [data-view]').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    window.Scene3D.setRunning(v === 'sim');
    if (v === 'levels') renderLevelsView();
    if (v === 'path') renderMatrix();
    updateStepper();
    setRoute(v === 'sim' ? state.screen : v, opts && opts.replace);
    window.scrollTo({ top: 0 });
    if (v !== 'sim') focusHeading($('#view-' + v));
  }
  function applyRoute() {
    const h = (location.hash || '').replace('#', '');
    const key = Object.keys(ROUTES).find(k => ROUTES[k] === h) || 'start';
    if (key === 'levels' || key === 'path') { showView(key, { replace: true }); return; }
    if (state.view !== 'sim') showView('sim', { replace: true });
    if (key === 'run') { if (state.screen === 'run') return; showScreen(state.evaluated ? 'result' : 'plan', { replace: true }); return; }
    if (key === 'result' && !state.evaluated) { showScreen('plan', { replace: true }); return; }
    if (state.screen !== key) showScreen(key, { replace: true });
  }

  /* In-Page-Bestätigung (Browserdialoge stehen nicht überall zur Verfügung). */
  function ask(msg) {
    return new Promise(resolve => {
      const box = $('#confirm'); $('#confirmMsg').textContent = msg; box.hidden = false;
      const done = v => { box.hidden = true; $('#confirmYes').onclick = $('#confirmNo').onclick = null; resolve(v); };
      $('#confirmYes').onclick = () => done(true); $('#confirmNo').onclick = () => done(false);
      $('#confirmYes').focus();
    });
  }

  /* ---------- Planung ---------- */
  function renderPlan() {
    const b = budget(), sp = spent();
    $('#budgetSeg').innerHTML = BUDGETS.map((bd, i) => '<button type="button" data-budget="' + i + '" aria-pressed="' + (i === state.budgetIdx) + '"><span class="n">' + bd.points + '</span><span class="lbl">' + bd.name + '</span></button>').join('');
    $('#budgetDesc').textContent = BUDGETS[state.budgetIdx].desc;
    $('#budgetBar').style.width = Math.min(100, sp / b * 100) + '%';
    $('#budgetText').innerHTML = '<b>' + sp + '</b> von ' + b + ' Punkten eingesetzt · ' + (b - sp) + ' frei';
    $$('#baseSeg button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.base === 'assess') === state.useAssessment));
    $('#baseAssessBtn').disabled = !state.assessed;
    $('#baseHint').innerHTML = state.useAssessment ? (state.intake.applied ? 'Ausgangslage aus der Ist-Aufnahme' + (state.intake.customer ? ' von ' + esc(state.intake.customer) : '') + '. Vorhandene Stufen kosten kein Budget.' : 'Vorhandene Stufen aus Ihrer Standortbestimmung kosten kein Budget.') : (state.assessed ? 'Ein Ist-Bild liegt vor und kann als Ausgangslage dienen.' : 'Noch kein Ist-Bild. <button type="button" class="linkbtn" data-step="intake">Ist-Aufnahme</button> oder <button type="button" class="linkbtn" data-view="path">Standort bestimmen</button>');
    $$('#baseSeg button').forEach(b => { if (b.dataset.base === 'assess') b.textContent = state.intake.applied ? 'Aus Ist-Aufnahme' : 'Aus Standortbestimmung'; });
    $('#varyBtn').checked = !!state.vary;

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
    if (state.view === 'sim') window.Scene3D.setTime(state.screen === 'run' ? state.sim : 10 * 60 + (ts / 400) % (8 * 60));
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
    state.evaluated = true;
    $('#resultHero').innerHTML = '<div class="eyebrow">Schritt 3 · Auswertung</div><div class="hero-num">' + t.index + '<small>Experience-Index</small></div>' +
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
      '<div class="actions"><button class="btn primary" type="button" data-play-level="' + lv + '">Alle Felder auf Stufe ' + lv + ' in die Planung übernehmen</button></div>';
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

  /* ---------- Wissensseite: Standortbestimmung ---------- */
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
    $('[data-play-assessment]', box).onclick = async () => {
      if (spent() > 0 && !(await ask('Die aktuelle Planung wird durch die Standortbestimmung als Ausgangslage ersetzt. Fortfahren?'))) return;
      state.useAssessment = true; store.set('zt.useAssessment', true); applyBase(); showView('sim'); showScreen('plan'); toast('Ausgangslage übernommen. Weiter mit „Arbeitstag starten“.');
    };
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
    box.innerHTML = phases.map((p, i) => '<div class="phase"><div class="num">' + (i + 1) + '<small>Etappe</small></div><div style="min-width:0"><h3>' + esc(p.tr.title) + ' <span class="muted" style="font-weight:400">· auf Stufe ' + p.lv + '</span></h3>' +
      '<div class="meta">Typische Dauer ' + p.tr.duration + ' · ' + p.items.length + ' von ' + FIELDS.length + ' Handlungsfeldern betroffen</div><p class="focus">' + esc(p.tr.focus) + '</p>' +
      '<ul>' + p.items.map(it => '<li><span class="f">' + esc(it.field.name) + '</span><span>' + esc(it.text) + '</span></li>').join('') + '</ul>' +
      '<details><summary>Typische Maßnahmen in diesem Schritt</summary><ul>' + p.tr.actions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></details>' +
      '<div class="success"><b>Erfolgskriterium</b><span>' + esc(p.tr.success) + '</span></div></div></div>').join('');
  }
  function copyResult() {
    let txt = 'Zero-Touch IT Simulator – Standortbestimmung\nReifegrad im Durchschnitt: ' + fmtNum(avgLevel(), 1) + ' von 5, Zielstufe ' + state.target + '\n\nHandlungsfelder heute:\n';
    FIELDS.forEach(f => { txt += '- ' + f.name + ': Stufe ' + (state.assessment[f.id] || 1) + '\n'; });
    txt += '\nEntwicklungspfad:\n';
    roadmap().forEach((p, i) => { txt += '\nEtappe ' + (i + 1) + ': ' + p.tr.title + ' (auf Stufe ' + p.lv + ', ' + p.tr.duration + ')\n'; p.items.forEach(it => { txt += '  - ' + it.field.name + ': ' + it.text + '\n'; }); txt += '  Erfolgskriterium: ' + p.tr.success + '\n'; });
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

    // A · Ausgangslage
    $('#baseBars').innerHTML = FIELDS.map(f => '<div class="fieldbar"><div class="nm">' + f.name + '</div><div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= L[f.id] ? 'on' : '') + '"></i>').join('') + '</div><div class="v">Stufe ' + L[f.id] + ' · ' + esc(f.short[L[f.id] - 1]) + '</div></div>').join('');
    const tile = (l, v, rng) => '<div class="tile"><div class="lbl">' + l + '</div><div class="val">' + v + '</div>' + (rng ? '<div class="rng">' + rng + '</div>' : '') + '</div>';
    $('#baseTiles').innerHTML =
      tile('Vorfälle und Anfragen je Jahr', fmtNum(Math.round(base.exp.occurrences)), fmtNum(Math.round(base.occurrences.p10)) + ' – ' + fmtNum(Math.round(base.occurrences.p90))) +
      tile('IT-Aufwand je Jahr', fmtNum(Math.round(base.exp.it / 60)) + ' h', fmtNum(Math.round(base.it.p10 / 60)) + ' – ' + fmtNum(Math.round(base.it.p90 / 60)) + ' h') +
      tile('Ausfallzeit je Jahr', fmtNum(Math.round(base.exp.user / 60)) + ' h', fmtNum(Math.round(base.user.p10 / 60)) + ' – ' + fmtNum(Math.round(base.user.p90 / 60)) + ' h') +
      tile('Tickets je Jahr', fmtNum(Math.round(base.exp.tickets)), fmtNum(Math.round(base.tickets.p10)) + ' – ' + fmtNum(Math.round(base.tickets.p90))) +
      tile('Kosten je Jahr', fmtEur(base.exp.cost), fmtEur(base.cost.p10) + ' – ' + fmtEur(base.cost.p90)) +
      tile('Verhindert oder autonom', fmtNum(Math.round(base.exp.prevented)) + ' <small>von ' + fmtNum(Math.round(base.exp.occurrences)) + '</small>');

    // B · Abhängigkeitsmatrix
    const vs = A.variants(L);
    $('#depTable').innerHTML = '<thead><tr><th>Ereignis</th>' + FIELDS.map(f => '<th>' + f.name.replace(' & ', '<br>& ').replace(', ', '<br>') + '</th>').join('') + '<th>läuft heute auf</th></tr></thead><tbody>' +
      vs.map(x => '<tr><td>' + esc(x.e.title) + '</td>' + FIELDS.map(f => {
        if (f.id === 'org') return '<td><span class="dot org" title="Organisation begrenzt jedes Ereignis"></span></td>';
        if (!x.e.fields.includes(f.id)) return '<td></td>';
        return '<td><span class="dot' + (x.limiters.includes(f.id) ? ' weak' : '') + '" title="' + esc(f.name + ' Stufe ' + L[f.id] + (x.limiters.includes(f.id) ? ' (begrenzt)' : '')) + '"></span></td>';
      }).join('') + '<td>Stufe ' + x.level + ' · ' + outcomeOf(x.v) + '<br>begrenzt durch ' + x.limiters.map(fieldName).join(', ') + '</td></tr>').join('') +
      '</tbody>';
    $('#depTable').insertAdjacentHTML('beforeend', '<tfoot><tr><td colspan="' + (FIELDS.length + 2) + '" style="text-align:left;color:var(--fg-3);font-size:.72rem"><span class="dot" style="width:9px;height:9px"></span> beteiligtes Feld · <span class="dot weak" style="width:9px;height:9px"></span> begrenzt das Ereignis heute · <span class="dot org" style="width:9px;height:9px"></span> Organisation begrenzt immer</td></tr></tfoot>');

    // C · Maßnahmenkarten
    const cands = A.candidates(L, P, base);
    const lo = Math.min(0, Math.min.apply(null, cands.map(c => c.savingMC.p10)));
    const hi = Math.max(1, Math.max.apply(null, cands.map(c => c.savingMC.p90)));
    const bestRatio = Math.max.apply(null, cands.filter(c => !c.blocker).map(c => c.ratio));
    renderQuickWinsAnalysis(L, cands);
    $('#candCards').innerHTML = cands.map(c => {
      const cur = L[c.field.id];
      const top = !c.blocker && c.ratio === bestRatio && c.ratio > 0;
      const badge = c.blocker ? '<span class="badge lock">gesperrt</span>' : top ? '<span class="badge top">Beste Einzelwirkung</span>' : (c.saving > 0 ? '<span class="badge ok">sofort möglich</span>' : '<span class="badge zero">wirkt erst mit Partner</span>');
      const fx = [];
      if (c.blocker) fx.push('<span class="warn">Voraussetzung fehlt: ' + esc(c.blocker) + '.</span>');
      if (c.changes.length) fx.push('<span>Verändert <b>' + c.changes.length + ' Ereignistyp' + (c.changes.length > 1 ? 'en' : '') + '</b> auf Stufe ' + c.changes[0].to + ': ' + esc(c.changes.map(x => x.title).join('; ')) + '</span>');
      else fx.push('<span>Allein verändert diese Maßnahme kein Ereignis, weil das jeweilige Partnerfeld oder die Organisation begrenzt.</span>');
      if (c.pair && c.pair.net > c.net + 1) fx.push('<span class="good">Zusammen mit <b>' + c.pair.field.name + ' auf Stufe ' + c.pair.stage + '</b> (' + c.pair.points + ' P): Nettonutzen ' + fmtEur(c.pair.net) + ' je Jahr.</span>');
      if (c.unlocks.length) fx.push('<span>Schaltet frei: ' + esc(c.unlocks.join(', ')) + '.</span>');
      return '<article class="cand' + (c.blocker ? ' locked' : '') + (top ? ' top' : '') + '">' +
        '<div class="cand-head"><h4>' + c.field.name + '</h4>' + badge + '</div>' +
        '<div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= cur ? 'on' : (n === cur + 1 ? 'next' : '')) + '"></i>').join('') + '</div>' +
        '<div class="trans"><div class="st"><b>Heute · Stufe ' + cur + '</b>' + esc(c.field.short[cur - 1]) + '</div><span class="arrow" aria-hidden="true">→</span><div class="st next"><b>Maßnahme · Stufe ' + c.stage + '</b>' + esc(c.title) + '</div></div>' +
        '<div class="nums"><div>Investition<b>' + c.cost.points + ' P · ' + fmtEur(c.cost.invest) + '</b>+ ' + fmtEur(c.cost.opex) + ' je Jahr</div><div>Nettonutzen je Jahr<b>' + fmtEur(c.net) + '</b>' + (c.net > 0 ? 'je € Invest: ' + fmtNum(c.ratio, 2) : '') + '</div><div>Amortisation<b>' + fmtMonths(c.payback) + '</b></div></div>' +
        '<div><div class="note" style="margin-bottom:3px">Ersparnis je Jahr: ' + fmtEur(c.saving) + '</div>' + rangeBar(c.savingMC, lo, hi) + '</div>' +
        '<div class="fx">' + fx.join('') + '</div>' +
        '</article>';
    }).join('');

    // D · Roadmap
    const road = A.roadmap(L, frames[frameIndex()].points, P);
    lastRoad = road;
    if (!road.steps.length) {
      $('#roadSummary').textContent = 'Innerhalb dieses Rahmens gibt es keine Maßnahme mit positivem Nettonutzen. Erhöhen Sie den Rahmen oder prüfen Sie die Annahmen.';
      $('#roadList').innerHTML = ''; $('#roadChart').innerHTML = '';
    } else {
      const last = road.steps[road.steps.length - 1];
      const pct = Math.round((1 - last.costAfter / road.startCost) * 100);
      $('#roadSummary').innerHTML = '<b>' + road.steps.length + ' Schritte, ' + road.spent + ' Punkte, ' + fmtEur(last.cumInvest) + ' Investition.</b> Die jährlichen Kosten sinken von ' + fmtEur(road.startCost) + ' auf ' + fmtEur(last.costAfter) + ' (−' + pct + ' %). Nettoersparnis ' + fmtEur(last.cumNet) + ' je Jahr, Amortisation der gesamten Roadmap nach ' + fmtMonths(last.payback) + '.';
      $('#roadList').innerHTML = road.steps.map((s, i) => {
        const prep = s.stepSaving <= 0;
        let why;
        if (prep) { const k = road.steps.findIndex((x, j) => j > i && x.stepSaving > 0); why = k >= 0 ? 'Voraussetzung, wirkt ab Schritt ' + (k + 1) : 'Voraussetzung für weitere Stufen'; }
        else why = 'spart ' + fmtEur(s.stepSaving) + ' je Jahr';
        return '<li class="' + (prep ? 'prep' : (s.payback <= 12 ? 'pay' : '')) + '"><span class="rn">' + (i + 1) + '</span><div class="rt">' + s.field.name + ': Stufe ' + (s.stage - 1) + ' → ' + s.stage + ' · ' + esc(s.title) + '<small>' + why + ' · ' + s.points + ' P · ' + fmtEur(s.invest) + '</small></div><div class="rv"><b>' + fmtEur(s.cumNet) + '</b>Nettoersparnis je Jahr nach diesem Schritt<br>Investition bisher ' + fmtEur(s.cumInvest) + ' · Amortisation ' + fmtMonths(s.payback) + '</div></li>';
      }).join('');
      $('#roadChart').innerHTML = roadChart(road);
    }
    renderPath(road, L);
  }

  function resetAll() {
    const theme = store.get('zt.theme', '');
    store.clearAll(); if (theme) store.set('zt.theme', theme); store.set('zt.version', STORAGE_VERSION);
    state.budgetIdx = 1; state.useAssessment = false; state.base = allOne(); state.levels = allOne();
    state.speed = 1; $$('#speed button').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === '1'));
    state.playing = false; state.ended = false; state.day = null; state.runs = []; state.evaluated = false; state.runCount = 0;
    state.follow = true; $('#followBtn').checked = true; window.Scene3D.setFollow(true);
    state.vary = false; $('#varyBtn').checked = false;
    state.assessment = {}; FIELDS.forEach(f => { state.assessment[f.id] = 2; }); state.assessed = false; state.target = 5;
    state.params = Object.assign({}, PARAMS); state.frameIdx = null; state.levelView = 3;
    EVENTS.forEach(e => { e.freq = DEFAULT_FREQ[e.id]; });
    state.intake = { customer: '', employees: 300, metrics: null, counts: null, docText: '', detected: [], manual: {}, answers: {}, overrides: {}, applied: false, extra: {}, agentAnswers: {} }; rawData = null; rawExtra = {};
    const pg = $('#paramsGrid'); if (pg) { pg.innerHTML = ''; $('#freqGrid').innerHTML = ''; }
    $('#feed').innerHTML = ''; window.Scene3D.reset();
    endHandled = true;
    renderPlan(); renderMatrix();
    showView('sim'); showScreen('start');
    toast('Alles zurückgesetzt. Die Simulation beginnt von vorn.');
  }

  function adoptLevels(levels) {
    state.levels = Object.assign({}, levels);
    const need = spent();
    let idx = BUDGETS.findIndex(b => b.points >= need); if (idx < 0) idx = BUDGETS.length - 1;
    if (BUDGETS[state.budgetIdx].points < need) state.budgetIdx = idx;
    store.set('zt.levels', state.levels); store.set('zt.budget', state.budgetIdx);
  }
  function scheduleAnalysis() { clearTimeout(analysisTimer); analysisTimer = setTimeout(renderAnalysis, 250); }


  /* ---------- Ist-Aufnahme ---------- */
  let rawData = null;   // Rohdaten der Sitzung (werden nicht gespeichert)
  let rawExtra = {};    // Rohdaten weiterer Quellen je Quellen-ID
  const saveIntake = () => store.set('zt.intake', state.intake);
  const fmtDur = h => h === null || h === undefined ? '–' : (h < 1 ? Math.round(h * 60) + ' Min' : h < 48 ? fmtNum(h, 1) + ' h' : fmtNum(h / 24, 1) + ' Tage');
  const pct = v => v === null || v === undefined ? '–' : Math.round(v * 100) + ' %';

  function intakeSignals() {
    const I = window.Intake, it = state.intake;
    const detPos = it.detected.filter(d => !d.negated).map(d => d.id), detNeg = it.detected.filter(d => d.negated).map(d => d.id);
    const ids = TOOL_CATALOG.map(t => t.id).filter(id => it.manual[id] === true || (it.manual[id] !== false && detPos.indexOf(id) >= 0));
    const negs = detNeg.filter(id => it.manual[id] !== true);
    const extraSig = []; Object.keys(it.extra || {}).forEach(k => { const r = it.extra[k]; if (r && r.signals) r.signals.forEach(s => extraSig.push(s)); });
    return I.signalsFromMetrics(it.metrics).concat(I.signalsFromTools(ids, negs), I.signalsFromAnswers(it.answers), I.signalsFromAgentAnswers(it.agentAnswers || {}, it.answers), extraSig);
  }
  function extraCtx() { const it = state.intake; return { employees: it.employees || 300, ticketsPerMonth: it.metrics && it.metrics.tickets ? it.metrics.perMonth : 0 }; }
  function rederiveExtras() { const it = state.intake; Object.keys(rawExtra).forEach(id => { const r = window.Sources.derive(id, rawExtra[id], extraCtx()); if (r) it.extra[id] = r; }); }
  function renderSources() {
    const it = state.intake;
    $('#sourceGroups').innerHTML = window.Sources.GROUPS.map(g => {
      const list = window.Sources.SOURCES.filter(s => s.group === g.id);
      return '<div class="src-group"><div class="tg">' + g.name + '</div><div class="src-cards">' + list.map(s => {
        const r = it.extra && it.extra[s.id];
        return '<div class="src-card' + (r ? ' loaded' : '') + '"><h4><span>' + esc(s.name) + '</span>' + (r ? '<span class="badge ok">' + r.count + ' Zeilen</span>' : (s.graph ? '<span class="badge lock">Graph</span>' : '')) + '</h4><div class="sys">' + esc(s.systems) + '</div><div class="tells">' + esc(s.tells) + '</div><div class="cols">' + esc(s.columns) + '</div>' +
          (r ? '<div class="sum">' + esc(r.summary) + '</div>' : '') +
          '<div class="acts"><label class="btn ghost" for="src_' + s.id + '">Export laden</label><input type="file" id="src_' + s.id + '" data-src="' + s.id + '" accept=".csv,.json,.txt">' + (r ? '<button type="button" class="btn ghost" data-src-clear="' + s.id + '">Entfernen</button>' : '') + '</div></div>';
      }).join('') + '</div></div>';
    }).join('');
  }
  function ingestSource(id, files) {
    const reads = Array.from(files).map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => res(''); r.readAsText(f); }));
    return Promise.all(reads).then(texts => {
      let rows = []; texts.forEach(t => { rows = rows.concat(window.Connectors.parseAny(t)); });
      if (!rows.length) { toast('Keine Daten erkannt. Erwartet werden CSV oder JSON mit Kopfzeile.'); return; }
      rawExtra[id] = rows; const r = window.Sources.derive(id, rows, extraCtx());
      state.intake.extra[id] = r; state.intake.applied = false; saveIntake(); renderSources(); renderReady();
      toast(window.Sources.SOURCES.find(s => s.id === id).name + ': ' + rows.length + ' Zeilen · ' + r.summary);
    });
  }
  async function connectGraph() {
    const token = $('#graphToken').value.trim(); if (!token) { toast('Bitte ein Zugriffstoken einfügen.'); return; }
    const st = $('#graphStatus'); st.textContent = 'Lade …';
    try {
      const d = await window.Connectors.fetchGraph({ token }, msg => { st.textContent = msg; });
      let n = 0; Object.keys(d).forEach(id => { if (d[id] && d[id].length) { rawExtra[id] = d[id]; state.intake.extra[id] = window.Sources.derive(id, d[id], extraCtx()); n++; } });
      state.intake.applied = false; saveIntake(); renderSources(); renderReady();
      st.textContent = 'Geladen: ' + (d.mdm || []).length + ' Geräte, ' + (d.signins || []).length + ' Anmeldungen, ' + (d.edr || []).length + ' Vorfälle, ' + (d.licenses || []).length + ' Lizenzprodukte.';
    } catch (e) { st.textContent = 'Abruf fehlgeschlagen: ' + (e && e.message ? e.message : e) + '. Token, Berechtigungen und Netzwerk prüfen, oder Exporte laden.'; }
  }
  function intakeProposal() {
    const p = window.Intake.propose(intakeSignals());
    FIELDS.forEach(f => { p[f.id].final = state.intake.overrides[f.id] || p[f.id].stage; });
    return p;
  }

  function renderIntake() {
    const it = state.intake;
    $('#custName').value = it.customer || '';
    $('#custEmployees').value = it.employees || 300;
    renderSrcStatus(); renderSnResult(); renderSources(); renderToolList(); renderQuestions(); renderReady();
  }
  function intakeHasData() { const it = state.intake; return !!((it.metrics && it.metrics.tickets) || it.detected.length || Object.keys(it.manual).some(k => it.manual[k]) || Object.keys(it.answers).length || Object.keys(it.extra || {}).length); }
  function renderReady() {
    const it = state.intake, parts = [];
    if (it.metrics && it.metrics.tickets) parts.push(it.metrics.tickets + ' Tickets');
    const tools = it.detected.filter(d => !d.negated).length + Object.keys(it.manual).filter(k => it.manual[k]).length; if (tools) parts.push(tools + ' Werkzeuge');
    const qs = Object.keys(it.answers).length; if (qs) parts.push(qs + ' Antworten');
    const ex = Object.keys(it.extra || {}).length; if (ex) parts.push(ex + ' weitere Systeme');
    const ag = Object.keys(it.agentAnswers || {}).length; if (ag) parts.push(ag + ' Agentenantworten');
    $('#intakeReady').textContent = parts.length ? 'Bereit: ' + parts.join(', ') + '.' : 'Noch keine Quelle. Die Analyse nimmt dann Stufe 1 in allen Feldern an.';
    renderSrcStatus();
  }
  function renderSrcStatus() {
    const it = state.intake, c = it.counts || {};
    const sn = it.metrics && it.metrics.tickets;
    const tools = it.detected.length || Object.keys(it.manual).some(k => it.manual[k]);
    const qs = Object.keys(it.answers).length;
    $('#srcStatus').innerHTML =
      '<span class="' + (sn ? 'on' : '') + '">ServiceNow: ' + (sn ? (c.incidents || 0) + ' Incidents, ' + (c.requests || 0) + ' Requests, ' + (c.changes || 0) + ' Changes, ' + (c.cis || 0) + ' CIs' : 'keine Daten') + '</span>' +
      '<span class="' + (tools ? 'on' : '') + '">Dokumentation: ' + (tools ? it.detected.filter(d => !d.negated).length + ' Werkzeuge erkannt' : 'nichts erkannt') + '</span>' +
      '<span class="' + (qs ? 'on' : '') + '">Interview: ' + qs + ' von ' + QUESTIONS.length + ' Fragen</span>' +
      '<span class="' + (Object.keys(it.extra || {}).length ? 'on' : '') + '">Weitere Systeme: ' + Object.keys(it.extra || {}).length + ' von ' + window.Sources.SOURCES.length + '</span>' +
      '<span class="' + (it.applied ? 'on' : '') + '">' + (it.applied ? 'Ist-Bild übernommen' : 'noch nicht übernommen') + '</span>';
  }
  function renderSnResult() {
    const m = state.intake.metrics, box = $('#snResult');
    if (!m || !m.tickets) { box.innerHTML = '<p class="note" style="margin-top:10px">Noch keine Ticketdaten. Laden Sie einen Export, verbinden Sie eine Instanz oder nutzen Sie den Beispielkunden.</p>'; return; }
    const tile = (l, v, s) => '<div class="tile"><div class="lbl">' + l + '</div><div class="val">' + v + '</div>' + (s ? '<div class="rng">' + s + '</div>' : '') + '</div>';
    box.innerHTML = '<div class="tiles kpi9">' +
      tile('Tickets je Monat', fmtNum(Math.round(m.perMonth)), m.months.toFixed(1) + ' Monate Daten') +
      tile('Je 100 Mitarbeiter und Monat', m.per100 !== null ? fmtNum(Math.round(m.per100)) : '–', 'Richtwert Stufe 2: ≈ 90') +
      tile('Über Self-Service', pct(m.selfServiceShare)) + tile('Automatisch gelöst', pct(m.autoShare)) + tile('Aus Monitoring angelegt', pct(m.monitoringShare)) +
      tile('Ø Lösungszeit', fmtDur(m.mttrHours), 'Median ' + fmtDur(m.medianHours)) + tile('Wiedereröffnet', pct(m.reopenRate)) +
      tile('Changes erfolgreich', m.changeSuccess === null || m.changeSuccess === undefined ? '–' : pct(m.changeSuccess), m.changes + ' Changes') +
      tile('CIs mit Verantwortlichem', m.cmdbOwnerShare === undefined ? '–' : pct(m.cmdbOwnerShare), m.cis + ' CIs') + '</div>' +
      '<div class="matrix-wrap"><table class="sn-table"><thead><tr><th>Ereignistyp der Simulation</th><th>Tickets</th><th>je Monat</th><th>Anteil</th><th>Ø Lösungszeit</th><th>Self-Service</th><th>Häufigkeit für die Prognose</th></tr></thead><tbody>' +
      EVENTS.map(e => { const b = m.byType[e.id]; if (!b) return ''; const f = e.perCompany ? b.perMonth : (b.perMonth / (state.intake.employees || 300) * 100); return '<tr><td>' + esc(e.title) + '</td><td>' + b.count + '</td><td>' + fmtNum(b.perMonth, 1) + '</td><td>' + pct(b.share) + '</td><td>' + fmtDur(b.mttr) + '</td><td>' + (b.count ? pct(b.selfService / b.count) : '–') + '</td><td>' + (b.count ? fmtNum(f, 1) + (e.perCompany ? ' je Unternehmen' : ' je 100 MA') : 'Standard') + '</td></tr>'; }).join('') +
      '<tr><td>Nicht zugeordnet</td><td>' + m.byType.other.count + '</td><td>' + fmtNum(m.byType.other.perMonth, 1) + '</td><td>' + pct(m.byType.other.share) + '</td><td>' + fmtDur(m.byType.other.mttr) + '</td><td></td><td>geht in die Abdeckung ein</td></tr>' +
      '</tbody></table></div>' +
      (m.topTexts && m.topTexts.length ? '<p class="note" style="margin-top:8px">Häufigste Anliegen: ' + m.topTexts.slice(0, 6).map(t => esc(t.text) + ' (' + t.n + ')').join(' · ') + '</p>' : '');
  }
  function renderToolList() {
    const it = state.intake, det = {}; it.detected.forEach(d => { det[d.id] = d; });
    let html = '';
    FIELDS.forEach(f => {
      html += '<div class="tg">' + f.name + '</div>';
      TOOL_CATALOG.filter(t => t.field === f.id).forEach(t => {
        const d = det[t.id]; const on = it.manual[t.id] === true || (it.manual[t.id] !== false && d && !d.negated);
        html += '<label class="' + (d ? (d.negated ? 'neg' : 'det') : '') + '"><input type="checkbox" data-tool="' + t.id + '"' + (on ? ' checked' : '') + '><span class="lbl">' + esc(t.label) + '</span><span class="stg">Stufe ' + t.stage + '</span></label>';
      });
    });
    $('#toolList').innerHTML = html;
  }
  function renderQuestions() {
    const it = state.intake;
    const lbl = { yes: 'Ja', partly: 'Teilweise', no: 'Nein' };
    $('#questionList').innerHTML = QUESTIONS.map(q => { const ag = it.agentAnswers && it.agentAnswers[q.id]; return '<div class="q"><div class="qf">' + fieldName(q.field) + ' · Stufe ' + q.stage + '</div><div>' + esc(q.text) + '</div><div class="segments">' +
      [['yes', 'Ja', ''], ['partly', 'Teilweise', 'partly'], ['no', 'Nein', 'no']].map(o => '<button type="button" class="' + o[2] + '" data-q="' + q.id + '" data-a="' + o[0] + '" aria-pressed="' + (it.answers[q.id] === o[0]) + '">' + o[1] + '</button>').join('') + '</div>' +
      (ag ? '<div class="agent-note"><b>Laut Agent: ' + lbl[ag.a] + '.</b>' + (ag.evidence ? ' ' + esc(ag.evidence) : '') + (it.answers[q.id] ? ' · von Ihnen überschrieben' : '') + '</div>' : '') + '</div>'; }).join('');
  }
  function renderProposal() {
    const it = state.intake, p = intakeProposal();
    const levels = {}; FIELDS.forEach(f => { levels[f.id] = p[f.id].final; });
    $('#proposalCards').innerHTML = FIELDS.map(f => {
      const x = p[f.id];
      const ov = it.overrides[f.id];
      return '<article class="cand"><div class="cand-head"><h4>' + f.name + '</h4><span class="badge ' + (x.confidence >= .7 ? 'ok' : x.confidence > 0 ? 'zero' : 'lock') + '">' + (x.confidence > 0 ? 'Sicherheit ' + Math.round(x.confidence * 100) + ' %' : 'keine Daten') + '</span></div>' +
        '<div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= x.final ? 'on' : '') + '"></i>').join('') + '</div>' +
        '<div class="trans"><div class="st"><b>Abgeleitet · Stufe ' + x.stage + '</b>' + esc(f.short[x.stage - 1]) + '</div><span class="arrow" aria-hidden="true">→</span><div class="st next"><b>Übernommen</b><select data-override="' + f.id + '">' + [1, 2, 3, 4, 5].map(n => '<option value="' + n + '"' + (n === x.final ? ' selected' : '') + '>Stufe ' + n + ' · ' + esc(f.short[n - 1]) + '</option>').join('') + '</select>' + (ov ? '<small class="note">manuell gesetzt</small>' : '') + '</div></div>' +
        '<div class="conf"><i style="width:' + Math.round(x.confidence * 100) + '%"></i></div>' +
        (x.evidence.length ? '<ul class="ev">' + x.evidence.slice(0, 6).map(e => '<li class="' + (e.weight < 0 ? 'neg' : '') + '"><span class="src">' + e.source + '</span><span>' + esc(e.text) + '</span></li>').join('') + (x.evidence.length > 6 ? '<li><span class="src"></span><span class="note">' + (x.evidence.length - 6) + ' weitere Hinweise</span></li>' : '') + '</ul>' : '<p class="note">Keine Hinweise aus den Quellen. Stufe 1 angenommen; bitte prüfen oder im Interview beantworten.</p>') +
        '</article>';
    }).join('');
    const cands = it.metrics && it.metrics.tickets ? window.Analysis.candidates(levels, Object.assign({}, state.params, { employees: it.employees || 300 })) : [];
    const qw = window.Intake.quickWins(it.metrics, levels, cands);
    Object.keys(it.extra || {}).forEach(k => { const r = it.extra[k]; if (r && r.quickWin && !qw.some(w => w.title === r.quickWin.title)) qw.push(r.quickWin); });
    const items = [];
    if (it.metrics && it.metrics.tickets) items.push({ name: 'ServiceNow / ITSM', sum: it.metrics.tickets + ' Tickets, ' + it.metrics.changes + ' Changes, ' + it.metrics.cis + ' CIs · ' + it.metrics.months.toFixed(1) + ' Monate', note: pct(it.metrics.selfServiceShare) + ' Self-Service · ' + pct(it.metrics.autoShare) + ' automatisch · Ø ' + fmtDur(it.metrics.mttrHours) });
    const tl = it.detected.filter(d => !d.negated).length; if (tl || it.docText) items.push({ name: 'Dokumentation', sum: tl + ' Werkzeuge erkannt, ' + it.detected.filter(d => d.negated).length + ' als nicht vorhanden', note: it.docText ? Math.round(it.docText.length / 1000) + ' Tsd. Zeichen ausgewertet' : '' });
    const qs = Object.keys(it.answers).length; if (qs) items.push({ name: 'Interview', sum: qs + ' von ' + QUESTIONS.length + ' Fragen beantwortet', note: Object.values(it.answers).filter(v => v === 'yes').length + ' ja · ' + Object.values(it.answers).filter(v => v === 'partly').length + ' teilweise · ' + Object.values(it.answers).filter(v => v === 'no').length + ' nein' });
    const ag = Object.keys(it.agentAnswers || {}); if (ag.length) items.push({ name: 'KI-Agent des Kunden', sum: ag.length + ' Fragen vom Agenten beantwortet, ' + ag.filter(k => it.answers[k]).length + ' davon von Menschen überschrieben', note: ag.filter(k => it.agentAnswers[k].evidence).length + ' mit Beleg' });
    window.Sources.SOURCES.forEach(s => { const r = it.extra && it.extra[s.id]; if (r) items.push({ name: s.name, sum: r.summary, note: (r.note || '') + (r.signals && r.signals.length ? (r.note ? ' · ' : '') + r.signals.length + ' Signale' : '') }); });
    $('#dataGrid').innerHTML = items.length ? items.map(i => '<div class="data-item"><b>' + esc(i.name) + '</b><span>' + esc(i.sum) + '</span>' + (i.note ? '<small>' + esc(i.note) + '</small>' : '') + '</div>').join('') : '<div class="data-item"><span>Keine Quellen geladen.</span></div>';
    $('#quickWinList').innerHTML = qw.length ? qw.map(w => '<li><span class="lv-badge l' + w.stage + '">' + w.stage + '</span><span class="pv-body"><span class="pv-title">' + esc(w.title) + '<span class="qw-badge">Aufwand ' + w.effort + '</span></span><span class="pv-sub">' + esc(w.why) + ' Handlungsfeld: ' + fieldName(w.field) + ', Stufe ' + w.stage + '.</span></span></li>').join('') : '<li><span class="pv-body"><span class="pv-sub">Quick Wins erscheinen, sobald Ticketdaten vorliegen.</span></span></li>';
    $('#applyStatus').textContent = it.applied ? 'Bereits übernommen. Änderungen werden mit erneutem Übernehmen wirksam.' : '';
    const avg = FIELDS.reduce((s, f) => s + levels[f.id], 0) / FIELDS.length;
    const mn = Math.min.apply(null, FIELDS.map(f => levels[f.id]));
    const weakest = FIELDS.filter(f => levels[f.id] === mn).map(f => f.name);
    $('#istbildTitle').textContent = 'Ist-Bild' + (it.customer ? ' von ' + it.customer : '');
    const src = []; if (it.metrics && it.metrics.tickets) src.push(it.metrics.tickets + ' Tickets aus ' + it.metrics.months.toFixed(1) + ' Monaten'); if (tl) src.push(tl + ' erkannte Werkzeuge'); if (qs) src.push(qs + ' Interviewantworten'); const exn = Object.keys(it.extra || {}).length; if (exn) src.push(exn + ' weiteren Systemen');
    $('#istbildIntro').textContent = (src.length ? 'Abgeleitet aus ' + src.join(', ') + '. ' : 'Ohne Quellen wird Stufe 1 angenommen. ') + 'Die Reife wird durch das schwächste Feld begrenzt: ' + weakest.join(', ') + ' auf Stufe ' + mn + '.';
    const exp = ['survey', 'dex'].map(k => it.extra && it.extra[k] && it.extra[k].experience).find(v => v !== null && v !== undefined);
    $('#istbildHero').innerHTML = fmtNum(avg, 1) + '<small>von 5' + (exp !== undefined ? ' · Experience gemessen ' + Math.round(exp) + ' von 100' : '') + '</small>';
    $('#istbildBars').innerHTML = FIELDS.map(f => '<div class="fieldbar' + (levels[f.id] === mn && weakest.length < FIELDS.length ? ' bottleneck' : '') + '"><div class="nm">' + f.name + '</div><div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= levels[f.id] ? 'on' : '') + '"></i>').join('') + '</div><div class="v">' + levels[f.id] + '</div></div>').join('');
    renderSrcStatus();
  }
  function startIstbild() {
    const it = state.intake;
    showScreen('istbild', { animate: true });
    const run = $('#revealRun'), res = $('#revealResult');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lines = [];
    if (it.metrics && it.metrics.tickets) lines.push(it.metrics.tickets + ' Tickets gelesen und ' + (it.metrics.tickets - it.metrics.byType.other.count) + ' den elf Ereignistypen zugeordnet');
    if (it.metrics && it.metrics.cis) lines.push(it.metrics.cis + ' Konfigurationselemente der CMDB geprüft');
    const tl = it.detected.length; if (tl) lines.push(tl + ' Werkzeuge in der Dokumentation erkannt, davon ' + it.detected.filter(d => d.negated).length + ' als nicht vorhanden');
    const qs = Object.keys(it.answers).length; if (qs) lines.push(qs + ' Interviewantworten ausgewertet');
    const agn = Object.keys(it.agentAnswers || {}).length; if (agn) lines.push('Kunden-Agent befragt: ' + agn + ' Antworten mit Belegen aufgenommen');
    const ex = Object.keys(it.extra || {}); if (ex.length) lines.push(ex.length + ' weitere Systeme ausgewertet: ' + ex.slice(0, 4).map(k => window.Sources.SOURCES.find(s => s.id === k).name).join(', ') + (ex.length > 4 ? ' und ' + (ex.length - 4) + ' mehr' : ''));
    lines.push('Signale je Handlungsfeld zusammengeführt und Reifegrad abgeleitet');
    lines.push('Quick Wins aus dem Ticketaufkommen bestimmt');
    run.hidden = false; res.hidden = true;
    $('#revealSteps').innerHTML = lines.map(l => '<li><i></i><span>' + esc(l) + '</span></li>').join('');
    const items = $$('#revealSteps li');
    if (reduce) { items.forEach(li => li.classList.add('show', 'done')); run.hidden = true; res.hidden = false; renderProposal(); return; }
    let i = 0;
    const step = () => {
      if (i > 0) { items[i - 1].classList.remove('active'); items[i - 1].classList.add('done'); }
      if (i < items.length) { items[i].classList.add('show', 'active'); i++; setTimeout(step, 550); }
      else setTimeout(() => { run.hidden = true; res.hidden = false; renderProposal(); window.scrollTo({ top: 0 }); focusHeading(res); }, 350);
    };
    step();
  }

  function ingestFiles(files, kindHint) {
    const reads = Array.from(files).map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, text: String(r.result || '') }); r.onerror = () => res({ name: f.name, text: '' }); r.readAsText(f); }));
    return Promise.all(reads).then(list => {
      rawData = rawData || { incidents: [], requests: [], changes: [], cis: [] };
      const added = [];
      list.forEach(f => {
        const rows = window.Connectors.parseAny(f.text); if (!rows.length) return;
        const n = f.name.toLowerCase(); const cols = Object.keys(rows[0]).join(' ').toLowerCase();
        let kind = kindHint;
        if (!kind) {
          if (/incident|inc[_-]|störung|stoerung/.test(n)) kind = 'incidents';
          else if (/request|ritm|req|anfrage|sc_req/.test(n)) kind = 'requests';
          else if (/change|chg|änderung/.test(n)) kind = 'changes';
          else if (/cmdb|ci[_-]|asset|inventar|configuration/.test(n)) kind = 'cis';
          else if (/sys_class_name|install_status|owned_by|managed_by/.test(cols)) kind = 'cis';
          else if (/close_code|change_type|risk/.test(cols) && /^chg/i.test(String(rows[0].number || ''))) kind = 'changes';
          else if (/^ritm|^req/i.test(String(rows[0].number || ''))) kind = 'requests';
          else kind = 'incidents';
        }
        rawData[kind] = rawData[kind].concat(rows); added.push(kind + ': ' + rows.length + ' Zeilen aus ' + f.name);
      });
      recomputeMetrics();
      toast(added.length ? added.join(' · ') : 'Keine Daten erkannt. Erwartet werden CSV oder JSON mit Kopfzeile.');
    });
  }
  function recomputeMetrics() {
    if (!rawData) return;
    const m = window.Connectors.metrics(rawData, state.intake.employees || 300);
    state.intake.metrics = m;
    state.intake.counts = { incidents: rawData.incidents.length, requests: rawData.requests.length, changes: rawData.changes.length, cis: rawData.cis.length };
    state.intake.applied = false;
    rederiveExtras();
    saveIntake(); renderSnResult(); renderSources(); renderReady();
  }
  function loadDemo() {
    const d = window.Connectors.demoData(42);
    rawData = { incidents: d.incidents, requests: d.requests, changes: d.changes, cis: d.cis };
    state.intake.customer = d.customer; state.intake.employees = d.employees; state.intake.docText = d.docs;
    state.intake.detected = window.Intake.detectTools(d.docs); state.intake.manual = {}; state.intake.overrides = {};
    state.intake.answers = { q_inventory: 'yes', q_zerotouch: 'no', q_roles: 'partly', q_hr: 'no', q_monitoring: 'yes', q_e2e: 'no', q_scripts: 'yes', q_workflow: 'no', q_itsm: 'yes', q_portal: 'partly', q_patch: 'yes', q_edr: 'partly', q_roles_org: 'yes', q_autoeng: 'no' };
    $('#docText').value = d.docs;
    rawExtra = window.Sources.demoAll(7); state.intake.extra = {};
    state.intake.agentAnswers = { q_dex: { a: 'no', evidence: 'Kein DEX-Werkzeug im Softwareinventar, Gerätestörungen werden erst nach Meldung sichtbar.' }, q_scripts: { a: 'yes', evidence: 'GitLab-Gruppe it-ops mit 3 Repositories und 126 Skripten, WSUS-Patchfenster jeden zweiten Dienstag.' }, q_remediation: { a: 'no', evidence: 'PRTG-Alarme gehen per E-Mail an die Gruppe it-ops; kein Runbook wird automatisch ausgelöst.' }, q_proactive: { a: 'no', evidence: 'Statusmeldungen erfolgen reaktiv über das Intranet nach Rückfragen.' }, q_vuln: { a: 'partly', evidence: 'Defender Vulnerability Management aktiv, Priorisierung nach CVSS, Schließung manuell im Patchfenster.' }, q_product: { a: 'no', evidence: 'Organisation nach Technikbereichen: Service Desk, Infrastruktur, Anwendungen.' }, q_ca: { a: 'partly', evidence: 'Eine Conditional-Access-Richtlinie für Admin-Konten, keine für Mitarbeiter.' } };
    recomputeMetrics(); rederiveExtras(); saveIntake(); renderIntake();
    toast('Beispielkunde geladen: ' + d.customer + ' mit ' + Object.keys(rawExtra).length + ' weiteren Quellen');
  }
  function detectFromText() {
    const text = $('#docText').value;
    state.intake.docText = text;
    state.intake.detected = window.Intake.detectTools(text);
    state.intake.applied = false; saveIntake();
    renderToolList(); renderReady();
    const n = state.intake.detected.filter(d => !d.negated).length, g = state.intake.detected.filter(d => d.negated).length;
    $('#docStatus').textContent = n + ' Werkzeuge erkannt' + (g ? ', ' + g + ' als nicht vorhanden' : '') + '.';
  }
  function applyIntake() {
    const it = state.intake, p = intakeProposal();
    FIELDS.forEach(f => { state.assessment[f.id] = p[f.id].final; });
    state.assessed = true; state.useAssessment = true;
    store.set('zt.assessment', state.assessment); store.set('zt.assessed', true); store.set('zt.useAssessment', true);
    state.params.employees = it.employees || 300;
    const cal = window.Intake.calibrate(it.metrics, it.employees);
    const fo = {};
    if (cal) { EVENTS.forEach(e => { if (cal.freq[e.id] !== null && cal.freq[e.id] !== undefined) { e.freq = Math.round(cal.freq[e.id] * 100) / 100; fo[e.id] = e.freq; } }); state.params.coverage = cal.coverage; }
    const extraCal = {}; Object.keys(it.extra || {}).forEach(k => { const r = it.extra[k]; if (r && r.calib) Object.keys(r.calib).forEach(t => { const v = r.calib[t]; if (v !== null && v !== undefined && isFinite(v) && v >= 0) (extraCal[t] = extraCal[t] || []).push(v); }); });
    EVENTS.forEach(e => { const vs = extraCal[e.id]; if (!vs || !vs.length) return; const ev = vs.reduce((s, v) => s + v, 0) / vs.length; e.freq = Math.round(((fo[e.id] !== undefined ? (fo[e.id] + ev) / 2 : ev)) * 100) / 100; fo[e.id] = e.freq; });
    const team = it.extra && it.extra.team; it.lanes = team && team.lanes ? team.lanes : null;
    store.set('zt.freq', fo); store.set('zt.params', state.params);
    const pg = $('#paramsGrid'); if (pg) { pg.innerHTML = ''; $('#freqGrid').innerHTML = ''; }
    it.applied = true; saveIntake();
    applyBase(); state.levels = Object.assign({}, state.base); store.set('zt.levels', state.levels);
    renderPlan(); renderMatrix(); renderProposal(); updateStepper();
    toast('Ist-Bild übernommen: Ausgangslage, Mitarbeiterzahl' + (cal ? ', Häufigkeiten aus ' + it.metrics.tickets + ' Tickets' : '') + (Object.keys(extraCal).length ? ' und ' + Object.keys(extraCal).length + ' Messwerten weiterer Systeme' : '') + ' gesetzt.');
  }
  function profileJSON() {
    const it = state.intake; const p = intakeProposal(); const levels = {}; FIELDS.forEach(f => { levels[f.id] = p[f.id].final; });
    return JSON.stringify({ version: 1, customer: it.customer, employees: it.employees, exportedAt: new Date().toISOString(), levels, overrides: it.overrides, answers: it.answers, detected: it.detected, manual: it.manual, docText: it.docText, metrics: it.metrics, counts: it.counts, extra: it.extra, agentAnswers: it.agentAnswers }, null, 2);
  }
  function importProfile(text) {
    try {
      const j = JSON.parse(text);
      state.intake = Object.assign({ customer: '', employees: 300, metrics: null, counts: null, docText: '', detected: [], manual: {}, answers: {}, overrides: {}, applied: false }, { customer: j.customer || '', employees: j.employees || 300, metrics: j.metrics || null, counts: j.counts || null, docText: j.docText || '', detected: j.detected || [], manual: j.manual || {}, answers: j.answers || {}, overrides: j.overrides || {}, extra: j.extra || {}, agentAnswers: j.agentAnswers || {} });
      rawData = null; rawExtra = {}; saveIntake(); renderIntake(); $('#docText').value = state.intake.docText; toast('Profil eingelesen' + (j.customer ? ': ' + j.customer : '') + '.');
    } catch (e) { toast('Die Datei ist kein gültiges Profil.'); }
  }
  async function connectServiceNow() {
    const cfg = { instance: $('#snInstance').value.trim(), user: $('#snUser').value, password: $('#snPass').value, token: $('#snToken').value.trim(), months: parseInt($('#snMonths').value, 10) || 6 };
    if (!cfg.instance) { toast('Bitte die Instanz-Adresse angeben.'); return; }
    if (!cfg.token && !(cfg.user && cfg.password)) { toast('Bitte Benutzer und Passwort oder ein Token angeben.'); return; }
    const st = $('#snStatus'); st.textContent = 'Verbinde …';
    try {
      const data = await window.Connectors.fetchServiceNow(cfg, msg => { st.textContent = msg; });
      rawData = data; recomputeMetrics(); st.textContent = 'Geladen: ' + data.incidents.length + ' Incidents, ' + data.requests.length + ' Requests, ' + data.changes.length + ' Changes, ' + data.cis.length + ' CIs.';
    } catch (e) {
      st.textContent = 'Verbindung fehlgeschlagen: ' + (e && e.message ? e.message : e) + '. Prüfen Sie CORS-Regel, Adresse und Rechte, oder importieren Sie einen Export.';
    }
  }
  async function askCustomerAgent() {
    const cfg = { endpoint: $('#agentEndpoint').value.trim(), apiKey: $('#agentKey').value.trim(), model: $('#agentModel').value.trim(), format: $('#agentFormat').value };
    if (!cfg.endpoint) { toast('Bitte den Endpunkt des Agenten angeben.'); return; }
    const st = $('#agentStatus'); st.textContent = 'Agent wird befragt …';
    try {
      const ans = await window.Connectors.askAgent(cfg, QUESTIONS, msg => { st.textContent = msg; });
      const n = Object.keys(ans).length; if (!n) throw new Error('keine verwertbaren Antworten');
      state.intake.agentAnswers = ans; state.intake.applied = false; saveIntake(); renderQuestions(); renderReady();
      st.textContent = n + ' von ' + QUESTIONS.length + ' Fragen beantwortet, ' + Object.values(ans).filter(x => x.evidence).length + ' mit Beleg.';
    } catch (e) { st.textContent = 'Befragung fehlgeschlagen: ' + (e && e.message ? e.message : e) + '. Endpunkt, Schlüssel und CORS prüfen, oder Antworten als JSON einlesen.'; }
  }
  function bindIntake() {
    $('#agentAskBtn').addEventListener('click', askCustomerAgent);
    $('#agentAnswersFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const ans = window.Connectors.normalizeAgentAnswers(JSON.parse(String(r.result || ''))); const n = Object.keys(ans).length; if (!n) throw new Error('leer'); state.intake.agentAnswers = ans; state.intake.applied = false; saveIntake(); renderQuestions(); renderReady(); $('#agentStatus').textContent = n + ' Antworten eingelesen.'; } catch (err) { toast('Die Datei enthält keine verwertbaren Antworten.'); } }; r.readAsText(f); e.target.value = ''; });
    $('#agentClearBtn').addEventListener('click', () => { state.intake.agentAnswers = {}; state.intake.applied = false; saveIntake(); renderQuestions(); renderReady(); $('#agentStatus').textContent = ''; });
    $('#custName').addEventListener('input', e => { state.intake.customer = e.target.value; saveIntake(); });
    $('#custEmployees').addEventListener('change', e => { state.intake.employees = Math.max(10, parseInt(e.target.value, 10) || 300); state.intake.applied = false; saveIntake(); if (rawData) recomputeMetrics(); else { renderSnResult(); renderReady(); } });
    $('#demoBtn').addEventListener('click', loadDemo);
    $('#snFiles').addEventListener('change', e => { ingestFiles(e.target.files); e.target.value = ''; });
    $$('[data-sn]').forEach(inp => inp.addEventListener('change', e => { ingestFiles(e.target.files, e.target.dataset.sn); e.target.value = ''; }));
    const dz = $('#dropZone');
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
    dz.addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files.length) ingestFiles(e.dataTransfer.files); });
    $('#snConnectBtn').addEventListener('click', connectServiceNow);
    $('#graphConnectBtn').addEventListener('click', connectGraph);
    $('#sourceGroups').addEventListener('change', e => { const id = e.target.dataset && e.target.dataset.src; if (!id) return; ingestSource(id, e.target.files); e.target.value = ''; });
    $('#sourceGroups').addEventListener('click', e => { const b = e.target.closest('[data-src-clear]'); if (!b) return; delete rawExtra[b.dataset.srcClear]; delete state.intake.extra[b.dataset.srcClear]; state.intake.applied = false; saveIntake(); renderSources(); renderReady(); });
    $('#detectBtn').addEventListener('click', detectFromText);
    $('#docText').addEventListener('change', () => { state.intake.docText = $('#docText').value; saveIntake(); });
    $('#docFiles').addEventListener('change', e => {
      const reads = Array.from(e.target.files).map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => res(''); r.readAsText(f); }));
      Promise.all(reads).then(texts => { $('#docText').value = ($('#docText').value + '\n\n' + texts.join('\n\n')).trim(); detectFromText(); }); e.target.value = '';
    });
    $('#toolList').addEventListener('change', e => { const id = e.target.dataset && e.target.dataset.tool; if (!id) return; state.intake.manual[id] = e.target.checked; state.intake.applied = false; saveIntake(); renderToolList(); renderReady(); });
    $('#questionList').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (!b) return; state.intake.answers[b.dataset.q] = b.dataset.a; state.intake.applied = false; saveIntake(); renderQuestions(); renderReady(); });
    $('#proposalCards').addEventListener('change', e => { const f = e.target.dataset && e.target.dataset.override; if (!f) return; state.intake.overrides[f] = parseInt(e.target.value, 10); state.intake.applied = false; saveIntake(); renderProposal(); });
    $('#applyIntakeBtn').addEventListener('click', () => { applyIntake(); showScreen('plan'); });
    $('#intakeNextBtn').addEventListener('click', startIstbild);
    $('#istbildBackBtn').addEventListener('click', () => showScreen('intake'));
    $('#profileCopyBtn2').addEventListener('click', () => $('#profileCopyBtn').click());
    $('#intakeSkipBtn').addEventListener('click', () => { state.useAssessment = false; store.set('zt.useAssessment', false); applyBase(); showScreen('plan'); });
    $('#profileCopyBtn').addEventListener('click', () => { const txt = profileJSON(); const ok = () => toast('Profil in die Zwischenablage kopiert.'); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => toast('Kopieren nicht möglich.')); else toast('Kopieren nicht möglich.'); });
    $('#profileImport').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importProfile(String(r.result || '')); r.readAsText(f); e.target.value = ''; });
  }

  /* ---------- Prognose: Quick Wins und Zeitplan ---------- */
  function renderQuickWinsAnalysis(levels, cands) {
    const it = state.intake;
    const qw = window.Intake.quickWins(it.applied ? it.metrics : null, levels, cands);
    $('#anaQuickWins').innerHTML = qw.length ? '<div class="road-summary" style="margin-bottom:12px"><b>Quick Wins' + (it.applied && it.metrics ? ' aus den Daten von ' + esc(it.customer || 'diesem Kunden') : '') + ':</b> ' + qw.map(w => esc(w.title)).join(' · ') + '</div>' : '';
  }
  function pathChart(sch) {
    const steps = sch.steps; if (!steps.length) return '';
    const months = Math.ceil(sch.totalMonths / 3) * 3 || 3;
    const W = 720, rowH = 22, L = 10, R = 10, T = 22, labelW = 250;
    const H = T + steps.length * rowH + 10;
    const x = m => L + labelW + (m / months) * (W - L - R - labelW);
    const now = new Date(); const startY = now.getFullYear(), startQ = Math.floor(now.getMonth() / 3);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Zeitplan der Roadmap">';
    for (let q = 0; q * 3 <= months; q++) {
      const qi = startQ + q; const y = startY + Math.floor(qi / 4); const ql = 'Q' + (qi % 4 + 1) + ' ' + y;
      s += '<line class="gline" x1="' + x(q * 3) + '" x2="' + x(q * 3) + '" y1="' + (T - 6) + '" y2="' + H + '"/>';
      if (q * 3 < months) s += '<text class="gq" x="' + (x(q * 3) + 3) + '" y="' + (T - 9) + '">' + ql + '</text>';
    }
    steps.forEach((st, i) => {
      const y = T + i * rowH;
      const prep = st.stepSaving <= 0;
      s += '<text class="gtext" x="' + L + '" y="' + (y + 14) + '">' + esc((i + 1) + '. ' + st.field.name + ' → ' + st.stage) + '</text>';
      s += '<rect class="gbar' + (prep ? ' prep' : '') + '" x="' + x(st.start) + '" y="' + (y + 4) + '" width="' + Math.max(2, x(st.end) - x(st.start)) + '" height="' + (rowH - 8) + '" rx="3"><title>' + esc(st.field.name + ' auf Stufe ' + st.stage + ': Monat ' + Math.round(st.start) + ' bis ' + Math.round(st.end) + (prep ? ' (Voraussetzung)' : ', spart ' + fmtEur(st.stepSaving) + ' je Jahr')) + '</title></rect>';
    });
    s += '</svg>';
    return s;
  }
  function renderPath(road, L) {
    if (!road.steps.length) { $('#pathSummary').textContent = 'Kein Zeitplan ohne Roadmap.'; $('#pathChart').innerHTML = ''; return; }
    const lanes = state.intake.applied && state.intake.lanes ? state.intake.lanes : 2;
    const sch = window.Intake.schedule(road.steps, lanes, L);
    const last = road.steps[road.steps.length - 1];
    const years = sch.totalMonths / 12;
    const perYear = last.cumInvest / Math.max(1, years);
    const end = new Date(); end.setMonth(end.getMonth() + Math.round(sch.totalMonths));
    $('#pathSummary').innerHTML = '<b>Dauer etwa ' + Math.round(sch.totalMonths) + ' Monate</b> (bis ' + end.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) + ') in ' + (lanes === 1 ? 'einem Arbeitsstrang' : lanes + ' parallelen Arbeitssträngen') + (state.intake.applied && state.intake.lanes ? ', abgeleitet aus der Teamgröße' : '') + '. Investition ' + fmtEur(last.cumInvest) + ', das sind etwa ' + fmtEur(perYear) + ' je Jahr. Nach Abschluss sinken die jährlichen Kosten um ' + fmtEur(last.cumNet) + ' netto. ' + (state.intake.applied && state.intake.customer ? 'Berechnet für ' + esc(state.intake.customer) + ' mit ' + state.params.employees + ' Mitarbeitern.' : '');
    $('#pathChart').innerHTML = pathChart(sch);
  }

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
      const home = t.closest('[data-home]'); if (home) { showView('sim'); showScreen('start'); return; }
      const nav = t.closest('[data-view]'); if (nav) { showView(nav.dataset.view); return; }
      const st = t.closest('[data-step]'); if (st && !st.disabled) {
        const s = st.dataset.step;
        if (state.view !== 'sim') showView('sim');
        if (s === 'run') { if (state.screen === 'run' && !state.ended) return; if (state.screen === 'run' && state.ended) { showScreen('result'); return; } startRun(); endHandled = false; return; }
        if (s === 'result' && !state.evaluated) return;
        showScreen(s); return;
      }
      const bs = t.closest('[data-base]'); if (bs && !bs.disabled) { state.useAssessment = bs.dataset.base === 'assess'; store.set('zt.useAssessment', state.useAssessment); applyBase(); renderPlan(); return; }
      const fr = t.closest('[data-frame]'); if (fr) { state.frameIdx = parseInt(fr.dataset.frame, 10); store.set('zt.frame', state.frameIdx); renderAnalysis(); return; }
      const bd = t.closest('[data-budget]'); if (bd) { state.budgetIdx = parseInt(bd.dataset.budget, 10); store.set('zt.budget', state.budgetIdx); applyBase(); renderPlan(); return; }
      const inv = t.closest('.inv'); if (inv) { setStage(inv.dataset.field, parseInt(inv.dataset.stage, 10)); return; }
      const sp = t.closest('#speed button'); if (sp) { state.speed = parseInt(sp.dataset.s, 10); $$('#speed button').forEach(b => b.setAttribute('aria-pressed', b === sp)); return; }
      const lvv = t.closest('[data-levelview]'); if (lvv) { state.levelView = parseInt(lvv.dataset.levelview, 10); renderLevelsView(); return; }
      const pl = t.closest('[data-play-level]'); if (pl) {
        const n = parseInt(pl.dataset.playLevel, 10);
        (async () => {
          if (spent() > 0 && !(await ask('Die aktuelle Planung wird ersetzt: alle Felder auf Stufe ' + n + '. Fortfahren?'))) return;
          state.useAssessment = false; state.base = allOne(); state.budgetIdx = 3; FIELDS.forEach(f => { state.levels[f.id] = n; }); store.set('zt.levels', state.levels);
          showView('sim'); showScreen('plan'); toast('Alle Felder auf Stufe ' + n + ' gesetzt. Weiter mit „Arbeitstag starten“.');
        })();
        return;
      }
      const cell = t.closest('.cell'); if (cell) { state.assessment[cell.dataset.afield] = parseInt(cell.dataset.astage, 10); state.assessed = true; store.set('zt.assessment', state.assessment); store.set('zt.assessed', true); renderMatrix(); return; }
      const tg = t.closest('[data-target]'); if (tg) { state.target = parseInt(tg.dataset.target, 10); store.set('zt.target', state.target); renderMatrix(); return; }
    });
    $('#startBtn').addEventListener('click', () => showScreen('intake'));
    $('#startPlanBtn').addEventListener('click', () => showScreen('plan'));
    bindIntake();
    $('#resetAllBtn').addEventListener('click', async () => { if (await ask('Planung, Durchläufe, Auswertung, Standortbestimmung und Annahmen werden gelöscht. Die Simulation beginnt von vorn. Fortfahren?')) resetAll(); });
    $('#analysisBtn').addEventListener('click', () => showScreen('analysis'));
    $('#resultAnalysisBtn').addEventListener('click', () => { endHandled = true; showScreen('analysis'); });
    $('#analysisBack').addEventListener('click', () => showScreen(state.evaluated && state.returnScreen === 'result' ? 'result' : 'plan'));
    $('#paramsToggle').addEventListener('click', () => { const p = $('#paramsPanel'); p.hidden = !p.hidden; $('#paramsToggle').setAttribute('aria-expanded', !p.hidden); });
    $('#varyBtn').addEventListener('change', e => { state.vary = e.target.checked; store.set('zt.vary', state.vary); toast(state.vary ? 'Jeder Durchlauf wählt Ereignisse, Zeiten und Aufwände zufällig.' : 'Jeder Durchlauf zeigt denselben Referenztag.'); });
    $('#adoptRoadBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.end); showScreen('plan'); toast('Roadmap übernommen: ' + lastRoad.steps.length + ' Schritte in der Planung gesetzt.'); });
    $('#adoptStepBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.steps[0].levels); renderAnalysis(); toast('Schritt 1 steht jetzt in der Planung. Die Prognose geht von der neuen Ausgangslage aus.'); });
    $('#roadRunBtn').addEventListener('click', () => { if (!lastRoad || !lastRoad.steps.length) return; adoptLevels(lastRoad.end); endHandled = false; startRun(); });
    document.addEventListener('input', e => {
      const p = e.target.dataset && e.target.dataset.param;
      if (p) { let v = parseFloat(e.target.value); if (isNaN(v)) return; if (PCT_PARAMS[p]) v = v / 100; if (p === 'runs') v = Math.max(20, Math.min(2000, Math.round(v))); state.params[p] = v; store.set('zt.params', state.params); scheduleAnalysis(); return; }
      const f = e.target.dataset && e.target.dataset.freq;
      if (f) { const v = parseFloat(e.target.value); if (isNaN(v) || v < 0) return; const ev = EVENTS.find(x => x.id === f); ev.freq = v; const fo = store.get('zt.freq', {}); fo[f] = v; store.set('zt.freq', fo); scheduleAnalysis(); }
    });
    $('#runBtn').addEventListener('click', () => { if (spent() === 0 && !state.useAssessment) toast('Ohne Investition läuft der Tag auf Stufe 1. Gut als Vergleich.'); startRun(); endHandled = false; });
    $('#resetPlanBtn').addEventListener('click', () => { state.levels = Object.assign({}, state.base); store.set('zt.levels', state.levels); renderPlan(); });
    $('#playBtn').addEventListener('click', () => { if (state.ended) return; state.playing = !state.playing; renderClock(); });
    $('#skipBtn').addEventListener('click', () => { state.sim = DAY_END; state.ended = true; state.playing = false; update(); });
    $('#stopBtn').addEventListener('click', async () => {
      if (!state.ended) { const was = state.playing; state.playing = false; renderClock(); if (!(await ask('Den laufenden Arbeitstag abbrechen und zur Planung zurückkehren?'))) { state.playing = was; renderClock(); return; } }
      endHandled = true; showScreen('plan');
    });
    $('#followBtn').addEventListener('change', e => { state.follow = e.target.checked; window.Scene3D.setFollow(state.follow); });
    $$('.replanBtn').forEach(b => b.addEventListener('click', () => { endHandled = true; showScreen('plan'); }));
    $('#rerunBtn').addEventListener('click', () => { endHandled = false; startRun(); });
    $$('.themeBtn').forEach(b => b.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      applyTheme((cur ? cur === 'dark' : sysDark) ? 'light' : 'dark');
    }));
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      if (!$('#confirm').hidden) { if (e.key === 'Escape') $('#confirmNo').click(); return; }
      if (state.view !== 'sim' || state.screen !== 'run') return;
      if (e.key === ' ') { e.preventDefault(); $('#playBtn').click(); }
      else if (e.key === 'ArrowRight') $('#skipBtn').click();
      else if (e.key === 'Escape') { if (state.playing) $('#playBtn').click(); }
      else if (e.key === '1' || e.key === '2' || e.key === '4') { const b = $('#speed button[data-s="' + e.key + '"]'); if (b) b.click(); }
    });
    window.addEventListener('popstate', applyRoute);
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
    $('#playBtn').innerHTML = ICON.pause + 'Pause';
    $('#varyBtn').checked = !!state.vary;
    $('#stage').hidden = false;
    renderPlan();
    applyRoute();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
