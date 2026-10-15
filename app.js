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
  const ROUTES = { start: 'start', goals: 'ziele', intake: 'ist-aufnahme', istbild: 'digital-twin', simulate: 'simulation', roadmap: 'roadmap', plan: 'planen', run: 'arbeitstag', result: 'auswertung', analysis: 'prognose', levels: 'reifegrade', path: 'standort' };
  const STEP_NAMES = { intake: 'Ist-Aufnahme', istbild: 'Digital Twin', plan: 'Planung', run: 'Arbeitstag', result: 'Auswertung', analysis: 'Prognose' };

  const STORAGE_VERSION = 2;   // Erhöhen setzt den gespeicherten Zustand aller Nutzer beim nächsten Laden zurück
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch (e) { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kein Speicher */ } },
    clearAll() { try { Object.keys(localStorage).filter(k => k.indexOf('zt.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) { /* kein Speicher */ } }
  };
  (function () { if (store.get('zt.version', 0) !== STORAGE_VERSION) { const theme = store.get('zt.theme', ''); store.clearAll(); if (theme) store.set('zt.theme', theme); store.set('zt.version', STORAGE_VERSION); } })();
  setOtEnabled(store.get('zt.ot', false));
  const DEFAULT_FREQ = {}; EVENTS_ALL.forEach(e => { DEFAULT_FREQ[e.id] = e.freq; });

  const allOne = () => { const o = {}; FIELDS.forEach(f => { o[f.id] = 1; }); return o; };
  const state = {
    view: 'sim', screen: 'start', returnScreen: 'start', evaluated: false, ot: store.get('zt.ot', false), twinRun: false, twinLast: null, simResult: null, calib: store.get('zt.calib', null), twinAck: store.get('zt.twinAck', null), twinQuality: null,
    goals: Object.assign({ touched: false, horizon: 36, budgetMode: 'needed', budget: 300000, lanes: 0, perYear: 0, cap: { fte: 0, share: 0.2, partners: 0 }, items: { level: { on: true, v: 4 }, tickets: { on: true, v: 50 }, user: { on: true, v: 70 }, mttr: { on: true, v: 4 }, auto: { on: false, v: 50 }, cost: { on: false, v: 50 }, ot: { on: true, v: 70 } } }, store.get('zt.goals', {})),
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
  (function () { const fo = store.get('zt.freq', {}); EVENTS_ALL.forEach(e => { if (typeof fo[e.id] === 'number') e.freq = fo[e.id]; }); })();
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
    const t = { it: 0, user: 0, ot: 0, touches: 0, tickets: 0, prevented: 0, auto: 0, events: [] };
    EVENTS.forEach(e => {
      const eff = effectiveLevel(e, levels); const v = e.v[eff.level - 1];
      t.it += v.it; t.user += v.user; t.ot += v.ot || 0; t.touches += v.touches;
      if (v.ticket) t.tickets++;
      if (v.prevented) t.prevented++; else if (v.touches === 0) t.auto++;
      t.events.push({ def: e, level: eff.level, limiters: eff.limiters, v });
    });
    t.index = experienceIndex(t.user, t.tickets, t.touches);
    return t;
  }
  function base1() { const t = { it: 0, user: 0, touches: 0, tickets: 0 }; EVENTS.forEach(e => { const v = e.v[0]; t.it += v.it; t.user += v.user; t.touches += v.touches; if (v.ticket) t.tickets++; }); return t; }
  function experienceIndex(user, tickets, touches) {
    const BASE1 = base1();
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
    const map = { plan: 'simulate', run: state.twinRun ? 'istbild' : 'simulate', result: 'simulate', analysis: 'roadmap' };
    const active = state.view === 'sim' ? (map[state.screen] || state.screen) : null;
    $$('#steps [data-step]').forEach(b => {
      const s = b.dataset.step;
      if (s === active) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.disabled = false;
      b.classList.toggle('done', (s === 'goals' && !!state.goals.touched) || (s === 'intake' && intakeHasData()) || (s === 'istbild' && state.intake.applied) || (s === 'simulate' && !!state.simResult) || (s === 'roadmap' && !!state.simResult && state.simResult.seenCase));
    });
    const back = $('#backBtn');
    if (state.view !== 'sim') {
      const lbl = { start: 'Zum Start', goals: 'Zurück zu den Zielen', simulate: 'Zurück zur Simulation', roadmap: 'Zurück zur Roadmap', intake: 'Zurück zur Ist-Aufnahme', istbild: 'Zurück zum Digital Twin', plan: 'Zurück zur Planung', run: state.ended ? 'Zurück zur Auswertung' : 'Zurück zum Arbeitstag', result: 'Zurück zur Auswertung', analysis: 'Zurück zur Prognose' }[state.returnScreen] || 'Zur Simulation';
      back.textContent = lbl; back.hidden = false;
    } else back.hidden = true;
  }
  function focusHeading(root) {
    const h = $('h2', root); if (!h) return;
    h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) { h.focus(); }
  }
  function showScreen(name, opts) {
    state.screen = name;
    ['start', 'goals', 'intake', 'istbild', 'simulate', 'roadmap', 'plan', 'result', 'analysis'].forEach(s => { $('#screen-' + s).hidden = s !== name; });
    const hud = $('#hud');
    hud.classList.toggle('dim', name !== 'run');
    hud.inert = name !== 'run';
    document.body.classList.toggle('in-run', name === 'run');
    if (name === 'goals') renderGoals();
    if (name === 'simulate') renderSimulate();
    if (name === 'roadmap') renderRoadmapCase();
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
    if (key === 'run') { if (state.screen === 'run') return; showScreen(state.evaluated ? 'result' : 'simulate', { replace: true }); return; }
    if (key === 'result' && !state.evaluated) { showScreen('simulate', { replace: true }); return; }
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
  function poissonSample(lambda, rand) { const L = Math.exp(-lambda); let k = 0, p = 1; do { k++; p *= rand(); } while (p > L); return k - 1; }
  function buildDay(levelsOverride, twin) {
    const rand = seededRandom(1000 + state.runCount * 7919);
    const levels = levelsOverride || state.levels;
    let defs;
    if (twin) {
      // Der Zwilling erzeugt den Tag aus den kalibrierten Häufigkeiten: Vorkommen je Tag ~ Poisson
      defs = [];
      EVENTS.forEach(def => {
        const perMonth = def.freq * (def.perCompany ? 1 : state.params.employees / 100);
        const n = Math.min(3, poissonSample(perMonth / 20, rand));
        for (let i = 0; i < n; i++) defs.push({ def, key: def.id + (i ? '#' + i : '') });
      });
      if (!defs.length) { const def = EVENTS[Math.floor(rand() * EVENTS.length)]; defs.push({ def, key: def.id }); }
    } else defs = EVENTS.filter(() => !state.vary || rand() < 0.75).map(def => ({ def, key: def.id }));
    const items = defs.map(x => {
      const def = x.def;
      const eff = effectiveLevel(def, levels);
      let v = def.v[eff.level - 1];
      let start = (def.startByLevel && def.startByLevel[eff.level]) || def.start;
      if (state.vary || twin) {
        const f = 1 - state.params.spread + rand() * 2 * state.params.spread;
        v = Object.assign({}, v, { it: Math.round(v.it * f), user: Math.round(v.user * f), ot: Math.round((v.ot || 0) * f) });
        start = twin ? Math.round(DAY_START + 15 + rand() * (DAY_END - DAY_START - 120)) : Math.max(DAY_START + 15, Math.min(DAY_END - 90, Math.round(start + (rand() - .5) * 120)));
      }
      let acc = start;
      const steps = v.steps.map(s => { const at = acc; acc += s.d; return Object.assign({}, s, { at }); });
      return { def, key: x.key, v, level: eff.level, limiters: eff.limiters, start, steps, endAt: acc, shown: 0, started: false, finished: false, el: null, blocked: false };
    });
    items.sort((a, b) => a.start - b.start);
    return items;
  }

  function startRun(opts) {
    state.runCount++;
    state.twinRun = !!(opts && opts.twin);
    state.day = buildDay(opts && opts.levels, state.twinRun);
    state.sim = DAY_START; state.ended = false; state.playing = true;
    $('#feed').innerHTML = '';
    $('#modeChip').hidden = !state.twinRun;
    window.Scene3D.reset();
    renderDayline(); renderFieldSummary(opts && opts.levels);
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
        window.Scene3D.eventStart(inst.key || inst.def.id, inst.blocked);
      }
      if (!inst.started) return;
      while (inst.shown < inst.steps.length && inst.steps[inst.shown].at <= state.sim) {
        const st = inst.steps[inst.shown];
        appendStep(inst, st); inst.shown++;
        window.Scene3D.eventStep(inst.key || inst.def.id, st.a, inst.blocked);
      }
      if (inst.shown === inst.steps.length) {
        if (!inst.finished) {
          inst.finished = true; finishCard(inst);
          window.Scene3D.eventFinish(inst.key || inst.def.id, inst.v.prevented ? 'prevented' : 'done');
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
    if (state.twinRun) {
      const t = dayTotals(state.day);
      state.twinLast = { events: t.events.length, tickets: t.tickets, it: t.it, user: t.user, ot: t.ot, prevented: t.prevented + t.auto, open: state.day.filter(i => !i.finished).length, at: new Date().toISOString(), titles: state.day.map(i => fmtTime(i.start) + ' ' + i.v.title) };
      setTimeout(() => { if (state.screen === 'run') { state.twinRun = false; $('#modeChip').hidden = true; showScreen('istbild'); const el = $('#twRunH'); if (el) el.scrollIntoView({ block: 'start' }); } }, 1400);
      return;
    }
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
      '<div class="card-foot"><span class="m">IT <b>' + fmtHours(inst.v.it) + '</b></span><span class="m">Ausfall <b>' + fmtHours(inst.v.user) + '</b></span>' + (inst.v.ot ? '<span class="m">Stillstand <b>' + fmtHours(inst.v.ot) + '</b></span>' : '') + '<span class="m">Eingriffe <b>' + inst.v.touches + '</b></span>' +
      (inst.v.risk ? '<span class="risk">' + esc(inst.v.risk) + '</span>' : '') + '</div>';
    inst.el = card; inst.stepsEl = $('.steps', card); inst.statusEl = $('.status', card);
    card.addEventListener('click', () => window.Scene3D.focusEvent(inst.key || inst.def.id, 6));
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
    const it = started.reduce((s, i) => s + i.v.it, 0), user = started.reduce((s, i) => s + i.v.user, 0), touches = started.reduce((s, i) => s + i.v.touches, 0), otMin = started.reduce((s, i) => s + (i.v.ot || 0), 0);
    const tickets = started.filter(i => i.v.ticket).length;
    const good = started.filter(i => i.finished && (i.v.prevented || i.v.touches === 0)).length;
    const tiles = [
      { l: 'Offen', v: open, cls: open > 2 ? 'hl' : '' }, { l: 'Tickets', v: tickets, cls: tickets > 3 ? 'hl' : '' }, { l: 'Verhindert / autonom', v: good, cls: good ? 'ok' : '' },
      { l: 'IT-Aufwand', v: fmtH(it), u: 'h', cls: it > 240 ? 'hl' : '' }, { l: 'Ausfallzeit', v: fmtH(user), u: 'h', cls: user > 240 ? 'hl' : '' }, { l: 'Eingriffe', v: touches, cls: touches > 10 ? 'hl' : '' }
    ];
    if (state.ot) tiles.push({ l: 'Produktions-stillstand', v: fmtH(otMin), u: 'h', cls: otMin > 60 ? 'hl' : '' });
    $('#tiles').innerHTML = tiles.map(t => '<div class="tile ' + t.cls + '"><div class="lbl">' + t.l + '</div><div class="val">' + t.v + (t.u ? '<small>' + t.u + '</small>' : '') + '</div></div>').join('');
    const xi = experienceIndex(user, tickets, touches);
    $('#xla').textContent = xi; $('#xlaBar').style.width = xi + '%';
    $('#xlaBar').style.background = xi >= 80 ? 'var(--agent)' : (xi >= 50 ? 'var(--accent)' : 'var(--human)');
  }
  function renderFieldSummary(levelsOverride) {
    const L = levelsOverride || state.levels;
    $('#fieldSummary').innerHTML = FIELDS.map(f => '<div class="fs-row"><span class="nm">' + f.name + '</span><span class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= L[f.id] ? 'on' : '') + '"></i>').join('') + '</span></div>').join('');
  }

  /* ---------- Auswertung ---------- */
  function dayTotals(day) {
    const t = { it: 0, user: 0, ot: 0, touches: 0, tickets: 0, prevented: 0, auto: 0, events: [] };
    day.forEach(i => { t.it += i.v.it; t.user += i.v.user; t.ot += i.v.ot || 0; t.touches += i.v.touches; if (i.v.ticket) t.tickets++; if (i.v.prevented) t.prevented++; else if (i.v.touches === 0) t.auto++; t.events.push({ def: i.def, level: i.level, limiters: i.limiters, v: i.v }); });
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
      (state.ot ? row('Produktionsstillstand', x => x.ot || 0, fmtHours, true) : '') +
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
  const totalsByLevel = () => [1, 2, 3, 4, 5].map(n => { const l = {}; FIELDS.forEach(f => { l[f.id] = n; }); const t = totalsFor(l); t.steps = { human: 0, auto: 0, agent: 0 }; EVENTS.forEach(e => e.v[n - 1].steps.forEach(s => { if (s.a === 'sd' || s.a === 'tech' || s.a === 'mgr') t.steps.human++; else if (s.a === 'sys') t.steps.auto++; else if (s.a === 'ai') t.steps.agent++; })); return t; });

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
    const TOTALS = totalsByLevel();
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
    $('#paramsGrid').innerHTML = Object.keys(PARAM_LABELS).filter(k => k !== 'rateOT' || state.ot).map(k => {
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
      (state.ot ? tile('Produktionsstillstand je Jahr', fmtNum(Math.round(base.exp.ot / 60)) + ' h', fmtNum(Math.round(base.ot.p10 / 60)) + ' – ' + fmtNum(Math.round(base.ot.p90 / 60)) + ' h') : '') +
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
    state.playing = false; state.ended = false; state.day = null; state.runs = []; state.evaluated = false; state.runCount = 0; state.twinRun = false; state.twinLast = null; $('#modeChip').hidden = true;
    state.follow = true; $('#followBtn').checked = true; window.Scene3D.setFollow(true);
    state.vary = false; $('#varyBtn').checked = false;
    setOt(false, true);
    state.assessment = {}; FIELDS.forEach(f => { state.assessment[f.id] = 2; }); state.assessed = false; state.target = 5;
    state.params = Object.assign({}, PARAMS); state.frameIdx = null; state.levelView = 3;
    EVENTS.forEach(e => { e.freq = DEFAULT_FREQ[e.id]; });
    state.intake = { customer: '', employees: 300, metrics: null, counts: null, docText: '', detected: [], manual: {}, answers: {}, overrides: {}, applied: false, extra: {}, agentAnswers: {} }; rawData = null; rawExtra = {};
    state.calib = null; window.Analysis.setCalibration(null); window.Analysis.setUncertainty(0); state.twinAck = null; state.twinQuality = null;
    state.simResult = null; state.goals = { touched: false, horizon: 36, budgetMode: 'needed', budget: 300000, lanes: 0, perYear: 0, cap: { fte: 0, share: 0.2, partners: 0 }, items: { level: { on: true, v: 4 }, tickets: { on: true, v: 50 }, user: { on: true, v: 70 }, mttr: { on: true, v: 4 }, auto: { on: false, v: 50 }, cost: { on: false, v: 50 }, ot: { on: true, v: 70 } } };
    const pg = $('#paramsGrid'); if (pg) { pg.innerHTML = ''; $('#freqGrid').innerHTML = ''; }
    $('#feed').innerHTML = ''; window.Scene3D.reset();
    endHandled = true;
    renderPlan(); renderMatrix();
    showView('sim'); showScreen('start');
    toast('Alles zurückgesetzt. Die Simulation beginnt von vorn.');
  }

  function setOt(on, quiet) {
    on = !!on; state.ot = on; store.set('zt.ot', on); state.simResult = null;
    setOtEnabled(on);
    ['levels', 'base'].forEach(k => { if (state[k].ot === undefined) state[k].ot = 1; });
    if (state.assessment.ot === undefined) state.assessment.ot = 2;
    $$('.otToggle').forEach(c => { c.checked = on; });
    window.Scene3D.setOt(on);
    if (state.screen === 'plan') renderPlan();
    if (state.screen === 'intake') renderIntake();
    if (state.screen === 'analysis') renderAnalysis();
    if (state.view === 'levels') renderLevelsView();
    if (state.view === 'path') renderMatrix();
    if (state.screen === 'run' && state.day) renderFieldSummary();
    if (!quiet) toast(on ? 'OT-Erweiterung aktiv: Handlungsfeld OT & Produktion, fünf Produktionsereignisse, Werkhalle und OT-Quellen.' : 'OT-Erweiterung abgeschaltet.');
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
    $('#sourceGroups').innerHTML = window.Sources.GROUPS.filter(g => !g.ot || state.ot).map(g => {
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
    const activeQ = QUESTIONS.filter(q => FIELDS.some(f => f.id === q.field));
    $('#questionList').innerHTML = activeQ.map(q => { const ag = it.agentAnswers && it.agentAnswers[q.id]; return '<div class="q"><div class="qf">' + fieldName(q.field) + ' · Stufe ' + q.stage + '</div><div>' + esc(q.text) + '</div><div class="segments">' +
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
    renderTwin();
    const avg = FIELDS.reduce((s, f) => s + levels[f.id], 0) / FIELDS.length;
    const mn = Math.min.apply(null, FIELDS.map(f => levels[f.id]));
    const weakest = FIELDS.filter(f => levels[f.id] === mn).map(f => f.name);
    $('#istbildTitle').textContent = 'Digital Twin' + (it.customer ? ' von ' + it.customer : '');
    const src = []; if (it.metrics && it.metrics.tickets) src.push(it.metrics.tickets + ' Tickets aus ' + it.metrics.months.toFixed(1) + ' Monaten'); if (tl) src.push(tl + ' erkannte Werkzeuge'); if (qs) src.push(qs + ' Interviewantworten'); const exn = Object.keys(it.extra || {}).length; if (exn) src.push(exn + ' weiteren Systemen');
    $('#istbildIntro').textContent = (src.length ? 'Abgeleitet aus ' + src.join(', ') + '. ' : 'Ohne Quellen wird Stufe 1 angenommen. ') + 'Die Reife wird durch das schwächste Feld begrenzt: ' + weakest.join(', ') + ' auf Stufe ' + mn + '.';
    const exp = ['survey', 'dex'].map(k => it.extra && it.extra[k] && it.extra[k].experience).find(v => v !== null && v !== undefined);
    $('#istbildHero').innerHTML = fmtNum(avg, 1) + '<small>von 5' + (exp !== undefined ? ' · Experience gemessen ' + Math.round(exp) + ' von 100' : '') + '</small>';
    $('#istbildBars').innerHTML = FIELDS.map(f => '<div class="fieldbar' + (levels[f.id] === mn && weakest.length < FIELDS.length ? ' bottleneck' : '') + '"><div class="nm">' + f.name + '</div><div class="seg">' + [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= levels[f.id] ? 'on' : '') + '"></i>').join('') + '</div><div class="v">' + levels[f.id] + '</div></div>').join('');
    renderSrcStatus();
  }
  function twinLevels() { const p = intakeProposal(); const L = {}; FIELDS.forEach(f => { L[f.id] = p[f.id].final; }); return L; }
  function startTwinRun() { endHandled = false; startRun({ twin: true, levels: twinLevels() }); toast('Validierungslauf: ein aus den Häufigkeiten erzeugter Arbeitstag auf dem Ist-Bild.'); }
  /* Zwillingsmodell: Erwartungswerte des Ist-Bilds mit kalibrierten Häufigkeiten, wahlweise mit oder ohne Kalibrierfaktoren. */
  function twinModel(useCal) {
    const it = state.intake, L = twinLevels(), A = window.Analysis;
    const P = Object.assign({}, state.params, { employees: it.employees || state.params.employees });
    const cal = window.Intake.calibrate(it.metrics, it.employees);
    const freqOf = e => { if (cal && cal.freq[e.id] !== null && cal.freq[e.id] !== undefined) return cal.freq[e.id]; const ex = []; Object.keys(it.extra || {}).forEach(k => { const r = it.extra[k]; if (r && r.calib && r.calib[e.id] !== undefined && r.calib[e.id] !== null) ex.push(r.calib[e.id]); }); return ex.length ? ex.reduce((s, v) => s + v, 0) / ex.length : e.freq; };
    const twinP = Object.assign({}, P, { coverage: cal ? cal.coverage : P.coverage });
    const saved = EVENTS.map(e => e.freq); EVENTS.forEach(e => { e.freq = freqOf(e); });
    const active = calibActive();
    if (!useCal) A.setCalibration(null);
    const c = A.calibration();
    const exp = A.expected(L, twinP);
    const vs = A.variants(L);
    let durW = 0, nW = 0, autoN = 0, prevN = 0; vs.forEach(x => { const n = A.perYear(x.e, twinP); const dur = x.v.steps.reduce((s, st) => s + st.d, 0) / 60 * c.dur; durW += dur * n; nW += n; if (x.v.touches === 0 || x.v.prevented) autoN += n; if (x.v.prevented) prevN += n; });
    const perType = EVENTS.map(e => ({ e, twin: e.freq * (e.perCompany ? 1 : (it.employees || 300) / 100), measured: it.metrics && it.metrics.byType && it.metrics.byType[e.id] ? it.metrics.byType[e.id].perMonth : null, calibrated: !!(cal && cal.freq[e.id] !== null && cal.freq[e.id] !== undefined) }));
    EVENTS.forEach((e, i) => { e.freq = saved[i]; });
    if (!useCal) A.setCalibration(active ? state.calib.f : null);
    return { L, exp, mttr: nW ? durW / nW : 0, auto: nW ? Math.max(0, Math.min(1, autoN / nW + c.auto)) : 0, prev: nW ? prevN / nW : 0, perType, calibrated: perType.filter(p => p.calibrated).length };
  }
  const calibActive = () => !!(state.calib && state.calib.on);
  /* Realitätscheck: Zeilen mit Messung, Erwartung, Abweichung und Hinweis; dazu die Qualität des Zwillings. */
  function twinCheck() {
    const it = state.intake, m = it.metrics && it.metrics.tickets ? it.metrics : null;
    const model = twinModel(true), raw = calibActive() ? twinModel(false) : model;
    const verdict = (tw, me, abs) => {
      if (me === null || me === undefined || !isFinite(me)) return { d: null, cls: '', txt: 'keine Messung' };
      if (abs) { const d = tw - me; const ad = Math.abs(d); return { d, cls: ad <= .05 ? 'ok' : ad <= .15 ? 'warn' : 'bad', txt: (d >= 0 ? '+' : '−') + Math.round(ad * 100) + ' Pkt.', rel: ad / .3 }; }
      if (me === 0) return { d: null, cls: '', txt: 'keine Messung' };
      const d = (tw - me) / me; const ad = Math.abs(d); return { d, cls: ad <= .2 ? 'ok' : ad <= .5 ? 'warn' : 'bad', txt: (d > 0 ? '+' : '−') + Math.round(ad * 100) + ' %', rel: ad };
    };
    const rowsOf = (M) => {
      const rows = [];
      const push = (key, label, me, tw, fmt, hintHi, hintLo, abs) => { const v = verdict(tw, me, abs); rows.push(Object.assign({ key, label, me, tw, fmt, abs, hint: v.d === null ? 'Quelle laden, um zu prüfen.' : v.cls === 'ok' ? 'Realitätsnah.' : (v.d > 0 ? hintHi : hintLo) }, v)); };
      push('occ', 'Vorfälle und Anfragen je Monat', m ? m.perMonth : null, M.exp.occurrences / 12, v => fmtNum(Math.round(v)), 'Zwilling erzeugt mehr Nachfrage als gemessen: Ereignisse aus anderen Quellen (Monitoring, OT, Agenten) kommen zu den Tickets hinzu; Häufigkeiten oder Abdeckung prüfen.', 'Zwilling erzeugt weniger Nachfrage als gemessen: Häufigkeiten nicht kalibrierter Typen prüfen, Abdeckung senken.');
      push('tickets', 'Tickets je Monat', m ? m.perMonth : null, M.exp.tickets / 12, v => fmtNum(Math.round(v)), 'Zwilling erzeugt mehr Tickets: Stufen in Service Management und Automatisierung im Zwilling vermutlich zu niedrig.', 'Zwilling erzeugt weniger Tickets als gemessen: Stufen im Zwilling zu hoch, oder Anfragen laufen in der Realität ohne Self-Service über Tickets.');
      push('mttr', 'Ø Lösungszeit', m ? m.mttrHours : null, M.mttr, v => fmtDur(v), 'Zwilling löst langsamer als gemessen: Stufen zu niedrig angesetzt.', 'Zwilling löst schneller als gemessen: Reifegrad in Service Management oder Automatisierung zu hoch, oder Wartezeiten der Realität (Rückfragen, Warteschlangen, Schichten) sind im Zwilling nicht abgebildet.');
      push('auto', 'Ohne menschlichen Eingriff gelöst', m ? m.autoShare : null, M.auto, v => pct(v), 'Zwilling automatisiert mehr als gemessen: Stufe Automatisierung im Zwilling prüfen.', 'Zwilling automatisiert weniger als gemessen: Automationen des Kunden sind in Ticketdaten sichtbar, aber im Zwilling nicht abgebildet.', true);
      push('prev', 'Vorab erkannt (aus Monitoring)', m ? m.monitoringShare : null, M.prev, v => pct(v), 'Zwilling erkennt mehr vorab als gemessen: Stufe Telemetrie prüfen.', 'Zwilling erkennt weniger vorab als gemessen: Monitoring des Kunden im Zwilling unterschätzt.', true);
      if (state.ot) { const oa = it.extra && it.extra.otalarms ? it.extra.otalarms.metrics.downtimeMinPerMonth : null; push('ot', 'Produktionsstillstand je Monat', oa, M.exp.ot / 12, v => fmtHours(v), 'Zwilling erzeugt mehr Stillstand: Stufe OT oder Häufigkeiten prüfen.', 'Zwilling erzeugt weniger Stillstand als gemessen: Stillstandsdauern in den OT-Ereignissen zu kurz oder Stufe OT zu hoch.'); }
      return rows;
    };
    const rows = rowsOf(model), rawRows = raw === model ? rows : rowsOf(raw);
    return { rows, rawRows, perType: model.perType, model, raw, verdict, quality: qualityOf(rows, rawRows) };
  }
  function qualityOf(rows, rawRows) {
    const measured = rows.filter(r => r.d !== null);
    const stampOf = (cls, list) => cls + '|' + list.map(r => r.key + r.cls).join(',') + '|' + (calibActive() ? state.calib.at : '');
    if (!measured.length) return { cls: 'none', title: 'Zwilling nicht prüfbar', text: 'Es liegen keine Messwerte vor, gegen die sich der Zwilling prüfen lässt. Die Simulation rechnet mit ungeprüften Annahmen.', u: .3, issues: [], missing: rows.map(r => r.label), measured: 0, stamp: stampOf('none', []) };
    const bad = measured.filter(r => r.cls === 'bad'), warn = measured.filter(r => r.cls === 'warn');
    const resid = Math.max.apply(null, measured.map(r => r.rel)), rawMax = Math.max.apply(null, rawRows.filter(r => r.d !== null).map(r => r.rel));
    const u = Math.min(1, Math.max(resid, 0.3 * rawMax));
    const issues = bad.concat(warn).map(r => r.label + ': Zwilling ' + r.fmt(r.tw) + ', gemessen ' + r.fmt(r.me) + ' (' + r.txt + ')');
    const missing = rows.filter(r => r.d === null).map(r => r.label);
    let cls, title, text;
    if (bad.length) { cls = 'bad'; title = 'Zwilling nicht belastbar'; text = bad.length + (bad.length === 1 ? ' Kennzahl weicht' : ' Kennzahlen weichen') + ' um mehr als 50 % von der Messung ab. Vor der Simulation kalibrieren oder Quellen ergänzen.'; }
    else if (warn.length) { cls = 'warn'; title = 'Zwilling prüfenswert'; text = warn.length + (warn.length === 1 ? ' Kennzahl weicht' : ' Kennzahlen weichen') + ' um 20 bis 50 % ab. Simulation und Business Case erhalten einen Vorbehalt.'; }
    else if (measured.length < 3) { cls = 'warn'; title = 'Zwilling dünn geprüft'; text = 'Nur ' + measured.length + (measured.length === 1 ? ' Kennzahl liegt' : ' Kennzahlen liegen') + ' als Messung vor. Weitere Quellen erhöhen die Belastbarkeit.'; }
    else { cls = 'ok'; title = 'Zwilling realitätsnah'; text = 'Alle ' + measured.length + ' gemessenen Kennzahlen liegen innerhalb von 20 % der Erwartung.'; }
    if (calibActive() && cls !== 'bad') text += ' Kalibriert am ' + new Date(state.calib.at).toLocaleDateString('de-DE') + '; die korrigierte Abweichung bleibt als Unsicherheit erhalten.';
    return { cls, title, text, u, issues, missing, measured: measured.length, stamp: stampOf(cls, measured) };
  }
  /* Kalibrierung: Faktoren aus den Abweichungen ohne Kalibrierung, protokolliert und rücknehmbar. */
  function calibrateTwin() {
    const C = twinCheck(); const raw = C.rawRows; const f = { dur: 1, ticket: 1, auto: 0, ot: 1 }; const log = [];
    const clampF = v => Math.max(.25, Math.min(4, v));
    const row = k => raw.find(r => r.key === k && r.d !== null);
    let r;
    if ((r = row('mttr')) && r.tw > 0 && Math.abs(r.me / r.tw - 1) >= .02) { f.dur = clampF(r.me / r.tw); log.push({ t: 'Lösungszeit und Ausfallzeit × ' + fmtNum(f.dur, 2), s: 'Gemessen ' + r.fmt(r.me) + ', Zwilling ' + r.fmt(r.tw) + '. Wartezeiten und Produktivitätsverlust skalieren mit.' }); }
    if ((r = row('tickets')) && r.tw > 0 && Math.abs(r.me / r.tw - 1) >= .02) { f.ticket = clampF(r.me / r.tw); log.push({ t: 'Ticketanteil × ' + fmtNum(f.ticket, 2), s: 'Gemessen ' + r.fmt(r.me) + ' je Monat, Zwilling ' + r.fmt(r.tw) + '.' }); }
    if ((r = row('auto')) && Math.abs(r.me - r.tw) >= .02) { f.auto = Math.max(-.5, Math.min(.5, r.me - r.tw)); log.push({ t: 'Anteil ohne menschlichen Eingriff ' + (f.auto >= 0 ? '+' : '−') + Math.round(Math.abs(f.auto) * 100) + ' Punkte', s: 'Gemessen ' + pct(r.me) + ', Zwilling ' + pct(r.tw) + '.' }); }
    if ((r = row('ot')) && r.tw > 0 && Math.abs(r.me / r.tw - 1) >= .02) { f.ot = clampF(r.me / r.tw); log.push({ t: 'Produktionsstillstand × ' + fmtNum(f.ot, 2), s: 'Gemessen ' + r.fmt(r.me) + ' je Monat, Zwilling ' + r.fmt(r.tw) + '.' }); }
    const occ = row('occ'); if (occ && occ.cls !== 'ok') log.push({ t: 'Nachfrage nicht angepasst', s: 'Vorfälle und Anfragen werden über die Häufigkeiten je Ereignistyp kalibriert (Ticketdaten, weitere Quellen). Abweichung ' + occ.txt + ' bleibt; Häufigkeiten in der Prognose prüfen.' });
    const prev = row('prev'); if (prev && prev.cls !== 'ok') log.push({ t: 'Vorab-Erkennung nicht angepasst', s: 'Abweichung ' + prev.txt + ' bleibt: Stufe Telemetrie im Ist-Bild prüfen.' });
    if (!log.length) { toast('Keine Messwerte, aus denen sich Faktoren ableiten lassen.'); return; }
    state.calib = { on: true, f, log, at: new Date().toISOString() }; store.set('zt.calib', state.calib);
    window.Analysis.setCalibration(f); state.simResult = null; state.twinAck = null; store.set('zt.twinAck', null);
    renderTwin(); scheduleAnalysis(); toast('Zwilling kalibriert: ' + log.filter(l => !/nicht angepasst/.test(l.t)).length + ' Faktoren gesetzt, Abweichungen protokolliert.');
  }
  function uncalibrateTwin() {
    state.calib = null; store.set('zt.calib', null); window.Analysis.setCalibration(null); state.simResult = null; state.twinAck = null; store.set('zt.twinAck', null);
    renderTwin(); scheduleAnalysis(); toast('Kalibrierung zurückgenommen.');
  }
  function twinQuality() {
    if (!intakeHasData()) { const q = { cls: 'none', title: 'Kein Digital Twin aus Kundendaten', text: 'Die Simulation rechnet mit der gewählten Ausgangslage und Standardannahmen, ohne Prüfung gegen Messwerte.', u: .3, issues: [], missing: [], measured: 0, stamp: 'none' }; state.twinQuality = q; window.Analysis.setUncertainty(q.u); return q; }
    const q = twinCheck().quality; state.twinQuality = q; window.Analysis.setUncertainty(q.u); return q;
  }
  function renderTwin() {
    const it = state.intake, C = twinCheck(), M = C.model, Q = C.quality; state.twinQuality = Q; window.Analysis.setUncertainty(Q.u);
    const tile = (l, v, s) => '<div class="tile"><div class="lbl">' + l + '</div><div class="val">' + v + '</div>' + (s ? '<div class="rng">' + s + '</div>' : '') + '</div>';
    $('#twinModel').innerHTML = tile('Handlungsfelder', FIELDS.length, 'Reife Ø ' + fmtNum(FIELDS.reduce((s, f) => s + M.L[f.id], 0) / FIELDS.length, 1)) + tile('Ereignistypen', EVENTS.length, M.calibrated + ' aus Daten kalibriert') + tile('Vorfälle und Anfragen je Monat', fmtNum(Math.round(M.exp.occurrences / 12)), 'davon Tickets ' + fmtNum(Math.round(M.exp.tickets / 12))) + tile('Ø Lösungszeit im Zwilling', fmtDur(M.mttr || null)) + tile('Ohne menschlichen Eingriff', pct(M.auto), 'vorab erkannt ' + pct(M.prev));
    const m = it.metrics && it.metrics.tickets ? it.metrics : null;
    const lr = state.twinLast;
    $('#twinLastRun').innerHTML = lr ? '<div class="twin-run"><h4>Letzter Validierungslauf</h4><div class="tiles five">' + tile('Ereignisse am Tag', lr.events, m ? 'gemessen Ø ' + fmtNum(m.perMonth / 20, 1) + ' je Tag' : '') + tile('Tickets', lr.tickets, m ? 'gemessen Ø ' + fmtNum(m.perMonth / 20, 1) : '') + tile('IT-Aufwand', fmtHours(lr.it)) + tile('Ausfall Mitarbeiter', fmtHours(lr.user)) + (state.ot ? tile('Produktionsstillstand', fmtHours(lr.ot)) : tile('Verhindert / autonom', lr.prevented)) + '</div><p class="note" style="margin-top:8px">' + esc(lr.titles.join(' · ')) + (lr.open ? ' · ' + lr.open + ' über Nacht offen' : '') + '</p></div>' : '';
    $('#twinRunNote').textContent = lr ? 'Jeder Lauf erzeugt einen anderen Tag.' : 'Noch kein Validierungslauf.';
    // Zwillingsqualität und Kalibrierung
    const vcls = Q.cls === 'bad' ? 'stop' : Q.cls === 'ok' ? 'ok' : 'warn';
    $('#twinQuality').innerHTML = '<div class="verdict ' + vcls + '"><b>' + esc(Q.title) + '</b>' + esc(Q.text) + (Q.issues.length ? '<ul>' + Q.issues.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '') + (Q.missing.length && Q.measured ? '<p class="note" style="margin-top:6px">Ohne Messung: ' + esc(Q.missing.join(', ')) + '.</p>' : '') + '</div>' +
      '<div><div class="tiles two"><div class="tile"><div class="lbl">Unsicherheit des Zwillings</div><div class="val">' + Math.round(Q.u * 100) + '<small>%</small></div><div class="rng">weitet die Bandbreiten der Prognose, Ersparnis im Business Case um ' + Math.round(haircutOf(Q) * 100) + ' % abgeschlagen</div></div><div class="tile"><div class="lbl">Kalibrierung</div><div class="val" style="font-size:1rem">' + (calibActive() ? 'aktiv' : 'keine') + '</div><div class="rng">' + (calibActive() ? state.calib.log.filter(l => !/nicht angepasst/.test(l.t)).length + ' Faktoren, rücknehmbar' : 'Faktoren aus den Abweichungen ableiten') + '</div></div></div>' +
      '<div class="actions" style="margin-top:8px">' + (Q.measured ? '<button type="button" class="btn primary" id="calibBtn">' + (calibActive() ? 'Neu kalibrieren' : 'Zwilling automatisch kalibrieren') + '</button>' : '') + (calibActive() ? '<button type="button" class="btn" id="uncalibBtn">Kalibrierung zurücknehmen</button>' : '') + '</div>' +
      (calibActive() ? '<ul class="pv-list" style="margin-top:8px">' + state.calib.log.map(l => '<li><span class="pv-body"><span class="pv-title">' + esc(l.t) + '</span><span class="pv-sub">' + esc(l.s) + '</span></span></li>').join('') + '</ul>' : '') + '</div>';
    const cb = $('#calibBtn'); if (cb) cb.addEventListener('click', calibrateTwin);
    const ub = $('#uncalibBtn'); if (ub) ub.addEventListener('click', uncalibrateTwin);
    $('#realityTable').innerHTML = '<thead><tr><th>Kennzahl</th><th>Realität (gemessen)</th><th>Zwilling (Erwartung)</th><th>Abweichung</th>' + (calibActive() ? '<th>vor Kalibrierung</th>' : '') + '<th style="text-align:left">Hinweis</th></tr></thead><tbody>' + C.rows.map((r, i) => '<tr><td>' + r.label + '</td><td>' + (r.me === null || r.me === undefined ? '–' : r.fmt(r.me)) + '</td><td>' + r.fmt(r.tw) + '</td><td class="' + r.cls + '">' + r.txt + '</td>' + (calibActive() ? '<td class="' + C.rawRows[i].cls + '">' + C.rawRows[i].txt + '</td>' : '') + '<td class="hint">' + r.hint + '</td></tr>').join('') + '</tbody>';
    const verdict = C.verdict;
    $('#realityTypes').innerHTML = '<thead><tr><th>Ereignistyp</th><th>gemessen je Monat</th><th>Zwilling je Monat</th><th>Abweichung</th><th style="text-align:left">Herkunft</th></tr></thead><tbody>' + C.perType.map(p => { const v = verdict(p.twin, p.measured); return '<tr><td>' + esc(p.e.title) + '</td><td>' + (p.measured === null ? '–' : fmtNum(p.measured, 1)) + '</td><td>' + fmtNum(p.twin, 1) + '</td><td class="' + v.cls + '">' + v.txt + '</td><td class="hint">' + (p.calibrated ? 'aus Ticketdaten kalibriert' : (p.measured === null ? 'Standardannahme, keine Messung' : 'Messwerte anderer Quellen')) + '</td></tr>'; }).join('') + '</tbody>';
  }
  const haircutOf = Q => Math.min(.5, Math.round(Q.u * 0.5 * 100) / 100);
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
    lines.push('Digitalen Zwilling aufgebaut: ' + FIELDS.length + ' Handlungsfelder, ' + EVENTS.length + ' Ereignistypen, Häufigkeiten ' + (it.metrics && it.metrics.tickets ? 'aus Ticketdaten kalibriert' : 'als Standardannahme'));
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
    if (!state.ot) setOt(true, true);
    const d = window.Connectors.demoData(42);
    d.docs += ' Produktion: Siemens S7-Steuerungen und HMIs in einem flachen Produktionsnetz, Fernwartung über den Herstellerzugang, kein OT-Monitoring, Stillstände werden im MES erfasst.';
    rawData = { incidents: d.incidents, requests: d.requests, changes: d.changes, cis: d.cis };
    state.intake.customer = d.customer; state.intake.employees = d.employees; state.intake.docText = d.docs;
    state.intake.detected = window.Intake.detectTools(d.docs); state.intake.manual = {}; state.intake.overrides = {};
    state.intake.answers = { q_inventory: 'yes', q_zerotouch: 'no', q_roles: 'partly', q_hr: 'no', q_monitoring: 'yes', q_e2e: 'no', q_scripts: 'yes', q_workflow: 'no', q_itsm: 'yes', q_portal: 'partly', q_patch: 'yes', q_edr: 'partly', q_roles_org: 'yes', q_autoeng: 'no' };
    $('#docText').value = d.docs;
    rawExtra = window.Sources.demoAll(7, state.ot); state.intake.extra = {};
    state.intake.agentAnswers = { q_dex: { a: 'no', evidence: 'Kein DEX-Werkzeug im Softwareinventar, Gerätestörungen werden erst nach Meldung sichtbar.' }, q_scripts: { a: 'yes', evidence: 'GitLab-Gruppe it-ops mit 3 Repositories und 126 Skripten, WSUS-Patchfenster jeden zweiten Dienstag.' }, q_remediation: { a: 'no', evidence: 'PRTG-Alarme gehen per E-Mail an die Gruppe it-ops; kein Runbook wird automatisch ausgelöst.' }, q_proactive: { a: 'no', evidence: 'Statusmeldungen erfolgen reaktiv über das Intranet nach Rückfragen.' }, q_vuln: { a: 'partly', evidence: 'Defender Vulnerability Management aktiv, Priorisierung nach CVSS, Schließung manuell im Patchfenster.' }, q_product: { a: 'no', evidence: 'Organisation nach Technikbereichen: Service Desk, Infrastruktur, Anwendungen.' }, q_ca: { a: 'partly', evidence: 'Eine Conditional-Access-Richtlinie für Admin-Konten, keine für Mitarbeiter.' }, q_ot_inventory: { a: 'no', evidence: 'Steuerungen sind nur in der Instandhaltungsliste erfasst, Produktionsnetz ohne Zonen, Fernwartung direkt vom Hersteller.' } };
    recomputeMetrics(); rederiveExtras(); saveIntake(); renderIntake();
    toast('Beispielkunde geladen: ' + d.customer + ' mit ' + Object.keys(rawExtra).length + ' weiteren Quellen, OT-Erweiterung aktiv');
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
    it.applied = true; saveIntake(); state.simResult = null; state.twinAck = null; store.set('zt.twinAck', null);
    applyBase(); state.levels = Object.assign({}, state.base); store.set('zt.levels', state.levels);
    renderPlan(); renderMatrix(); renderProposal(); updateStepper();
    toast('Ist-Bild übernommen: Ausgangslage, Mitarbeiterzahl' + (cal ? ', Häufigkeiten aus ' + it.metrics.tickets + ' Tickets' : '') + (Object.keys(extraCal).length ? ' und ' + Object.keys(extraCal).length + ' Messwerten weiterer Systeme' : '') + ' gesetzt.');
  }
  function profileJSON() {
    const it = state.intake; const p = intakeProposal(); const levels = {}; FIELDS.forEach(f => { levels[f.id] = p[f.id].final; });
    return JSON.stringify({ version: 1, ot: state.ot, customer: it.customer, employees: it.employees, exportedAt: new Date().toISOString(), levels, overrides: it.overrides, answers: it.answers, detected: it.detected, manual: it.manual, docText: it.docText, metrics: it.metrics, counts: it.counts, extra: it.extra, agentAnswers: it.agentAnswers }, null, 2);
  }
  function importProfile(text) {
    try {
      const j = JSON.parse(text);
      if (typeof j.ot === 'boolean' && j.ot !== state.ot) setOt(j.ot, true);
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
    $('#applyIntakeBtn').addEventListener('click', () => { applyIntake(); state.simResult = null; showScreen('simulate'); });
    $('#intakeNextBtn').addEventListener('click', startIstbild);
    $('#istbildBackBtn').addEventListener('click', () => showScreen('intake'));
    $('#twinRunBtn').addEventListener('click', startTwinRun);
    $('#twinRunBtn2').addEventListener('click', startTwinRun);
    $('#profileCopyBtn2').addEventListener('click', () => $('#profileCopyBtn').click());
    $('#intakeSkipBtn').addEventListener('click', () => { state.useAssessment = false; store.set('zt.useAssessment', false); applyBase(); state.simResult = null; showScreen('simulate'); });
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
    const lanes = simLanes();
    const sch = window.Intake.schedule(road.steps, lanes, L);
    const last = road.steps[road.steps.length - 1];
    const years = sch.totalMonths / 12;
    const perYear = last.cumInvest / Math.max(1, years);
    const end = new Date(); end.setMonth(end.getMonth() + Math.round(sch.totalMonths));
    $('#pathSummary').innerHTML = '<b>Dauer etwa ' + Math.round(sch.totalMonths) + ' Monate</b> (bis ' + end.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) + ') in ' + (lanes === 1 ? 'einer Maßnahme nach der anderen' : lanes + ' Maßnahmen gleichzeitig') + ', abgeleitet aus dem Umsetzungstempo in Schritt 1' + '. Investition ' + fmtEur(last.cumInvest) + ', das sind etwa ' + fmtEur(perYear) + ' je Jahr. Nach Abschluss sinken die jährlichen Kosten um ' + fmtEur(last.cumNet) + ' netto. ' + (state.intake.applied && state.intake.customer ? 'Berechnet für ' + esc(state.intake.customer) + ' mit ' + state.params.employees + ' Mitarbeitern.' : '');
    $('#pathChart').innerHTML = pathChart(sch);
  }


  /* ---------- Ziele ---------- */
  const GOAL_DEFS = [
    { id: 'level', name: 'Zielstufe in allen Handlungsfeldern', unit: 'Stufe', min: 2, max: 5, step: 1, note: 'Jedes Handlungsfeld erreicht mindestens diese Stufe.' },
    { id: 'tickets', name: 'Tickets senken um', unit: '%', min: 10, max: 95, step: 5, note: 'Ticketaufkommen je Jahr gegenüber heute.' },
    { id: 'user', name: 'Ausfallzeit der Mitarbeiter senken um', unit: '%', min: 10, max: 99, step: 5, note: 'Produktivitätsverlust je Jahr gegenüber heute.' },
    { id: 'mttr', name: 'Lösungszeit höchstens', unit: 'h', min: 0.1, max: 48, step: 0.5, note: 'Durchschnittliche Lösungszeit über alle Ereignisse.' },
    { id: 'auto', name: 'Anteil ohne menschlichen Eingriff mindestens', unit: '%', min: 10, max: 100, step: 5, note: 'Anteil der Ereignisse, die verhindert oder autonom gelöst werden.' },
    { id: 'cost', name: 'Jährliche Kosten senken um', unit: '%', min: 10, max: 95, step: 5, note: 'IT-Aufwand, Ausfall, Tickets und bei OT Stillstand, gegenüber heute.' },
    { id: 'ot', name: 'Produktionsstillstand senken um', unit: '%', min: 10, max: 99, step: 5, note: 'Stillstandzeit je Jahr gegenüber heute.', ot: true }
  ];
  const saveGoals = () => store.set('zt.goals', state.goals);
  const FTE_PER_MEASURE = 2.5;
  /* Umsetzungstempo: gleichzeitige Maßnahmen aus IT-Teamgröße, Zeitanteil für Veränderung und Partnerteams. */
  function capacity() {
    const G = state.goals; if (!G.cap) G.cap = { fte: 0, share: 0.2, partners: 0 };
    const team = state.intake.extra && state.intake.extra.team && state.intake.extra.team.metrics ? state.intake.extra.team.metrics.itFte : null;
    const emp = state.intake.employees || state.params.employees || 300;
    const fte = G.cap.fte > 0 ? G.cap.fte : (team ? team : Math.max(2, Math.round(emp * 0.03)));
    const source = G.cap.fte > 0 ? 'eigene Angabe' : (team ? 'aus der Ist-Aufnahme (Organigramm)' : 'Faustregel 3 % der ' + fmtNum(emp) + ' Mitarbeiter');
    const internal = fte * G.cap.share / FTE_PER_MEASURE;
    const derived = Math.max(1, Math.min(4, Math.round(internal + G.cap.partners)));
    const lanes = G.lanes > 0 ? G.lanes : derived;
    return { fte, source, internal, derived, lanes, manual: G.lanes > 0 };
  }
  function simLanes() { return capacity().lanes; }
  function simStartLevels() { return state.intake.applied ? Object.assign({}, state.base) : (intakeHasData() ? twinLevels() : Object.assign({}, state.base)); }
  function metricsOf(levels) {
    const P = state.params, A = window.Analysis;
    const e = A.expected(levels, P);
    const c = A.calibration();
    let dur = 0, n = 0, auto = 0; A.variants(levels).forEach(x => { const k = A.perYear(x.e, P); dur += x.v.steps.reduce((s, st) => s + st.d, 0) / 60 * k * c.dur; n += k; if (x.v.touches === 0 || x.v.prevented) auto += k; });
    return { minLevel: Math.min.apply(null, FIELDS.map(f => levels[f.id])), tickets: e.tickets, user: e.user, cost: e.cost, mttr: n ? dur / n : 0, auto: n ? Math.max(0, Math.min(1, auto / n + c.auto)) : 0, ot: e.ot, prevented: e.prevented, it: e.it };
  }
  function goalTarget(g, base) {
    const v = state.goals.items[g.id].v;
    switch (g.id) {
      case 'level': return { target: v, test: m => m.minLevel >= v, fmt: x => 'Stufe ' + x, cur: m => m.minLevel, valueOf: m => m.minLevel, higherBetter: true, gap: (m, l) => FIELDS.reduce((s, f) => s + Math.max(0, v - l[f.id]), 0) };
      case 'tickets': return { target: base.tickets * (1 - v / 100), test: m => m.tickets <= base.tickets * (1 - v / 100) + 1e-9, fmt: x => fmtNum(Math.round(x / 12)) + ' je Monat', cur: m => m.tickets, valueOf: m => m.tickets, higherBetter: false, gap: m => Math.max(0, m.tickets - base.tickets * (1 - v / 100)) };
      case 'user': return { target: base.user * (1 - v / 100), test: m => m.user <= base.user * (1 - v / 100) + 1e-9, fmt: x => fmtNum(Math.round(x / 60)) + ' h je Jahr', cur: m => m.user, valueOf: m => m.user, higherBetter: false, gap: m => Math.max(0, m.user - base.user * (1 - v / 100)) };
      case 'mttr': return { target: v, test: m => m.mttr <= v + 1e-9, fmt: x => fmtDur(x), cur: m => m.mttr, valueOf: m => m.mttr, higherBetter: false, gap: m => Math.max(0, m.mttr - v) };
      case 'auto': return { target: v / 100, test: m => m.auto >= v / 100 - 1e-9, fmt: x => pct(x), cur: m => m.auto, valueOf: m => m.auto, higherBetter: true, gap: m => Math.max(0, v / 100 - m.auto) };
      case 'cost': return { target: base.cost * (1 - v / 100), test: m => m.cost <= base.cost * (1 - v / 100) + 1e-9, fmt: x => fmtEur(x) + ' je Jahr', cur: m => m.cost, valueOf: m => m.cost, higherBetter: false, gap: m => Math.max(0, m.cost - base.cost * (1 - v / 100)) };
      case 'ot': return { target: base.ot * (1 - v / 100), test: m => m.ot <= base.ot * (1 - v / 100) + 1e-9, fmt: x => fmtNum(Math.round(x / 60)) + ' h je Jahr', cur: m => m.ot, valueOf: m => m.ot, higherBetter: false, gap: m => Math.max(0, m.ot - base.ot * (1 - v / 100)) };
    }
  }
  function activeGoals() { return GOAL_DEFS.filter(g => (!g.ot || state.ot) && state.goals.items[g.id].on); }
  function renderGoals() {
    const G = state.goals;
    $('#horizonSeg').innerHTML = [12, 24, 36, 48, 60].map(m => '<button type="button" data-horizon="' + m + '" aria-pressed="' + (G.horizon === m) + '"><span class="n">' + m + '</span><span class="lbl">Monate</span></button>').join('') + '<button type="button" data-horizon="0" aria-pressed="' + (!G.horizon) + '"><span class="lbl">Ohne Vorgabe</span></button>';
    $$('#budgetModeSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.bmode === G.budgetMode));
    $('#budgetAmountRow').hidden = G.budgetMode !== 'available';
    $('#goalBudget').value = G.budget;
    $('#budgetModeHint').textContent = G.budgetMode === 'available' ? 'Die Simulation sucht den besten Pfad innerhalb dieses Budgets und zeigt, wie weit er trägt.' : 'Die Simulation ermittelt das nötige Budget und erstellt in Schritt 5 die Argumentation für den Antrag.';
    const C = capacity();
    $('#capFte').value = C.fte; $('#capFteHint').textContent = 'Vorbelegung: ' + C.source + '. Überschreiben, wenn die Zahl bekannt ist.';
    $('#capShareSeg').innerHTML = [[.1, 'kaum', '10 %'], [.2, 'ein Tag je Woche', '20 %'], [.33, 'ein Drittel', '33 %'], [.5, 'die Hälfte', '50 %']].map(o => '<button type="button" data-capshare="' + o[0] + '" aria-pressed="' + (Math.abs(G.cap.share - o[0]) < .01) + '"><span class="n">' + o[2] + '</span><span class="lbl">' + o[1] + '</span></button>').join('');
    $('#capPartnerSeg').innerHTML = [0, 1, 2].map(n => '<button type="button" data-cappartners="' + n + '" aria-pressed="' + (G.cap.partners === n) + '"><span class="n">' + n + '</span><span class="lbl">' + (n === 0 ? 'keine' : n === 1 ? 'Team' : 'Teams') + '</span></button>').join('');
    $('#capResult').innerHTML = '<b>' + C.lanes + (C.lanes === 1 ? ' Maßnahme nach der anderen' : ' Maßnahmen gleichzeitig') + (C.manual ? ' (selbst festgelegt)' : '') + '</b>' + fmtNum(C.fte) + ' IT-Mitarbeiter × ' + Math.round(G.cap.share * 100) + ' % Zeit = ' + fmtNum(C.fte * G.cap.share, 1) + ' Vollzeitkräfte für Veränderung, das trägt ' + fmtNum(C.internal, 1) + (C.internal < 1.5 ? ' Maßnahme' : ' Maßnahmen') + (G.cap.partners ? ', plus ' + G.cap.partners + (G.cap.partners === 1 ? ' Partnerteam' : ' Partnerteams') : '') + (C.manual ? '. Berechnet wären ' + C.derived + '.' : (C.internal + G.cap.partners > 4.5 ? '. Mehr als vier gleichzeitig plant die Simulation nicht; Voraussetzungen und Wartungsfenster begrenzen ohnehin.' : '.')) + (C.internal < 1 && !G.cap.partners ? ' Unter einer Maßnahme: Das Team braucht Entlastung im Tagesgeschäft oder einen Partner, sonst zieht sich jede Maßnahme in die Länge.' : '');
    $('#lanesManualOn').checked = G.lanes > 0; $('#lanesManualRow').hidden = !(G.lanes > 0);
    $('#lanesSeg').innerHTML = [1, 2, 3, 4].map(n => '<button type="button" data-lanes="' + n + '" aria-pressed="' + (G.lanes === n) + '"><span class="n">' + n + '</span><span class="lbl">' + (n === 1 ? 'nacheinander' : 'gleichzeitig') + '</span></button>').join('');
    $('#perYearOn').checked = G.perYear > 0; $('#perYearRow').hidden = !(G.perYear > 0); $('#goalPerYear').value = G.perYear || 0;
    $('#perYearHint').textContent = G.perYear > 0 ? 'Schritte, die den Betrag eines Jahres überschreiten würden, warten auf das nächste Haushaltsjahr.' : 'Ohne Grenze darf der Pfad das Budget so schnell ausgeben, wie das Umsetzungstempo erlaubt.';
    const hasTwin = !!state.intake.applied;
    const base = hasTwin ? metricsOf(simStartLevels()) : null;
    $('#goalsTwinNote').textContent = hasTwin ? 'Der Digital Twin liegt vor: Zu jedem Ziel steht der heutige Wert und der daraus abgeleitete Zielwert.' : 'Relative Ziele beziehen sich auf den Zustand heute. Den liefert der Digital Twin in Schritt 3; die Prüfung der Ziele folgt in Schritt 4.';
    $('#goalList').innerHTML = GOAL_DEFS.filter(g => !g.ot || state.ot).map(g => {
      const it = G.items[g.id]; const t = base ? goalTarget(g, base) : null;
      if (g.id === 'level') {
        const lv = LEVELS[Math.max(1, Math.min(5, Math.round(it.v))) - 1];
        return '<div class="goal wide' + (it.on ? '' : ' off') + '"><div class="gh"><b>' + g.name + '</b><label class="switch"><input type="checkbox" data-goal-on="' + g.id + '"' + (it.on ? ' checked' : '') + '><span></span></label></div>' +
          '<div class="segments wrap" role="group" aria-label="Zielstufe">' + LEVELS.filter(l => l.n >= 2).map(l => '<button type="button" data-goal-level="' + l.n + '" aria-pressed="' + (l.n === it.v) + '"><span class="n">' + l.n + '</span><span class="lbl">' + l.name + '</span></button>').join('') + '</div>' +
          '<div class="level-expl"><b>Stufe ' + lv.n + ' · ' + lv.name + ': ' + esc(lv.tagline) + '</b><p>' + esc(lv.desc) + '</p><p class="kpi">Richtwerte: ohne menschlichen Eingriff ' + lv.kpi.auto + ' · Tickets je 100 Mitarbeiter und Monat ' + lv.kpi.tickets + ' · Lösungszeit ' + lv.kpi.mttr + ' · vorab erkannt ' + lv.kpi.proactive + '</p><p>' + esc(lv.role) + ' ' + g.note + '</p><button type="button" class="btn small" data-goal-levels="' + lv.n + '">Alle Reifegrade im Detail</button></div>' +
          (t ? '<div class="gnote twin">Aus dem Digital Twin: heute ' + t.fmt(t.cur(base)) + ', Zielwert ' + t.fmt(t.target) + '.</div>' : '') + '</div>';
      }
      return '<div class="goal' + (it.on ? '' : ' off') + '"><div class="gh"><b>' + g.name + '</b><label class="switch"><input type="checkbox" data-goal-on="' + g.id + '"' + (it.on ? ' checked' : '') + '><span></span></label></div>' +
        '<div class="gv"><span>' + g.note + '</span><span><input type="number" data-goal-v="' + g.id + '" value="' + it.v + '" min="' + g.min + '" max="' + g.max + '" step="' + g.step + '"> ' + g.unit + '</span></div>' +
        (t ? '<div class="gnote twin">Aus dem Digital Twin: heute ' + t.fmt(t.cur(base)) + ', Zielwert ' + t.fmt(t.target) + '.</div>' : '') + '</div>';
    }).join('');
    renderGoalsSummary();
  }
  function renderGoalsSummary() {
    const G = state.goals, n = activeGoals().length;
    $('#goalsSummary').textContent = n + ' Ziele aktiv · ' + (G.horizon ? G.horizon + ' Monate' : 'ohne Zeitvorgabe') + ' · ' + (G.budgetMode === 'available' ? 'Budget ' + fmtEur(G.budget) : 'Budget wird ermittelt');
  }

  /* ---------- Simulation: Pfadsuche mit Zielprüfung ---------- */
  function scheduleCapped(steps, lanes, startLevels, capPerYear) {
    const sch = window.Intake.schedule(steps, lanes, startLevels);
    if (!capPerYear) return sch;
    const yearInv = {};
    sch.steps.forEach((s, i) => {
      let earliest = s.start;
      for (let j = 0; j < i; j++) { const pj = sch.steps[j]; const before = j ? sch.steps[j - 1].levels : startLevels; if (pj.field.id === s.field.id || (stageBlocker(s.field.id, s.stage, before) && !stageBlocker(s.field.id, s.stage, pj.levels))) earliest = Math.max(earliest, pj.end); }
      let start = Math.max(s.start, earliest);
      let y = Math.floor(start / 12);
      while ((yearInv[y] || 0) + s.invest > capPerYear && (yearInv[y] || 0) > 0) { y++; start = y * 12; }
      yearInv[y] = (yearInv[y] || 0) + s.invest;
      s.start = start; s.end = start + s.dur;
    });
    sch.totalMonths = sch.steps.length ? Math.max.apply(null, sch.steps.map(o => o.end)) : 0;
    return sch;
  }
  function computeSimulation() {
    const G = state.goals, P = state.params, A = window.Analysis;
    const Q = twinQuality();
    const gated = Q.cls === 'bad' && state.twinAck !== Q.stamp;
    const start = simStartLevels();
    const base = metricsOf(start);
    const goals = activeGoals().map(g => Object.assign({ g }, goalTarget(g, base)));
    const budgetPoints = G.budgetMode === 'available' ? Math.floor(G.budget / P.eurPerPoint) : 80;
    const lanes = simLanes();
    const memo = {}; const mOf = l => { const key = FIELDS.map(f => l[f.id]).join(''); return memo[key] || (memo[key] = metricsOf(l)); };
    const gap0 = goals.map(gl => Math.max(1e-9, gl.gap(base, start)));
    const goalGap = goals.length ? (l => { const m = mOf(l); return goals.reduce((s, gl, i) => s + Math.min(1, gl.gap(m, l) / gap0[i]), 0); }) : null;
    const road = A.roadmap(start, budgetPoints, P, goalGap);
    const roadFull = budgetPoints >= 80 ? road : A.roadmap(start, 80, P, goalGap);
    const sch = scheduleCapped(road.steps, lanes, start, G.perYear || 0);
    const schFull = roadFull === road ? sch : scheduleCapped(roadFull.steps, lanes, start, G.perYear || 0);
    const allMet = (levels) => { const m = mOf(levels); return { m, ok: goals.every(gl => gl.test(m)) }; };
    const findK = (r) => { for (let k = 0; k < r.steps.length; k++) { if (allMet(r.steps[k].levels).ok) return k; } return -1; };
    const k = goals.length ? findK(road) : (road.steps.length ? road.steps.length - 1 : -1);
    const kFull = goals.length ? findK(roadFull) : (roadFull.steps.length ? roadFull.steps.length - 1 : -1);
    const full = {}; FIELDS.forEach(f => { full[f.id] = 5; });
    const mFull = metricsOf(full);
    const monthsOf = (s, kk) => kk < 0 ? null : Math.max.apply(null, s.steps.slice(0, kk + 1).map(o => o.end));
    const checks = goals.map(gl => {
      const kk = road.steps.findIndex(st => gl.test(mOf(st.levels)));
      const kkFull = roadFull.steps.findIndex(st => gl.test(mOf(st.levels)));
      const best = roadFull.steps.length ? mOf(roadFull.steps[roadFull.steps.length - 1].levels) : base;
      return { g: gl.g, cur: gl.cur(base), target: gl.target, fmt: gl.fmt, metAt: kk, metAtFull: kkFull, month: kk >= 0 ? monthsOf(sch, kk) : null, monthFull: kkFull >= 0 ? monthsOf(schFull, kkFull) : null, bestOnPath: gl.valueOf(best), bestFull: gl.valueOf(mFull), feasibleFull: gl.test(mFull) || kkFull >= 0, okNow: gl.test(base) };
    });
    let verdict;
    const metOnPath = k >= 0, monthsK = monthsOf(sch, k), investK = k >= 0 ? road.steps[k].cumInvest : 0;
    const monthsFull = monthsOf(schFull, kFull), investFull = kFull >= 0 ? roadFull.steps[kFull].cumInvest : 0;
    if (!goals.length) verdict = { cls: 'warn', title: 'Keine Ziele aktiv', text: 'Schalten Sie in Schritt 1 mindestens ein Ziel ein. Gezeigt wird der Pfad mit dem höchsten Nettonutzen.' };
    else if (checks.some(c => !c.feasibleFull)) verdict = { cls: 'stop', title: 'Stopp: Ziele so nicht erreichbar', text: 'Auch mit vollem Ausbau aller Handlungsfelder auf Stufe 5 werden nicht alle Ziele erreicht.', items: checks.filter(c => !c.feasibleFull).map(c => c.g.name + ': bestenfalls ' + c.fmt(c.bestFull) + ' statt ' + c.fmt(c.target) + '. Ziel anpassen oder Annahmen prüfen.') };
    else if (metOnPath && (!G.horizon || monthsK <= G.horizon)) verdict = { cls: 'ok', title: 'Ziele erreichbar in ' + Math.round(monthsK) + ' Monaten', text: k + 1 + ' Schritte, ' + fmtEur(investK) + ' Investition' + (G.budgetMode === 'available' ? ' von ' + fmtEur(G.budget) + ' verfügbar' : '') + (G.horizon ? ', innerhalb des Horizonts von ' + G.horizon + ' Monaten.' : '. Die Dauer folgt aus Voraussetzungen, Wartungsfenstern und dem Umsetzungstempo; ein Zeithorizont ist nicht vorgegeben.') };
    else if (metOnPath) verdict = { cls: 'warn', title: 'Erreichbar, aber erst nach ' + Math.round(monthsK) + ' Monaten', text: 'Der Horizont von ' + G.horizon + ' Monaten reicht nicht. ' + (k + 1) + ' Schritte, ' + fmtEur(investK) + ' Investition.', items: ['Horizont auf ' + Math.ceil(monthsK / 12) * 12 + ' Monate verlängern', 'Mehr Maßnahmen gleichzeitig umsetzen (Teamkapazität oder Partner)', 'Ziele mit langer Vorlaufzeit (Stufe 5, Organisation) zurückstellen'] };
    else if (kFull >= 0) verdict = { cls: 'warn', title: 'Budget reicht nicht' + (G.horizon && monthsFull > G.horizon ? ', Horizont ebenfalls nicht' : ''), text: 'Mit ' + fmtEur(G.budget) + ' endet der Pfad vor dem Ziel. Nötig sind ' + fmtEur(investFull) + ' (' + (kFull + 1) + ' Schritte, etwa ' + Math.round(monthsFull) + ' Monate). Lücke: ' + fmtEur(Math.max(0, investFull - G.budget)) + '.' + (G.horizon && monthsFull > G.horizon ? ' Der Pfad braucht ' + Math.round(monthsFull) + ' Monate, der Horizont erlaubt ' + G.horizon + '.' : ''), items: ['Budgetantrag über die Lücke, Argumentation in Schritt 5', 'Ziele reduzieren, die der Pfad zuletzt erreicht', 'Budget auf mehrere Jahre strecken (Investition je Jahr begrenzen)'].concat(G.horizon && monthsFull > G.horizon ? ['Horizont auf ' + Math.ceil(monthsFull / 12) * 12 + ' Monate verlängern oder mehr Maßnahmen gleichzeitig umsetzen'] : []) };
    else verdict = { cls: 'stop', title: 'Stopp: Ziele auf keinem Pfad erreichbar', text: 'Der Optimierer findet keinen Pfad, auf dem alle Ziele zugleich erreicht werden. Ziele einzeln prüfen und entschärfen.', items: checks.filter(c => c.metAtFull < 0).map(c => c.g.name + ': bestenfalls ' + c.fmt(c.bestOnPath)) };
    const useFull = !metOnPath && kFull >= 0;
    const pathRoad = useFull ? roadFull : road, pathSch = useFull ? schFull : sch, pathK = useFull ? kFull : (metOnPath ? k : road.steps.length - 1);
    const endLevels = pathK >= 0 ? pathRoad.steps[pathK].levels : start;
    const haircut = haircutOf(Q);
    const reservation = Q.cls === 'ok' ? null : Q.cls === 'none' ? 'Vorbehalt: ' + Q.title + '. ' + Q.text : (Q.cls === 'bad' ? 'Vorbehalt: Fortgesetzt trotz nicht belastbarem Zwilling. ' : 'Vorbehalt: ' + Q.title + '. ') + (Q.issues.length ? Q.issues.join('; ') + '. ' : '') + 'Ersparnis im Business Case um ' + Math.round(haircut * 100) + ' % abgeschlagen, Bandbreiten der Prognose geweitet.';
    if (reservation) verdict.items = (verdict.items || []).concat([reservation]);
    state.simResult = { start, base, goals: checks, verdict, road: pathRoad, sch: pathSch, k: pathK, endLevels, months: pathK >= 0 ? monthsOf(pathSch, pathK) : 0, invest: pathK >= 0 ? pathRoad.steps[pathK].cumInvest : 0, lanes, budgetPoints, useFull, quality: Q, gated, haircut, reservation, seenCase: state.simResult ? state.simResult.seenCase : false };
    return state.simResult;
  }
  function gateHTML(Q) {
    return '<div class="verdict stop"><b>Stopp: ' + esc(Q.title) + '</b>' + esc(Q.text) + '<ul>' + Q.issues.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></div>' +
      '<div><p class="muted" style="font-size:.9rem">Die Pfadsuche ist ausgesetzt. Ein Zwilling, der die gemessene Realität um mehr als 50 % verfehlt, liefert Dauer, Investition und Ersparnis ohne Aussagekraft.</p><div class="actions" style="margin-top:8px"><button type="button" class="btn primary" data-gate="calib">Zum Digital Twin: kalibrieren oder Quellen ergänzen</button><button type="button" class="btn" data-gate="proceed">Trotzdem fortfahren (wird im Ergebnis vermerkt)</button></div></div>';
  }
  function renderSimulate() {
    const R = computeSimulation(), G = state.goals;
    $('#simTitle').textContent = 'Wie erreicht ' + (state.intake.customer || 'die IT') + ' die Ziele?';
    $('#simNextBtn').disabled = !!R.gated;
    if (R.gated) { $('#simVerdict').innerHTML = gateHTML(R.quality); $('#goalTable').innerHTML = ''; $('#simPath').innerHTML = '<li><div class="rt">Pfadsuche ausgesetzt, bis der Zwilling kalibriert oder das Fortfahren bestätigt ist.</div></li>'; $('#simChart').innerHTML = ''; return; }
    $('#simVerdict').innerHTML = '<div class="verdict ' + R.verdict.cls + '"><b>' + esc(R.verdict.title) + '</b>' + esc(R.verdict.text) + (R.verdict.items ? '<ul>' + R.verdict.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '') + '</div>' +
      '<div class="case-kpi"><div class="tile"><div class="lbl">Schritte bis zum Ziel</div><div class="val">' + (R.k + 1) + '</div></div><div class="tile"><div class="lbl">Dauer</div><div class="val">' + Math.round(R.months) + '<small>Monate</small></div></div><div class="tile"><div class="lbl">Investition</div><div class="val" style="font-size:1.05rem">' + fmtEur(R.invest) + '</div></div><div class="tile"><div class="lbl">Gleichzeitige Maßnahmen</div><div class="val">' + R.lanes + '</div></div></div>';
    $('#goalTable').innerHTML = '<thead><tr><th style="text-align:left">Ziel</th><th>Heute</th><th>Zielwert</th><th>Bester Wert auf dem Pfad</th><th>Erreicht</th><th style="text-align:left">Status</th></tr></thead><tbody>' +
      (R.goals.length ? R.goals.map(c => { const met = c.metAt >= 0 || c.okNow; const feas = c.feasibleFull; return '<tr><td style="text-align:left">' + c.g.name + '</td><td>' + c.fmt(c.cur) + '</td><td>' + c.fmt(c.target) + '</td><td>' + c.fmt(c.bestOnPath) + '</td><td>' + (c.okNow ? 'heute' : c.metAt >= 0 ? 'Schritt ' + (c.metAt + 1) + ' · Monat ' + Math.round(c.month) : (c.metAtFull >= 0 ? 'Schritt ' + (c.metAtFull + 1) + ' bei vollem Budget' : '–')) + '</td><td class="' + (met ? 'ok' : feas ? 'warn' : 'bad') + '" style="text-align:left">' + (c.okNow ? 'bereits erfüllt' : met ? 'erreicht' : feas ? 'nur mit mehr Budget' : 'nicht erreichbar') + '</td></tr>'; }).join('') : '<tr><td colspan="6" style="text-align:left">Keine Ziele aktiv.</td></tr>') + '</tbody>';
    const steps = R.road.steps.slice(0, R.k + 1);
    $('#simPath').innerHTML = steps.map((s, i) => {
      const prep = s.stepSaving <= 0; const hit = R.goals.filter(c => c.metAt === i || (R.useFull && c.metAtFull === i)).map(c => c.g.name);
      const sc = R.sch.steps[i];
      return '<li class="' + (prep ? 'prep' : (s.payback <= 12 ? 'pay' : '')) + (hit.length ? ' goal-hit' : '') + '"><span class="rn">' + (i + 1) + '</span><div class="rt">' + s.field.name + ': Stufe ' + (s.stage - 1) + ' → ' + s.stage + ' · ' + esc(s.title) + '<small>' + (prep ? 'Voraussetzung' : 'spart ' + fmtEur(s.stepSaving) + ' je Jahr') + ' · Monat ' + Math.round(sc.start) + ' bis ' + Math.round(sc.end) + ' · ' + fmtEur(s.invest) + (hit.length ? ' · erreicht: ' + esc(hit.join(', ')) : '') + '</small></div><div class="rv"><b>' + fmtEur(s.cumNet) + '</b>Nettoersparnis je Jahr<br>Investition bisher ' + fmtEur(s.cumInvest) + '</div></li>';
    }).join('') || '<li><div class="rt">Kein Schritt nötig oder möglich.</div></li>';
    $('#simChart').innerHTML = steps.length ? pathChart({ steps: R.sch.steps.slice(0, R.k + 1), totalMonths: R.months }) : '';
  }

  /* ---------- Roadmap und Business Case ---------- */
  function cashflow(R) {
    const steps = R.sch.steps.slice(0, R.k + 1), startCost = R.road.startCost;
    const H = state.goals.horizon ? Math.max(state.goals.horizon, Math.ceil(R.months) + 1, 12) : Math.max(Math.ceil((R.months + 12) / 12) * 12, 36);
    const rows = []; let cum = 0, breakEven = null;
    for (let m = 0; m < H; m++) {
      let inv = 0, opex = 0, save = 0;
      steps.forEach(s => { if (Math.floor(s.start) === m) inv += s.invest; if (m >= s.start) opex += s.opex / 12; });
      const done = steps.filter(s => s.end <= m); const costAfter = done.length ? done[done.length - 1].costAfter : startCost;
      save = (startCost - costAfter) / 12 * (1 - (R.haircut || 0));
      cum += save - inv - opex;
      if (breakEven === null && cum >= 0 && m > 0 && inv + opex + save > 0 && steps.length) breakEven = m;
      rows.push({ m, inv, opex, save, cum });
    }
    if (breakEven !== null && rows.slice(0, breakEven).every(r => r.cum >= 0)) breakEven = null;
    return { rows, breakEven, H };
  }
  function caseChart(cf) {
    const W = 960, H = 230, L = 64, R = 12, T = 14, B = 26;
    const vals = cf.rows.map(r => r.cum); const max = Math.max(1, Math.max.apply(null, vals)), min = Math.min(0, Math.min.apply(null, vals));
    const step = niceStep(max - min), top = Math.ceil(max / step) * step, bottom = Math.floor(min / step) * step;
    const iw = W - L - R, ih = H - T - B; const x = m => L + m / Math.max(1, cf.rows.length - 1) * iw; const y = v => T + ih - (v - bottom) / (top - bottom) * ih;
    const kfmt = v => Math.abs(v) >= 1e6 ? fmtNum(v / 1e6, 1) + ' M' : Math.abs(v) >= 1000 ? fmtNum(v / 1000) + ' k' : fmtNum(v);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Kumulierter Cashflow je Monat"><g class="grid">';
    for (let v = bottom; v <= top + 1e-9; v += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + kfmt(v) + '</text>';
    s += '</g>';
    const path = cf.rows.map((r, i) => (i ? 'L' : 'M') + x(r.m) + ' ' + y(r.cum)).join(' ');
    s += '<path class="area-neg" d="' + path + ' L' + x(cf.rows.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z"/>';
    s += '<path class="line-cash" d="' + path + '"/>';
    s += '<g class="axis"><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></g>';
    for (let m = 0; m < cf.rows.length; m += 12) s += '<text class="xl" x="' + x(m) + '" y="' + (H - 8) + '" text-anchor="middle">Jahr ' + (m / 12 + 1) + '</text>';
    if (cf.breakEven !== null) s += '<circle class="dot-a" cx="' + x(cf.breakEven) + '" cy="' + y(cf.rows[cf.breakEven].cum) + '" r="4"><title>Break-even in Monat ' + cf.breakEven + '</title></circle>';
    s += '</svg>';
    return s;
  }
  function renderRoadmapCase() {
    const R = state.simResult || computeSimulation(); R.seenCase = true;
    if (R.gated) { $('#rmTitle').textContent = 'Roadmap und Business Case'; $('#rmSummary').textContent = ''; $('#rmBudgetBox').innerHTML = gateHTML(R.quality); ['#caseTable', '#caseChart', '#argList', '#rmChart', '#rmList'].forEach(s => { $(s).innerHTML = ''; }); state.roadmapText = ''; updateStepper(); return; }
    const G = state.goals, steps = R.sch.steps.slice(0, R.k + 1), last = steps[steps.length - 1];
    const cf = cashflow(R);
    const years = Math.ceil(cf.H / 12);
    const yearRows = []; for (let yy = 0; yy < years; yy++) { const rs = cf.rows.slice(yy * 12, yy * 12 + 12); yearRows.push({ y: yy + 1, inv: rs.reduce((s, r) => s + r.inv, 0), opex: rs.reduce((s, r) => s + r.opex, 0), save: rs.reduce((s, r) => s + r.save, 0), cum: rs.length ? rs[rs.length - 1].cum : 0 }); }
    const investTotal = steps.reduce((s, st) => s + st.invest, 0), savingsFull = last ? last.cumNet : 0;
    const maxYear = Math.max.apply(null, yearRows.map(r => r.inv).concat([0]));
    const hz = G.horizon || cf.H; const inaction = R.road.startCost * (hz / 12);
    $('#rmTitle').textContent = 'Roadmap und Business Case' + (state.intake.customer ? ' für ' + state.intake.customer : '');
    $('#rmSummary').textContent = (R.verdict.cls === 'stop' ? 'Die Ziele sind in der gewählten Form nicht erreichbar; gezeigt wird der beste Pfad. ' : '') + steps.length + ' Schritte in etwa ' + Math.round(R.months) + ' Monaten, ' + fmtEur(investTotal) + ' Investition, danach ' + fmtEur(savingsFull) + ' Nettoersparnis je Jahr' + (cf.breakEven !== null ? ', Break-even nach ' + cf.breakEven + ' Monaten.' : '.') + ' Kosten des Nichtstuns über ' + hz + ' Monate: ' + fmtEur(inaction) + '.' + (R.haircut ? ' Ersparnis um ' + Math.round(R.haircut * 100) + ' % abgeschlagen (Unsicherheit des Zwillings ' + Math.round(R.quality.u * 100) + ' %).' : '');
    const gap = G.budgetMode === 'available' ? investTotal - G.budget : investTotal;
    $('#rmBudgetBox').innerHTML = '<div><div class="eyebrow" style="margin-bottom:6px">' + (G.budgetMode === 'available' ? 'Budgetabgleich' : 'Budgetbedarf für den Antrag') + '</div>' +
      '<div class="hero-num" style="font-size:2rem">' + fmtEur(investTotal) + '<small style="display:block;margin:4px 0 0;font-size:.8rem">Investition gesamt · höchstens ' + fmtEur(maxYear) + ' in einem Jahr' + (G.budgetMode === 'available' ? ' · verfügbar ' + fmtEur(G.budget) : '') + '</small></div></div>' +
      '<div class="case-kpi"><div class="tile"><div class="lbl">Laufende Kosten je Jahr nach Abschluss</div><div class="val" style="font-size:1rem">' + fmtEur(steps.reduce((s, st) => s + st.opex, 0)) + '</div></div><div class="tile"><div class="lbl">' + (G.budgetMode === 'available' ? (gap > 0 ? 'Lücke zum verfügbaren Budget' : 'Reserve im verfügbaren Budget') : 'Amortisation') + '</div><div class="val" style="font-size:1rem">' + (G.budgetMode === 'available' ? fmtEur(Math.abs(gap)) : (last ? fmtMonths(last.payback) : '–')) + '</div></div></div>';
    $('#caseTable').innerHTML = '<thead><tr><th>Jahr</th><th>Investition</th><th>Laufende Kosten</th><th>Ersparnis</th><th>Netto</th><th>Kumuliert</th></tr></thead><tbody>' + yearRows.map(r => '<tr><td>Jahr ' + r.y + '</td><td>' + fmtEur(r.inv) + '</td><td>' + fmtEur(r.opex) + '</td><td>' + fmtEur(r.save) + '</td><td class="' + (r.save - r.inv - r.opex >= 0 ? 'ok' : 'bad') + '">' + fmtEur(r.save - r.inv - r.opex) + '</td><td class="' + (r.cum >= 0 ? 'ok' : '') + '">' + fmtEur(r.cum) + '</td></tr>').join('') + '</tbody>';
    $('#caseChart').innerHTML = caseChart(cf);
    const args = [];
    const prevGain = metricsOf(R.endLevels).prevented - R.base.prevented;
    args.push({ t: 'Wirtschaftlichkeit', s: 'Nach Abschluss sinken die jährlichen Kosten um ' + fmtEur(savingsFull) + ' netto, von ' + fmtEur(R.road.startCost) + ' auf ' + fmtEur(last ? last.costAfter : R.road.startCost) + '. ' + (cf.breakEven !== null ? 'Die Investition ist nach ' + cf.breakEven + ' Monaten zurückverdient.' : 'Die Amortisation liegt außerhalb des Horizonts.') });
    args.push({ t: 'Kosten des Nichtstuns', s: 'Ohne Veränderung kostet der heutige Betrieb über ' + hz + ' Monate ' + fmtEur(inaction) + ' an IT-Aufwand, Ausfallzeit' + (state.ot ? ', Produktionsstillstand' : '') + ' und Ticketbearbeitung.' });
    const qw = steps.find(s => s.payback <= 12 && s.stepSaving > 0); if (qw) args.push({ t: 'Schnell sichtbar', s: 'Schritt ' + (steps.indexOf(qw) + 1) + ' (' + qw.field.name + ' auf Stufe ' + qw.stage + ') zahlt sich innerhalb eines Jahres aus und finanziert die weiteren Schritte mit.' });
    if (prevGain > 0) args.push({ t: 'Risiko und Resilienz', s: 'Jährlich ' + fmtNum(Math.round(prevGain)) + ' Vorfälle mehr werden verhindert oder ohne menschlichen Eingriff gelöst, darunter Sicherheitsvorfälle und Ausfälle, die heute Stunden kosten.' });
    const okGoals = R.goals.filter(c => c.metAt >= 0 || c.okNow || (R.useFull && c.metAtFull >= 0)); if (okGoals.length) args.push({ t: 'Strategische Ziele', s: okGoals.map(c => c.g.name.replace(' um', '').replace(' mindestens', '').replace(' höchstens', '') + ' (' + c.fmt(c.target) + ')').join(', ') + ' werden erreicht, in etwa ' + Math.round(R.months) + ' Monaten.' });
    args.push({ t: 'Planbarkeit', s: 'Die Investition verteilt sich auf ' + years + ' Jahre mit höchstens ' + fmtEur(maxYear) + ' in einem Jahr, mit ' + (R.lanes === 1 ? 'einer Maßnahme nach der anderen' : R.lanes + ' Maßnahmen gleichzeitig') + ' (' + fmtNum(capacity().fte) + ' IT-Mitarbeiter, ' + Math.round(state.goals.cap.share * 100) + ' % Zeit für Veränderung' + (state.goals.cap.partners ? ', ' + state.goals.cap.partners + ' Partnerteam' + (state.goals.cap.partners > 1 ? 's' : '') : '') + '). Jeder Schritt hat ein Erfolgskriterium und lässt sich einzeln beauftragen.' });
    if (R.reservation) args.push({ t: 'Vorbehalt', s: R.reservation });
    if (G.budgetMode !== 'available') args.push({ t: 'Budgetantrag', s: 'Beantragt werden ' + fmtEur(investTotal) + ' einmalig und ' + fmtEur(steps.reduce((s, st) => s + st.opex, 0)) + ' je Jahr laufend. Gegenwert: ' + fmtEur(savingsFull) + ' je Jahr ab Abschluss, kumuliert ' + fmtEur(cf.rows[cf.rows.length - 1].cum) + ' nach ' + cf.H + ' Monaten.' });
    $('#argH').textContent = G.budgetMode === 'available' ? 'Warum es sich lohnt' : 'Warum es sich lohnt: Argumentation für den Budgetantrag';
    $('#argList').innerHTML = args.map(x => '<li><span class="pv-body"><span class="pv-title">' + esc(x.t) + '</span><span class="pv-sub">' + esc(x.s) + '</span></span></li>').join('');
    $('#rmChart').innerHTML = steps.length ? pathChart({ steps, totalMonths: R.months }) : '';
    $('#rmList').innerHTML = R.road.steps.slice(0, R.k + 1).map((s, i) => { const prep = s.stepSaving <= 0; const sc = R.sch.steps[i]; return '<li class="' + (prep ? 'prep' : (s.payback <= 12 ? 'pay' : '')) + '"><span class="rn">' + (i + 1) + '</span><div class="rt">' + s.field.name + ': Stufe ' + (s.stage - 1) + ' → ' + s.stage + ' · ' + esc(s.title) + '<small>Monat ' + Math.round(sc.start) + ' bis ' + Math.round(sc.end) + ' · ' + fmtEur(s.invest) + ' · ' + (prep ? 'Voraussetzung' : 'spart ' + fmtEur(s.stepSaving) + ' je Jahr') + ' · Erfolgskriterium: ' + esc((TRANSITIONS[s.stage - 2] || {}).success || '') + '</small></div><div class="rv"><b>' + fmtEur(s.cumInvest) + '</b>Investition bisher</div></li>'; }).join('');
    state.roadmapText = buildSummaryText(R, cf, yearRows, args);
    updateStepper();
  }
  function buildSummaryText(R, cf, yearRows, args) {
    const G = state.goals, steps = R.sch.steps.slice(0, R.k + 1);
    let t = 'Zero-Touch IT Simulator – Management-Zusammenfassung' + (state.intake.customer ? ' für ' + state.intake.customer : '') + '\n\n';
    t += 'Ziele (' + (G.horizon ? G.horizon + ' Monate' : 'ohne Zeitvorgabe') + '): ' + R.goals.map(c => c.g.name + ' ' + c.fmt(c.target)).join('; ') + '\n';
    t += 'Ergebnis: ' + R.verdict.title + '. ' + R.verdict.text + '\n';
    t += 'Zwilling: ' + R.quality.title + ' (Unsicherheit ' + Math.round(R.quality.u * 100) + ' %' + (R.haircut ? ', Ersparnis um ' + Math.round(R.haircut * 100) + ' % abgeschlagen' : '') + ').' + (R.reservation ? ' ' + R.reservation : '') + '\n\n';
    t += 'Roadmap (' + steps.length + ' Schritte, etwa ' + Math.round(R.months) + ' Monate):\n';
    steps.forEach((s, i) => { t += '  ' + (i + 1) + '. ' + s.field.name + ' auf Stufe ' + s.stage + ' (' + s.title + '), Monat ' + Math.round(s.start) + ' bis ' + Math.round(s.end) + ', ' + fmtEur(s.invest) + '\n'; });
    t += '\nBusiness Case je Jahr:\n';
    yearRows.forEach(r => { t += '  Jahr ' + r.y + ': Investition ' + fmtEur(r.inv) + ', laufend ' + fmtEur(r.opex) + ', Ersparnis ' + fmtEur(r.save) + ', kumuliert ' + fmtEur(r.cum) + '\n'; });
    t += '\nArgumente:\n'; args.forEach(a => { t += '  - ' + a.t + ': ' + a.s + '\n'; });
    t += '\nAlle Werte sind Modellannahmen aus dem Digital Twin, keine Zusagen.\n';
    return t;
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
        if (s === 'run') { if (state.screen === 'run' && !state.ended) return; if (state.screen === 'run' && state.ended && !state.twinRun) { showScreen('result'); return; } startRun(); endHandled = false; return; }
        if (s === 'result' && !state.evaluated) return;
        showScreen(s); return;
      }
      const gt = t.closest('[data-gate]'); if (gt) { if (gt.dataset.gate === 'calib') { showScreen('istbild'); } else { const Q = state.twinQuality || twinQuality(); state.twinAck = Q.stamp; store.set('zt.twinAck', Q.stamp); state.simResult = null; if (state.screen === 'roadmap') renderRoadmapCase(); else renderSimulate(); toast('Fortgesetzt trotz nicht belastbarem Zwilling. Der Vorbehalt steht im Urteil und in der Zusammenfassung.'); } return; }
      const ln = t.closest('[data-lanes]'); if (ln) { state.goals.lanes = parseInt(ln.dataset.lanes, 10); saveGoals(); state.simResult = null; renderGoals(); return; }
      const gl = t.closest('[data-goal-level]'); if (gl) { state.goals.items.level.v = parseInt(gl.dataset.goalLevel, 10); state.goals.touched = true; saveGoals(); state.simResult = null; renderGoals(); return; }
      const gls = t.closest('[data-goal-levels]'); if (gls) { state.levelView = parseInt(gls.dataset.goalLevels, 10); showView('levels'); return; }
      const cs = t.closest('[data-capshare]'); if (cs) { state.goals.cap.share = parseFloat(cs.dataset.capshare); saveGoals(); state.simResult = null; renderGoals(); return; }
      const cp = t.closest('[data-cappartners]'); if (cp) { state.goals.cap.partners = parseInt(cp.dataset.cappartners, 10); saveGoals(); state.simResult = null; renderGoals(); return; }
      const hz = t.closest('[data-horizon]'); if (hz) { state.goals.horizon = parseInt(hz.dataset.horizon, 10); state.goals.touched = true; saveGoals(); state.simResult = null; renderGoals(); return; }
      const bm = t.closest('[data-bmode]'); if (bm) { state.goals.budgetMode = bm.dataset.bmode; state.goals.touched = true; saveGoals(); state.simResult = null; renderGoals(); return; }
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
    $('#startBtn').addEventListener('click', () => showScreen('goals'));
    $$('.otToggle').forEach(c => c.addEventListener('change', e => setOt(e.target.checked)));
    $('#startPlanBtn').addEventListener('click', () => showScreen('intake'));
    $('#goalsNextBtn').addEventListener('click', () => { state.goals.touched = true; saveGoals(); showScreen('intake'); });
    $('#simRunBtn').addEventListener('click', () => { const R = state.simResult || computeSimulation(); adoptLevels(R.endLevels); endHandled = false; startRun(); });
    $('#simTodayBtn').addEventListener('click', () => { const R = state.simResult || computeSimulation(); endHandled = false; startRun({ levels: R.start }); });
    $('#simPlanBtn').addEventListener('click', () => { const R = state.simResult || computeSimulation(); adoptLevels(R.endLevels); showScreen('plan'); });
    $('#simNextBtn').addEventListener('click', () => showScreen('roadmap'));
    $('#rmDetailsBtn').addEventListener('click', () => showScreen('analysis'));
    $('#rmAdoptBtn').addEventListener('click', () => { const R = state.simResult || computeSimulation(); adoptLevels(R.endLevels); showScreen('plan'); toast('Zielkonfiguration in die Planung übernommen.'); });
    $('#rmCopyBtn').addEventListener('click', () => { const txt = state.roadmapText || ''; window.__lastSummary = txt; const ok = () => toast('Zusammenfassung in die Zwischenablage kopiert.'); if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, () => toast('Kopieren nicht möglich.')); else toast('Kopieren nicht möglich.'); });
    document.addEventListener('input', e => {
      const gv = e.target.dataset && e.target.dataset.goalV; if (gv) { const v = parseFloat(e.target.value); if (!isNaN(v)) { state.goals.items[gv].v = v; state.goals.touched = true; saveGoals(); state.simResult = null; } return; }
      if (e.target.id === 'goalBudget') { state.goals.budget = Math.max(0, parseFloat(e.target.value) || 0); state.goals.touched = true; saveGoals(); state.simResult = null; renderGoalsSummary(); }
      if (e.target.id === 'goalPerYear') { state.goals.perYear = Math.max(0, parseFloat(e.target.value) || 0); saveGoals(); state.simResult = null; }
    });
    $('#lanesManualOn').addEventListener('change', e => { state.goals.lanes = e.target.checked ? capacity().derived : 0; saveGoals(); state.simResult = null; renderGoals(); });
    $('#capFte').addEventListener('change', e => { state.goals.cap.fte = Math.max(0, parseInt(e.target.value, 10) || 0); saveGoals(); state.simResult = null; renderGoals(); });
    $('#perYearOn').addEventListener('change', e => { state.goals.perYear = e.target.checked ? (state.goals.perYear > 0 ? state.goals.perYear : Math.max(50000, Math.round((state.goals.budgetMode === 'available' ? state.goals.budget : 300000) / 3 / 10000) * 10000)) : 0; saveGoals(); state.simResult = null; renderGoals(); });
    document.addEventListener('change', e => { const go = e.target.dataset && e.target.dataset.goalOn; if (go) { state.goals.items[go].on = e.target.checked; state.goals.touched = true; saveGoals(); state.simResult = null; renderGoals(); } });
    bindIntake();
    $('#resetAllBtn').addEventListener('click', async () => { if (await ask('Planung, Durchläufe, Auswertung, Standortbestimmung und Annahmen werden gelöscht. Die Simulation beginnt von vorn. Fortfahren?')) resetAll(); });
    $('#analysisBtn').addEventListener('click', () => showScreen('analysis'));
    $('#resultAnalysisBtn').addEventListener('click', () => { endHandled = true; showScreen('analysis'); });
    $('#analysisBack').addEventListener('click', () => showScreen('roadmap'));
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
      endHandled = true; if (state.twinRun) { state.twinRun = false; $('#modeChip').hidden = true; showScreen('istbild'); } else showScreen('plan');
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
    window.Analysis.setCalibration(state.calib && state.calib.on ? state.calib.f : null);
    let ok = false;
    if (window.THREE) { try { window.Scene3D.init($('#c3d')); ok = true; } catch (e) { console.error(e); } }
    if (!ok) { $('#webglWarn').hidden = false; const noop = () => {}; window.Scene3D = new Proxy({}, { get: () => noop }); }
    bind();
    ['levels', 'base'].forEach(k => { if (state.ot && state[k].ot === undefined) state[k].ot = 1; });
    if (state.ot && state.assessment.ot === undefined) state.assessment.ot = 2;
    $$('.otToggle').forEach(c => { c.checked = state.ot; });
    window.Scene3D.setOt(state.ot);
    $('#playBtn').innerHTML = ICON.pause + 'Pause';
    $('#varyBtn').checked = !!state.vary;
    $('#stage').hidden = false;
    renderPlan();
    applyRoute();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
