/* =========================================================================
   Zero-Touch IT Simulator – Inhalte
   -------------------------------------------------------------------------
   Alle fachlichen Inhalte der Simulation liegen in dieser Datei:
   - LEVELS       : die fünf Reifegrade mit Beschreibung und Richtwerten
   - PERSPECTIVES : wie sich jede Stufe für Mitarbeiter, IT-Team und
                    Management anfühlt
   - FIELDS       : sieben Handlungsfelder mit je fünf Ausbaustufen
                    (Grundlage für Selbsteinschätzung und Roadmap)
   - TRANSITIONS  : was den Schritt von einer Stufe zur nächsten ausmacht
   - ACTORS       : wer in der Simulation handelt
   - EVENTS       : elf Ereignisse eines Arbeitstages, jeweils in fünf
                    Varianten (eine pro Reifegrad)

   Zeiten sind Minuten. Ein Ereignis beginnt um `start` (Minuten seit 0:00),
   jeder Schritt dauert `d` Minuten, bis der nächste sichtbar wird.
   `it`      = Arbeitszeit des IT-Teams in Minuten
   `user`    = Produktivitätsverlust der betroffenen Mitarbeiter in Minuten
   `touches` = manuelle Eingriffe der IT (inkl. Freigaben)
   `ticket`  = entsteht ein Ticket bzw. eine Anfrage, die jemand bearbeitet
   `prevented` = Störung wurde verhindert, bevor jemand sie bemerkt hat
   Alle Zahlen sind illustrative Richtwerte, keine Benchmarks.
   ========================================================================= */

const LEVELS = [
  {
    n: 1, name: 'Reaktiv', tagline: 'Die IT als Feuerwehr',
    desc: 'Störungen werden gemeldet, wenn sie auftreten. Wissen steckt in Köpfen, Prozesse sind ungeschrieben, jede Anfrage ist Handarbeit.',
    kpi: { auto: '< 5 %', tickets: '≈ 120', mttr: '1–2 Tage', proactive: '0 %' },
    role: 'Menschen suchen Fehler und beheben sie von Hand.'
  },
  {
    n: 2, name: 'Standardisiert', tagline: 'Prozesse geben Halt',
    desc: 'Ein Ticketsystem, ein Servicekatalog, eine Inventarbasis und definierte Abläufe. Verlässlich, aber langsam und nur über Personal skalierbar.',
    kpi: { auto: '≈ 15 %', tickets: '≈ 90', mttr: '≈ 1 Tag', proactive: '≈ 10 %' },
    role: 'Menschen arbeiten nach Checkliste, Werkzeuge dokumentieren.'
  },
  {
    n: 3, name: 'Automatisiert', tagline: 'Standard läuft von selbst',
    desc: 'Wiederkehrende Anfragen laufen als Workflow, Geräte richten sich selbst ein, Identitäten folgen dem HR-System, Patches verteilen sich automatisch.',
    kpi: { auto: '≈ 40 %', tickets: '≈ 55', mttr: '≈ 4 Stunden', proactive: '≈ 30 %' },
    role: 'Menschen bauen Automationen und bearbeiten die Ausnahmen.'
  },
  {
    n: 4, name: 'Proaktiv', tagline: 'Sehen, bevor es passiert',
    desc: 'Telemetrie aus Geräten, Netz, Anwendungen und Cloud wird korreliert. Probleme werden vorhergesagt und behoben, bevor jemand sie bemerkt. Der Mensch gibt frei.',
    kpi: { auto: '≈ 70 %', tickets: '≈ 25', mttr: '≈ 30 Minuten', proactive: '≈ 70 %' },
    role: 'Systeme schlagen vor, Menschen entscheiden mit einem Klick.'
  },
  {
    n: 5, name: 'Autonom', tagline: 'Zero Touch',
    desc: 'KI-Agenten erkennen, entscheiden und handeln innerhalb klarer Leitplanken. Menschen gestalten Policies, Architektur und Ausnahmen. Das Ticket verschwindet.',
    kpi: { auto: '> 90 %', tickets: '< 10', mttr: '< 5 Minuten', proactive: '> 95 %' },
    role: 'Agenten operieren, Menschen steuern Regeln und Ausnahmen.'
  }
];

const KPI_LABELS = {
  auto: 'Automatisierungsquote',
  tickets: 'Tickets je 100 Mitarbeiter und Monat',
  mttr: 'Typische Lösungszeit',
  proactive: 'Vorab erkannte Störungen'
};

const PERSPECTIVES = {
  1: {
    ma: 'Ich rufe an, warte, erkläre mein Problem dreimal. Wenn es klappt, bin ich dankbar. Meistens plane ich die IT als Risiko ein.',
    it: 'Der Tag besteht aus Unterbrechungen. Wir löschen Brände, dokumentieren wenig und wissen abends nicht, was morgen kommt.',
    mgmt: 'IT ist ein Kostenblock mit unklarer Leistung. Ausfälle kosten Umsatz, Sicherheitsvorfälle werden spät oder gar nicht entdeckt.'
  },
  2: {
    ma: 'Ich weiß, wohin ich mich wende, und bekomme eine Ticketnummer. Es dauert, aber es ist nachvollziehbar.',
    it: 'Prozesse geben Halt. Wir messen SLAs und erkennen Wiederholungsfehler, haben aber kaum Zeit, sie abzustellen.',
    mgmt: 'Kennzahlen sind da, Kosten planbar. Die IT ist verlässlich, aber langsam, und sie skaliert nur über zusätzliches Personal.'
  },
  3: {
    ma: 'Standardwünsche erledige ich selbst im Portal in Minuten. Neue Geräte richten sich von selbst ein.',
    it: 'Wiederkehrende Aufgaben laufen als Workflow. Wir bauen Automationen, statt Tickets abzuarbeiten, zumindest einen Teil der Zeit.',
    mgmt: 'Das Ticketvolumen sinkt, Durchlaufzeiten fallen deutlich. Erste Automatisierungsgewinne finanzieren den nächsten Schritt.'
  },
  4: {
    ma: 'Die IT meldet sich, bevor ich ein Problem habe. Ich bekomme Lösungen statt Fragen.',
    it: 'Wir arbeiten mit Prognosen und Vorschlägen. Unsere Aufgabe ist das Freigeben und Verbessern, das Suchen übernehmen die Systeme.',
    mgmt: 'Ausfallzeiten nahe null, Sicherheitslage in Echtzeit sichtbar, Compliance als Nebenprodukt. Die IT gestaltet das Arbeitserlebnis.'
  },
  5: {
    ma: 'IT ist unsichtbar. Alles funktioniert. Wenn etwas im Hintergrund repariert wurde, sehe ich eine kurze Notiz.',
    it: 'Wir definieren Leitplanken, Policies und Architektur. Agenten operieren innerhalb dieser Grenzen, wir entscheiden die Ausnahmen.',
    mgmt: 'Die IT skaliert ohne lineares Personalwachstum. Jeder Fall macht das System besser. Risiko und Kosten sind steuerbar.'
  }
};

const PERSPECTIVE_LABELS = { ma: 'Mitarbeiter', it: 'IT-Team', mgmt: 'Management' };

/* Sieben Handlungsfelder, je fünf Ausbaustufen. Die Stufe eines Feldes
   beschreibt, was heute Praxis ist. Die Gesamtreife wird durch das
   schwächste Feld begrenzt. */
const FIELDS = [
  {
    id: 'endpoint', name: 'Arbeitsplatz & Geräte',
    stages: [
      'Geräte werden manuell installiert, Images per USB, Inventar in Excel.',
      'Standard-Hardwarekatalog, zentrale Imaging-Lösung, Inventar in der CMDB.',
      'Zero-Touch-Provisioning: Gerät geht vom Hersteller direkt zum Mitarbeiter, Software kommt per MDM.',
      'Geräte-Telemetrie erkennt Akku-, SSD- und Performance-Probleme vor dem Ausfall; Austausch wird automatisch angestoßen.',
      'Selbstheilende Clients: Remediation läuft autonom, Gerätelebenszyklus inklusive Rückgabe und Nachbestellung vollständig automatisiert.'
    ]
  },
  {
    id: 'identity', name: 'Identität & Zugriff',
    stages: [
      'Konten manuell angelegt, Berechtigungen per E-Mail-Anfrage, Passwörter telefonisch zurückgesetzt.',
      'Zentrales Verzeichnis, dokumentiertes Rollenmodell, Passwort-Self-Service.',
      'HR-getriebene Provisionierung (Eintritt, Wechsel, Austritt automatisch), Single Sign-on, MFA überall.',
      'Risikobasierte Zugriffsentscheidungen, automatisierte Zugriffsreviews, Admin-Rechte nur zeitlich befristet.',
      'Passwordless und kontinuierliche Verifikation (Zero Trust); Berechtigungen passen sich automatisch an Rolle und Verhalten an.'
    ]
  },
  {
    id: 'telemetry', name: 'Telemetrie, Daten & KI',
    stages: [
      'Monitoring nur auf Servern, Alarme per E-Mail, keine Daten von Endgeräten.',
      'Zentrales Monitoring der gesamten Infrastruktur, definierte Schwellwerte, Dashboard für die IT.',
      'End-to-End-Telemetrie (Clients, Netz, Anwendungen, Cloud) in einer Datenplattform, Alarme werden korreliert.',
      'AIOps: Anomalieerkennung, Vorhersagen, automatische Ursachenanalyse, Experience-Score je Mitarbeiter.',
      'KI-Agenten bewerten die Lage, schlagen Maßnahmen vor oder führen sie innerhalb von Leitplanken aus und lernen aus jedem Fall.'
    ]
  },
  {
    id: 'automation', name: 'Automatisierung & Orchestrierung',
    stages: [
      'Einzelne Skripte auf Admin-Rechnern, nicht dokumentiert, personenabhängig.',
      'Versionierte Skript-Bibliothek, zentral geplantes Patch-Management.',
      'Workflow-Engine: Standardanfragen (Lizenz, Zugriff, Software) laufen ohne manuelle Schritte.',
      'Ereignisgesteuerte Automatisierung: Alarme lösen Remediation aus, Infrastruktur als Code.',
      'Autonome Orchestrierung: Agenten planen und führen mehrstufige Maßnahmen aus, Menschen definieren Policies und genehmigen Ausnahmen.'
    ]
  },
  {
    id: 'service', name: 'Service Management & Self-Service',
    stages: [
      'Anfragen per Telefon und E-Mail, kein oder nur ein rudimentäres Ticketsystem.',
      'ITSM-Werkzeug mit Incident-, Request- und Change-Prozess, Servicekatalog, SLAs.',
      'Self-Service-Portal und Chatbot für Standardanfragen, Wissensdatenbank, automatische Kategorisierung und Verteilung.',
      'Proaktive Kommunikation: Betroffene werden informiert, bevor sie etwas merken; Tickets entstehen überwiegend aus Telemetrie.',
      'Das Ticket verschwindet: Anliegen werden im Hintergrund gelöst, Mitarbeiter sehen eine Bestätigung. Der Service Desk wird zum Experience-Team.'
    ]
  },
  {
    id: 'security', name: 'Sicherheit & Compliance',
    stages: [
      'Virenschutz und Firewall, Patches manuell und unregelmäßig.',
      'Definierte Patch-Zyklen, dokumentierte Sicherheitsrichtlinien, Awareness-Schulungen.',
      'Automatisiertes Patching inklusive Drittanbieter, EDR auf allen Geräten, zentrale Log-Sammlung (SIEM).',
      'Schwachstellen werden risikobasiert priorisiert und automatisch geschlossen, Compliance-Nachweise (ISO 27001, NIS2) entstehen automatisch.',
      'Autonome Abwehr (SOAR): Angriffe werden in Sekunden isoliert, Zero-Trust-Architektur, Compliance ist Nebenprodukt der Automatisierung.'
    ]
  },
  {
    id: 'org', name: 'Organisation, Rollen & Kultur',
    stages: [
      'Helden-Kultur: Wissen liegt bei einzelnen Personen, die IT arbeitet als Feuerwehr.',
      'Klare Rollen und Verantwortlichkeiten, dokumentierte Prozesse, regelmäßige Reviews.',
      'Automation Engineering als eigene Rolle, Prinzip „Automate first“, feste Zeitanteile für Verbesserung.',
      'Produktteams statt Ticketwarteschlangen, Kennzahlen zum Arbeitserlebnis (XLA) statt nur SLA.',
      'IT als Steuerungsfunktion: Menschen gestalten Policies, Leitplanken und Architektur, Agenten operieren, das System entwickelt sich kontinuierlich weiter.'
    ]
  }
];

/* Der Schritt von Stufe n auf Stufe n+1. Index 0 = von 1 auf 2. */
const TRANSITIONS = [
  {
    from: 1, to: 2, title: 'Fundament schaffen', duration: '6–12 Monate',
    focus: 'Einen Kanal, ein Inventar, klare Zuständigkeiten. Ohne Standard lässt sich nichts automatisieren.',
    actions: [
      'ITSM-Werkzeug mit Incident- und Request-Prozess einführen',
      'Servicekatalog mit den 20 häufigsten Anfragen schreiben',
      'Inventar und CMDB aufbauen, Standard-Hardware festlegen',
      'Zentrales Monitoring für Server, Netz und Cloud',
      'Rollen, Vertretungen und Eskalationswege dokumentieren'
    ],
    success: '100 % der Anfragen laufen über einen Kanal, das Inventar ist vollständig, SLAs werden gemessen.'
  },
  {
    from: 2, to: 3, title: 'Den Standard automatisieren', duration: '9–18 Monate',
    focus: 'Die zehn häufigsten Anfragen und der Gerätelebenszyklus laufen ohne Handarbeit.',
    actions: [
      'Top-10-Anfragen analysieren und als Workflow bauen (Lizenz, Zugriff, Software, Passwort)',
      'Zero-Touch-Provisioning für neue Geräte einführen',
      'Identitäten aus dem HR-System provisionieren (Eintritt, Wechsel, Austritt)',
      'Self-Service-Portal mit Wissensdatenbank anbieten',
      'Patch-Automatisierung inklusive Drittanbieter, Skripte in Git versionieren',
      'Rolle „Automation Engineer“ besetzen und Zeit für Automatisierung reservieren'
    ],
    success: '40 % der Anfragen werden ohne manuellen Schritt erledigt, neue Geräte sind am ersten Tag einsatzbereit.'
  },
  {
    from: 3, to: 4, title: 'Sehen, bevor es passiert', duration: '12–18 Monate',
    focus: 'Telemetrie zusammenführen und Alarme mit Automationen koppeln. Der Mensch wird zum Freigeber.',
    actions: [
      'Telemetrie-Plattform für Clients, Netz, Anwendungen und Cloud aufbauen',
      'Digital-Employee-Experience-Werkzeug einführen, Experience-Score messen',
      'Alarme korrelieren (AIOps) und Runbooks an Alarme koppeln',
      'Freigabe-Workflows für automatische Maßnahmen einführen',
      'XLAs definieren, Produktteams statt Warteschlangen organisieren',
      'Conditional Access und risikobasierte Schwachstellenbehandlung'
    ],
    success: 'Mehr als 50 % der Störungen werden erkannt, bevor ein Mitarbeiter sie meldet.'
  },
  {
    from: 4, to: 5, title: 'Autonomie mit Leitplanken', duration: '12–24 Monate',
    focus: 'Was darf automatisch passieren, was braucht Freigabe? Agenten erhalten Entscheidungsbefugnis Schritt für Schritt.',
    actions: [
      'Policy-Framework: Risikoklassen, erlaubte Maßnahmen, Freigabepflichten',
      'KI-Agenten zunächst mit Vorschlagsrecht, dann mit Handlungsrecht je Risikoklasse',
      'Digitaler Zwilling für Changes und Rollouts',
      'Vollständiger Audit-Trail jeder automatischen Entscheidung',
      'Rollen zu Steuerung, Architektur und Policy-Design weiterentwickeln',
      'Passwordless und kontinuierliche Verifikation flächendeckend'
    ],
    success: 'Mehr als 90 % der Fälle ohne menschlichen Eingriff, jede Entscheidung nachvollziehbar.'
  }
];

const ACTORS = {
  ma:   { label: 'Mitarbeiter',     cls: 'ma' },
  sd:   { label: 'Service Desk',    cls: 'human' },
  tech: { label: 'Techniker',       cls: 'human' },
  mgr:  { label: 'Freigabe',        cls: 'approve' },
  sys:  { label: 'Automatisierung', cls: 'auto' },
  ai:   { label: 'KI-Agent',        cls: 'agent' }
};

const T = (h, m) => h * 60 + (m || 0);

/* Schritte: a = Akteur, t = Text, d = Dauer bis zum nächsten Schritt (Minuten),
   w = optionaler Hinweis, der während des Wartens angezeigt wird. */
const EVENTS = [
  {
    id: 'onboarding', start: T(7, 30), field: 'identity',
    title: 'Neuer Mitarbeiter: Jonas Weber startet heute im Controlling',
    v: [
      {
        title: 'Jonas Weber steht ohne Arbeitsplatz da',
        steps: [
          { a: 'ma', t: 'Jonas Weber kommt um 8 Uhr. Kein Konto, kein Gerät. Sein Vorgesetzter ruft die IT an.', d: 30, w: 'Jonas wartet in der Kaffeeküche.' },
          { a: 'sd', t: 'Die IT sucht ein freies Notebook, findet eines im Schrank und installiert Windows neu.', d: 180, w: 'Installation läuft, Jonas liest Unterlagen.' },
          { a: 'tech', t: 'Konto im Verzeichnis anlegen, Mailbox, sechs Gruppenberechtigungen auf Zuruf, SAP-Zugang per Formular (dauert zwei Tage).', d: 120 },
          { a: 'ma', t: 'Jonas arbeitet ab dem Nachmittag eingeschränkt. SAP erst am Donnerstag.', d: 0 }
        ],
        it: 300, user: 420, touches: 6, ticket: true
      },
      {
        title: 'Onboarding nach Checkliste',
        steps: [
          { a: 'sd', t: 'HR hat den Eintritt vor zwei Wochen per Ticket gemeldet. Die Onboarding-Checkliste wird abgearbeitet.', d: 60 },
          { a: 'tech', t: 'Standardnotebook aus dem Pool mit zentralem Image, Konto nach Rollenprofil „Controlling“.', d: 120, w: 'Jonas wartet auf sein Gerät.' },
          { a: 'tech', t: 'Übergabe um 11 Uhr. SAP-Zugang läuft über den Change-Prozess bis morgen.', d: 30 },
          { a: 'ma', t: 'Jonas startet nach einem halben Tag.', d: 0 }
        ],
        it: 150, user: 210, touches: 4, ticket: true
      },
      {
        title: 'Identität und Gerät kommen aus dem Workflow',
        steps: [
          { a: 'sys', t: 'Das HR-System legt Jonas Weber an. Identität, Mailbox, Gruppen und Lizenzen werden nach Rollenprofil provisioniert.', d: 5 },
          { a: 'sys', t: 'Das Notebook wurde direkt vom Hersteller an Jonas geliefert. Die erste Anmeldung startet die automatische Einrichtung.', d: 35, w: 'Autopilot richtet das Gerät ein.' },
          { a: 'ma', t: 'Jonas arbeitet um 08:10 mit allen Standardanwendungen. Der SAP-Zugang kommt um 10 Uhr aus dem Workflow.', d: 0 }
        ],
        it: 10, user: 45, touches: 1, ticket: false
      },
      {
        title: 'Arbeitsplatz steht, Agent ergänzt das Teampaket',
        steps: [
          { a: 'sys', t: 'Die Provisionierung lief bereits vorgestern. Das Gerät liegt eingerichtet am Platz.', d: 1 },
          { a: 'ai', t: 'Agent erkennt: Jonas’ Team nutzt Power BI und ein Controlling-Add-in. Vorschlag: Zusatzlizenzen zuweisen.', d: 2 },
          { a: 'mgr', t: 'Die Teamleiterin bestätigt per Teams-Nachricht.', d: 15 },
          { a: 'sys', t: 'Zusatzsoftware installiert sich im Hintergrund. Begrüßungsnachricht mit Hinweisen zu den Werkzeugen.', d: 10 },
          { a: 'ma', t: 'Jonas ist um 08:05 voll arbeitsfähig.', d: 0 }
        ],
        it: 2, user: 5, touches: 1, ticket: false, prevented: true
      },
      {
        title: 'Onboarding ohne Beteiligung der IT',
        steps: [
          { a: 'sys', t: 'Identität, Gerät, Lizenzen und Teamzugänge stehen seit Freitag. Der Peer-Vergleich im Team ergab das passende Softwarepaket.', d: 1 },
          { a: 'ai', t: 'Prüfung am Morgen: Anmeldung erfolgreich, alle Anwendungen starten, Netzwerk in Ordnung. Onboarding-Experience-Score 98.', d: 2 },
          { a: 'ma', t: 'Jonas arbeitet ab 08:00. Die IT hat ihn nie gesehen.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'erp', start: T(7, 50), field: 'automation',
    title: 'ERP-Client-Update verursacht Abstürze',
    startByLevel: { 3: T(16, 30), 4: T(16, 30), 5: T(16, 30) },
    v: [
      {
        title: 'Gestriges ERP-Update legt 40 Arbeitsplätze lahm',
        steps: [
          { a: 'ma', t: 'Gestern Abend wurde das ERP-Client-Update an alle 300 Geräte verteilt. Ab 8 Uhr stürzt der Client bei 40 Nutzern ab. Die Hotline ist überlastet.', d: 60, w: '40 Mitarbeiter können nicht buchen.' },
          { a: 'tech', t: 'Nach zwei Stunden ist die Ursache klar: inkompatibel mit einer alten Treiberversion.', d: 120 },
          { a: 'tech', t: 'Rollback manuell per Fernwartung, Gerät für Gerät.', d: 240, w: 'Rollback läuft, Gerät 17 von 40.' },
          { a: 'ma', t: 'Nachmittags arbeiten alle wieder. Die Monatsbuchung verschiebt sich.', d: 0 }
        ],
        it: 300, user: 2400, touches: 5, ticket: true
      },
      {
        title: 'Genehmigter Change, trotzdem Abstürze',
        steps: [
          { a: 'tech', t: 'Der Change war im Change-Board genehmigt, getestet auf zwei Geräten. Rollout an alle lief gestern Abend.', d: 60 },
          { a: 'ma', t: '40 Nutzer melden Abstürze, der Service Desk eröffnet ein Problem-Ticket.', d: 60, w: 'Analyse läuft, Betroffene warten.' },
          { a: 'tech', t: 'Rollback per Softwareverteilung an die Betroffenen.', d: 120 },
          { a: 'ma', t: 'Nach vier Stunden sind alle wieder arbeitsfähig.', d: 0 }
        ],
        it: 150, user: 1600, touches: 3, ticket: true
      },
      {
        title: 'Pilotring fängt den Fehler ab',
        steps: [
          { a: 'sys', t: 'Rollout an den Pilotring (30 Geräte). Die Crash-Telemetrie meldet vier Abstürze.', d: 30 },
          { a: 'tech', t: 'Techniker stoppt den Rollout, Rollback auf vier Geräte per Skript, Ticket beim Hersteller.', d: 60 },
          { a: 'ma', t: 'Vier Pilotnutzer hatten eine halbe Stunde Ausfall. Der Rest des Unternehmens hat nichts gemerkt.', d: 0 }
        ],
        it: 45, user: 120, touches: 2, ticket: true
      },
      {
        title: 'Anomalie erkannt, Rollout pausiert sich selbst',
        steps: [
          { a: 'sys', t: 'Pilotring: Anomalie „Crash-Rate +400 %“ nach zwölf Minuten erkannt, Rollout automatisch pausiert.', d: 2 },
          { a: 'ai', t: 'Ursache: Treiberversion älter als 31.0. Im Gesamtbestand sind 38 Geräte betroffen. Vorschlag: Treiber vorab aktualisieren, dann fortsetzen.', d: 5 },
          { a: 'mgr', t: 'Der Application Owner bestätigt den Vorschlag.', d: 15 },
          { a: 'sys', t: 'Rollback auf vier Pilotgeräte, Treiber-Update ausgerollt, Rollout fortgesetzt.', d: 60 },
          { a: 'ma', t: 'Vier Pilotnutzer hatten eine Viertelstunde Ausfall.', d: 0 }
        ],
        it: 10, user: 60, touches: 1, ticket: false
      },
      {
        title: 'Inkompatibilität vor dem Rollout gefunden',
        steps: [
          { a: 'sys', t: 'Test im digitalen Zwilling über alle Hardware- und Treiberkombinationen findet die Inkompatibilität vor dem Rollout.', d: 3 },
          { a: 'ai', t: 'Agent setzt das Treiber-Update als Voraussetzung. Der Rollout läuft in Wellen fehlerfrei durch.', d: 20 },
          { a: 'sys', t: 'Abschlussbericht: 300 Geräte aktualisiert, 0 Abstürze.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'ssd', start: T(8, 10), field: 'endpoint',
    title: 'SSD-Verschleiß auf dem Notebook von Anna Berger (Vertrieb)',
    v: [
      {
        title: 'Notebook startet nicht mehr',
        steps: [
          { a: 'ma', t: 'Anna Berger ruft an: „Mein Notebook startet nicht, ich habe um 10 Uhr einen Kundentermin.“', d: 10, w: 'Anna hängt in der Telefonschleife.' },
          { a: 'sd', t: 'Der Service Desk notiert den Fall in einer E-Mail an den 2nd Level.', d: 20 },
          { a: 'tech', t: 'Ein Techniker kommt vorbei und diagnostiziert eine defekte SSD.', d: 60 },
          { a: 'tech', t: 'Ersatzgerät aus dem Lager, manuelle Installation: Image, Treiber, Software.', d: 150, w: 'Installation läuft. Der Kundentermin ist verschoben.' },
          { a: 'tech', t: 'Datenrettung von der alten SSD, soweit möglich. Lokale Dateien der letzten drei Tage fehlen.', d: 90 },
          { a: 'ma', t: 'Anna arbeitet nach fünfeinhalb Stunden wieder.', d: 0 }
        ],
        it: 240, user: 330, touches: 5, ticket: true
      },
      {
        title: 'Hardware-Ticket mit SLA',
        steps: [
          { a: 'ma', t: 'Anna Berger erstellt Ticket #4711: „Notebook startet nicht.“', d: 5 },
          { a: 'sd', t: 'Kategorie Hardware, Priorität hoch, SLA vier Stunden.', d: 15 },
          { a: 'tech', t: '2nd Level diagnostiziert per Checkliste: SSD defekt.', d: 45 },
          { a: 'tech', t: 'Standardgerät aus dem Pool wird mit zentralem Image bespielt.', d: 90, w: 'Image wird aufgespielt.' },
          { a: 'tech', t: 'Cloud-Daten synchronisieren, Profil einrichten.', d: 45 },
          { a: 'ma', t: 'Anna arbeitet nach gut drei Stunden wieder. SLA eingehalten, Termin trotzdem verschoben.', d: 0 }
        ],
        it: 150, user: 200, touches: 4, ticket: true
      },
      {
        title: 'Ersatzgerät richtet sich selbst ein',
        steps: [
          { a: 'ma', t: 'Anna meldet den Ausfall im Self-Service-Portal. Das Ticket geht automatisch an die Hardware-Gruppe.', d: 5 },
          { a: 'tech', t: 'Techniker bestätigt den Defekt per Ferndiagnose und gibt ein Poolgerät frei.', d: 20 },
          { a: 'sys', t: 'Zero-Touch-Provisioning: Anna meldet sich am Ersatzgerät an, alles installiert sich selbst.', d: 40, w: 'Gerät richtet sich ein.' },
          { a: 'ma', t: 'Anna arbeitet nach gut einer Stunde wieder, alle Daten aus der Cloud vorhanden.', d: 0 }
        ],
        it: 30, user: 65, touches: 2, ticket: true
      },
      {
        title: 'SSD-Ausfall drei Tage vorher erkannt',
        steps: [
          { a: 'sys', t: 'Geräte-Telemetrie: SMART-Wert „Reallocated Sectors“ steigt. Ausfallwahrscheinlichkeit in sieben Tagen 84 %.', d: 1 },
          { a: 'ai', t: 'Vorschlag: Ersatzgerät bestellen, Anna informieren, Datensicherung prüfen.', d: 2 },
          { a: 'mgr', t: 'Ein Techniker gibt den Vorschlag mit einem Klick frei.', d: 25 },
          { a: 'sys', t: 'Ersatznotebook beim Lieferanten bestellt, vorkonfiguriert, Lieferung an Annas Standort.', d: 10 },
          { a: 'sys', t: 'Nachricht an Anna: „Ihr Notebook wird voraussichtlich ausfallen. Das Ersatzgerät kommt übermorgen. Ihre Daten sind gesichert.“', d: 2 },
          { a: 'ma', t: 'Anna arbeitet weiter. Kein Ausfall, kein Ticket.', d: 0 }
        ],
        it: 5, user: 0, touches: 1, ticket: false, prevented: true
      },
      {
        title: 'Austausch läuft innerhalb der Leitplanken',
        steps: [
          { a: 'sys', t: 'Geräte-Telemetrie: Ausfallwahrscheinlichkeit der SSD in sieben Tagen 84 %.', d: 1 },
          { a: 'ai', t: 'Policy-Prüfung: Gerät 3,5 Jahre alt, Austauschbudget vorhanden, Risiko hoch. Austausch ist innerhalb der Leitplanken erlaubt.', d: 1 },
          { a: 'sys', t: 'Bestellung, Vorkonfiguration und Versand laufen automatisch. Rücksende-Etikett für das alte Gerät wird erzeugt.', d: 5 },
          { a: 'sys', t: 'Anna erhält den Liefertermin. Die IT sieht den Fall nur im Tagesbericht.', d: 1 },
          { a: 'ma', t: 'Anna bemerkt nichts außer einem neuen Notebook am Mittwoch.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'cve', start: T(9, 5), field: 'security',
    title: 'Kritische Schwachstelle im Browser, aktiv ausgenutzt',
    v: [
      {
        title: 'Notfall-Update bleibt unbemerkt',
        steps: [
          { a: 'sys', t: 'Der Hersteller veröffentlicht ein Notfall-Update. In der IT bemerkt es niemand, es gibt keinen Prozess für Drittanbieter-Patches.', d: 240, w: '1.240 Geräte sind verwundbar.' },
          { a: 'tech', t: 'Ein Admin liest am Nachmittag zufällig davon und schickt eine Rundmail: „Bitte Browser aktualisieren.“', d: 60 },
          { a: 'ma', t: 'Viele ignorieren die Mail. Ohne Verteilung bleiben Geräte wochenlang verwundbar.', d: 0 }
        ],
        it: 90, user: 0, touches: 3, ticket: false, risk: 'Geräte bleiben wochenlang angreifbar'
      },
      {
        title: 'Notfall-Change durch das Change-Board',
        steps: [
          { a: 'sys', t: 'Die Sicherheitsmeldung erreicht die IT über den Patch-Prozess.', d: 60 },
          { a: 'tech', t: 'Ein Notfall-Change wird eingereicht und im Change-Board freigegeben.', d: 180, w: 'Warten auf die Freigabe.' },
          { a: 'tech', t: 'Verteilung per Softwareverteilung, Nachzügler manuell.', d: 240 },
          { a: 'sys', t: 'Nach zwei Tagen sind 85 % der Geräte aktualisiert.', d: 0 }
        ],
        it: 240, user: 60, touches: 5, ticket: true
      },
      {
        title: 'Drittanbieter-Patching verteilt automatisch',
        steps: [
          { a: 'sys', t: 'Das Patch-Management erkennt das Update und verteilt es an den Pilotring.', d: 30 },
          { a: 'tech', t: 'Techniker prüft den Pilotring und gibt den Rollout frei.', d: 30 },
          { a: 'sys', t: 'Rollout an alle Geräte, Neustart des Browsers wird angeboten. Nach sechs Stunden 95 %.', d: 300, w: 'Rollout läuft.' },
          { a: 'sys', t: 'Restliche Geräte folgen beim nächsten Verbinden.', d: 0 }
        ],
        it: 30, user: 20, touches: 1, ticket: true
      },
      {
        title: 'Beschleunigter Rollout nach Risiko-Bewertung',
        steps: [
          { a: 'sys', t: 'Threat-Intelligence-Feed: Die Schwachstelle wird aktiv ausgenutzt. 1.240 Geräte betroffen, Risiko-Score 9,1.', d: 1 },
          { a: 'ai', t: 'Vorschlag: Rollout ohne Pilotwartezeit. Sandbox-Test zeigt keine Inkompatibilität.', d: 5 },
          { a: 'mgr', t: 'Security-Analyst gibt frei.', d: 10 },
          { a: 'sys', t: 'Rollout läuft. Betroffene erhalten den Hinweis, den Browser bei Gelegenheit neu zu starten.', d: 120, w: 'Rollout in Wellen.' },
          { a: 'sys', t: 'Nach zwei Stunden 99 % aktualisiert. Nachweis für das ISO-Audit automatisch abgelegt.', d: 0 }
        ],
        it: 10, user: 5, touches: 1, ticket: false
      },
      {
        title: 'Policy „Kritische Schwachstelle mit Exploit“ greift',
        steps: [
          { a: 'sys', t: 'Threat-Intelligence und Sandbox-Test: Exploit im Umlauf, Update kompatibel.', d: 1 },
          { a: 'ai', t: 'Policy „Kritische Schwachstelle mit Exploit: sofort“ greift. Rollout in Wellen, Rollback-Plan liegt bereit.', d: 2 },
          { a: 'sys', t: 'Nach 90 Minuten 99,6 % aktualisiert. Fünf Offline-Geräte werden beim nächsten Verbinden aktualisiert.', d: 90, w: 'Rollout in Wellen.' },
          { a: 'ai', t: 'Compliance-Nachweis und Lagebericht liegen im Security-Dashboard.', d: 0 }
        ],
        it: 0, user: 3, touches: 0, ticket: false
      }
    ]
  },
  {
    id: 'storage', start: T(10, 20), field: 'telemetry',
    title: 'Fileshare „Projekte“ läuft voll',
    v: [
      {
        title: '„Datenträger voll“ im Projektteam',
        steps: [
          { a: 'ma', t: 'Zwölf Personen im Projektteam können keine Dateien mehr speichern.', d: 15, w: 'Projektteam blockiert.' },
          { a: 'sd', t: 'Mehrere Anrufe. Der Storage-Admin ist im Urlaub.', d: 60 },
          { a: 'tech', t: 'Ein Kollege löscht nach Rücksprache alte Daten. Erweiterung des Speichers: Bestellung dauert zwei Wochen.', d: 120 },
          { a: 'ma', t: 'Das Team arbeitet nach gut drei Stunden weiter und löscht vorsichtshalber selbst Dateien.', d: 0 }
        ],
        it: 150, user: 720, touches: 4, ticket: true
      },
      {
        title: 'Monitoring-Alarm, Analyse, geplante Erweiterung',
        steps: [
          { a: 'sys', t: 'Monitoring-Alarm bei 90 % per E-Mail an die Storage-Gruppe.', d: 30 },
          { a: 'tech', t: 'Ticket angelegt, Analyse der größten Verzeichnisse, Abstimmung mit dem Fachbereich.', d: 180, w: 'Analyse läuft.' },
          { a: 'tech', t: 'Erweiterung des Volumes um 2 TB, geplant für den Abend.', d: 240 },
          { a: 'sys', t: 'Volume erweitert.', d: 0 }
        ],
        it: 120, user: 60, touches: 3, ticket: true
      },
      {
        title: 'Runbook liefert Analyse, Techniker erweitert',
        steps: [
          { a: 'sys', t: 'Alarm bei 85 % löst ein Runbook aus: Report der größten Ordner geht an die Fachbereichsleitung.', d: 5 },
          { a: 'tech', t: 'Techniker erweitert das Volume per Skript um 2 TB.', d: 20 },
          { a: 'sys', t: 'Volume bei 70 %, kein Nutzer betroffen.', d: 0 }
        ],
        it: 15, user: 0, touches: 1, ticket: true
      },
      {
        title: 'Engpass in neun Tagen vorhergesagt',
        steps: [
          { a: 'sys', t: 'Kapazitätsprognose: Volume erreicht in neun Tagen 100 % (Wachstum 3 % pro Woche, Projektende Q4 bekannt).', d: 1 },
          { a: 'ai', t: 'Vorschlag: 1,2 TB Archivdaten älter als drei Jahre in kaltes Storage verschieben. Spart 1.400 € im Jahr gegenüber einer Erweiterung.', d: 3 },
          { a: 'mgr', t: 'Der Storage-Verantwortliche gibt frei.', d: 30 },
          { a: 'sys', t: 'Tiering läuft in der Nacht. Volume anschließend bei 61 %.', d: 10 },
          { a: 'sys', t: 'Kein Nutzer hat etwas bemerkt.', d: 0 }
        ],
        it: 5, user: 0, touches: 1, ticket: false, prevented: true
      },
      {
        title: 'Archiv-Policy greift automatisch',
        steps: [
          { a: 'sys', t: 'Kapazitätsprognose: Engpass in neun Tagen.', d: 1 },
          { a: 'ai', t: 'Policy „Archivdaten älter als drei Jahre in Cold Storage“ greift. Der Fachbereich wird informiert, Einspruchsfrist 48 Stunden.', d: 2 },
          { a: 'sys', t: 'Tiering ausgeführt, Volume bei 61 %, Kosten gesenkt.', d: 5 },
          { a: 'sys', t: 'Eintrag im Tagesbericht.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'license', start: T(11, 0), field: 'service',
    title: 'Lizenzanfrage: Mehmet Yilmaz braucht Visio',
    v: [
      {
        title: 'Lizenz per E-Mail-Kette',
        steps: [
          { a: 'ma', t: 'Mehmet schreibt an die IT: „Ich brauche Visio für ein Prozessdiagramm bis Freitag.“', d: 120, w: 'Mail liegt im Posteingang.' },
          { a: 'sd', t: 'Die IT fragt beim Vorgesetzten per Mail nach einer Genehmigung.', d: 300, w: 'Genehmigung steht aus.' },
          { a: 'tech', t: 'Lizenz im Portal gekauft, Installation per Fernwartung.', d: 60 },
          { a: 'ma', t: 'Mehmet hat Visio am Abend. Das Diagramm zeichnet er zwischenzeitlich in PowerPoint.', d: 0 }
        ],
        it: 45, user: 90, touches: 4, ticket: true
      },
      {
        title: 'Antrag per Formular',
        steps: [
          { a: 'ma', t: 'Mehmet stellt den Antrag im Ticketsystem über ein Formular.', d: 10 },
          { a: 'mgr', t: 'Der Vorgesetzte genehmigt im Ticket.', d: 240, w: 'Genehmigung steht aus.' },
          { a: 'tech', t: 'Die Softwareverteilung weist Visio zu.', d: 30 },
          { a: 'ma', t: 'Mehmet hat Visio nach knapp fünf Stunden.', d: 0 }
        ],
        it: 20, user: 30, touches: 2, ticket: true
      },
      {
        title: 'Bestellung im Self-Service-Portal',
        steps: [
          { a: 'ma', t: 'Mehmet bestellt Visio im Self-Service-Katalog.', d: 2 },
          { a: 'sys', t: 'Der Workflow holt die Genehmigung per Teams-Nachricht ein. Der Vorgesetzte klickt „Ja“.', d: 20 },
          { a: 'sys', t: 'Lizenz zugewiesen, Installation läuft, Mehmet wird benachrichtigt.', d: 10 },
          { a: 'ma', t: 'Mehmet arbeitet nach einer halben Stunde mit Visio.', d: 0 }
        ],
        it: 0, user: 5, touches: 0, ticket: true
      },
      {
        title: 'IT-Assistent entscheidet nach Regelwerk',
        steps: [
          { a: 'ma', t: 'Mehmet fragt den IT-Assistenten im Chat: „Ich brauche Visio.“', d: 1 },
          { a: 'ai', t: 'Prüfung: Rolle „Prozessmanager“, Budget vorhanden, zwei ungenutzte Lizenzen im Pool. Lizenz wird zugewiesen, der Vorgesetzte wird informiert.', d: 2 },
          { a: 'sys', t: 'Installation läuft. Mehmet arbeitet nach fünf Minuten.', d: 5 },
          { a: 'ma', t: 'Kein Antrag, keine Wartezeit.', d: 0 }
        ],
        it: 0, user: 5, touches: 0, ticket: false
      },
      {
        title: 'Lizenz kommt, bevor die Frage entsteht',
        steps: [
          { a: 'ai', t: 'Agent erkennt: Mehmet hat eine Visio-Datei erhalten und versucht sie zu öffnen. Rolle berechtigt, Lizenz wird im Hintergrund zugewiesen.', d: 1 },
          { a: 'sys', t: 'Visio öffnet die Datei nach 40 Sekunden.', d: 1 },
          { a: 'ai', t: 'Pool-Optimierung: Drei Lizenzen ohne Nutzung seit 90 Tagen werden freigegeben.', d: 0 }
        ],
        it: 0, user: 1, touches: 0, ticket: false
      }
    ]
  },
  {
    id: 'login', start: T(12, 30), field: 'security',
    title: 'Verdächtige Anmeldung: Konto von Petra Lang aus Lagos, zwei Minuten nach München',
    v: [
      {
        title: 'Kontoübernahme bleibt unentdeckt',
        steps: [
          { a: 'sys', t: 'Die Anmeldung aus Lagos gelingt zwei Minuten nach einer Anmeldung in München. Niemand wertet Anmeldeprotokolle aus.', d: 480, w: 'Unentdeckt. Der Angreifer liest Postfach und Kontakte.' },
          { a: 'ma', t: 'Petra wundert sich Tage später über Antworten auf Mails, die sie nie geschrieben hat.', d: 120 },
          { a: 'tech', t: 'Passwort zurückgesetzt, Forensik: Postfach ausgelesen, 20 Kontakte haben Phishing-Mails erhalten.', d: 480 },
          { a: 'tech', t: 'Meldung an die Datenschutzbehörde wird geprüft.', d: 0 }
        ],
        it: 600, user: 240, touches: 5, ticket: true, risk: 'Datenabfluss über mehrere Tage'
      },
      {
        title: 'SIEM-Alarm, Analyst sperrt nach dem Mittag',
        steps: [
          { a: 'sys', t: 'Das SIEM meldet „Impossible Travel“ per E-Mail an die Security-Mailbox.', d: 90, w: 'Mail wartet auf Bearbeitung.' },
          { a: 'tech', t: 'Ein Analyst prüft nach dem Mittag, sperrt das Konto und ruft Petra an.', d: 60 },
          { a: 'tech', t: 'Passwort-Reset, Sitzungen beendet, Postfachregeln geprüft: eine Weiterleitungsregel entfernt.', d: 60 },
          { a: 'ma', t: 'Petra arbeitet nach dreieinhalb Stunden wieder normal.', d: 0 }
        ],
        it: 150, user: 90, touches: 3, ticket: true
      },
      {
        title: 'Playbook sperrt Sitzungen automatisch',
        steps: [
          { a: 'sys', t: 'EDR und SIEM korrelieren die Risiko-Anmeldung. Das Playbook beendet alle Sitzungen und eröffnet ein Ticket für das SOC.', d: 5 },
          { a: 'tech', t: 'Analyst bestätigt den Vorfall, setzt das Passwort zurück, kontaktiert Petra.', d: 40 },
          { a: 'ma', t: 'Petra arbeitet nach 45 Minuten wieder.', d: 0 }
        ],
        it: 45, user: 30, touches: 2, ticket: true
      },
      {
        title: 'Anmeldung in Echtzeit blockiert, Ursache gefunden',
        steps: [
          { a: 'sys', t: 'Conditional Access blockiert die Anmeldung aus Lagos (Risiko hoch). Die MFA-Abfrage schlägt fehl.', d: 1 },
          { a: 'ai', t: 'Analyse: Die Zugangsdaten stammen aus einer Phishing-Mail von gestern. 14 weitere Empfänger identifiziert.', d: 3 },
          { a: 'mgr', t: 'Analyst gibt frei: Mails löschen, Passwörter der 14 zurücksetzen.', d: 15 },
          { a: 'sys', t: 'Maßnahmen umgesetzt. Petra erhält einen Hinweis und eine kurze Schulung.', d: 10 },
          { a: 'ma', t: 'Petra verliert zehn Minuten für die Schulung.', d: 0 }
        ],
        it: 15, user: 10, touches: 1, ticket: false
      },
      {
        title: 'Blockiert, bereinigt, gemeldet. Ohne Eingriff.',
        steps: [
          { a: 'sys', t: 'Anmeldung in Echtzeit blockiert, Sitzungen widerrufen. Das passwortlose Konto ist per Passwort ohnehin nicht angreifbar.', d: 1 },
          { a: 'ai', t: 'Agent entfernt die Phishing-Mail bei allen Empfängern, isoliert den Absender und meldet die Indikatoren an das Threat-Intel-Sharing.', d: 3 },
          { a: 'sys', t: 'Petra sieht nur: „Ein Anmeldeversuch wurde blockiert. Sie müssen nichts tun.“', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'wlan', start: T(13, 15), field: 'telemetry',
    title: 'WLAN im Besprechungsraum „Alpen“ bricht während eines Workshops ein',
    startByLevel: { 4: T(7, 45), 5: T(7, 45) },
    v: [
      {
        title: 'Workshop ohne Netz',
        steps: [
          { a: 'ma', t: 'Workshop mit 16 Teilnehmern, das WLAN fällt aus. Jemand läuft zur IT.', d: 20, w: '16 Personen warten.' },
          { a: 'tech', t: 'Techniker schaut vor Ort und startet den Access Point neu. Nachmittags fällt er wieder aus.', d: 60 },
          { a: 'tech', t: 'Access Point wird am nächsten Tag ausgetauscht.', d: 240, w: 'Workshop läuft über Mobilfunk-Hotspots weiter.' },
          { a: 'ma', t: 'Der Workshop verlor etwa 45 Minuten.', d: 0 }
        ],
        it: 120, user: 720, touches: 3, ticket: true
      },
      {
        title: 'Monitoring zeigt rot, Austausch von Hand',
        steps: [
          { a: 'sys', t: 'Das Netzwerk-Monitoring zeigt den Access Point rot. Ein Ticket wird manuell erstellt.', d: 20 },
          { a: 'tech', t: 'Techniker tauscht den Access Point aus dem Ersatzlager, Konfiguration von Hand.', d: 90, w: 'Austausch läuft.' },
          { a: 'ma', t: 'Der Workshop verlor etwa 30 Minuten.', d: 0 }
        ],
        it: 90, user: 480, touches: 2, ticket: true
      },
      {
        title: 'Runbook startet neu, Clients wechseln automatisch',
        steps: [
          { a: 'sys', t: 'Monitoring erkennt den Ausfall. Das Runbook startet den Access Point neu, Clients wechseln auf den Nachbar-AP.', d: 5 },
          { a: 'tech', t: 'Ticket an das Netzwerkteam: wiederholte Hardwarefehler. Austausch geplant, Konfiguration aus Template.', d: 60 },
          { a: 'ma', t: 'Der Workshop verlor fünf Minuten.', d: 0 }
        ],
        it: 30, user: 80, touches: 1, ticket: true
      },
      {
        title: 'Defekt vor dem gebuchten Workshop behoben',
        steps: [
          { a: 'sys', t: 'Telemetrie: Die Fehlerrate des Access Points steigt seit zwei Tagen. Der Raum ist um 13:00 für 16 Personen gebucht.', d: 1 },
          { a: 'ai', t: 'Vorschlag: Nachbar-APs auf höhere Sendeleistung, Austausch heute früh vor dem Termin.', d: 2 },
          { a: 'mgr', t: 'Der Netzwerk-Admin bestätigt.', d: 15 },
          { a: 'sys', t: 'Austausch um 08:30 durch einen Techniker, Konfiguration kommt automatisch aus dem Cloud-Controller.', d: 30 },
          { a: 'ma', t: 'Der Workshop um 13:00 läuft störungsfrei.', d: 0 }
        ],
        it: 30, user: 0, touches: 1, ticket: false, prevented: true
      },
      {
        title: 'Vorhergesagter Defekt, Plug-and-Play-Austausch',
        steps: [
          { a: 'sys', t: 'Prädiktive Analyse erkennt den sich ankündigenden Defekt. Die Lastverteilung wird automatisch angepasst.', d: 1 },
          { a: 'ai', t: 'Ersatz-AP wird vorkonfiguriert aus dem Lager bestellt. Der Facility-Dienst tauscht ihn um 08:00 per Plug and Play.', d: 20 },
          { a: 'ma', t: 'Der Workshop läuft störungsfrei. Niemand aus der IT war beteiligt.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'mfa', start: T(14, 0), field: 'identity',
    title: 'MFA-Gerät verloren: Sven Hartmann hat sein Smartphone im Zug vergessen',
    v: [
      {
        title: 'Identitätsprüfung per Geburtsdatum',
        steps: [
          { a: 'ma', t: 'Sven kann sich nicht anmelden und ruft die IT an. Besetzt.', d: 40, w: 'Sven versucht es weiter.' },
          { a: 'sd', t: 'Identität wird telefonisch über das Geburtsdatum „geprüft“, MFA zurückgesetzt.', d: 30 },
          { a: 'ma', t: 'Sven arbeitet nach 70 Minuten wieder. Dasselbe Verfahren würde auch bei einem Angreifer funktionieren.', d: 0 }
        ],
        it: 30, user: 70, touches: 2, ticket: true, risk: 'Social Engineering möglich'
      },
      {
        title: 'Verifikation per Rückruf',
        steps: [
          { a: 'ma', t: 'Sven meldet sich per Ticket vom Rechner eines Kollegen.', d: 20 },
          { a: 'sd', t: 'Der Service Desk verifiziert per Rückruf bei der Führungskraft und setzt MFA zurück.', d: 45, w: 'Rückruf steht aus.' },
          { a: 'ma', t: 'Sven arbeitet nach gut einer Stunde wieder.', d: 0 }
        ],
        it: 30, user: 65, touches: 2, ticket: true
      },
      {
        title: 'Self-Service mit Ausweis-Check',
        steps: [
          { a: 'ma', t: 'Sven nutzt den Self-Service: Identitätsnachweis per Ausweis-Scan und Video-Check.', d: 15 },
          { a: 'sys', t: 'MFA wird zurückgesetzt, ein temporärer Zugangscode geht an die hinterlegte Nummer.', d: 5 },
          { a: 'ma', t: 'Sven arbeitet nach 20 Minuten wieder.', d: 0 }
        ],
        it: 0, user: 20, touches: 0, ticket: true
      },
      {
        title: 'Zweiter Faktor genügt, Gerät wird gesperrt',
        steps: [
          { a: 'sys', t: 'Windows Hello auf dem Notebook genügt als zweiter Faktor. Das System erkennt das fehlende Smartphone.', d: 1 },
          { a: 'ai', t: 'Agent sperrt das verlorene Smartphone (Remote Wipe) und bietet Sven die Registrierung eines neuen Geräts an.', d: 5 },
          { a: 'ma', t: 'Sven bestätigt den Wipe und arbeitet weiter.', d: 5 },
          { a: 'sys', t: 'Fall geschlossen.', d: 0 }
        ],
        it: 0, user: 10, touches: 0, ticket: false
      },
      {
        title: 'Passwordless mit Gerätebindung',
        steps: [
          { a: 'sys', t: 'Passwordless mit Gerätebindung: Sven arbeitet am Notebook ohne Unterbrechung weiter.', d: 1 },
          { a: 'ai', t: 'Geo-Signal und fehlende Verbindung: Das Smartphone wird automatisch gesperrt, ein Ersatzgerät wird Sven vorgeschlagen.', d: 3 },
          { a: 'ma', t: 'Sven bemerkt den Verlust erst am Abend.', d: 0 }
        ],
        it: 0, user: 2, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'teams', start: T(15, 10), field: 'telemetry',
    title: 'Teams-Anrufqualität sinkt für 40 Mitarbeiter am Standort Hamburg',
    v: [
      {
        title: '„Teams hackt“, Ursache unbekannt',
        steps: [
          { a: 'ma', t: 'Mehrere Beschwerden: „Teams hackt.“ Die IT vermutet ein Problem bei Microsoft.', d: 120, w: '40 Personen telefonieren mit Aussetzern.' },
          { a: 'tech', t: 'Nach Tagen Analyse: Ein Firewall-Update hat die QoS-Regeln zurückgesetzt.', d: 480, w: 'Analyse läuft, Problem bleibt.' },
          { a: 'tech', t: 'QoS-Regeln von Hand neu angelegt.', d: 0 }
        ],
        it: 420, user: 2400, touches: 4, ticket: true
      },
      {
        title: 'Acht Tickets werden zum Problem-Ticket',
        steps: [
          { a: 'sd', t: 'Acht Tickets. Der Service Desk fasst sie zu einem Problem-Ticket zusammen.', d: 60 },
          { a: 'tech', t: 'Das Netzwerkteam analysiert, findet den QoS-Fehler nach dem Firewall-Update und korrigiert ihn.', d: 180, w: 'Analyse läuft.' },
          { a: 'ma', t: 'Nach vier Stunden ist die Qualität wieder normal.', d: 0 }
        ],
        it: 180, user: 1200, touches: 3, ticket: true
      },
      {
        title: 'Dashboard zeigt Jitter, Change wird zurückgesetzt',
        steps: [
          { a: 'sys', t: 'Das Call-Quality-Dashboard zeigt einen Jitter-Anstieg in Hamburg. Alarm an das Netzwerkteam.', d: 15 },
          { a: 'tech', t: 'Techniker erkennt den Zusammenhang mit Change #312 (Firewall) und setzt die Konfiguration zurück.', d: 45 },
          { a: 'ma', t: 'Nach einer Stunde ist die Qualität wieder normal.', d: 0 }
        ],
        it: 45, user: 400, touches: 2, ticket: true
      },
      {
        title: 'Korrelation mit Change #312 in vier Minuten',
        steps: [
          { a: 'sys', t: 'AIOps korreliert: Jitter-Anstieg vier Minuten nach Change #312 am Standort Hamburg.', d: 2 },
          { a: 'ai', t: 'Vorschlag: Rollback der QoS-Konfiguration. Der Change-Owner wird informiert.', d: 2 },
          { a: 'mgr', t: 'Der Change-Owner bestätigt den Rollback.', d: 8 },
          { a: 'sys', t: 'Rollback durchgeführt. Qualität nach zwölf Minuten wieder normal.', d: 2 },
          { a: 'ma', t: 'Die Nutzer haben nur kurz etwas gemerkt.', d: 0 }
        ],
        it: 10, user: 120, touches: 1, ticket: false
      },
      {
        title: 'Change im digitalen Zwilling vorab geprüft',
        steps: [
          { a: 'sys', t: 'Der Change wurde vorab im digitalen Zwilling getestet. Die QoS-Abweichung wurde erkannt, der Change automatisch angepasst.', d: 1 },
          { a: 'ai', t: 'Keine Auswirkung im Betrieb. Lerneffekt: Das Firewall-Template wurde korrigiert.', d: 2 },
          { a: 'sys', t: 'Eintrag im Tagesbericht.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  },
  {
    id: 'offboarding', start: T(16, 0), field: 'identity',
    title: 'Austritt: Claudia Fischer verlässt heute das Unternehmen',
    v: [
      {
        title: 'Niemand hat die IT informiert',
        steps: [
          { a: 'ma', t: 'Claudia verabschiedet sich. Die IT weiß nichts vom Austritt. Konto und Lizenzen bleiben aktiv.', d: 120, w: 'Zugriff besteht weiter.' },
          { a: 'sd', t: 'Rückgabe des Notebooks? Kein Prozess. Erst eine HR-Mail in der nächsten Woche löst die Deaktivierung aus.', d: 60 },
          { a: 'tech', t: 'Konto deaktiviert. Lizenzen laufen weiter, das Notebook taucht nach drei Erinnerungen wieder auf.', d: 0 }
        ],
        it: 90, user: 0, touches: 3, ticket: true, risk: 'Zugriff nach Austritt über Tage'
      },
      {
        title: 'Austritts-Checkliste am letzten Tag',
        steps: [
          { a: 'sd', t: 'Das HR-Ticket „Austritt“ liegt vor. Die Checkliste wird am letzten Tag abgearbeitet.', d: 90 },
          { a: 'tech', t: 'Konto um 18 Uhr deaktiviert, Lizenzen entzogen, Gerät eingesammelt.', d: 60 },
          { a: 'sys', t: 'Fall geschlossen.', d: 0 }
        ],
        it: 60, user: 0, touches: 2, ticket: true
      },
      {
        title: 'Deprovisionierung aus dem HR-System',
        steps: [
          { a: 'sys', t: 'Das HR-System setzt das Austrittsdatum. Die Identität wird um 18:00 deaktiviert, Lizenzen freigegeben, Postfach an die Vertretung weitergeleitet.', d: 5 },
          { a: 'tech', t: 'Das Gerät wird im Lager zurückgenommen und per Skript zurückgesetzt.', d: 20 },
          { a: 'sys', t: 'Fall geschlossen.', d: 0 }
        ],
        it: 15, user: 0, touches: 1, ticket: false
      },
      {
        title: 'Wissensübergabe wird mitgedacht',
        steps: [
          { a: 'sys', t: 'Deprovisionierung läuft automatisch. Der Agent listet 14 Dokumente ohne zweiten Eigentümer und drei Automationen unter Claudias Konto.', d: 3 },
          { a: 'mgr', t: 'Der Teamleiter weist Nachfolger zu.', d: 20 },
          { a: 'sys', t: 'Eigentum übertragen, Rückgabe des Geräts per Versandetikett, Remote-Wipe nach Eingang.', d: 5 },
          { a: 'sys', t: 'Fall geschlossen.', d: 0 }
        ],
        it: 5, user: 0, touches: 1, ticket: false
      },
      {
        title: 'Übergabe seit der Kündigung vorbereitet',
        steps: [
          { a: 'ai', t: 'Der Agent hat die Übergabe seit Bekanntgabe der Kündigung vorbereitet: Service-Konten migriert, Dokumente übertragen, Zugriffe zeitgesteuert.', d: 2 },
          { a: 'sys', t: 'Um 18:00 erlischt jeder Zugriff. Das Gerät meldet sich nach Rückgabe automatisch im Pool zurück.', d: 1 },
          { a: 'sys', t: 'Eintrag im Tagesbericht.', d: 0 }
        ],
        it: 0, user: 0, touches: 0, ticket: false, prevented: true
      }
    ]
  }
];

const DAY_START = T(7, 0);
const DAY_END = T(19, 30);
