/* =========================================================================
   Zero-Touch IT Simulator – Konnektoren für Kundendaten
   - Import von ServiceNow-Exporten (CSV oder JSON) für Incidents, Requests,
     Changes und CMDB
   - Direktverbindung zur ServiceNow-Tabellen-API (benötigt eine CORS-Regel
     in der Instanz, wenn die Anwendung im Browser läuft)
   - Normalisierung auf ein gemeinsames Ticketformat, Zuordnung zu den elf
     Ereignistypen, Kennzahlen
   - Beispieldaten eines fiktiven Kunden
   Schnittstelle: window.Connectors
   ========================================================================= */
window.Connectors = (function () {
  'use strict';

  /* ---------- CSV / JSON ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : text.length);
    const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : (firstLine.indexOf('\t') >= 0 && (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length ? '\t' : ',');
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
      else field += c;
    }
    if (field !== '' || row.length) { row.push(field); if (row.some(v => v !== '')) rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] || '').trim(); }); return o; });
  }
  function parseAny(text) {
    const t = text.trim();
    if (t[0] === '[' || t[0] === '{') {
      try { const j = JSON.parse(t); if (Array.isArray(j)) return j; if (j && Array.isArray(j.result)) return j.result; if (j && Array.isArray(j.records)) return j.records; return [j]; } catch (e) { /* kein JSON */ }
    }
    return parseCSV(t);
  }

  /* ---------- Normalisierung ---------- */
  const ALIASES = {
    id: ['number', 'nummer', 'id', 'ticket', 'ticket_id', 'key'],
    opened: ['opened_at', 'sys_created_on', 'created', 'erstellt', 'opened', 'created_at', 'eröffnet', 'start_date'],
    resolved: ['resolved_at', 'closed_at', 'resolved', 'closed', 'gelöst', 'geschlossen', 'end_date'],
    category: ['category', 'kategorie', 'cat'],
    subcategory: ['subcategory', 'unterkategorie', 'u_subcategory'],
    text: ['short_description', 'description', 'summary', 'titel', 'title', 'betreff', 'beschreibung', 'kurzbeschreibung'],
    contact: ['contact_type', 'kontaktart', 'channel', 'kanal', 'source', 'quelle', 'u_channel'],
    group: ['assignment_group', 'gruppe', 'team', 'assigned_group'],
    resolvedBy: ['resolved_by', 'closed_by', 'assigned_to', 'bearbeiter', 'resolver'],
    reopen: ['reopen_count', 'reopened', 'wiedereröffnet'],
    priority: ['priority', 'priorität', 'prio'],
    state: ['state', 'status', 'incident_state'],
    closeCode: ['close_code', 'resolution_code', 'lösungscode', 'u_close_code'],
    type: ['type', 'typ', 'ticket_type', 'sys_class_name']
  };
  function pick(row, key) {
    const keys = Object.keys(row);
    for (const a of ALIASES[key]) { const k = keys.find(x => x.toLowerCase() === a); if (k !== undefined && row[k] !== undefined && row[k] !== '') return row[k]; }
    for (const a of ALIASES[key]) { const k = keys.find(x => x.toLowerCase().indexOf(a) >= 0); if (k !== undefined && row[k] !== undefined && row[k] !== '') return row[k]; }
    return '';
  }
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    let s = String(v).trim();
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    const d = new Date(s); return isNaN(d) ? null : d;
  }

  function classify(text, category, subcategory) {
    const t = ((category || '') + ' ' + (subcategory || '') + ' ' + (text || '')).toLowerCase();
    for (const r of TICKET_RULES) { if (r.kw.some(k => t.indexOf(k) >= 0)) return r.type; }
    const c = (category || '').toLowerCase().trim();
    if (CATEGORY_MAP[c]) return CATEGORY_MAP[c];
    return 'other';
  }
  const AUTO_RX = /automat|bot|workflow|system|integration|flow|orchestr|robot|rpa/i;
  function normalize(rows, kind) {
    return rows.map(r => {
      const text = pick(r, 'text'), category = pick(r, 'category'), sub = pick(r, 'subcategory');
      const contact = String(pick(r, 'contact')).toLowerCase();
      const resolvedBy = String(pick(r, 'resolvedBy'));
      const opened = parseDate(pick(r, 'opened')), resolved = parseDate(pick(r, 'resolved'));
      return {
        id: pick(r, 'id'), kind, opened, resolved, category, subcategory: sub, text,
        contact, group: pick(r, 'group'), resolvedBy, reopen: parseInt(pick(r, 'reopen'), 10) || 0,
        priority: pick(r, 'priority'), state: String(pick(r, 'state')).toLowerCase(), closeCode: String(pick(r, 'closeCode')).toLowerCase(),
        type: classify(text, category, sub),
        selfService: /self|portal|catalog|katalog|chat|bot|virtual/.test(contact),
        monitoring: /monitor|event|alert|alarm|automat|integration/.test(contact),
        auto: AUTO_RX.test(resolvedBy) || /automat/.test(contact)
      };
    }).filter(t => t.opened);
  }

  /* ---------- Kennzahlen ---------- */
  function metrics(data, employees) {
    const tickets = normalize(data.incidents || [], 'incident').concat(normalize(data.requests || [], 'request'));
    const changes = (data.changes || []).map(r => ({ state: String(pick(r, 'state')).toLowerCase(), closeCode: String(pick(r, 'closeCode')).toLowerCase() }));
    const cis = data.cis || [];
    const m = { tickets: tickets.length, incidents: tickets.filter(t => t.kind === 'incident').length, requests: tickets.filter(t => t.kind === 'request').length, changes: changes.length, cis: cis.length, byType: {}, employees: employees || 0 };
    if (!tickets.length) return m;
    const times = tickets.map(t => t.opened.getTime());
    const minT = Math.min.apply(null, times), maxT = Math.max.apply(null, times);
    m.from = new Date(minT); m.to = new Date(maxT);
    m.months = Math.max(1, (maxT - minT) / (30.44 * 86400000));
    m.perMonth = m.tickets / m.months;
    m.per100 = employees ? m.perMonth / employees * 100 : null;
    m.selfServiceShare = tickets.filter(t => t.selfService).length / tickets.length;
    m.monitoringShare = tickets.filter(t => t.monitoring).length / tickets.length;
    m.autoShare = tickets.filter(t => t.auto).length / tickets.length;
    m.reopenRate = tickets.filter(t => t.reopen > 0).length / tickets.length;
    const res = tickets.filter(t => t.resolved && t.resolved > t.opened);
    m.mttrHours = res.length ? res.reduce((s, t) => s + (t.resolved - t.opened) / 3600000, 0) / res.length : null;
    const sorted = res.map(t => (t.resolved - t.opened) / 3600000).sort((a, b) => a - b);
    m.medianHours = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const closedCh = changes.filter(c => /closed|complete|erledigt|geschlossen|3|4/.test(c.state) || c.closeCode);
    m.changeSuccess = closedCh.length ? closedCh.filter(c => /success|erfolg|implemented|complete/.test(c.closeCode) || (!c.closeCode && /closed|complete/.test(c.state))).length / closedCh.length : null;
    if (cis.length) {
      const ownerKeys = ['owned_by', 'managed_by', 'owner', 'verantwortlich', 'support_group', 'assigned_to'];
      const withOwner = cis.filter(r => ownerKeys.some(k => { const kk = Object.keys(r).find(x => x.toLowerCase() === k); return kk && String(r[kk]).trim(); })).length;
      m.cmdbOwnerShare = withOwner / cis.length;
      const classes = {}; cis.forEach(r => { const k = Object.keys(r).find(x => /class|klasse|category|type/i.test(x)); const v = k ? String(r[k]) : 'unbekannt'; classes[v] = (classes[v] || 0) + 1; });
      m.cmdbClasses = classes;
    }
    EVENTS.forEach(e => { m.byType[e.id] = { count: 0, perMonth: 0, mttr: null, hours: [], selfService: 0 }; });
    m.byType.other = { count: 0, perMonth: 0, mttr: null, hours: [], selfService: 0 };
    tickets.forEach(t => { const b = m.byType[t.type]; b.count++; if (t.selfService) b.selfService++; if (t.resolved && t.resolved > t.opened) b.hours.push((t.resolved - t.opened) / 3600000); });
    Object.keys(m.byType).forEach(k => { const b = m.byType[k]; b.perMonth = b.count / m.months; b.share = b.count / tickets.length; b.mttr = b.hours.length ? b.hours.reduce((s, v) => s + v, 0) / b.hours.length : null; delete b.hours; });
    m.unmappedShare = m.byType.other.share;
    // häufigste Texte je Typ (für Begründungen)
    const texts = {}; tickets.forEach(t => { const key = t.type + '|' + (t.text || '').toLowerCase().slice(0, 60); texts[key] = (texts[key] || 0) + 1; });
    m.topTexts = Object.keys(texts).map(k => ({ type: k.split('|')[0], text: k.split('|')[1], n: texts[k] })).sort((a, b) => b.n - a.n).slice(0, 12);
    return m;
  }

  /* ---------- ServiceNow-Tabellen-API ---------- */
  async function fetchServiceNow(cfg, progress) {
    const base = cfg.instance.replace(/\/+$/, '');
    const headers = { Accept: 'application/json' };
    if (cfg.token) headers.Authorization = 'Bearer ' + cfg.token;
    else headers.Authorization = 'Basic ' + btoa(cfg.user + ':' + cfg.password);
    const since = new Date(); since.setMonth(since.getMonth() - (cfg.months || 6));
    const sinceStr = since.toISOString().slice(0, 10);
    const tables = [
      { key: 'incidents', table: 'incident', fields: 'number,opened_at,resolved_at,closed_at,category,subcategory,short_description,contact_type,assignment_group,resolved_by,reopen_count,priority,state,close_code', q: 'opened_at>=' + sinceStr },
      { key: 'requests', table: 'sc_req_item', fields: 'number,opened_at,closed_at,cat_item,short_description,contact_type,assignment_group,closed_by,priority,state', q: 'opened_at>=' + sinceStr },
      { key: 'changes', table: 'change_request', fields: 'number,opened_at,closed_at,state,close_code,type', q: 'opened_at>=' + sinceStr },
      { key: 'cis', table: 'cmdb_ci', fields: 'name,sys_class_name,owned_by,managed_by,support_group,install_status', q: 'install_status=1' }
    ];
    const out = {};
    for (const t of tables) {
      out[t.key] = []; let offset = 0; const limit = 1000;
      while (true) {
        const url = base + '/api/now/table/' + t.table + '?sysparm_query=' + encodeURIComponent(t.q) + '&sysparm_fields=' + t.fields + '&sysparm_display_value=true&sysparm_limit=' + limit + '&sysparm_offset=' + offset;
        if (progress) progress(t.table + ' … ' + offset);
        const res = await fetch(url, { headers, mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' bei ' + t.table);
        const j = await res.json();
        const rows = (j.result || []).map(r => { const o = {}; Object.keys(r).forEach(k => { o[k] = r[k] && typeof r[k] === 'object' ? (r[k].display_value || r[k].value || '') : r[k]; }); return o; });
        out[t.key] = out[t.key].concat(rows);
        if (rows.length < limit || out[t.key].length >= (cfg.maxRows || 20000)) break;
        offset += limit;
      }
    }
    return out;
  }

  /* ---------- Beispieldaten ---------- */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const DEMO_TEXTS = {
    mfa: ['Passwort vergessen, bitte zurücksetzen', 'Konto gesperrt nach Fehlversuchen', 'MFA-Gerät verloren, Authenticator neu einrichten', 'Anmeldung nicht möglich'],
    login: ['Verdächtige Anmeldung aus dem Ausland gemeldet', 'Phishing-Mail erhalten, Link geklickt', 'Sicherheitsvorfall: unbekannte Weiterleitungsregel'],
    onboarding: ['Neuer Mitarbeiter startet am Montag, Konto und Notebook', 'Onboarding Vertrieb: Zugänge einrichten', 'Erstausstattung Arbeitsplatz'],
    offboarding: ['Austritt zum Monatsende, Konto deaktivieren', 'Offboarding: Rückgabe Notebook', 'Kündigung, Berechtigungen entziehen'],
    license: ['Lizenz für Visio benötigt', 'Software-Installation Adobe Acrobat', 'Zugriff auf Projektlaufwerk beantragen', 'Berechtigung SAP Modul FI', 'Installation Teams-Add-in'],
    storage: ['Netzlaufwerk voll, Speichern nicht möglich', 'Quota auf Fileshare erhöhen', 'OneDrive Speicher voll'],
    wlan: ['WLAN im Besprechungsraum instabil', 'VPN-Verbindung bricht ab', 'Kein Netzwerk am Arbeitsplatz 2.OG'],
    teams: ['Teams-Anrufe mit Aussetzern', 'Telefonie: Headset nicht erkannt', 'Videokonferenz ruckelt'],
    ssd: ['Notebook startet nicht mehr', 'Akku hält nur noch eine Stunde', 'Docking-Station erkennt Monitor nicht', 'Drucker 2. OG offline', 'Tastatur defekt'],
    cve: ['Windows Update schlägt fehl', 'Browser-Update erzwingen (Sicherheitslücke)', 'Patch-Rollout Nachzügler'],
    erp: ['ERP-Client stürzt ab', 'Outlook hängt beim Start', 'SAP Fehlermeldung beim Buchen', 'Excel reagiert langsam', 'Anwendung funktioniert nicht nach Update'],
    other: ['Frage zur Reisekostenabrechnung', 'Raumbuchung funktioniert nicht', 'Bestellung Visitenkarten', 'Zugang Parkhaus']
  };
  const DEMO_CATEGORY = { mfa: 'Account', login: 'Security', onboarding: 'Onboarding', offboarding: 'Offboarding', license: 'Software', storage: 'Storage', wlan: 'Network', teams: 'Telephony', ssd: 'Hardware', cve: 'Software', erp: 'Software', other: 'Inquiry / Help' };
  function demoData(seed) {
    const rand = rng(seed || 42);
    const employees = 320;
    const rates = { mfa: 9.5, login: 1.2, onboarding: 3.8, offboarding: 3.1, license: 21, storage: 1.6, wlan: 3.4, teams: 2.2, ssd: 6.8, cve: 1.4, erp: 7.5, other: 6 };
    const mttr = { mfa: 3, login: 30, onboarding: 26, offboarding: 40, license: 28, storage: 20, wlan: 9, teams: 22, ssd: 31, cve: 70, erp: 14, other: 10 };
    const selfServiceP = { mfa: .08, login: 0, onboarding: .6, offboarding: .5, license: .22, storage: .05, wlan: .05, teams: .05, ssd: .1, cve: 0, erp: .08, other: .3 };
    const incidents = [], requests = [], changes = [], cis = [];
    const start = new Date(); start.setMonth(start.getMonth() - 6); start.setDate(1);
    let n = 1;
    for (let month = 0; month < 6; month++) {
      Object.keys(rates).forEach(type => {
        const lambda = rates[type]; let k = 0; const L = Math.exp(-lambda); let p = 1; do { k++; p *= rand(); } while (p > L); k--;
        for (let i = 0; i < k; i++) {
          const opened = new Date(start.getFullYear(), start.getMonth() + month, 1 + Math.floor(rand() * 28), 7 + Math.floor(rand() * 10), Math.floor(rand() * 60));
          const hours = mttr[type] * (0.4 + rand() * 1.4);
          const resolved = new Date(opened.getTime() + hours * 3600000);
          const ss = rand() < selfServiceP[type];
          const isReq = ['license', 'onboarding', 'offboarding'].indexOf(type) >= 0;
          const row = {
            number: (isReq ? 'RITM' : 'INC') + String(100000 + n++),
            opened_at: opened.toISOString().slice(0, 19).replace('T', ' '), resolved_at: resolved.toISOString().slice(0, 19).replace('T', ' '),
            category: DEMO_CATEGORY[type], subcategory: '', short_description: DEMO_TEXTS[type][Math.floor(rand() * DEMO_TEXTS[type].length)],
            contact_type: ss ? 'Self-service' : (type === 'cve' && rand() < .5 ? 'Monitoring' : (rand() < .55 ? 'Phone' : 'Email')),
            assignment_group: type === 'login' ? 'Security Operations' : (type === 'wlan' ? 'Network' : (type === 'ssd' ? 'Field Service' : 'Service Desk')),
            resolved_by: type === 'mfa' && ss ? 'automation.user' : ['M. Keller', 'S. Brandt', 'T. Nowak', 'L. Hoffmann'][Math.floor(rand() * 4)],
            reopen_count: rand() < .09 ? 1 : 0, priority: type === 'login' ? '2 - High' : (rand() < .2 ? '3 - Moderate' : '4 - Low'), state: 'Closed', close_code: 'Solved (Permanently)'
          };
          (isReq ? requests : incidents).push(row);
        }
      });
    }
    for (let i = 0; i < 58; i++) { const ok = rand() < .88; const d = new Date(start.getTime() + rand() * 180 * 86400000); changes.push({ number: 'CHG' + (30000 + i), opened_at: d.toISOString().slice(0, 10), closed_at: new Date(d.getTime() + 5 * 86400000).toISOString().slice(0, 10), state: 'Closed', close_code: ok ? 'successful' : 'unsuccessful', type: rand() < .3 ? 'Standard' : 'Normal' }); }
    const classes = ['cmdb_ci_computer', 'cmdb_ci_computer', 'cmdb_ci_computer', 'cmdb_ci_server', 'cmdb_ci_netgear', 'cmdb_ci_appl', 'cmdb_ci_printer'];
    for (let i = 0; i < 420; i++) { const cls = classes[Math.floor(rand() * classes.length)]; cis.push({ name: cls.replace('cmdb_ci_', '').toUpperCase() + '-' + (1000 + i), sys_class_name: cls, owned_by: rand() < .62 ? 'IT Operations' : '', managed_by: rand() < .5 ? 'Service Desk' : '', install_status: '1' }); }
    return { incidents, requests, changes, cis, employees, customer: 'Nordlicht Maschinenbau GmbH (Beispiel)', docs: 'Architekturüberblick (Auszug): Clients werden per SCCM mit Image bespielt; Inventar in der CMDB von ServiceNow. Active Directory und Entra ID mit MFA über Microsoft Authenticator, kein Single Sign-on für Fachanwendungen. Monitoring der Server mit PRTG, Alarme per E-Mail. Skripte liegen in GitLab, Patch-Management über WSUS. ServiceNow ITSM mit Incident-, Request- und Change-Prozess, Self-Service-Portal vorhanden, aber wenig genutzt. Defender for Endpoint auf allen Clients, SIEM geplant. Rollen und Prozesse nach ITIL dokumentiert, Betriebshandbuch im Wiki.' };
  }

  return { parseCSV, parseAny, normalize, classify, metrics, fetchServiceNow, demoData };
})();
