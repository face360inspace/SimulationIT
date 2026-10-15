/* =========================================================================
   Zero-Touch IT Simulator – Quellenkatalog für den Digital Twin
   Jede Quelle beschreibt, welche Spalten sie erwartet (tolerant, mit
   Aliasen), leitet Kennzahlen ab, übersetzt sie in Reifegrad-Signale je
   Handlungsfeld und kalibriert, wo sinnvoll, Häufigkeiten der Prognose.
   Beispieldaten je Quelle erzeugen einen fiktiven Kunden auf Stufe 2.
   Schnittstelle: window.Sources
   ========================================================================= */
window.Sources = (function () {
  'use strict';

  /* ---------- Hilfen ---------- */
  function col(row, names) {
    const keys = Object.keys(row);
    for (const n of names) { const k = keys.find(x => x.toLowerCase() === n.toLowerCase()); if (k !== undefined && row[k] !== '' && row[k] !== null && row[k] !== undefined) return row[k]; }
    for (const n of names) { const k = keys.find(x => x.toLowerCase().indexOf(n.toLowerCase()) >= 0); if (k !== undefined && row[k] !== '' && row[k] !== null && row[k] !== undefined) return row[k]; }
    return '';
  }
  const num = v => { if (typeof v === 'number') return v; const s = String(v || '').replace('%', '').replace(/\./g, m => m).trim(); const n = parseFloat(s.replace(',', '.')); return isNaN(n) ? null : n; };
  const pctv = v => { const n = num(v); if (n === null) return null; return n > 1.5 ? n / 100 : n; };
  const date = v => window.Connectors.parseDate(v);
  const share = (arr, pred) => arr.length ? arr.filter(pred).length / arr.length : 0;
  const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
  const pct = v => v === null || v === undefined ? '–' : Math.round(v * 100) + ' %';
  const months = (rows, getDate) => { const ts = rows.map(getDate).filter(Boolean).map(d => d.getTime()); if (ts.length < 2) return 1; return Math.max(1, (Math.max.apply(null, ts) - Math.min.apply(null, ts)) / (30.44 * 86400000)); };
  const days = (a, b) => (b - a) / 86400000;
  const sig = (field, stage, weight, text) => ({ field, stage, weight, text });
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const iso = d => d.toISOString().slice(0, 10);
  const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

  const GROUPS = [
    { id: 'endpoint', name: 'Endgeräte und Arbeitsplatz' },
    { id: 'identity', name: 'Identität und Zugriff' },
    { id: 'ops', name: 'Telemetrie und Betrieb' },
    { id: 'security', name: 'Sicherheit und Compliance' },
    { id: 'org', name: 'Organisation, Finanzen, Wissen' },
    { id: 'people', name: 'Sicht der Mitarbeiter' },
    { id: 'agents', name: 'KI-Agenten und Bots' },
    { id: 'ot', name: 'OT und Produktion', ot: true }
  ];

  const SOURCES = [
    {
      id: 'mdm', group: 'endpoint', name: 'MDM / Endpoint Management', systems: 'Intune, Jamf, SCCM, Workspace ONE', graph: true,
      tells: 'Geräteinventar mit Alter, Compliance und Anteil Zero-Touch-registrierter Geräte.', fields: ['endpoint', 'security'],
      columns: 'deviceName, osVersion, complianceState, lastSyncDateTime, deviceEnrollmentType, enrolledDateTime, model',
      derive(rows, ctx) {
        const comp = rows.map(r => String(col(r, ['complianceState', 'compliance', 'konform', 'compliant'])).toLowerCase());
        const enr = rows.map(r => String(col(r, ['deviceEnrollmentType', 'enrollmentType', 'enrollment', 'autopilot', 'registrierung'])).toLowerCase());
        const ages = rows.map(r => date(col(r, ['purchaseDate', 'kaufdatum', 'enrolledDateTime', 'enrolled', 'registriert']))).filter(Boolean).map(d => days(d, new Date()) / 365);
        const sync = rows.map(r => date(col(r, ['lastSyncDateTime', 'last_sync', 'lastSync', 'letzter kontakt', 'lastSeen']))).filter(Boolean);
        const m = { devices: rows.length, compliantShare: share(comp, c => /compliant|konform|true|yes/.test(c) && !/non|nicht|not/.test(c)), autopilotShare: share(enr, e => /autopilot|autoenroll|automated|abm|dep|zero/.test(e)), avgAgeYears: avg(ages), staleShare: sync.length ? share(sync, d => days(d, new Date()) > 30) : null };
        const s = [sig('endpoint', 2, 1, 'Vollständiges Geräteinventar im MDM: ' + m.devices + ' Geräte' + (m.avgAgeYears ? ', Ø ' + m.avgAgeYears.toFixed(1) + ' Jahre alt' : ''))];
        if (m.autopilotShare >= .5) s.push(sig('endpoint', 3, 1, pct(m.autopilotShare) + ' der Geräte per Autopilot oder ABM registriert'));
        else if (m.autopilotShare >= .2) s.push(sig('endpoint', 3, .5, 'Erst ' + pct(m.autopilotShare) + ' der Geräte per Zero-Touch registriert'));
        else s.push(sig('endpoint', 3, -.8, 'Nur ' + pct(m.autopilotShare) + ' der Geräte per Zero-Touch registriert'));
        if (m.compliantShare >= .9) s.push(sig('security', 3, .6, pct(m.compliantShare) + ' der Geräte richtlinienkonform'));
        else if (m.compliantShare < .7) s.push(sig('security', 3, -.5, 'Nur ' + pct(m.compliantShare) + ' der Geräte richtlinienkonform'));
        return { metrics: m, signals: s, summary: m.devices + ' Geräte · ' + pct(m.compliantShare) + ' konform · ' + pct(m.autopilotShare) + ' Zero-Touch' };
      },
      demo(rand) { const out = []; for (let i = 0; i < 340; i++) { const ap = rand() < .18; out.push({ deviceName: 'NB-' + (1000 + i), operatingSystem: 'Windows', osVersion: rand() < .8 ? '10.0.22631' : '10.0.19045', complianceState: rand() < .78 ? 'compliant' : 'noncompliant', lastSyncDateTime: iso(daysAgo(Math.floor(rand() * (rand() < .85 ? 10 : 90)))), deviceEnrollmentType: ap ? 'windowsAutoEnrollment' : 'userEnrollment', enrolledDateTime: iso(daysAgo(Math.floor(rand() * 1500))), model: rand() < .6 ? 'Latitude 5540' : 'ThinkPad T14' }); } return out; }
    },
    {
      id: 'dex', group: 'endpoint', name: 'Digital Employee Experience', systems: 'Nexthink, 1E, Lakeside, ControlUp',
      tells: 'Experience-Score, Startzeiten, Abstürze und Hardwaregesundheit je Gerät. Kalibriert Hardware- und Anwendungsstörungen.', fields: ['endpoint', 'telemetry'],
      columns: 'device, experienceScore, bootTimeSec, appCrashes30d, hardwareHealth',
      derive(rows, ctx) {
        const scores = rows.map(r => num(col(r, ['experienceScore', 'dexScore', 'score', 'erlebnis']))).filter(v => v !== null);
        const boots = rows.map(r => num(col(r, ['bootTimeSec', 'bootTime', 'startzeit', 'boot']))).filter(v => v !== null);
        const crashes = rows.map(r => num(col(r, ['appCrashes30d', 'crashes', 'abstürze', 'crash']))).filter(v => v !== null);
        const hw = rows.map(r => String(col(r, ['hardwareHealth', 'batteryHealth', 'diskHealth', 'hardware', 'gesundheit'])).toLowerCase());
        const m = { devices: rows.length, avgScore: avg(scores), avgBootSec: avg(boots), crashesPerDevice: crashes.length ? crashes.reduce((s, v) => s + v, 0) / crashes.length : null, hwWarnShare: share(hw, h => /warn|poor|critical|schlecht|replace|low|kritisch/.test(h)) };
        const s = [sig('endpoint', 4, 1, 'Geräte-Telemetrie vorhanden: Experience-Score Ø ' + (m.avgScore !== null ? m.avgScore.toFixed(0) : '–') + ', ' + pct(m.hwWarnShare) + ' der Geräte mit Hardware-Warnung'), sig('telemetry', 3, .7, 'Client-Telemetrie fließt in eine Plattform (' + m.devices + ' Geräte)')];
        const calib = {}; if (ctx.employees && m.hwWarnShare !== null) calib.ssd = (m.devices * m.hwWarnShare / 3) / ctx.employees * 100;
        return { metrics: m, signals: s, summary: m.devices + ' Geräte · Score ' + (m.avgScore !== null ? m.avgScore.toFixed(0) : '–') + ' · ' + pct(m.hwWarnShare) + ' Hardware-Warnungen', calib, experience: m.avgScore };
      },
      demo(rand) { const out = []; for (let i = 0; i < 340; i++) out.push({ device: 'NB-' + (1000 + i), experienceScore: Math.round(55 + rand() * 35), bootTimeSec: Math.round(35 + rand() * 60), appCrashes30d: rand() < .6 ? 0 : Math.floor(rand() * 5), hardwareHealth: rand() < .12 ? 'warning' : 'good' }); return out; }
    },
    {
      id: 'licenses', group: 'endpoint', name: 'Lizenz- und Softwaremanagement', systems: 'Flexera, Snow, Microsoft 365 Admin', graph: true,
      tells: 'Lizenzpool, ungenutzte Lizenzen und Reserven. Quelle für Quick Wins im Lizenzbereich.', fields: ['service'],
      columns: 'product, purchased, assigned, lastUsed',
      derive(rows) {
        let purchased = 0, assigned = 0; rows.forEach(r => { purchased += num(col(r, ['purchased', 'gekauft', 'prepaidUnits', 'total', 'quantity', 'menge'])) || 0; assigned += num(col(r, ['assigned', 'zugewiesen', 'consumedUnits', 'used', 'consumed'])) || 0; });
        const m = { products: rows.length, purchased, assigned, unusedShare: purchased ? Math.max(0, 1 - assigned / purchased) : null };
        const s = m.unusedShare !== null && m.unusedShare > .15 ? [sig('service', 3, -.3, pct(m.unusedShare) + ' der gekauften Lizenzen sind nicht zugewiesen: kein gesteuerter Lizenzpool')] : [];
        return { metrics: m, signals: s, summary: m.products + ' Produkte · ' + pct(m.unusedShare) + ' ungenutzt', quickWin: m.unusedShare > .15 ? { title: 'Lizenzpool bereinigen', why: pct(m.unusedShare) + ' der ' + purchased + ' gekauften Lizenzen sind nicht zugewiesen. Rückgabe und automatische Zuweisung aus dem Pool senken Kosten sofort.', field: 'service', stage: 3, effort: 'sehr gering' } : null };
      },
      demo(rand) { return [['Microsoft 365 E3', 360, 318], ['Visio Plan 2', 40, 23], ['Project Plan 3', 25, 9], ['Adobe Acrobat Pro', 80, 61], ['Power BI Pro', 60, 44], ['Teams Phone', 120, 71]].map(x => ({ product: x[0], purchased: x[1], assigned: x[2] })); }
    },
    {
      id: 'signins', group: 'identity', name: 'Anmeldeprotokolle', systems: 'Entra ID, Okta, Ping', graph: true,
      tells: 'Anteil MFA-geschützter, passwortloser und risikobasiert geprüfter Anmeldungen.', fields: ['identity'],
      columns: 'createdDateTime, authenticationRequirement, authenticationMethod, conditionalAccessStatus, riskLevelDuringSignIn, status',
      derive(rows) {
        const req = rows.map(r => String(col(r, ['authenticationRequirement', 'mfaDetail', 'mfa', 'isMfa', 'authentication_requirement', 'faktor'])).toLowerCase());
        const meth = rows.map(r => String(col(r, ['authenticationMethod', 'authMethod', 'method', 'methode'])).toLowerCase());
        const ca = rows.map(r => String(col(r, ['conditionalAccessStatus', 'conditional_access', 'ca_status', 'policy'])).toLowerCase());
        const risk = rows.map(r => String(col(r, ['riskLevelDuringSignIn', 'riskLevel', 'risk', 'risiko'])).toLowerCase());
        const m = { signins: rows.length, mfaShare: share(req, v => /multi|mfa|true|yes|erforderlich|strong/.test(v)), passwordlessShare: share(meth, v => /fido|hello|passkey|certificate|passwordless|phone sign/.test(v)), caShare: share(ca, v => !/notapplied|not applied|nicht/.test(v) && /success|applied|failure|angewendet|report/.test(v)), riskyShare: share(risk, v => /medium|high|hoch|mittel/.test(v)) };
        const s = [];
        if (m.mfaShare >= .9) s.push(sig('identity', 3, 1, pct(m.mfaShare) + ' der Anmeldungen mit zweitem Faktor')); else if (m.mfaShare >= .6) s.push(sig('identity', 3, .5, 'Erst ' + pct(m.mfaShare) + ' der Anmeldungen mit zweitem Faktor')); else s.push(sig('identity', 3, -1, 'Nur ' + pct(m.mfaShare) + ' der Anmeldungen mit zweitem Faktor'));
        if (m.caShare >= .7) s.push(sig('identity', 4, 1, pct(m.caShare) + ' der Anmeldungen durch Conditional Access bewertet')); else if (m.caShare > .2) s.push(sig('identity', 4, .5, 'Conditional Access greift bei ' + pct(m.caShare) + ' der Anmeldungen')); else s.push(sig('identity', 4, -.7, 'Conditional Access greift bei ' + pct(m.caShare) + ' der Anmeldungen'));
        if (m.passwordlessShare >= .5) s.push(sig('identity', 5, 1, pct(m.passwordlessShare) + ' passwortlose Anmeldungen')); else if (m.passwordlessShare >= .2) s.push(sig('identity', 5, .5, pct(m.passwordlessShare) + ' passwortlose Anmeldungen'));
        return { metrics: m, signals: s, summary: m.signins + ' Anmeldungen · MFA ' + pct(m.mfaShare) + ' · CA ' + pct(m.caShare) + ' · passwortlos ' + pct(m.passwordlessShare) };
      },
      demo(rand) { const out = []; for (let i = 0; i < 1200; i++) out.push({ createdDateTime: iso(daysAgo(Math.floor(rand() * 30))), authenticationRequirement: rand() < .72 ? 'multiFactorAuthentication' : 'singleFactorAuthentication', authenticationMethod: rand() < .06 ? 'Windows Hello for Business' : (rand() < .7 ? 'Password + Authenticator' : 'Password'), conditionalAccessStatus: rand() < .15 ? 'success' : 'notApplied', riskLevelDuringSignIn: rand() < .02 ? 'medium' : 'none', status: rand() < .95 ? 'Success' : 'Failure' }); return out; }
    },
    {
      id: 'hr', group: 'identity', name: 'HR-System und Kontoabgleich', systems: 'SuccessFactors, Workday, Personio',
      tells: 'Eintritte und Austritte mit Datum, abgeglichen mit Kontoanlage und -deaktivierung. Misst Provisionierungszeiten.', fields: ['identity', 'security'],
      columns: 'person, hireDate, terminationDate, accountCreated, accountDisabled',
      derive(rows, ctx) {
        const prov = [], deprov = []; let joiners = 0, leavers = 0;
        rows.forEach(r => { const h = date(col(r, ['hireDate', 'startDate', 'eintritt', 'start'])), c = date(col(r, ['accountCreated', 'created', 'konto angelegt', 'provisioned'])), t = date(col(r, ['terminationDate', 'endDate', 'austritt', 'exit', 'leaveDate'])), d = date(col(r, ['accountDisabled', 'disabled', 'deaktiviert', 'deprovisioned'])); if (h) { joiners++; if (c) prov.push(Math.max(0, days(h, c))); } if (t) { leavers++; if (d) deprov.push(Math.max(0, days(t, d))); } });
        const per = months(rows, r => date(col(r, ['hireDate', 'startDate', 'eintritt', 'terminationDate', 'austritt'])));
        const m = { joiners, leavers, avgProvisionDays: avg(prov), avgDeprovisionDays: avg(deprov), deprovWithin1dShare: deprov.length ? share(deprov, v => v <= 1) : null, months: per };
        const s = [];
        if (m.avgProvisionDays !== null) { if (m.avgProvisionDays <= .5 && (m.avgDeprovisionDays === null || m.avgDeprovisionDays <= 1)) s.push(sig('identity', 3, 1, 'Konten werden am Eintrittstag angelegt und am Austrittstag deaktiviert: HR-getriebene Provisionierung')); else s.push(sig('identity', 3, -1, 'Konto Ø ' + m.avgProvisionDays.toFixed(1) + ' Tage nach Eintritt angelegt' + (m.avgDeprovisionDays !== null ? ', Ø ' + m.avgDeprovisionDays.toFixed(1) + ' Tage nach Austritt deaktiviert' : '') + ': manuelle Provisionierung')); }
        if (m.avgDeprovisionDays !== null && m.avgDeprovisionDays > 3) s.push(sig('security', 2, -.5, 'Zugriff besteht Ø ' + m.avgDeprovisionDays.toFixed(0) + ' Tage über den Austritt hinaus'));
        const calib = {}; if (ctx.employees && per) { calib.onboarding = joiners / per / ctx.employees * 100; calib.offboarding = leavers / per / ctx.employees * 100; }
        return { metrics: m, signals: s, summary: joiners + ' Eintritte, ' + leavers + ' Austritte · Konto nach Ø ' + (m.avgProvisionDays !== null ? m.avgProvisionDays.toFixed(1) : '–') + ' Tagen · Sperre nach Ø ' + (m.avgDeprovisionDays !== null ? m.avgDeprovisionDays.toFixed(1) : '–') + ' Tagen', calib };
      },
      demo(rand) { const out = []; for (let i = 0; i < 46; i++) { const h = daysAgo(Math.floor(rand() * 365)); const c = new Date(h.getTime() + (1 + Math.floor(rand() * 3)) * 86400000); out.push({ person: 'P' + (100 + i), hireDate: iso(h), accountCreated: iso(c) }); } for (let i = 0; i < 33; i++) { const t = daysAgo(Math.floor(rand() * 365)); const d = new Date(t.getTime() + Math.floor(rand() * 9) * 86400000); out.push({ person: 'P' + (300 + i), terminationDate: iso(t), accountDisabled: iso(d) }); } return out; }
    },
    {
      id: 'alerts', group: 'ops', name: 'Monitoring und Observability', systems: 'Checkmk, PRTG, Datadog, Dynatrace, Azure Monitor',
      tells: 'Alarme je Monat, Anteil mit Ticket, Anteil automatisch behoben. Beantwortet: sehen wir es, bevor es jemand meldet?', fields: ['telemetry', 'automation'],
      columns: 'timestamp, severity, source, ticket, autoRemediated',
      derive(rows) {
        const per = months(rows, r => date(col(r, ['timestamp', 'time', 'created', 'firedAt', 'zeit', 'date'])));
        const sev = rows.map(r => String(col(r, ['severity', 'priority', 'schwere', 'level'])).toLowerCase());
        const tick = rows.map(r => String(col(r, ['ticket', 'incident', 'ticketNumber', 'linked_ticket', 'inc'])));
        const auto = rows.map(r => String(col(r, ['autoRemediated', 'remediation', 'auto', 'automatisch', 'runbook'])).toLowerCase());
        const src = Array.from(new Set(rows.map(r => String(col(r, ['source', 'monitor', 'quelle', 'system', 'tool']))))).filter(Boolean);
        const m = { alerts: rows.length, perMonth: rows.length / per, criticalShare: share(sev, v => /crit|high|hoch|p1|1/.test(v)), ticketShare: share(tick, v => /\w{3,}/.test(v) && !/^(no|none|nein|false|0|-)$/i.test(v)), autoShare: share(auto, v => /true|yes|ja|1|done|success|erledigt/.test(v)), sources: src.length };
        const s = [sig('telemetry', 2, 1, 'Zentrales Monitoring mit ' + Math.round(m.perMonth) + ' Alarmen je Monat aus ' + m.sources + ' Quellen')];
        if (m.ticketShare >= .5) s.push(sig('telemetry', 3, .7, pct(m.ticketShare) + ' der Alarme sind mit einem Ticket verknüpft: Alarme fließen korreliert ins ITSM')); else s.push(sig('telemetry', 3, -.5, 'Nur ' + pct(m.ticketShare) + ' der Alarme sind mit einem Ticket verknüpft'));
        if (m.autoShare >= .3) s.push(sig('automation', 4, 1, pct(m.autoShare) + ' der Alarme werden automatisch behoben')); else if (m.autoShare >= .1) s.push(sig('automation', 4, .5, pct(m.autoShare) + ' der Alarme werden automatisch behoben')); else s.push(sig('automation', 4, -.7, 'Nur ' + pct(m.autoShare) + ' der Alarme lösen eine automatische Korrektur aus'));
        return { metrics: m, signals: s, summary: Math.round(m.perMonth) + ' Alarme je Monat · ' + pct(m.ticketShare) + ' mit Ticket · ' + pct(m.autoShare) + ' automatisch behoben' };
      },
      demo(rand) { const out = []; const srcs = ['PRTG', 'PRTG', 'PRTG', 'Azure Monitor']; for (let i = 0; i < 620; i++) out.push({ timestamp: iso(daysAgo(Math.floor(rand() * 180))), severity: rand() < .12 ? 'critical' : (rand() < .5 ? 'warning' : 'info'), source: srcs[Math.floor(rand() * srcs.length)], ticket: rand() < .09 ? 'INC' + (100000 + Math.floor(rand() * 900)) : '', autoRemediated: rand() < .03 ? 'true' : 'false' }); return out; }
    },
    {
      id: 'automation', group: 'ops', name: 'Automationsplattform', systems: 'Flow Designer, Power Automate, Ansible, Azure Automation',
      tells: 'Aktive Workflows, Ausführungen, Fehlerquote und ob Alarme Workflows auslösen.', fields: ['automation'],
      columns: 'workflow, runs, failures, trigger',
      derive(rows) {
        let runs = 0, fails = 0; rows.forEach(r => { runs += num(col(r, ['runs', 'executions', 'ausführungen', 'count', 'anzahl'])) || 0; fails += num(col(r, ['failures', 'failed', 'fehler', 'errors'])) || 0; });
        const trig = rows.map(r => String(col(r, ['trigger', 'type', 'auslöser', 'kategorie'])).toLowerCase());
        const m = { workflows: rows.length, runs, failureRate: runs ? fails / runs : null, eventTriggered: trig.filter(t => /alert|event|monitor|alarm|webhook/.test(t)).length };
        const s = [];
        if (m.workflows >= 10) s.push(sig('automation', 3, 1, m.workflows + ' Workflows mit ' + runs + ' Ausführungen: Standardanfragen laufen automatisiert')); else if (m.workflows >= 3) s.push(sig('automation', 3, .5, 'Erst ' + m.workflows + ' Workflows im Einsatz')); else s.push(sig('automation', 3, -.5, 'Nur ' + m.workflows + ' Workflows im Einsatz'));
        if (m.eventTriggered >= 3) s.push(sig('automation', 4, .8, m.eventTriggered + ' Workflows werden von Alarmen oder Ereignissen ausgelöst'));
        return { metrics: m, signals: s, summary: m.workflows + ' Workflows · ' + runs + ' Ausführungen · ' + pct(m.failureRate) + ' Fehler' };
      },
      demo(rand) { return [['Passwort-Reset Service Desk', 410, 12, 'manual'], ['Softwareverteilung Standardpaket', 96, 4, 'request'], ['Neues Netzlaufwerk anlegen', 31, 2, 'request'], ['Serverneustart nach Alarm', 18, 1, 'alert']].map(x => ({ workflow: x[0], runs: x[1], failures: x[2], trigger: x[3] })); }
    },
    {
      id: 'storage', group: 'ops', name: 'Speicher und Kapazität', systems: 'NetApp, Azure Storage, Backup-Reports',
      tells: 'Füllstände und Wachstum je Volume. Kalibriert das Ereignis Fileshare läuft voll und zeigt Engpässe vor dem Ausfall.', fields: ['telemetry'],
      columns: 'volume, usedPercent, growthPercentPerMonth',
      derive(rows) {
        const used = rows.map(r => pctv(col(r, ['usedPercent', 'used_pct', 'belegt', 'utilization', 'used', 'füllstand']))).filter(v => v !== null);
        const m = { volumes: rows.length, nearFull: used.filter(v => v >= .85).length, avgUsed: avg(used) };
        return { metrics: m, signals: [sig('telemetry', 2, .3, 'Kapazitätsdaten für ' + m.volumes + ' Volumes vorhanden, ' + m.nearFull + ' über 85 % belegt')], summary: m.volumes + ' Volumes · ' + m.nearFull + ' über 85 % · Ø ' + pct(m.avgUsed), calib: { storage: m.nearFull / 3 } };
      },
      demo(rand) { return ['Projekte', 'Vertrieb', 'Finanzen', 'Technik', 'Archiv', 'Home', 'Produktion', 'Marketing'].map(v => ({ volume: v, usedPercent: Math.round(45 + rand() * 50), growthPercentPerMonth: (1 + rand() * 4).toFixed(1) })); }
    },
    {
      id: 'network', group: 'ops', name: 'Netzwerk-Controller', systems: 'Meraki, Aruba Central, Mist',
      tells: 'Fehlerraten und Clients je Access Point und Standort. Kalibriert WLAN- und Anrufqualitätsstörungen.', fields: ['telemetry'],
      columns: 'accessPoint, site, errorRatePercent, clients',
      derive(rows, ctx) {
        const err = rows.map(r => pctv(col(r, ['errorRatePercent', 'errorRate', 'errors', 'fehlerrate', 'fehler']))).filter(v => v !== null);
        const m = { aps: rows.length, highErrorAps: err.filter(v => v > .05).length, avgError: avg(err) };
        const calib = {}; if (ctx.employees) calib.wlan = m.highErrorAps / ctx.employees * 100;
        return { metrics: m, signals: [sig('telemetry', 2, .3, m.aps + ' Access Points überwacht, ' + m.highErrorAps + ' mit erhöhter Fehlerrate')], summary: m.aps + ' Access Points · ' + m.highErrorAps + ' auffällig', calib };
      },
      demo(rand) { const out = []; for (let i = 0; i < 28; i++) out.push({ accessPoint: 'AP-' + (i + 1), site: i < 20 ? 'Hauptstandort' : 'Werk 2', errorRatePercent: (rand() < .15 ? 6 + rand() * 8 : rand() * 3).toFixed(1), clients: Math.floor(5 + rand() * 40) }); return out; }
    },
    {
      id: 'edr', group: 'security', name: 'EDR / XDR und SIEM', systems: 'Defender, CrowdStrike, Sentinel, Splunk', graph: true,
      tells: 'Zeit bis Eindämmung und Anteil automatisch isolierter Vorfälle. Kalibriert Sicherheitsvorfälle.', fields: ['security'],
      columns: 'detectedAt, containedAt, severity, automated',
      derive(rows, ctx) {
        const dur = []; rows.forEach(r => { const d = date(col(r, ['detectedAt', 'createdDateTime', 'created', 'firstSeen', 'erkannt'])), c = date(col(r, ['containedAt', 'resolvedDateTime', 'resolvedAt', 'remediatedAt', 'lastUpdateDateTime', 'eingedämmt', 'closed'])); if (d && c && c > d) dur.push((c - d) / 3600000); });
        const auto = rows.map(r => String(col(r, ['automated', 'autoRemediated', 'automatisch', 'action', 'determination', 'remediation'])).toLowerCase());
        const per = months(rows, r => date(col(r, ['detectedAt', 'createdDateTime', 'created', 'firstSeen'])));
        const m = { incidents: rows.length, perMonth: rows.length / per, mttcHours: avg(dur), autoShare: share(auto, v => /true|yes|ja|auto|isolat|quarant|blocked|remediated/.test(v)) };
        const s = [sig('security', 3, 1, 'EDR mit ' + m.incidents + ' Vorfällen, Eindämmung Ø ' + (m.mttcHours !== null ? m.mttcHours.toFixed(1) + ' h' : '–'))];
        if (m.mttcHours !== null) { if (m.mttcHours <= 1 && m.autoShare >= .5) s.push(sig('security', 5, 1, pct(m.autoShare) + ' der Vorfälle automatisch isoliert, Eindämmung unter einer Stunde')); else if (m.mttcHours <= 24) s.push(sig('security', 4, .5, 'Eindämmung innerhalb eines Tages')); else s.push(sig('security', 4, -.5, 'Eindämmung dauert Ø ' + m.mttcHours.toFixed(0) + ' h')); }
        const calib = {}; if (ctx.employees) calib.login = m.perMonth / ctx.employees * 100;
        return { metrics: m, signals: s, summary: m.incidents + ' Vorfälle · Eindämmung Ø ' + (m.mttcHours !== null ? m.mttcHours.toFixed(0) + ' h' : '–') + ' · ' + pct(m.autoShare) + ' automatisch', calib };
      },
      demo(rand) { const out = []; for (let i = 0; i < 14; i++) { const d = daysAgo(Math.floor(rand() * 180)); out.push({ detectedAt: d.toISOString().slice(0, 16).replace('T', ' '), containedAt: new Date(d.getTime() + (6 + rand() * 60) * 3600000).toISOString().slice(0, 16).replace('T', ' '), severity: rand() < .3 ? 'high' : 'medium', automated: rand() < .2 ? 'true' : 'false' }); } return out; }
    },
    {
      id: 'vuln', group: 'security', name: 'Schwachstellenmanagement', systems: 'Tenable, Qualys, Defender Vulnerability Management',
      tells: 'Zeit bis Schließung kritischer Schwachstellen und Patch-Compliance. Kalibriert Zero-Day-Ereignisse.', fields: ['security'],
      columns: 'cve, severity, published, fixed',
      derive(rows) {
        const crit = rows.filter(r => /crit|high|hoch|9|10/.test(String(col(r, ['severity', 'cvss', 'schwere', 'risk'])).toLowerCase()));
        const fix = []; let open = 0; crit.forEach(r => { const p = date(col(r, ['published', 'discovered', 'firstFound', 'gefunden', 'detected'])), f = date(col(r, ['fixed', 'resolved', 'closed', 'behoben', 'remediated'])); if (p && f) fix.push(days(p, f)); else if (p) open++; });
        const per = months(rows, r => date(col(r, ['published', 'discovered', 'firstFound', 'gefunden'])));
        const m = { total: rows.length, critical: crit.length, criticalPerMonth: crit.length / per, avgDaysToFixCritical: avg(fix), openCritical: open, fixedWithin30Share: fix.length ? share(fix, v => v <= 30) : null };
        const s = [sig('security', 3, .5, 'Schwachstellenmanagement mit ' + m.total + ' Funden, ' + m.critical + ' kritisch')];
        if (m.avgDaysToFixCritical !== null) { if (m.avgDaysToFixCritical <= 14) s.push(sig('security', 4, 1, 'Kritische Schwachstellen in Ø ' + m.avgDaysToFixCritical.toFixed(0) + ' Tagen geschlossen')); else if (m.avgDaysToFixCritical <= 30) s.push(sig('security', 4, .5, 'Kritische Schwachstellen in Ø ' + m.avgDaysToFixCritical.toFixed(0) + ' Tagen geschlossen')); else s.push(sig('security', 4, -.7, 'Kritische Schwachstellen bleiben Ø ' + m.avgDaysToFixCritical.toFixed(0) + ' Tage offen')); }
        return { metrics: m, signals: s, summary: m.critical + ' kritische Funde · Schließung Ø ' + (m.avgDaysToFixCritical !== null ? m.avgDaysToFixCritical.toFixed(0) + ' Tage' : '–') + ' · ' + m.openCritical + ' offen', calib: { cve: m.criticalPerMonth } };
      },
      demo(rand) { const out = []; for (let i = 0; i < 160; i++) { const p = daysAgo(Math.floor(rand() * 180)); const crit = rand() < .22; const fixed = rand() < .8; out.push({ cve: 'CVE-2026-' + (10000 + i), severity: crit ? 'critical' : (rand() < .5 ? 'medium' : 'low'), published: iso(p), fixed: fixed ? iso(new Date(p.getTime() + (crit ? 20 + rand() * 50 : 30 + rand() * 90) * 86400000)) : '' }); } return out; }
    },
    {
      id: 'timesheets', group: 'org', name: 'Zeiterfassung der IT', systems: 'Jira, Azure Boards, Zeitbuchungen',
      tells: 'Anteil der Arbeitszeit für Störungen, Anfragen, Changes und Verbesserung. Die Feuerwehr-Quote ist der stärkste Indikator für Stufe 1 und 2.', fields: ['org'],
      columns: 'category, hours',
      derive(rows) {
        const buckets = { fire: 0, request: 0, change: 0, improve: 0, other: 0 }; let total = 0;
        rows.forEach(r => { const c = String(col(r, ['category', 'type', 'kategorie', 'worktype', 'tätigkeit'])).toLowerCase(); const h = num(col(r, ['hours', 'stunden', 'duration', 'dauer'])) || 0; total += h; if (/incident|störung|stoerung|support|fire|hotline/.test(c)) buckets.fire += h; else if (/request|anfrage|service/.test(c)) buckets.request += h; else if (/change|projekt|project|release/.test(c)) buckets.change += h; else if (/improve|automat|verbesser|innovation|optimier/.test(c)) buckets.improve += h; else buckets.other += h; });
        const m = { hours: total, fireShare: total ? buckets.fire / total : null, requestShare: total ? buckets.request / total : null, improveShare: total ? buckets.improve / total : null };
        const s = [];
        if (m.fireShare !== null) { if (m.fireShare > .6) s.push(sig('org', 2, -.7, pct(m.fireShare) + ' der IT-Arbeitszeit gehen in Störungsbeseitigung: Feuerwehrbetrieb')); else s.push(sig('org', 2, .5, pct(m.fireShare) + ' der IT-Arbeitszeit für Störungen: planbarer Betrieb')); }
        if (m.improveShare !== null) { if (m.improveShare >= .15) s.push(sig('org', 3, 1, pct(m.improveShare) + ' der Arbeitszeit für Automatisierung und Verbesserung fest eingeplant')); else s.push(sig('org', 3, -.7, 'Nur ' + pct(m.improveShare) + ' der Arbeitszeit für Automatisierung und Verbesserung')); }
        return { metrics: m, signals: s, summary: Math.round(total) + ' h · Störungen ' + pct(m.fireShare) + ' · Verbesserung ' + pct(m.improveShare) };
      },
      demo(rand) { return [['Incident', 1420], ['Request', 860], ['Change / Projekt', 540], ['Verbesserung / Automatisierung', 110], ['Sonstiges', 190]].map(x => ({ category: x[0], hours: x[1] })); }
    },
    {
      id: 'budget', group: 'org', name: 'IT-Budget und Verträge', systems: 'Controlling, Vertragsverwaltung, Cloud-Rechnungen',
      tells: 'Laufende Kosten je Werkzeug und Vertragsenden. Zeigt Ablösefenster für die Roadmap.', fields: [],
      columns: 'item, annualCost, endDate',
      derive(rows) {
        let total = 0; const ending = []; rows.forEach(r => { const c = num(col(r, ['annualCost', 'cost', 'kosten', 'betrag', 'amount'])) || 0; total += c; const e = date(col(r, ['endDate', 'laufzeitende', 'renewal', 'ende', 'expires'])); if (e && days(new Date(), e) <= 365 && days(new Date(), e) >= -30) ending.push(String(col(r, ['item', 'tool', 'vertrag', 'name', 'produkt'])) + ' (' + e.toLocaleDateString('de-DE', { month: 'short', year: 'numeric' }) + ')'); });
        const m = { items: rows.length, totalAnnual: total, endingWithin12m: ending };
        return { metrics: m, signals: [], summary: rows.length + ' Posten · ' + Math.round(total).toLocaleString('de-DE') + ' € je Jahr · ' + ending.length + ' Verträge enden binnen 12 Monaten', note: ending.length ? 'Ablösefenster: ' + ending.join(', ') : '' };
      },
      demo(rand) { return [['ServiceNow ITSM', 84000, 420], ['PRTG', 6500, 95], ['WSUS / SCCM (CALs)', 22000, 300], ['Microsoft 365', 310000, 180], ['Defender for Endpoint', 28000, 180], ['Wartung Server', 41000, 60]].map(x => ({ item: x[0], annualCost: x[1], endDate: iso(new Date(Date.now() + x[2] * 86400000)) })); }
    },
    {
      id: 'team', group: 'org', name: 'Organigramm und Rollen', systems: 'HR, Teamstruktur, Dienstpläne',
      tells: 'Teamgrößen und Rollenprofile. Bestimmt, wie viele Roadmap-Schritte parallel laufen können.', fields: ['org'],
      columns: 'role, fte',
      derive(rows) {
        let fte = 0, auto = 0, desk = 0, product = 0; rows.forEach(r => { const role = String(col(r, ['role', 'rolle', 'team', 'funktion'])).toLowerCase(); const n = num(col(r, ['fte', 'count', 'anzahl', 'headcount', 'vza'])) || 0; fte += n; if (/automat|sre|platform|devops|engineer/.test(role)) auto += n; if (/desk|support|hotline|1st/.test(role)) desk += n; if (/product|produkt|owner/.test(role)) product += n; });
        const m = { itFte: fte, automationFte: auto, serviceDeskFte: desk, productFte: product, lanes: Math.max(1, Math.min(4, Math.round(fte / 8) || 1)) };
        const s = [];
        if (auto >= 1) s.push(sig('org', 3, 1, auto + ' Vollzeitstellen für Automation Engineering')); else s.push(sig('org', 3, -.7, 'Keine Stelle für Automation Engineering im Organigramm'));
        if (product >= 1) s.push(sig('org', 4, .5, product + ' Product-Owner-Rollen: Produktorientierung begonnen'));
        return { metrics: m, signals: s, summary: fte + ' Vollzeitstellen IT · ' + auto + ' Automation · ' + desk + ' Service Desk · ' + m.lanes + ' parallele Stränge', lanes: m.lanes };
      },
      demo(rand) { return [['Service Desk', 5], ['2nd Level / Field Service', 4], ['Infrastruktur und Netzwerk', 4], ['Anwendungsbetreuung', 3], ['IT-Sicherheit', 1], ['IT-Leitung', 1]].map(x => ({ role: x[0], fte: x[1] })); }
    },
    {
      id: 'knowledge', group: 'org', name: 'Wissensdatenbank und Wiki', systems: 'Confluence, SharePoint, ServiceNow Knowledge',
      tells: 'Alter und Nutzung der Artikel, Verknüpfung mit Tickets. Zeigt, wie viel Betriebswissen explizit und automatisierbar vorliegt.', fields: ['service'],
      columns: 'title, updated, views, linkedTickets',
      derive(rows) {
        const upd = rows.map(r => date(col(r, ['updated', 'lastModified', 'geändert', 'modified', 'lastUpdated']))).filter(Boolean);
        const linked = rows.map(r => num(col(r, ['linkedTickets', 'tickets', 'verknüpft', 'attached'])) || 0);
        const m = { articles: rows.length, staleShare: upd.length ? share(upd, d => days(d, new Date()) > 365) : null, linkedShare: rows.length ? linked.filter(v => v > 0).length / rows.length : null };
        const s = [];
        if (m.articles >= 50 && (m.staleShare === null || m.staleShare < .4)) s.push(sig('service', 3, .7, m.articles + ' Wissensartikel, ' + pct(m.staleShare) + ' älter als ein Jahr: nutzbare Wissensbasis')); else s.push(sig('service', 3, -.3, m.articles + ' Wissensartikel, ' + pct(m.staleShare) + ' älter als ein Jahr'));
        return { metrics: m, signals: s, summary: m.articles + ' Artikel · ' + pct(m.staleShare) + ' veraltet · ' + pct(m.linkedShare) + ' mit Tickets verknüpft' };
      },
      demo(rand) { const out = []; for (let i = 0; i < 72; i++) out.push({ title: 'KB-' + (100 + i), updated: iso(daysAgo(Math.floor(rand() * 900))), views: Math.floor(rand() * 400), linkedTickets: rand() < .3 ? Math.floor(1 + rand() * 20) : 0 }); return out; }
    },
    {
      id: 'repos', group: 'org', name: 'Code-Repositories', systems: 'GitLab, GitHub, Azure DevOps',
      tells: 'Skripte, Playbooks, Commits und Infrastructure-as-Code-Anteil. Harte Evidenz für Automatisierungsreife.', fields: ['automation'],
      columns: 'repository, scripts, commits90d, iacFiles',
      derive(rows) {
        let scripts = 0, commits = 0, iac = 0; rows.forEach(r => { scripts += num(col(r, ['scripts', 'files', 'dateien', 'skripte'])) || 0; commits += num(col(r, ['commits90d', 'commits', 'commits_90d', 'änderungen'])) || 0; iac += num(col(r, ['iacFiles', 'iac', 'terraform', 'ansible'])) || 0; });
        const m = { repos: rows.length, scripts, commits, iacShare: scripts ? iac / scripts : null };
        const s = [sig('automation', 2, 1, m.repos + ' Repositories mit ' + scripts + ' Skripten, ' + commits + ' Commits in 90 Tagen: versionierte Skript-Bibliothek')];
        if (iac >= 10 || (m.iacShare !== null && m.iacShare >= .2)) s.push(sig('automation', 4, .5, iac + ' Infrastructure-as-Code-Dateien'));
        return { metrics: m, signals: s, summary: m.repos + ' Repositories · ' + scripts + ' Skripte · ' + commits + ' Commits/90 Tage · ' + iac + ' IaC-Dateien' };
      },
      demo(rand) { return [['it-scripts', 86, 41, 0], ['client-deployment', 23, 9, 0], ['server-automation', 17, 6, 3]].map(x => ({ repository: x[0], scripts: x[1], commits90d: x[2], iacFiles: x[3] })); }
    },
    {
      id: 'survey', group: 'people', name: 'Zufriedenheit und XLA', systems: 'Ticket-Feedback, Pulsbefragung, NPS der IT',
      tells: 'Gemessener Startwert für den Experience-Index statt Annahme.', fields: ['service'],
      columns: 'score (1 bis 5, 1 bis 10 oder 0 bis 100)',
      derive(rows) {
        const sc = rows.map(r => num(col(r, ['score', 'rating', 'bewertung', 'zufriedenheit', 'nps', 'wert']))).filter(v => v !== null);
        const max = sc.length ? Math.max.apply(null, sc) : 0; const scale = max <= 5 ? 5 : (max <= 10 ? 10 : 100);
        const m = { responses: sc.length, avg0to100: sc.length ? avg(sc) / scale * 100 : null };
        const s = m.avg0to100 !== null && m.avg0to100 >= 80 ? [sig('service', 4, .3, 'Zufriedenheit ' + Math.round(m.avg0to100) + ' von 100: Mitarbeiter erleben die IT als proaktiv')] : [];
        return { metrics: m, signals: s, summary: m.responses + ' Antworten · Experience ' + (m.avg0to100 !== null ? Math.round(m.avg0to100) : '–') + ' von 100', experience: m.avg0to100 };
      },
      demo(rand) { const out = []; for (let i = 0; i < 180; i++) out.push({ score: Math.max(1, Math.min(5, Math.round(2.4 + rand() * 2.6))) }); return out; }
    },
    {
      id: 'chat', group: 'people', name: 'Teams-Kanäle und Postfächer der IT', systems: 'Teams, Outlook, Slack',
      tells: 'Schattenaufkommen, das nie zum Ticket wird. Oft 20 bis 40 Prozent zusätzliche Anfragen.', fields: ['service'],
      columns: 'message, channel, date',
      derive(rows, ctx) {
        const texts = rows.map(r => String(col(r, ['message', 'text', 'nachricht', 'body', 'subject', 'betreff'])));
        const per = months(rows, r => date(col(r, ['date', 'timestamp', 'datum', 'created'])));
        const byType = {}; texts.forEach(t => { const ty = window.Connectors.classify(t, '', ''); byType[ty] = (byType[ty] || 0) + 1; });
        const perMonth = rows.length / per; const tickets = ctx.ticketsPerMonth || 0;
        const m = { messages: rows.length, perMonth, shadowShare: tickets ? perMonth / (perMonth + tickets) : null, byType };
        const s = m.shadowShare !== null && m.shadowShare > .25 ? [sig('service', 3, -.5, pct(m.shadowShare) + ' der Anliegen laufen an Chat und Postfächern vorbei am Ticketsystem')] : [];
        return { metrics: m, signals: s, summary: Math.round(perMonth) + ' Anliegen je Monat außerhalb des ITSM' + (m.shadowShare !== null ? ' · ' + pct(m.shadowShare) + ' Schattenaufkommen' : ''), shadowPerMonth: perMonth };
      },
      demo(rand) { const t = ['Kann mir jemand schnell das Passwort zurücksetzen?', 'Drucker im 2. OG geht wieder nicht', 'Brauche Zugriff auf das Projektlaufwerk', 'Teams hängt bei mir seit heute früh', 'Wer kann mir Visio freischalten?', 'WLAN im Besprechungsraum ist weg', 'Outlook startet nicht']; const out = []; for (let i = 0; i < 190; i++) out.push({ message: t[Math.floor(rand() * t.length)], channel: rand() < .6 ? 'Teams: IT-Hilfe' : 'Postfach it@', date: iso(daysAgo(Math.floor(rand() * 180))) }); return out; }
    },
    {
      id: 'agentlogs', group: 'agents', name: 'Konversationen von KI-Assistenten und Chatbots', systems: 'Now Assist, Virtual Agent, Copilot, Moveworks, Aisera',
      tells: 'Anliegen je Monat, Anteil ohne menschliche Übergabe gelöst (Containment), Eskalationen, häufigste Themen. Zeigt, welche Nachfrage der Agent bereits abfängt.', fields: ['service', 'automation'],
      columns: 'timestamp, intent, resolved, escalated, satisfaction, text',
      derive(rows, ctx) {
        const per = months(rows, r => date(col(r, ['timestamp', 'created', 'date', 'zeit', 'started'])));
        const res = rows.map(r => String(col(r, ['resolved', 'contained', 'gelöst', 'deflected', 'outcome', 'ergebnis'])).toLowerCase());
        const esc = rows.map(r => String(col(r, ['escalated', 'handoff', 'eskaliert', 'transferred', 'übergabe'])).toLowerCase());
        const sat = rows.map(r => num(col(r, ['satisfaction', 'csat', 'rating', 'zufriedenheit', 'bewertung']))).filter(v => v !== null);
        const byType = {}; rows.forEach(r => { const t = window.Connectors.classify(String(col(r, ['text', 'utterance', 'intent', 'topic', 'thema', 'anliegen'])), '', ''); byType[t] = (byType[t] || 0) + 1; });
        const m = { conversations: rows.length, perMonth: rows.length / per, containment: share(res, v => /true|yes|ja|1|resolved|contained|gelöst|deflected|success/.test(v) && !/not|nicht|un/.test(v)), escalation: share(esc, v => /true|yes|ja|1|agent|human|mensch/.test(v)), satisfaction: sat.length ? avg(sat) : null, byType };
        const s = [sig('service', 3, 1, 'KI-Assistent im Einsatz: ' + Math.round(m.perMonth) + ' Konversationen je Monat, ' + pct(m.containment) + ' ohne Übergabe gelöst')];
        if (m.containment >= .5) { s.push(sig('service', 4, .5, 'Containment ' + pct(m.containment) + ': der Assistent löst die Mehrheit der Anliegen selbst')); s.push(sig('automation', 3, .7, 'Assistent führt Lösungen aus, nicht nur Antworten')); }
        else if (m.containment < .3) s.push(sig('service', 4, -.3, 'Containment nur ' + pct(m.containment) + ': der Assistent übergibt meist an Menschen'));
        const calib = {}; if (ctx.employees) Object.keys(byType).forEach(t => { const ev = EVENTS.find(e => e.id === t); if (!ev || byType[t] < 5) return; calib[t] = ev.perCompany ? byType[t] / per : byType[t] / per / ctx.employees * 100; });
        return { metrics: m, signals: s, summary: Math.round(m.perMonth) + ' Konversationen je Monat · Containment ' + pct(m.containment) + ' · Eskalation ' + pct(m.escalation), calib, quickWin: m.containment < .4 ? { title: 'Wissensbasis und Aktionen des Assistenten ausbauen', why: 'Der KI-Assistent löst nur ' + pct(m.containment) + ' der ' + Math.round(m.perMonth) + ' monatlichen Anliegen selbst. Die häufigsten Themen (' + Object.keys(byType).filter(k => k !== 'other').sort((a, b) => byType[b] - byType[a]).slice(0, 3).map(k => { const e = EVENTS.find(x => x.id === k); return e ? e.title.split(':')[0] : k; }).join(', ') + ') lassen sich mit Aktionen statt Artikeln abschließen.', field: 'service', stage: 3, effort: 'gering' } : null };
      },
      demo(rand) { const t = ['Passwort zurücksetzen', 'Wie beantrage ich Visio?', 'Mein Notebook ist langsam', 'VPN verbindet nicht', 'Wo finde ich das Projektlaufwerk?', 'Teams Audio geht nicht', 'Neuen Mitarbeiter anmelden', 'Drucker einrichten']; const out = []; for (let i = 0; i < 410; i++) { const r = rand() < .38; out.push({ timestamp: iso(daysAgo(Math.floor(rand() * 180))), intent: t[Math.floor(rand() * t.length)], resolved: r ? 'true' : 'false', escalated: r ? 'false' : (rand() < .8 ? 'true' : 'false'), satisfaction: Math.round(2 + rand() * 3) }); } return out; }
    },
    {
      id: 'agentactions', group: 'agents', name: 'Aktionsprotokolle autonomer Agenten und RPA-Bots', systems: 'Now Assist Agents, UiPath, Automation Anywhere, eigene Agenten',
      tells: 'Ausgeführte Aktionen, Anteil ohne menschliche Freigabe, Erfolgsquote, Risikoklassen. Zeigt, wie weit Agenten heute schon handeln dürfen.', fields: ['automation', 'telemetry', 'org'],
      columns: 'timestamp, agent, action, outcome, approval, riskClass',
      derive(rows) {
        const per = months(rows, r => date(col(r, ['timestamp', 'started', 'date', 'zeit'])));
        const out = rows.map(r => String(col(r, ['outcome', 'result', 'status', 'ergebnis'])).toLowerCase());
        const appr = rows.map(r => String(col(r, ['approval', 'approvedBy', 'freigabe', 'mode', 'humanInLoop'])).toLowerCase());
        const risk = rows.map(r => String(col(r, ['riskClass', 'risk', 'risiko', 'klasse'])).toLowerCase()).filter(Boolean);
        const agents = Array.from(new Set(rows.map(r => String(col(r, ['agent', 'bot', 'workflow', 'name']))))).filter(Boolean);
        const actions = Array.from(new Set(rows.map(r => String(col(r, ['action', 'aktion', 'task', 'skill']))))).filter(Boolean);
        const m = { actions: rows.length, perMonth: rows.length / per, agents: agents.length, actionTypes: actions.length, successRate: share(out, v => /success|ok|done|erfolg|completed|true/.test(v)), autonomousShare: share(appr, v => /auto|none|keine|self|ohne|policy|no/.test(v) && !/human|manual|mensch|required/.test(v)), riskClassed: risk.length / Math.max(1, rows.length) };
        const trig = rows.map(r => String(col(r, ['trigger', 'auslöser', 'source', 'initiatedBy'])).toLowerCase());
        const s = [sig('automation', 3, 1, agents.length + ' Agenten oder Bots führen ' + Math.round(m.perMonth) + ' Aktionen je Monat aus (' + actions.length + ' Aktionstypen, ' + pct(m.successRate) + ' erfolgreich)')];
        if (trig.some(t => /alert|event|monitor|alarm|anomal/.test(t))) s.push(sig('automation', 4, .8, 'Agentenaktionen werden von Alarmen oder Ereignissen ausgelöst'));
        if (m.autonomousShare >= .6 && m.successRate >= .95 && m.riskClassed >= .8) s.push(sig('automation', 5, 1, pct(m.autonomousShare) + ' der Aktionen ohne menschliche Freigabe innerhalb klassifizierter Risikoklassen'));
        else if (m.autonomousShare >= .3) s.push(sig('automation', 5, .4, pct(m.autonomousShare) + ' der Aktionen laufen ohne Freigabe'));
        if (m.riskClassed >= .8) s.push(sig('org', 5, .6, 'Jede Agentenaktion trägt eine Risikoklasse: Policy-gesteuerte Freigaben vorhanden')); else if (rows.length) s.push(sig('org', 5, -.4, 'Agentenaktionen ohne Risikoklassifizierung: keine Leitplanken dokumentiert'));
        if (actions.some(a => /diagnos|analy|root cause|ursache|triage/i.test(a))) s.push(sig('telemetry', 5, .5, 'Agenten übernehmen Diagnose und Ursachenanalyse'));
        return { metrics: m, signals: s, summary: agents.length + ' Agenten · ' + Math.round(m.perMonth) + ' Aktionen je Monat · ' + pct(m.autonomousShare) + ' autonom · ' + pct(m.successRate) + ' erfolgreich' };
      },
      demo(rand) { const out = []; const acts = [['RPA Lizenzbuchung', 'SAP-Benutzer anlegen', 'manual'], ['RPA Lizenzbuchung', 'Lizenz im Portal buchen', 'manual'], ['RPA Rechnungsabgleich', 'Rechnung prüfen', 'auto']]; for (let i = 0; i < 96; i++) { const a = acts[Math.floor(rand() * acts.length)]; out.push({ timestamp: iso(daysAgo(Math.floor(rand() * 180))), agent: a[0], action: a[1], outcome: rand() < .93 ? 'success' : 'failed', approval: a[2], riskClass: '' }); } return out; }
    },
    {
      id: 'agentregistry', group: 'agents', name: 'Agentenregister', systems: 'Agentenkatalog, AI-Governance-Register, Copilot-Studio-Übersicht',
      tells: 'Welche Agenten es gibt, wofür, mit welchem Verantwortlichen und welchen Leitplanken. Grundlage für Governance und Stufe 5.', fields: ['org', 'automation'],
      columns: 'agent, platform, useCase, owner, guardrails, status',
      derive(rows) {
        const own = rows.map(r => String(col(r, ['owner', 'verantwortlich', 'responsible', 'product owner'])));
        const gr = rows.map(r => String(col(r, ['guardrails', 'policy', 'leitplanken', 'controls', 'approval']))).map(v => v.toLowerCase());
        const act = rows.filter(r => /prod|aktiv|active|live/.test(String(col(r, ['status', 'stage', 'phase'])).toLowerCase()));
        const m = { agents: rows.length, active: act.length, ownerShare: share(own, v => v.trim().length > 1), guardrailShare: share(gr, v => v.trim().length > 1 && !/none|keine|-|n\/a/.test(v)) };
        const s = [];
        if (m.agents) s.push(sig('automation', 4, .5, m.agents + ' Agenten im Register, ' + m.active + ' produktiv'));
        if (m.ownerShare >= .9 && m.guardrailShare >= .8) s.push(sig('org', 5, .8, 'Jeder Agent hat Verantwortlichen und dokumentierte Leitplanken: Governance für autonome Systeme vorhanden')); else if (m.agents) s.push(sig('org', 5, -.5, 'Nur ' + pct(m.guardrailShare) + ' der Agenten mit dokumentierten Leitplanken'));
        if (m.ownerShare >= .8) s.push(sig('org', 4, .4, 'Agenten haben benannte Product Owner'));
        return { metrics: m, signals: s, summary: m.agents + ' Agenten · ' + m.active + ' produktiv · ' + pct(m.ownerShare) + ' mit Verantwortlichem · ' + pct(m.guardrailShare) + ' mit Leitplanken' };
      },
      demo(rand) { return [['Virtual Agent IT-Hilfe', 'ServiceNow Virtual Agent', 'Self-Service Standardanfragen', 'Service Desk Lead', 'nur Wissensartikel, keine Aktionen', 'produktiv'], ['RPA Lizenzbuchung', 'UiPath', 'SAP-Benutzer und Lizenzen', '', '', 'produktiv'], ['RPA Rechnungsabgleich', 'UiPath', 'Rechnungsprüfung', 'Finanzen', '', 'produktiv']].map(x => ({ agent: x[0], platform: x[1], useCase: x[2], owner: x[3], guardrails: x[4], status: x[5] })); }
    },
    {
      id: 'otassets', group: 'ot', ot: true, name: 'OT-Asset-Inventar', systems: 'Claroty, Nozomi, Armis, Tenable OT, Cisco Cyber Vision',
      tells: 'Steuerungen, HMIs und Netzkomponenten mit Firmware, Zone, Betriebssystem-Ende und Schwachstellen. Belegt Inventar, Segmentierung und Monitoring.', fields: ['ot', 'security'],
      columns: 'asset, type, vendor, firmware, zone, osEndOfLife, criticalVulns, lastSeen',
      derive(rows) {
        const zone = rows.map(r => String(col(r, ['zone', 'segment', 'purdue', 'level', 'vlan'])));
        const eol = rows.map(r => String(col(r, ['osEndOfLife', 'eol', 'endOfLife', 'end_of_life', 'supportEnde', 'unsupported'])).toLowerCase());
        const vul = rows.map(r => num(col(r, ['criticalVulns', 'vulnerabilities', 'critical', 'schwachstellen', 'cves'])) || 0);
        const types = {}; rows.forEach(r => { const t = String(col(r, ['type', 'typ', 'class', 'category']) || 'unbekannt'); types[t] = (types[t] || 0) + 1; });
        const m = { assets: rows.length, zonedShare: share(zone, z => z.trim().length > 0 && !/none|keine|flat|-/.test(z.toLowerCase())), eolShare: share(eol, v => /true|yes|ja|1|eol|ended|abgelaufen/.test(v)), vulnerableShare: share(vul, v => v > 0), criticalVulns: vul.reduce((a, b) => a + b, 0), types };
        const s = [sig('ot', 2, 1, 'OT-Inventar mit ' + m.assets + ' Assets (' + Object.keys(types).slice(0, 4).map(k => types[k] + ' ' + k).join(', ') + ')'), sig('ot', 3, .8, 'Passive Asset-Erkennung im Einsatz: Firmware und Schwachstellen je Asset bekannt')];
        if (m.zonedShare >= .9) s.push(sig('ot', 2, .5, pct(m.zonedShare) + ' der Assets einer Zone zugeordnet: Segmentierung umgesetzt')); else if (m.zonedShare < .5) s.push(sig('ot', 2, -.7, 'Nur ' + pct(m.zonedShare) + ' der Assets einer Zone zugeordnet: flaches Produktionsnetz'));
        if (m.eolShare > .3) s.push(sig('security', 3, -.4, pct(m.eolShare) + ' der OT-Assets laufen mit Betriebssystemen ohne Support'));
        return { metrics: m, signals: s, summary: m.assets + ' Assets · ' + pct(m.zonedShare) + ' segmentiert · ' + pct(m.eolShare) + ' ohne OS-Support · ' + m.criticalVulns + ' kritische Schwachstellen', calib: { ot_plc: Math.min(5, m.criticalVulns / 12) }, quickWin: m.zonedShare < .5 ? { title: 'Produktionsnetz segmentieren', why: 'Nur ' + pct(m.zonedShare) + ' der ' + m.assets + ' OT-Assets sind einer Zone zugeordnet. Zonen und Conduits nach IEC 62443 begrenzen Ausbreitung und Fernzugriff ohne Eingriff in die Anlagen.', field: 'ot', stage: 2, effort: 'mittel' } : null };
      },
      demo(rand) { const out = []; const types = ['PLC', 'PLC', 'HMI', 'HMI', 'Switch', 'SCADA', 'Drive']; for (let i = 0; i < 86; i++) { const t = types[Math.floor(rand() * types.length)]; out.push({ asset: t + '-' + (100 + i), type: t, vendor: rand() < .7 ? 'Siemens' : 'Rockwell', firmware: 'V' + (2 + Math.floor(rand() * 5)) + '.' + Math.floor(rand() * 9), zone: rand() < .35 ? 'Zone 3' : '', osEndOfLife: t === 'HMI' || t === 'SCADA' ? (rand() < .6 ? 'true' : 'false') : 'false', criticalVulns: rand() < .3 ? Math.floor(1 + rand() * 3) : 0, lastSeen: iso(daysAgo(Math.floor(rand() * 20))) }); } return out; }
    },
    {
      id: 'otalarms', group: 'ot', ot: true, name: 'Stillstände aus SCADA und MES', systems: 'MES, SCADA, Instandhaltungssystem',
      tells: 'Ungeplante Stillstände je Monat, Dauer, Ursachen, Anteil vorhergesagter Ausfälle. Kalibriert Linienstillstände und belegt vorausschauende Wartung.', fields: ['ot'],
      columns: 'timestamp, line, cause, durationMin, planned, predicted',
      derive(rows) {
        const per = months(rows, r => date(col(r, ['timestamp', 'start', 'date', 'zeit'])));
        const planned = rows.map(r => String(col(r, ['planned', 'geplant', 'type'])).toLowerCase());
        const unpl = rows.filter((r, i) => !/true|yes|ja|geplant|planned|maintenance/.test(planned[i]));
        const dur = unpl.map(r => num(col(r, ['durationMin', 'duration', 'dauer', 'minutes']))).filter(v => v !== null);
        const pred = unpl.map(r => String(col(r, ['predicted', 'vorhergesagt', 'detectedBy', 'erkannt'])).toLowerCase());
        const m = { stops: rows.length, unplannedPerMonth: unpl.length / per, avgDurationMin: avg(dur), downtimeMinPerMonth: dur.reduce((a, b) => a + b, 0) / per, predictedShare: unpl.length ? share(pred, v => /true|yes|ja|predict|vorher|sensor|monitor/.test(v)) : null };
        const s = [sig('ot', 2, .5, 'Stillstände werden systematisch erfasst: ' + Math.round(m.unplannedPerMonth) + ' ungeplante je Monat, Ø ' + (m.avgDurationMin !== null ? Math.round(m.avgDurationMin) : '–') + ' Minuten')];
        if (m.predictedShare !== null) { if (m.predictedShare >= .4) s.push(sig('ot', 4, 1, pct(m.predictedShare) + ' der Ausfälle wurden vorhergesagt: vorausschauende Wartung wirkt')); else if (m.predictedShare >= .15) s.push(sig('ot', 4, .4, pct(m.predictedShare) + ' der Ausfälle vorhergesagt')); else s.push(sig('ot', 4, -.7, 'Nur ' + pct(m.predictedShare) + ' der Ausfälle wurden vorhergesagt')); }
        return { metrics: m, signals: s, summary: Math.round(m.unplannedPerMonth) + ' ungeplante Stillstände je Monat · Ø ' + (m.avgDurationMin !== null ? Math.round(m.avgDurationMin) : '–') + ' Min · ' + pct(m.predictedShare) + ' vorhergesagt', calib: { ot_stop: m.unplannedPerMonth } };
      },
      demo(rand) { const out = []; const causes = ['Sensorfehler', 'Antrieb überhitzt', 'Materialstau', 'Netzwerk MES', 'SPS-Störung', 'Wartung']; for (let i = 0; i < 48; i++) { const c = causes[Math.floor(rand() * causes.length)]; out.push({ timestamp: iso(daysAgo(Math.floor(rand() * 180))), line: 'Linie ' + (1 + Math.floor(rand() * 3)), cause: c, durationMin: Math.round(20 + rand() * 200), planned: c === 'Wartung' ? 'true' : 'false', predicted: rand() < .08 ? 'true' : 'false' }); } return out; }
    },
    {
      id: 'otremote', group: 'ot', ot: true, name: 'Fernwartungssitzungen', systems: 'Secure Remote Access, Jump-Host-Protokolle, VPN-Logs der Hersteller',
      tells: 'Sitzungen je Monat, Anteil mit Freigabe und Aufzeichnung. Belegt gesteuerte Fernwartung.', fields: ['ot', 'identity'],
      columns: 'timestamp, vendor, target, approvedBy, recorded, durationMin',
      derive(rows) {
        const per = months(rows, r => date(col(r, ['timestamp', 'start', 'date', 'zeit'])));
        const appr = rows.map(r => String(col(r, ['approvedBy', 'approval', 'freigabe', 'genehmigt'])));
        const rec = rows.map(r => String(col(r, ['recorded', 'aufgezeichnet', 'recording', 'session_recording'])).toLowerCase());
        const vendors = Array.from(new Set(rows.map(r => String(col(r, ['vendor', 'hersteller', 'partner', 'user']))))).filter(Boolean);
        const m = { sessions: rows.length, perMonth: rows.length / per, vendors: vendors.length, approvedShare: share(appr, v => v.trim().length > 1 && !/none|keine|-|n\/a/i.test(v)), recordedShare: share(rec, v => /true|yes|ja|1/.test(v)) };
        const s = [];
        if (m.approvedShare >= .9 && m.recordedShare >= .8) s.push(sig('ot', 3, 1, pct(m.approvedShare) + ' der ' + m.sessions + ' Fernwartungssitzungen freigegeben und ' + pct(m.recordedShare) + ' aufgezeichnet'));
        else if (m.approvedShare >= .6) s.push(sig('ot', 3, .4, pct(m.approvedShare) + ' der Fernwartungssitzungen freigegeben, ' + pct(m.recordedShare) + ' aufgezeichnet'));
        else s.push(sig('ot', 3, -.8, 'Nur ' + pct(m.approvedShare) + ' der Fernwartungssitzungen mit Freigabe'));
        if (m.sessions) s.push(sig('ot', 2, .5, 'Fernwartung läuft über einen protokollierten Zugang (' + vendors.length + ' Hersteller)'));
        return { metrics: m, signals: s, summary: Math.round(m.perMonth) + ' Sitzungen je Monat · ' + vendors.length + ' Hersteller · ' + pct(m.approvedShare) + ' freigegeben · ' + pct(m.recordedShare) + ' aufgezeichnet', calib: { ot_remote: m.perMonth } };
      },
      demo(rand) { const out = []; const v = ['Siemens Service', 'Maschinenbau Krüger', 'Robotik Nord']; for (let i = 0; i < 34; i++) out.push({ timestamp: iso(daysAgo(Math.floor(rand() * 180))), vendor: v[Math.floor(rand() * v.length)], target: 'HMI Linie ' + (1 + Math.floor(rand() * 3)), approvedBy: rand() < .45 ? 'M. Keller' : '', recorded: rand() < .2 ? 'true' : 'false', durationMin: Math.round(20 + rand() * 120) }); return out; }
    }
  ];

  function derive(id, rows, ctx) {
    const s = SOURCES.find(x => x.id === id); if (!s || !rows || !rows.length) return null;
    const r = s.derive(rows, ctx || {});
    r.signals = (r.signals || []).map(x => Object.assign({ source: s.name }, x));
    r.count = rows.length; r.id = id;
    return r;
  }
  function demoAll(seed, includeOt) { const rand = rng(seed || 7); const out = {}; SOURCES.forEach(s => { if (s.ot && !includeOt) return; out[s.id] = s.demo(rand); }); return out; }

  return { GROUPS, SOURCES, derive, demoAll };
})();
