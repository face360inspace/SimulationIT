/* =========================================================================
   Zero-Touch IT Simulator – Prognose und Maßnahmenbewertung
   Simuliert viele zufällig variierte Jahre (Poisson-verteilte Vorkommen je
   Ereignistyp, gestreute Aufwände) für eine Ausgangslage und für jede
   mögliche nächste Maßnahme. Liefert Erwartungswerte mit Bandbreiten,
   Nutzen-Kosten-Verhältnis, Amortisation und einen Roadmap-Vorschlag.
   Schnittstelle: window.Analysis
   ========================================================================= */
window.Analysis = (function () {
  'use strict';

  /* Deterministischer Zufall, damit Ergebnisse reproduzierbar sind. */
  function rng(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function poisson(lambda, rand) {
    if (lambda > 30) { // Normalapproximation
      const u = rand() || 1e-9, v = rand();
      return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
    }
    const L = Math.exp(-lambda); let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  const cum = s => { let c = 0; for (let k = 2; k <= s; k++) c += STAGE_COST[k - 1]; return c; };

  /* Varianten je Ereignis für eine Stufenkonfiguration. */
  function variants(levels) {
    return EVENTS.map(e => { const eff = effectiveLevel(e, levels); return { e, level: eff.level, limiters: eff.limiters, v: e.v[eff.level - 1] }; });
  }
  /* Vorkommen je Jahr eines Ereignistyps nach Unternehmensgröße und Hochrechnung. */
  function perYear(e, P) { return e.freq * 12 * (e.perCompany ? 1 : P.employees / 100) / Math.max(0.05, P.coverage); }

  /* Erwartungswerte je Jahr (deterministisch). */
  function expected(levels, P) {
    const t = { it: 0, user: 0, ot: 0, tickets: 0, touches: 0, prevented: 0, occurrences: 0 };
    variants(levels).forEach(x => {
      const n = perYear(x.e, P);
      t.occurrences += n; t.it += n * x.v.it; t.user += n * x.v.user; t.ot += n * (x.v.ot || 0); t.touches += n * x.v.touches;
      if (x.v.ticket) t.tickets += n;
      if (x.v.prevented || x.v.touches === 0) t.prevented += n;
    });
    t.cost = cost(t, P);
    return t;
  }
  function cost(t, P) { return t.it / 60 * P.rateIT + t.user / 60 * P.rateUser + (t.ot || 0) / 60 * (P.rateOT || 0) + t.tickets * P.ticketCost; }

  /* Monte-Carlo: viele Jahre, jeweils Vorkommen je Ereignistyp und gestreute Aufwände. */
  function simulate(levels, P, seed) {
    const vs = variants(levels);
    const rand = rng(seed || 1);
    const years = [];
    for (let r = 0; r < P.runs; r++) {
      const t = { it: 0, user: 0, ot: 0, tickets: 0, touches: 0, prevented: 0, occurrences: 0 };
      vs.forEach(x => {
        const n = poisson(perYear(x.e, P), rand);
        for (let i = 0; i < n; i++) {
          const f = 1 - P.spread + rand() * 2 * P.spread;
          t.it += x.v.it * f; t.user += x.v.user * f; t.ot += (x.v.ot || 0) * f; t.touches += x.v.touches;
          if (x.v.ticket) t.tickets++;
          if (x.v.prevented || x.v.touches === 0) t.prevented++;
        }
        t.occurrences += n;
      });
      t.cost = cost(t, P);
      years.push(t);
    }
    return years;
  }
  function stats(years, key) {
    const a = years.map(y => y[key]).sort((x, y) => x - y);
    const q = p => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    return { mean: a.reduce((s, v) => s + v, 0) / a.length, p10: q(.1), p50: q(.5), p90: q(.9) };
  }
  function summary(levels, P, seed) {
    const years = simulate(levels, P, seed);
    return { levels: Object.assign({}, levels), exp: expected(levels, P), it: stats(years, 'it'), user: stats(years, 'user'), ot: stats(years, 'ot'), tickets: stats(years, 'tickets'), touches: stats(years, 'touches'), prevented: stats(years, 'prevented'), cost: stats(years, 'cost'), occurrences: stats(years, 'occurrences') };
  }

  /* Eine Maßnahme: ein Feld um eine Stufe anheben. */
  function step(levels, fieldId) {
    const l = Object.assign({}, levels); l[fieldId] = Math.min(5, l[fieldId] + 1); return l;
  }
  function stepCost(levels, fieldId, P) { const pts = STAGE_COST[levels[fieldId]]; return { points: pts, invest: pts * P.eurPerPoint, opex: pts * P.eurPerPoint * P.opexShare }; }

  /* Bewertet alle möglichen nächsten Maßnahmen gegen die Ausgangslage. */
  function candidates(levels, P, base) {
    base = base || summary(levels, P, 7);
    const list = [];
    FIELDS.forEach(f => {
      const cur = levels[f.id]; if (cur >= 5) return;
      const blocker = stageBlocker(f.id, cur + 1, levels);
      const nl = step(levels, f.id);
      const s = summary(nl, P, 7);
      const c = stepCost(levels, f.id, P);
      const saving = base.exp.cost - s.exp.cost;
      const savingMC = { mean: base.cost.mean - s.cost.mean, p10: base.cost.p10 - s.cost.p10, p90: base.cost.p90 - s.cost.p90 };
      const net = saving - c.opex;
      // Welche Ereignisse ändern sich?
      const changes = [];
      const vb = variants(levels), va = variants(nl);
      va.forEach((x, i) => { if (x.level !== vb[i].level) changes.push({ title: x.e.title, from: vb[i].level, to: x.level }); });
      // Was wird dadurch freigeschaltet?
      const unlocks = FIELDS.filter(g => g.id !== f.id && levels[g.id] < 5 && stageBlocker(g.id, levels[g.id] + 1, levels) && !stageBlocker(g.id, levels[g.id] + 1, nl)).map(g => g.name);
      // Bester Partner: welche zweite Maßnahme macht diese am wirksamsten?
      let pair = null;
      FIELDS.forEach(g => {
        if (nl[g.id] >= 5 || stageBlocker(g.id, nl[g.id] + 1, nl)) return;
        const l2 = step(nl, g.id); const c2 = stepCost(nl, g.id, P);
        const net2 = (base.exp.cost - expected(l2, P).cost) - c.opex - c2.opex;
        if (!pair || net2 > pair.net) pair = { field: g, stage: nl[g.id] + 1, net: net2, invest: c.invest + c2.invest, points: c.points + c2.points };
      });
      list.push({ pair, field: f, stage: cur + 1, title: f.short[cur], blocker, cost: c, saving, savingMC, net, ratio: net / (c.invest || 1), payback: net > 0 ? c.invest / net * 12 : Infinity, changes, unlocks, sum: s });
    });
    list.sort((a, b) => (b.blocker ? -1 : 1) - (a.blocker ? -1 : 1) || b.ratio - a.ratio);
    return list;
  }

  /* Roadmap-Vorschlag: gierig mit Vorausschau über bis zu drei Schritte auf
     Erwartungswerten. Jeder Schritt wählt die Maßnahme, die allein oder als
     Auftakt einer Kette den höchsten Nettonutzen je investiertem Euro bringt.
     So werden auch Voraussetzungen gewählt, die erst später Wirkung zeigen. */
  function roadmap(levels, budgetPoints, P, goalGap) {
    const steps = [];
    let cur = Object.assign({}, levels), spent = 0, baseCost = expected(cur, P).cost;
    const startCost = baseCost;
    let cumInvest = 0, cumOpex = 0;
    const openSteps = (l, pts) => FIELDS.filter(f => l[f.id] < 5 && !stageBlocker(f.id, l[f.id] + 1, l) && pts + STAGE_COST[l[f.id]] <= budgetPoints);
    for (let guard = 0; guard < 40; guard++) {
      const options = [];
      openSteps(cur, spent).forEach(f => {
        const c1 = stepCost(cur, f.id, P); const l1 = step(cur, f.id); const cost1 = expected(l1, P).cost;
        let best = ((baseCost - cost1) - c1.opex) / c1.invest;
        openSteps(l1, spent + c1.points).forEach(g => {
          const c2 = stepCost(l1, g.id, P); const l2 = step(l1, g.id); const cost2 = expected(l2, P).cost;
          best = Math.max(best, ((baseCost - cost2) - c1.opex - c2.opex) / (c1.invest + c2.invest));
          openSteps(l2, spent + c1.points + c2.points).forEach(h => {
            const c3 = stepCost(l2, h.id, P); const cost3 = expected(step(l2, h.id), P).cost;
            best = Math.max(best, ((baseCost - cost3) - c1.opex - c2.opex - c3.opex) / (c1.invest + c2.invest + c3.invest));
          });
        });
        options.push({ f, c1, l1, cost1, score: best });
      });
      if (!options.length) break;
      const gapNow = goalGap ? goalGap(cur) : 0;
      if (goalGap && gapNow <= 0) break;
      options.sort((a, b) => b.score - a.score);
      let o = options[0];
      if (o.score <= 0 || goalGap) {
        if (!goalGap) break;
        // Zielgetriebene Phase: Fortschritt auf die Ziele je investiertem Euro, mit Blick auf den Folgeschritt (Voraussetzungen).
        options.forEach(x => {
          let g = (gapNow - goalGap(x.l1)) / x.c1.invest;
          openSteps(x.l1, spent + x.c1.points).forEach(h => { const c2 = stepCost(x.l1, h.id, P); g = Math.max(g, (gapNow - goalGap(step(x.l1, h.id))) / (x.c1.invest + c2.invest)); });
          x.gscore = g;
        });
        options.sort((a, b) => (b.gscore - a.gscore) || (b.score - a.score));
        o = options[0];
        if (o.gscore <= 0 && o.score <= 0) break;
        if (o.gscore <= 0) { options.sort((a, b) => b.score - a.score); o = options[0]; }
      }
      spent += o.c1.points; cumInvest += o.c1.invest; cumOpex += o.c1.opex;
      const saving = startCost - o.cost1;
      steps.push({ field: o.f, stage: cur[o.f.id] + 1, title: o.f.short[cur[o.f.id]], points: o.c1.points, invest: o.c1.invest, opex: o.c1.opex, stepSaving: baseCost - o.cost1, cumPoints: spent, cumInvest, cumSaving: saving, cumNet: saving - cumOpex, payback: saving - cumOpex > 0 ? cumInvest / (saving - cumOpex) * 12 : Infinity, levels: Object.assign({}, o.l1), costAfter: o.cost1 });
      cur = o.l1; baseCost = o.cost1;
    }
    return { steps, end: cur, spent, startCost };
  }

  return { expected, simulate, summary, candidates, roadmap, stepCost, variants, perYear };
})();
