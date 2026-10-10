/* =========================================================================
   Zero-Touch IT Simulator – Anwendungslogik
   Erwartet die Inhalte aus data.js (LEVELS, FIELDS, TRANSITIONS, EVENTS …).
   ========================================================================= */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const MS_PER_MIN = 200;            // Echtzeit-Millisekunden je simulierter Minute bei 1×
  const VIEWS = { sim: 'simulation', levels: 'reifegrade', path: 'weg' };

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kein Speicher verfügbar */ } }
  };

  const state = {
    level: 2,
    view: 'sim',
    speed: 1,
    playing: true,
    ended: false,
    sim: DAY_START,
    day: null,
    target: store.get('zt.target', 5),
    assessment: store.get('zt.assessment', null),
    assessed: store.get('zt.assessed', false)
  };
  if (!state.assessment) {
    state.assessment = {};
    FIELDS.forEach(f => { state.assessment[f.id] = 2; });
  }

  /* ---------- Formatierung ---------- */
  const pad = n => String(n).padStart(2, '0');
  const fmtTime = min => pad(Math.floor(min / 60) % 24) + ':' + pad(Math.floor(min % 60));
  const fmtNum = (n, d) => n.toLocaleString('de-DE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  const fmtHours = min => min < 60 ? fmtNum(min) + ' Min' : fmtNum(min / 60, min % 60 === 0 ? 0 : 1) + ' h';
  const fmtHoursShort = min => fmtNum(min / 60, min / 60 < 10 && min % 60 !== 0 ? 1 : 0);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Totale je Stufe (für Diagramme, Vergleich, Index) ---------- */
  function totals(levelIdx) {
    const t = { it: 0, user: 0, touches: 0, tickets: 0, prevented: 0, auto: 0, steps: { human: 0, auto: 0, agent: 0 } };
    EVENTS.forEach(e => {
      const v = e.v[levelIdx];
      t.it += v.it; t.user += v.user; t.touches += v.touches;
      if (v.ticket) t.tickets++;
      if (v.prevented) t.prevented++;
      else if (v.touches === 0) t.auto++;
      v.steps.forEach(s => {
        if (s.a === 'sd' || s.a === 'tech' || s.a === 'mgr') t.steps.human++;
        else if (s.a === 'sys') t.steps.auto++;
        else if (s.a === 'ai') t.steps.agent++;
      });
    });
    return t;
  }
  const TOTALS = [0, 1, 2, 3, 4].map(totals);
  const BASE = TOTALS[0];

  function experienceIndex(user, tickets, touches) {
    const v = 100 - 50 * Math.min(1, user / BASE.user) - 25 * Math.min(1, tickets / BASE.tickets) - 15 * Math.min(1, touches / BASE.touches);
    return Math.max(0, Math.round(v));
  }

  /* ---------- Simulationstag aufbauen ---------- */
  function buildDay(level) {
    const items = EVENTS.map(def => {
      const v = def.v[level - 1];
      const start = (def.startByLevel && def.startByLevel[level]) || def.start;
      let acc = start;
      const steps = v.steps.map(s => { const at = acc; acc += s.d; return Object.assign({}, s, { at }); });
      return { def, v, start, steps, endAt: acc, shown: 0, started: false, finished: false, el: null };
    });
    items.sort((a, b) => a.start - b.start);
    return items;
  }

  function resetDay(keepPlaying) {
    state.day = buildDay(state.level);
    state.sim = DAY_START;
    state.ended = false;
    state.playing = keepPlaying !== false;
    $('#feed').innerHTML = '';
    $('#banner').innerHTML = '';
    renderDayline();
    update(true);
  }

  /* ---------- Rendering: Ereigniskarten ---------- */
  function actorChip(a) {
    const act = ACTORS[a];
    return '<span class="who ' + act.cls + '">' + act.label + '</span>';
  }

  function createCard(inst) {
    const card = document.createElement('article');
    card.className = 'card';
    const field = FIELDS.find(f => f.id === inst.def.field);
    card.innerHTML =
      '<div class="card-head">' +
        '<div class="time">' + fmtTime(inst.start) + '</div>' +
        '<div><h3>' + esc(inst.v.title) + '</h3><div class="sub">' + esc(inst.def.title) + ' · ' + esc(field.name) + '</div></div>' +
        '<span class="status open">in Arbeit</span>' +
      '</div>' +
      '<ol class="steps"></ol>' +
      '<div class="card-foot">' +
        '<span class="m">IT-Aufwand <b>' + fmtHours(inst.v.it) + '</b></span>' +
        '<span class="m">Ausfall Mitarbeiter <b>' + fmtHours(inst.v.user) + '</b></span>' +
        '<span class="m">Eingriffe <b>' + inst.v.touches + '</b></span>' +
        '<span class="m">' + (inst.v.ticket ? 'Ticket <b>ja</b>' : 'Ticket <b>nein</b>') + '</span>' +
        (inst.v.risk ? '<span class="risk">Risiko: ' + esc(inst.v.risk) + '</span>' : '') +
        '<button class="cmp" type="button">Alle Stufen vergleichen</button>' +
      '</div>' +
      '<div class="compare" hidden></div>';
    inst.el = card;
    inst.stepsEl = $('.steps', card);
    inst.statusEl = $('.status', card);
    $('.cmp', card).addEventListener('click', () => toggleCompare(inst));
    return card;
  }

  function toggleCompare(inst) {
    const box = $('.compare', inst.el);
    const btn = $('.cmp', inst.el);
    if (!box.hidden) { box.hidden = true; btn.textContent = 'Alle Stufen vergleichen'; return; }
    let html = '<table><thead><tr><th>Stufe</th><th>IT-Aufwand</th><th>Ausfall</th><th>Eingriffe</th><th>Ticket</th><th>Ergebnis</th></tr></thead><tbody>';
    inst.def.v.forEach((v, i) => {
      const dur = v.steps.reduce((s, x) => s + x.d, 0);
      const res = v.prevented ? 'verhindert' : (v.touches === 0 ? 'autonom gelöst' : 'gelöst nach ' + fmtHours(dur));
      html += '<tr class="' + (i + 1 === state.level ? 'cur' : '') + '"><td>' + (i + 1) + ' · ' + LEVELS[i].name + '</td><td>' + fmtHours(v.it) + '</td><td>' + fmtHours(v.user) + '</td><td>' + v.touches + '</td><td>' + (v.ticket ? 'ja' : 'nein') + '</td><td>' + res + '</td></tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;
    box.hidden = false;
    btn.textContent = 'Vergleich ausblenden';
  }

  function appendStep(inst, step) {
    const li = document.createElement('li');
    li.className = 'step';
    li.innerHTML = '<div class="t">' + fmtTime(step.at) + '</div><div class="rail"><i class="' + ACTORS[step.a].cls + '"></i></div>' +
      '<div class="body">' + actorChip(step.a) + '<span class="text">' + esc(step.t) + '</span></div>';
    inst.stepsEl.appendChild(li);
  }

  function ensurePending(inst) {
    if (!inst.pendingEl) {
      const li = document.createElement('li');
      li.className = 'step pending';
      li.innerHTML = '<div class="t"></div><div class="rail"><i></i></div><div class="body"><span class="text"></span></div>';
      inst.pendingEl = li;
    }
    if (inst.pendingEl.parentNode !== inst.stepsEl || inst.stepsEl.lastChild !== inst.pendingEl) inst.stepsEl.appendChild(inst.pendingEl);
    const last = inst.steps[inst.shown - 1];
    const waited = Math.max(0, Math.floor(state.sim - last.at));
    const label = last.w || 'wartet …';
    $('.text', inst.pendingEl).textContent = label + (waited >= 1 ? ' (seit ' + fmtHours(waited) + ')' : '');
    $('.t', inst.pendingEl).textContent = fmtTime(state.sim);
  }

  function finishCard(inst) {
    if (inst.pendingEl && inst.pendingEl.parentNode) inst.pendingEl.remove();
    const dur = inst.endAt - inst.start;
    if (inst.v.prevented) { inst.statusEl.className = 'status prevented'; inst.statusEl.textContent = 'verhindert'; }
    else if (inst.v.touches === 0) { inst.statusEl.className = 'status done'; inst.statusEl.textContent = 'autonom gelöst · ' + fmtHours(dur); }
    else { inst.statusEl.className = 'status done'; inst.statusEl.textContent = 'gelöst · ' + fmtHours(dur); }
  }

  /* ---------- Tick & Update ---------- */
  let lastTs = null;
  function loop(ts) {
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(200, ts - lastTs);
    lastTs = ts;
    if (state.playing && !state.ended) {
      state.sim += dt * state.speed / MS_PER_MIN;
      if (state.sim >= DAY_END) { state.sim = DAY_END; state.ended = true; state.playing = false; }
      update();
    }
    requestAnimationFrame(loop);
  }

  function update(force) {
    const feed = $('#feed');
    state.day.forEach(inst => {
      if (!inst.started && state.sim >= inst.start) {
        inst.started = true;
        feed.prepend(createCard(inst));
      }
      if (!inst.started) return;
      while (inst.shown < inst.steps.length && inst.steps[inst.shown].at <= state.sim) {
        appendStep(inst, inst.steps[inst.shown]);
        inst.shown++;
      }
      if (inst.shown === inst.steps.length) {
        if (!inst.finished) { inst.finished = true; finishCard(inst); }
      } else {
        ensurePending(inst);
        if (state.ended) { inst.statusEl.className = 'status night'; inst.statusEl.textContent = 'offen über Nacht'; }
      }
    });
    if (!state.day.some(i => i.started)) {
      if (!$('.empty-feed', feed)) feed.innerHTML = '<div class="empty-feed">Der Tag beginnt um 07:00. Das erste Ereignis folgt in Kürze.</div>';
    } else {
      const e = $('.empty-feed', feed); if (e) e.remove();
    }
    renderClock();
    renderKpis();
    if (state.ended) renderBanner();
  }

  function renderClock() {
    $('#clock').textContent = fmtTime(state.sim);
    $('#clockState').textContent = state.ended ? 'Feierabend' : (state.playing ? 'Simulation läuft' : 'Pause');
    const pct = (state.sim - DAY_START) / (DAY_END - DAY_START) * 100;
    $('#dayfill').style.width = pct + '%';
    $$('#dayline .tick').forEach((t, i) => {
      const inst = state.day[i];
      t.className = 'tick' + (inst.finished ? ' done' : (inst.started ? ' open' : ''));
    });
    const pb = $('#playBtn');
    pb.innerHTML = state.playing ? ICON.pause + 'Pause' : ICON.play + (state.ended ? 'Tag wiederholen' : 'Weiter');
  }

  function renderDayline() {
    const dl = $('#dayline');
    const span = DAY_END - DAY_START;
    let html = '<div class="track"></div><div class="fill" id="dayfill"></div>';
    state.day.forEach(inst => {
      const x = (inst.start - DAY_START) / span * 100;
      html += '<div class="tick" style="left:' + x + '%" title="' + esc(fmtTime(inst.start) + ' ' + inst.def.title) + '"></div>';
    });
    for (let h = 7; h <= 19; h += 2) {
      const x = (h * 60 - DAY_START) / span * 100;
      html += '<div class="hour" style="left:' + x + '%">' + pad(h) + '</div>';
    }
    dl.innerHTML = html;
  }

  function renderKpis() {
    const started = state.day.filter(i => i.started);
    const open = started.filter(i => !i.finished).length;
    const it = started.reduce((s, i) => s + i.v.it, 0);
    const user = started.reduce((s, i) => s + i.v.user, 0);
    const touches = started.reduce((s, i) => s + i.v.touches, 0);
    const tickets = started.filter(i => i.v.ticket).length;
    const prevented = started.filter(i => i.finished && i.v.prevented).length;
    const autoDone = started.filter(i => i.finished && !i.v.prevented && i.v.touches === 0).length;
    const tiles = [
      { l: 'Offene Fälle', v: open, cls: open > 2 ? 'hl' : '' },
      { l: 'Tickets heute', v: tickets, cls: tickets > 3 ? 'hl' : '' },
      { l: 'Verhindert oder autonom gelöst', v: prevented + autoDone, cls: prevented + autoDone > 0 ? 'ok' : '' },
      { l: 'IT-Aufwand durch heutige Fälle', v: fmtHoursShort(it), u: 'h', cls: it > 240 ? 'hl' : '' },
      { l: 'Ausfallzeit Mitarbeiter', v: fmtHoursShort(user), u: 'h', cls: user > 240 ? 'hl' : '' },
      { l: 'Manuelle Eingriffe der IT', v: touches, cls: touches > 10 ? 'hl' : '' }
    ];
    $('#tiles').innerHTML = tiles.map(t => '<div class="tile ' + t.cls + '"><div class="lbl">' + t.l + '</div><div class="val">' + t.v + (t.u ? '<small>' + t.u + '</small>' : '') + '</div></div>').join('');
    const xi = experienceIndex(user, tickets, touches);
    $('#xla').textContent = xi;
    $('#xlaBar').style.width = xi + '%';
    $('#xlaBar').style.background = xi >= 80 ? 'var(--agent)' : (xi >= 50 ? 'var(--accent)' : 'var(--human)');
  }

  function renderBanner() {
    const done = state.day.filter(i => i.finished && !i.v.prevented).length;
    const prevented = state.day.filter(i => i.finished && i.v.prevented).length;
    const open = state.day.filter(i => !i.finished).length;
    let txt = '<b>Feierabend auf Stufe ' + state.level + ' · ' + LEVELS[state.level - 1].name + '.</b> ' + done + ' Fälle gelöst, ' + prevented + ' verhindert, ' + open + (open === 1 ? ' Fall bleibt' : ' Fälle bleiben') + ' über Nacht offen.';
    let btns = '';
    if (state.level < 5) btns += '<button class="btn primary" data-next>Stufe ' + (state.level + 1) + ' erleben</button>';
    if (state.level > 1) btns += '<button class="btn" data-prev>Zurück zu Stufe ' + (state.level - 1) + '</button>';
    $('#banner').innerHTML = '<div class="banner" style="margin-bottom:12px"><span style="flex:1;min-width:200px">' + txt + '</span>' + btns + '</div>';
    const n = $('[data-next]', $('#banner')); if (n) n.onclick = () => setLevel(state.level + 1);
    const p = $('[data-prev]', $('#banner')); if (p) p.onclick = () => setLevel(state.level - 1);
  }

  function renderQuotes() {
    const q = PERSPECTIVES[state.level];
    $('#quotes').innerHTML = ['ma', 'it', 'mgmt'].map(k => '<div class="quote"><div class="who">' + PERSPECTIVE_LABELS[k] + '</div><p>„' + esc(q[k]) + '“</p></div>').join('');
  }

  /* ---------- Reifegrad-Wahl ---------- */
  function renderLevelBar() {
    $('#levelSeg').innerHTML = LEVELS.map(l => '<button type="button" data-level="' + l.n + '" aria-pressed="' + (l.n === state.level) + '"><span class="n">' + l.n + '</span><span class="lbl">' + l.name + '</span></button>').join('');
    const l = LEVELS[state.level - 1];
    $('#levelDesc').innerHTML = '<h2>Stufe ' + l.n + ' · ' + l.name + ' <span class="muted" style="font-weight:400">· ' + l.tagline + '</span></h2><p>' + esc(l.desc) + '</p>';
  }

  function setLevel(n, opts) {
    n = Math.max(1, Math.min(5, n));
    const changed = n !== state.level;
    state.level = n;
    renderLevelBar();
    renderQuotes();
    renderLevelsView();
    renderMatrix();
    if (changed || (opts && opts.restart)) resetDay(true);
    if (opts && opts.view) showView(opts.view);
  }

  /* ---------- Ansicht Reifegrade ---------- */
  function niceStep(max) {
    const raw = max / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const c = raw / p;
    const step = (c <= 1 ? 1 : c <= 2 ? 2 : c <= 5 ? 5 : 10) * p;
    return step;
  }

  function barChart(values, opts) {
    const W = 260, H = 150, L = 34, R = 8, Tm = 16, B = 24;
    const max = Math.max.apply(null, values.concat([1]));
    const step = niceStep(max);
    const top = Math.ceil(max / step) * step || step;
    const iw = W - L - R, ih = H - Tm - B;
    const y = v => Tm + ih - v / top * ih;
    const band = iw / values.length;
    const bw = Math.min(24, band * 0.6);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(opts.label) + '">';
    s += '<g class="grid">';
    for (let v = 0; v <= top + 1e-9; v += step) {
      s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text x="' + (L - 6) + '" y="' + (y(v) + 3) + '" text-anchor="end">' + fmtNum(v) + '</text>';
    }
    s += '</g>';
    values.forEach((v, i) => {
      const cx = L + band * i + band / 2;
      const x0 = cx - bw / 2, y0 = y(v), h = Math.max(0, y(0) - y0);
      const r = Math.min(4, h);
      const cur = i + 1 === state.level;
      const path = h > 0
        ? 'M' + x0 + ' ' + y(0) + ' V' + (y0 + r) + ' Q' + x0 + ' ' + y0 + ' ' + (x0 + r) + ' ' + y0 + ' H' + (x0 + bw - r) + ' Q' + (x0 + bw) + ' ' + y0 + ' ' + (x0 + bw) + ' ' + (y0 + r) + ' V' + y(0) + ' Z'
        : 'M' + x0 + ' ' + y(0) + ' h' + bw + ' v1 h-' + bw + ' Z';
      s += '<path class="bar' + (cur ? ' cur' : '') + '" d="' + path + '"/>';
      if (cur) s += '<text class="vlabel" x="' + cx + '" y="' + (y0 - 5) + '" text-anchor="middle">' + opts.fmt(v) + '</text>';
      s += '<text class="xl' + (cur ? ' cur' : '') + '" x="' + cx + '" y="' + (H - 8) + '" text-anchor="middle">' + (i + 1) + '</text>';
      s += '<rect class="bar hit" x="' + (L + band * i) + '" y="' + Tm + '" width="' + band + '" height="' + ih + '" data-tip="' + esc('Stufe ' + (i + 1) + ' · ' + LEVELS[i].name + ': ' + opts.fmt(v) + ' ' + opts.unit) + '"/>';
    });
    s += '<g class="axis"><line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(0) + '" y2="' + y(0) + '"/></g>';
    s += '</svg>';
    return s;
  }

  function renderLevelsView() {
    $('#ladder').innerHTML = LEVELS.map(l => '<button type="button" data-level="' + l.n + '" aria-pressed="' + (l.n === state.level) + '" class="' + (l.n < state.level ? 'reached' : '') + '"><span class="n">Stufe ' + l.n + '</span><span class="name">' + l.name + '</span><span class="tag">' + l.tagline + '</span></button>').join('');
    const l = LEVELS[state.level - 1];
    const q = PERSPECTIVES[state.level];
    $('#levelDetail').innerHTML =
      '<div class="eyebrow">Stufe ' + l.n + '</div><h2 style="margin:4px 0 8px">' + l.name + ' · ' + l.tagline + '</h2>' +
      '<p class="muted">' + esc(l.desc) + '</p>' +
      '<p style="margin-top:10px"><b>Rollenverteilung:</b> ' + esc(l.role) + '</p>' +
      '<div class="kpis">' + Object.keys(KPI_LABELS).map(k => '<div class="tile"><div class="lbl">' + KPI_LABELS[k] + '</div><div class="val">' + l.kpi[k] + '</div></div>').join('') + '</div>' +
      '<p class="note" style="margin-top:8px">Typische Richtwerte zur Orientierung, keine Benchmarks.</p>' +
      '<h3 style="margin-top:18px">So fühlt sich diese Stufe an</h3><div class="quotes" style="margin-top:8px">' +
      ['ma', 'it', 'mgmt'].map(k => '<div class="quote"><div class="who">' + PERSPECTIVE_LABELS[k] + '</div><p>„' + esc(q[k]) + '“</p></div>').join('') + '</div>' +
      '<div class="actions"><button class="btn primary" type="button" data-goto-sim>Diesen Tag erleben</button></div>';
    $('[data-goto-sim]').onclick = () => { showView('sim'); resetDay(true); };

    const series = [
      { k: 'it', cap: 'IT-Aufwand in Stunden', fmt: v => fmtNum(v / 60, v / 60 < 10 ? 1 : 0), unit: 'h' },
      { k: 'user', cap: 'Ausfallzeit der Mitarbeiter in Stunden', fmt: v => fmtNum(v / 60, v / 60 < 10 ? 1 : 0), unit: 'h' },
      { k: 'tickets', cap: 'Tickets', fmt: v => fmtNum(v), unit: 'Tickets' }
    ];
    $('#multiples').innerHTML = series.map(sr => {
      const vals = TOTALS.map(t => sr.k === 'tickets' ? t[sr.k] : t[sr.k] / 60);
      const fmt = sr.k === 'tickets' ? (v => fmtNum(v)) : (v => fmtNum(v, v < 10 ? 1 : 0));
      return '<figure><figcaption>' + sr.cap + '</figcaption>' + barChart(vals, { label: sr.cap + ' je Reifegrad', fmt, unit: sr.unit }) + '</figure>';
    }).join('');

    $('#stack').innerHTML = TOTALS.map((t, i) => {
      const n = t.steps.human + t.steps.auto + t.steps.agent || 1;
      const p = k => Math.round(t.steps[k] / n * 100);
      const tip = 'Stufe ' + (i + 1) + ': Mensch ' + p('human') + ' %, Automatisierung ' + p('auto') + ' %, KI-Agent ' + p('agent') + ' %';
      return '<div class="stack-row"><div class="lbl">Stufe ' + (i + 1) + '</div>' +
        '<div class="bar" data-tip="' + esc(tip) + '">' +
        (t.steps.human ? '<i class="human" style="flex:' + t.steps.human + '"></i>' : '') +
        (t.steps.auto ? '<i class="auto" style="flex:' + t.steps.auto + '"></i>' : '') +
        (t.steps.agent ? '<i class="agent" style="flex:' + t.steps.agent + '"></i>' : '') +
        '</div><div class="val">' + p('human') + ' % Mensch</div></div>';
    }).join('');
  }

  /* ---------- Ansicht Ihr Weg ---------- */
  function avgLevel() {
    const vals = FIELDS.map(f => state.assessment[f.id] || 1);
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function minLevel() { return Math.min.apply(null, FIELDS.map(f => state.assessment[f.id] || 1)); }

  function renderMatrix() {
    const tgt = state.target;
    let html = '<thead><tr><th>Handlungsfeld</th>' + LEVELS.map(l => '<th class="lv' + (l.n === state.level ? ' cur' : '') + '">Stufe ' + l.n + ' · ' + l.name + '<small>' + l.tagline + '</small></th>').join('') + '</tr></thead><tbody>';
    FIELDS.forEach(f => {
      const cur = state.assessment[f.id] || 1;
      html += '<tr><td class="field">' + f.name + '</td>';
      f.stages.forEach((txt, i) => {
        const n = i + 1;
        let cls = 'cell';
        if (n === cur) cls += ' sel';
        else if (n < cur) cls += ' reached';
        else if (n === cur + 1 && n <= tgt) cls += ' next';
        if (n > tgt) cls += ' beyond';
        html += '<td><button type="button" class="' + cls + '" data-field="' + f.id + '" data-stage="' + n + '" aria-pressed="' + (n === cur) + '">' + esc(txt) + '</button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody>';
    $('#matrix').innerHTML = html;
    $('#targetSeg').innerHTML = [3, 4, 5].map(n => '<button type="button" data-target="' + n + '" aria-pressed="' + (n === tgt) + '"><span class="n">' + n + '</span><span class="lbl">' + LEVELS[n - 1].name + '</span></button>').join('');
    renderStandort();
    renderPhases();
  }

  function renderStandort() {
    const avg = avgLevel();
    const mn = minLevel();
    const bottleneck = FIELDS.filter(f => (state.assessment[f.id] || 1) === mn);
    const tgt = state.target;
    let html = '<div class="eyebrow">Ihr Standort' + (state.assessed ? '' : ' · Beispielwerte, bitte anpassen') + '</div>' +
      '<div class="hero-num" style="margin-top:6px">' + fmtNum(avg, 1) + '<small>von 5</small></div>' +
      '<p class="muted small" style="margin-top:6px">Durchschnitt über sieben Handlungsfelder. Wirksam wird Automatisierung erst, wenn das schwächste Feld mitzieht: ' +
      (bottleneck.length === FIELDS.length ? 'alle Felder stehen auf Stufe ' + mn + '.' : '<b>' + bottleneck.map(b => b.name).join(', ') + '</b> auf Stufe ' + mn + '.') + '</p>' +
      '<div class="fieldbars">' + FIELDS.map(f => {
        const v = state.assessment[f.id] || 1;
        return '<div class="fieldbar' + (v === mn && bottleneck.length < FIELDS.length ? ' bottleneck' : '') + '"><div class="nm" title="' + esc(f.name) + '">' + f.name + '</div><div class="seg">' +
          [1, 2, 3, 4, 5].map(n => '<i class="' + (n <= v ? 'on' : '') + (n <= tgt && n > v ? ' target' : '') + '"></i>').join('') +
          '</div><div class="v">' + v + ' → ' + tgt + '</div></div>';
      }).join('') + '</div>' +
      '<div class="actions">' +
        '<button class="btn primary" type="button" data-sim-current>Meinen Tag erleben (Stufe ' + Math.round(avg) + ')</button>' +
        '<button class="btn" type="button" data-sim-target>Ziel erleben (Stufe ' + tgt + ')</button>' +
        '<button class="btn" type="button" data-copy>Ergebnis kopieren</button>' +
        '<button class="btn" type="button" data-reset-assess>Zurücksetzen</button>' +
      '</div>';
    const box = $('#standort');
    box.innerHTML = html;
    $('[data-sim-current]', box).onclick = () => setLevel(Math.round(avg), { restart: true, view: 'sim' });
    $('[data-sim-target]', box).onclick = () => setLevel(tgt, { restart: true, view: 'sim' });
    $('[data-copy]', box).onclick = copyResult;
    $('[data-reset-assess]', box).onclick = () => {
      FIELDS.forEach(f => { state.assessment[f.id] = 2; });
      state.assessed = false; store.set('zt.assessment', state.assessment); store.set('zt.assessed', false);
      renderMatrix(); toast('Einschätzung zurückgesetzt');
    };
  }

  function roadmap() {
    const phases = [];
    const tgt = state.target;
    for (let lv = minLevel() + 1; lv <= tgt; lv++) {
      const items = FIELDS.filter(f => (state.assessment[f.id] || 1) < lv).map(f => ({ field: f, text: f.stages[lv - 1] }));
      if (items.length) phases.push({ lv, tr: TRANSITIONS[lv - 2], items });
    }
    return phases;
  }

  function renderPhases() {
    const phases = roadmap();
    const box = $('#phases');
    if (!phases.length) {
      box.innerHTML = '<div class="panel"><h3>Ziel erreicht</h3><p class="muted">Alle Handlungsfelder stehen bereits auf oder über der Zielstufe ' + state.target + '. Wählen Sie eine höhere Zielstufe oder prüfen Sie die Einschätzung.</p></div>';
      return;
    }
    box.innerHTML = phases.map((p, i) =>
      '<div class="phase"><div class="num">' + (i + 1) + '<small>Schritt</small></div><div style="min-width:0">' +
        '<h3>' + esc(p.tr.title) + ' <span class="muted" style="font-weight:400">· auf Stufe ' + p.lv + '</span></h3>' +
        '<div class="meta">Typische Dauer ' + p.tr.duration + ' · ' + p.items.length + ' von ' + FIELDS.length + ' Handlungsfeldern betroffen</div>' +
        '<p class="focus">' + esc(p.tr.focus) + '</p>' +
        '<ul>' + p.items.map(it => '<li><span class="f">' + esc(it.field.name) + '</span><span>' + esc(it.text) + '</span></li>').join('') + '</ul>' +
        '<details><summary>Typische Maßnahmen in diesem Schritt</summary><ul>' + p.tr.actions.map(a => '<li>' + esc(a) + '</li>').join('') + '</ul></details>' +
        '<div class="success"><b>Erfolgskriterium</b><span>' + esc(p.tr.success) + '</span></div>' +
      '</div></div>'
    ).join('');
  }

  function copyResult() {
    const avg = avgLevel();
    let txt = 'Zero-Touch IT Simulator – Standortbestimmung\n';
    txt += 'Reifegrad im Durchschnitt: ' + fmtNum(avg, 1) + ' von 5, Zielstufe ' + state.target + '\n\n';
    txt += 'Handlungsfelder heute:\n';
    FIELDS.forEach(f => { txt += '- ' + f.name + ': Stufe ' + (state.assessment[f.id] || 1) + '\n'; });
    txt += '\nRoadmap:\n';
    roadmap().forEach((p, i) => {
      txt += '\nSchritt ' + (i + 1) + ': ' + p.tr.title + ' (auf Stufe ' + p.lv + ', ' + p.tr.duration + ')\n';
      p.items.forEach(it => { txt += '  - ' + it.field.name + ': ' + it.text + '\n'; });
      txt += '  Erfolgskriterium: ' + p.tr.success + '\n';
    });
    const done = () => toast('Ergebnis in die Zwischenablage kopiert');
    const fail = () => {
      const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Kopieren nicht möglich. Bitte Text manuell markieren.'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, fail); else fail();
  }

  /* ---------- Navigation, Theme, Hilfsmittel ---------- */
  function showView(v) {
    state.view = v;
    Object.keys(VIEWS).forEach(k => { $('#view-' + k).hidden = k !== v; });
    $$('#nav button').forEach(b => { if (b.dataset.view === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (location.hash !== '#' + VIEWS[v]) history.replaceState(null, '', '#' + VIEWS[v]);
    window.scrollTo({ top: 0 });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const ICON = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>'
  };

  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    store.set('zt.theme', t || '');
  }

  function bind() {
    document.addEventListener('click', e => {
      const lv = e.target.closest('[data-level]');
      if (lv) { setLevel(parseInt(lv.dataset.level, 10)); return; }
      const nav = e.target.closest('#nav button');
      if (nav) { showView(nav.dataset.view); return; }
      const sp = e.target.closest('#speed button');
      if (sp) { state.speed = parseInt(sp.dataset.s, 10); $$('#speed button').forEach(b => b.setAttribute('aria-pressed', b === sp)); return; }
      const cell = e.target.closest('.cell');
      if (cell) {
        state.assessment[cell.dataset.field] = parseInt(cell.dataset.stage, 10);
        state.assessed = true;
        store.set('zt.assessment', state.assessment); store.set('zt.assessed', true);
        renderMatrix(); return;
      }
      const tg = e.target.closest('[data-target]');
      if (tg) { state.target = parseInt(tg.dataset.target, 10); store.set('zt.target', state.target); renderMatrix(); return; }
    });
    $('#playBtn').addEventListener('click', () => {
      if (state.ended) { resetDay(true); return; }
      state.playing = !state.playing; renderClock();
    });
    $('#skipBtn').addEventListener('click', () => { state.sim = DAY_END; state.ended = true; state.playing = false; update(); });
    $('#resetBtn').addEventListener('click', () => resetDay(true));
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const isDark = cur ? cur === 'dark' : sysDark;
      applyTheme(isDark ? 'light' : 'dark');
    });
    document.addEventListener('keydown', e => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === ' ' && state.view === 'sim') { e.preventDefault(); $('#playBtn').click(); }
      else if (/^[1-5]$/.test(e.key)) setLevel(parseInt(e.key, 10));
      else if (e.key === 'ArrowRight' && state.view === 'sim') $('#skipBtn').click();
    });
    window.addEventListener('hashchange', () => {
      const k = Object.keys(VIEWS).find(k => '#' + VIEWS[k] === location.hash);
      if (k) showView(k);
    });
    const tip = $('#tooltip');
    document.addEventListener('mousemove', e => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { tip.classList.remove('show'); return; }
      tip.textContent = t.dataset.tip; tip.classList.add('show');
      const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12);
      tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
    });
  }

  function init() {
    const th = store.get('zt.theme', ''); if (th) applyTheme(th);
    bind();
    const k = Object.keys(VIEWS).find(k => '#' + VIEWS[k] === location.hash);
    showView(k || 'sim');
    renderLevelBar();
    renderQuotes();
    renderLevelsView();
    renderMatrix();
    resetDay(true);
    // Beim Start steht der Tag bereits bei 09:30, damit die Seite sofort etwas zeigt.
    state.sim = 9 * 60 + 30;
    update(true);
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
