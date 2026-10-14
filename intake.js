/* =========================================================================
   Zero-Touch IT Simulator – Ist-Bild ableiten
   Verbindet drei Quellen zu einem Reifegrad je Handlungsfeld mit
   Begründung: ITSM-Kennzahlen, erkannte Werkzeuge aus Dokumentation,
   Antworten der Delivery-Teams. Dazu Kalibrierung der Ereignishäufigkeiten,
   Quick Wins und die Dauerplanung einer Roadmap.
   Schnittstelle: window.Intake
   ========================================================================= */
window.Intake = (function () {
  'use strict';

  /* ---------- Werkzeuge in Text erkennen ---------- */
  /* Liefert erkannte Werkzeuge; `negated` wenn im Umfeld eine Verneinung oder
     Planung steht („kein SSO“, „SIEM geplant“). */
  const NEG_BEFORE = /(kein|keine|keinen|nicht|ohne|no|not|without|noch kein|bisher kein)\s+(\w+\s+){0,3}$/i;
  const NEG_AFTER = /^(\s+\w+){0,3}\s+(geplant|planned|in planung|nicht vorhanden|fehlt|not in place|not yet|vorgesehen)/i;
  function detectTools(text) {
    const t = ' ' + (text || '').replace(/\s+/g, ' ') + ' ';
    const low = t.toLowerCase();
    const out = [];
    TOOL_CATALOG.forEach(tool => {
      let found = false, negated = false;
      tool.kw.forEach(k => {
        let idx = low.indexOf(k.toLowerCase());
        while (idx >= 0) {
          found = true;
          const before = t.slice(Math.max(0, idx - 40), idx), after = t.slice(idx + k.length, idx + k.length + 40);
          if (NEG_BEFORE.test(before) || NEG_AFTER.test(after)) negated = true; else { negated = false; return; }
          idx = low.indexOf(k.toLowerCase(), idx + k.length);
        }
      });
      if (found) out.push({ id: tool.id, negated });
    });
    return out;
  }

  /* ---------- Signale ---------- */
  function signalsFromTools(ids, negatedIds) {
    const neg = negatedIds || [];
    const pos = ids.map(id => TOOL_CATALOG.find(t => t.id === id)).filter(Boolean).map(t => ({ field: t.field, stage: t.stage, weight: 1, source: 'Dokumentation', text: t.label + ' (' + t.note + ')' }));
    const negs = neg.map(id => TOOL_CATALOG.find(t => t.id === id)).filter(Boolean).map(t => ({ field: t.field, stage: t.stage, weight: -1, source: 'Dokumentation', text: 'Laut Unterlagen nicht vorhanden oder nur geplant: ' + t.label }));
    return pos.concat(negs);
  }
  function signalsFromAnswers(answers) {
    const out = [];
    QUESTIONS.forEach(q => {
      const a = answers[q.id]; if (!a) return;
      if (a === 'yes') out.push({ field: q.field, stage: q.stage, weight: 1, source: 'Interview', text: 'Bestätigt: ' + q.text });
      else if (a === 'partly') out.push({ field: q.field, stage: q.stage, weight: 0.5, source: 'Interview', text: 'Teilweise: ' + q.text });
      else out.push({ field: q.field, stage: q.stage, weight: -1, source: 'Interview', text: 'Verneint: ' + q.text });
    });
    return out;
  }
  const pct = v => Math.round(v * 100) + ' %';
  function signalsFromMetrics(m) {
    const s = [];
    if (!m || !m.tickets) return s;
    const add = (field, stage, weight, text) => s.push({ field, stage, weight, source: 'ITSM-Daten', text });
    add('service', 2, 1, m.tickets + ' Tickets in ' + m.months.toFixed(1) + ' Monaten liegen strukturiert im ITSM-Werkzeug vor');
    if (m.selfServiceShare >= 0.3) add('service', 3, 1, pct(m.selfServiceShare) + ' der Anfragen kommen über Self-Service oder Chatbot');
    else if (m.selfServiceShare >= 0.12) add('service', 3, 0.5, 'Nur ' + pct(m.selfServiceShare) + ' der Anfragen über Self-Service: Portal vorhanden, aber wenig genutzt');
    else add('service', 3, -1, 'Nur ' + pct(m.selfServiceShare) + ' der Anfragen über Self-Service');
    if (m.monitoringShare >= 0.5) add('service', 4, 0.7, pct(m.monitoringShare) + ' der Störungen werden proaktiv aus Monitoring angelegt');
    if (m.autoShare >= 0.5) add('automation', 4, 1, pct(m.autoShare) + ' der Tickets werden automatisch gelöst');
    else if (m.autoShare >= 0.25) add('automation', 3, 1, pct(m.autoShare) + ' der Tickets werden automatisch gelöst');
    else if (m.autoShare >= 0.08) add('automation', 3, 0.5, pct(m.autoShare) + ' automatisch gelöst: erste Automationen vorhanden');
    else add('automation', 3, -1, 'Nur ' + pct(m.autoShare) + ' der Tickets werden automatisch gelöst');
    if (m.monitoringShare >= 0.6) add('telemetry', 4, 1, pct(m.monitoringShare) + ' der Störungen stammen aus Monitoring oder Event-Management');
    else if (m.monitoringShare >= 0.35) add('telemetry', 3, 1, pct(m.monitoringShare) + ' der Störungen stammen aus Monitoring');
    else if (m.monitoringShare >= 0.12) add('telemetry', 2, 1, pct(m.monitoringShare) + ' der Störungen stammen aus Monitoring');
    else add('telemetry', 3, -1, 'Nur ' + pct(m.monitoringShare) + ' der Störungen stammen aus Monitoring; fast alles wird von Mitarbeitern gemeldet');
    const mfa = m.byType.mfa;
    if (mfa && mfa.share >= 0.15) add('identity', 3, -1, pct(mfa.share) + ' aller Tickets sind Passwort- und Kontoprobleme: kein wirksamer Self-Service');
    else if (mfa && mfa.share <= 0.05) add('identity', 2, 1, 'Nur ' + pct(mfa.share) + ' Passwort- und Kontotickets: Passwort-Self-Service wirkt');
    const onb = m.byType.onboarding;
    if (onb && onb.count >= 5 && onb.mttr !== null) { if (onb.mttr <= 8) add('identity', 3, 0.8, 'Onboarding-Anfragen in Ø ' + onb.mttr.toFixed(0) + ' h erledigt: Provisionierung weitgehend automatisiert'); else add('identity', 3, -0.5, 'Onboarding-Anfragen dauern Ø ' + onb.mttr.toFixed(0) + ' h: manuelle Provisionierung'); }
    const cve = m.byType.cve;
    if (cve && cve.count >= 3 && cve.mttr !== null) { if (cve.mttr <= 48) add('security', 3, 0.7, 'Patch- und Schwachstellentickets in Ø ' + cve.mttr.toFixed(0) + ' h geschlossen'); else add('security', 3, -0.5, 'Patch- und Schwachstellentickets dauern Ø ' + cve.mttr.toFixed(0) + ' h'); }
    if (m.cmdbOwnerShare !== undefined) { if (m.cmdbOwnerShare >= 0.8) add('endpoint', 2, 1, pct(m.cmdbOwnerShare) + ' der CIs haben einen Verantwortlichen: gepflegte CMDB'); else add('endpoint', 2, 0.5, 'Nur ' + pct(m.cmdbOwnerShare) + ' der ' + m.cis + ' CIs haben einen Verantwortlichen: CMDB lückenhaft'); }
    const ssd = m.byType.ssd;
    if (ssd && ssd.count >= 5 && ssd.mttr !== null) { if (ssd.mttr <= 4) add('endpoint', 3, 0.7, 'Hardwarestörungen in Ø ' + ssd.mttr.toFixed(0) + ' h gelöst: Poolgeräte richten sich selbst ein'); else add('endpoint', 3, -0.5, 'Hardwarestörungen dauern Ø ' + ssd.mttr.toFixed(0) + ' h: manuelle Neuinstallation'); }
    if (m.changeSuccess !== null && m.changeSuccess !== undefined) { if (m.changeSuccess >= 0.95) add('org', 2, 0.7, pct(m.changeSuccess) + ' der Changes erfolgreich: funktionierender Change-Prozess'); else add('org', 2, 0.3, pct(m.changeSuccess) + ' der Changes erfolgreich'); }
    if (m.reopenRate > 0.12) add('org', 3, -0.5, pct(m.reopenRate) + ' der Tickets werden wiedereröffnet: Lösungen halten nicht');
    return s;
  }

  /* ---------- Fusion zu Stufen ---------- */
  function propose(signals) {
    const out = {};
    FIELDS.forEach(f => {
      const sig = signals.filter(s => s.field === f.id);
      const support = [0, 0, 0, 0, 0, 0], against = [0, 0, 0, 0, 0, 0];
      sig.forEach(s => { if (s.weight > 0) support[s.stage] += s.weight; else against[s.stage] += -s.weight; });
      let stage = 1;
      for (let st = 2; st <= 5; st++) {
        const ok = support[st] >= 0.8 && support[st] > against[st];
        if (ok) stage = st; else if (against[st] >= 1 && support[st] < 0.5) break;
      }
      const sources = Array.from(new Set(sig.map(s => s.source)));
      const conf = sig.length ? Math.min(1, (support[stage] + (stage === 1 ? Math.max(0, sig.filter(s => s.weight < 0).length * 0.5) : 0)) / 2 * (0.6 + 0.2 * sources.length)) : 0;
      out[f.id] = { stage, confidence: sig.length ? Math.max(0.2, conf) : 0, evidence: sig.sort((a, b) => b.stage - a.stage || b.weight - a.weight), sources };
    });
    return out;
  }

  /* ---------- Häufigkeiten aus Daten ---------- */
  function calibrate(m, employees) {
    if (!m || !m.tickets) return null;
    const out = {}; const emp = employees || m.employees || 300;
    EVENTS.forEach(e => {
      const b = m.byType[e.id]; if (!b || !b.count) { out[e.id] = null; return; }
      out[e.id] = e.perCompany ? b.perMonth : b.perMonth / emp * 100;
    });
    const mapped = 1 - (m.unmappedShare || 0);
    return { freq: out, coverage: Math.max(0.05, Math.min(1, mapped)), employees: emp };
  }

  /* ---------- Quick Wins ---------- */
  function quickWins(m, levels, candidates) {
    const wins = [];
    const add = (w) => wins.push(w);
    if (m && m.tickets) {
      const t = m.byType;
      if (t.mfa && t.mfa.share >= 0.12 && levels.identity < 3) add({ title: 'Passwort- und MFA-Self-Service', why: pct(t.mfa.share) + ' aller Tickets (' + t.mfa.count + ') sind Passwort- und Kontoprobleme. Ein Self-Service-Reset mit MFA-Neuregistrierung erledigt den Großteil ohne Service Desk.', field: 'identity', stage: 3, effort: 'gering' });
      if (t.license && t.license.share >= 0.15 && levels.service < 3) add({ title: 'Servicekatalog mit automatischer Genehmigung', why: pct(t.license.share) + ' der Tickets (' + t.license.count + ') sind Software-, Lizenz- und Zugriffsanfragen' + (t.license.mttr ? ' mit Ø ' + t.license.mttr.toFixed(0) + ' h Durchlaufzeit' : '') + '. Ein Katalog mit Genehmigungs-Workflow reduziert Durchlaufzeit und Handarbeit.', field: 'service', stage: 3, effort: 'gering' });
      if (m.selfServiceShare < 0.12 && levels.service >= 2) add({ title: 'Self-Service-Portal bewerben und als Standardkanal setzen', why: 'Nur ' + pct(m.selfServiceShare) + ' der Anfragen kommen über das Portal. Telefon und E-Mail binden Service-Desk-Zeit für Erfassung und Rückfragen.', field: 'service', stage: 3, effort: 'sehr gering' });
      if (t.onboarding && t.onboarding.count >= 5 && t.onboarding.mttr > 8 && levels.identity < 3) add({ title: 'Onboarding aus dem HR-System auslösen', why: t.onboarding.count + ' Onboarding-Anfragen mit Ø ' + t.onboarding.mttr.toFixed(0) + ' h Durchlaufzeit. Ein HR-getriebener Workflow legt Konto, Lizenzen und Gruppen am ersten Tag automatisch an.', field: 'identity', stage: 3, effort: 'mittel' });
      if (m.monitoringShare < 0.15 && levels.telemetry < 3) add({ title: 'Monitoring-Alarme in das ITSM integrieren', why: 'Nur ' + pct(m.monitoringShare) + ' der Störungen stammen aus Monitoring. Die IT erfährt von Ausfällen über Anrufe statt über Alarme.', field: 'telemetry', stage: 3, effort: 'gering' });
      if (t.ssd && t.ssd.count >= 8 && levels.endpoint < 3) add({ title: 'Zero-Touch-Provisioning für Poolgeräte', why: t.ssd.count + ' Hardwarestörungen' + (t.ssd.mttr ? ' mit Ø ' + t.ssd.mttr.toFixed(0) + ' h Ausfall' : '') + '. Vorkonfigurierte Poolgeräte mit Autopilot verkürzen den Ausfall auf unter eine Stunde.', field: 'endpoint', stage: 3, effort: 'mittel' });
      if (m.reopenRate > 0.12) add({ title: 'Wissensdatenbank und Lösungsqualität', why: pct(m.reopenRate) + ' der Tickets werden wiedereröffnet. Dokumentierte Standardlösungen und Qualitätsprüfung senken Mehrfacharbeit.', field: 'service', stage: 3, effort: 'gering' });
    }
    (candidates || []).filter(c => !c.blocker && c.payback <= 12 && c.cost.points <= 2 && !wins.some(w => w.field === c.field.id)).forEach(c => add({ title: c.field.name + ' auf Stufe ' + c.stage + ': ' + c.title, why: 'Amortisiert sich in der Prognose nach ' + Math.round(c.payback) + ' Monaten bei ' + c.cost.points + ' Punkten Investition.', field: c.field.id, stage: c.stage, effort: 'gering' }));
    return wins;
  }

  /* ---------- Dauer der Transformation ---------- */
  const STEP_MONTHS = { 2: 3, 3: 5, 4: 6, 5: 8 };
  function schedule(steps, lanes, startLevels) {
    lanes = lanes || 2;
    const laneEnd = new Array(lanes).fill(0);
    const out = [];
    steps.forEach((s, i) => {
      const dur = STEP_MONTHS[s.stage] * (s.field.id === 'org' ? 1.3 : 1);
      const before = i ? steps[i - 1].levels : (startLevels || {});
      let earliest = 0;
      for (let j = 0; j < i; j++) {
        const pb = j ? steps[j - 1].levels : (startLevels || {});
        // Schritt j hat diesen Schritt freigeschaltet oder liegt im selben Feld: erst danach beginnen
        if ((stageBlocker(s.field.id, s.stage, pb) && !stageBlocker(s.field.id, s.stage, steps[j].levels)) || steps[j].field.id === s.field.id) earliest = Math.max(earliest, out[j].end);
      }
      let lane = 0; for (let l = 1; l < lanes; l++) if (laneEnd[l] < laneEnd[lane]) lane = l;
      const start = Math.max(laneEnd[lane], earliest);
      const end = start + dur;
      laneEnd[lane] = end;
      out.push(Object.assign({}, s, { start, end, dur, lane, before }));
    });
    const total = out.length ? Math.max.apply(null, out.map(o => o.end)) : 0;
    return { steps: out, totalMonths: total };
  }

  return { detectTools, signalsFromTools, signalsFromAnswers, signalsFromMetrics, propose, calibrate, quickWins, schedule, STEP_MONTHS };
})();
