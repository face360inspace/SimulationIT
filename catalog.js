/* =========================================================================
   Zero-Touch IT Simulator – Katalog für die Ist-Aufnahme
   - TOOL_CATALOG : Werkzeuge und Fähigkeiten, die in Architekturunterlagen,
                    Dokumentationen oder Wikis erkannt werden. Jeder Eintrag
                    liefert ein Signal: Handlungsfeld und Stufe, die das
                    Vorhandensein nahelegt.
   - QUESTIONS    : Kurzinterview mit den Delivery-Teams (Betriebswissen).
   - TICKET_RULES : Zuordnung von Ticketkategorien und Stichwörtern zu den
                    elf Ereignistypen der Simulation.
   ========================================================================= */

const TOOL_CATALOG = [
  /* Arbeitsplatz & Geräte */
  { id: 'intune', label: 'Microsoft Intune / Endpoint Manager', kw: ['intune', 'endpoint manager', 'mem '], field: 'endpoint', stage: 3, note: 'MDM mit Zero-Touch-Provisioning möglich' },
  { id: 'autopilot', label: 'Windows Autopilot', kw: ['autopilot'], field: 'endpoint', stage: 3, note: 'Zero-Touch-Provisioning' },
  { id: 'abm', label: 'Apple Business Manager / Jamf', kw: ['apple business manager', 'jamf', 'abm '], field: 'endpoint', stage: 3, note: 'Zero-Touch-Provisioning für Apple-Geräte' },
  { id: 'sccm', label: 'SCCM / Configuration Manager', kw: ['sccm', 'configuration manager', 'mecm'], field: 'endpoint', stage: 2, note: 'zentrale Imaging-Lösung' },
  { id: 'dex', label: 'Digital Employee Experience (Nexthink, 1E, Lakeside, ControlUp)', kw: ['nexthink', '1e tachyon', 'lakeside', 'systrack', 'controlup', 'digital employee experience', 'dex-'], field: 'endpoint', stage: 4, note: 'Geräte-Telemetrie und Remediation' },
  { id: 'remediation', label: 'Proaktive Remediation / Self-Healing', kw: ['proactive remediation', 'self-healing', 'selbstheil', 'auto-heal'], field: 'endpoint', stage: 5, note: 'selbstheilende Clients' },
  { id: 'excel-inventar', label: 'Inventar in Excel', kw: ['inventar in excel', 'excel-liste', 'inventarliste'], field: 'endpoint', stage: 1, note: 'kein Inventarsystem' },
  /* Identität & Zugriff */
  { id: 'ad', label: 'Active Directory', kw: ['active directory', ' ad ', 'adds'], field: 'identity', stage: 2, note: 'zentrales Verzeichnis' },
  { id: 'entra', label: 'Entra ID / Azure AD', kw: ['entra', 'azure ad', 'aad'], field: 'identity', stage: 2, note: 'zentrales Verzeichnis' },
  { id: 'sso', label: 'Single Sign-on', kw: ['single sign-on', 'single sign on', 'sso', 'saml', 'oidc'], field: 'identity', stage: 3, note: 'SSO' },
  { id: 'mfa', label: 'Multi-Faktor-Authentifizierung', kw: ['mfa', 'multi-faktor', 'multi-factor', '2fa', 'authenticator'], field: 'identity', stage: 3, note: 'MFA' },
  { id: 'hrprov', label: 'HR-getriebene Provisionierung (SailPoint, Okta Lifecycle, Entra Lifecycle)', kw: ['sailpoint', 'okta lifecycle', 'lifecycle workflows', 'hr-getrieben', 'hr-driven', 'joiner', 'identity governance', 'iam '], field: 'identity', stage: 3, note: 'automatische Provisionierung' },
  { id: 'ca', label: 'Conditional Access / risikobasierter Zugriff', kw: ['conditional access', 'risikobasiert', 'risk-based', 'identity protection', 'pim ', 'privileged identity'], field: 'identity', stage: 4, note: 'risikobasierte Zugriffsentscheidung' },
  { id: 'passwordless', label: 'Passwordless / FIDO2 / Windows Hello for Business', kw: ['passwordless', 'fido2', 'hello for business', 'passkey'], field: 'identity', stage: 5, note: 'passwortlos' },
  /* Telemetrie, Daten & KI */
  { id: 'nagios', label: 'Infrastruktur-Monitoring (Nagios, PRTG, Zabbix, Checkmk, SCOM)', kw: ['nagios', 'prtg', 'zabbix', 'checkmk', 'check_mk', 'scom', 'icinga', 'solarwinds'], field: 'telemetry', stage: 2, note: 'zentrales Monitoring' },
  { id: 'apm', label: 'Observability / APM (Datadog, Dynatrace, Splunk Observability, Grafana, Elastic)', kw: ['datadog', 'dynatrace', 'grafana', 'prometheus', 'elastic', 'new relic', 'appdynamics', 'observability', 'opentelemetry'], field: 'telemetry', stage: 3, note: 'End-to-End-Telemetrie' },
  { id: 'aiops', label: 'AIOps (Moogsoft, BigPanda, ServiceNow ITOM Predictive AIOps, Dynatrace Davis)', kw: ['aiops', 'moogsoft', 'bigpanda', 'predictive aiops', 'davis', 'event correlation', 'alarmkorrelation', 'anomalieerkennung'], field: 'telemetry', stage: 4, note: 'AIOps' },
  { id: 'agents', label: 'KI-Agenten im Betrieb (Now Assist, Agentic Ops, Copilot für IT)', kw: ['now assist', 'ki-agent', 'ai agent', 'agentic', 'copilot for service', 'llm-agent'], field: 'telemetry', stage: 5, note: 'KI-Agenten' },
  /* Automatisierung & Orchestrierung */
  { id: 'git', label: 'Skripte in Git (GitLab, GitHub, Azure DevOps)', kw: ['gitlab', 'github', 'azure devops', 'bitbucket', 'git-repo', 'versioniert'], field: 'automation', stage: 2, note: 'versionierte Skript-Bibliothek' },
  { id: 'patchplan', label: 'Zentrales Patch-Management (WSUS, Ivanti, Baramundi)', kw: ['wsus', 'ivanti', 'baramundi', 'patch management', 'patchmanagement'], field: 'automation', stage: 2, note: 'Patch-Plan' },
  { id: 'workflow', label: 'Workflow-Engine / Runbook-Automation (ServiceNow Flow Designer, Power Automate, Ansible, n8n)', kw: ['flow designer', 'power automate', 'ansible', 'n8n', 'runbook', 'workflow-engine', 'orchestrator', 'integration hub', 'integrationhub', 'rundeck', 'puppet', 'chef '], field: 'automation', stage: 3, note: 'Workflow-Engine' },
  { id: 'iac', label: 'Infrastructure as Code / Auto-Remediation (Terraform, event-driven Ansible)', kw: ['terraform', 'infrastructure as code', 'iac', 'event-driven', 'auto-remediation', 'autoremediation', 'self-remediat'], field: 'automation', stage: 4, note: 'Auto-Remediation und IaC' },
  { id: 'orchestration', label: 'Autonome Orchestrierung mit Policy-Framework', kw: ['policy-as-code', 'policy as code', 'autonome orchestrierung', 'guardrails', 'leitplanken'], field: 'automation', stage: 5, note: 'autonome Orchestrierung' },
  /* Service Management & Self-Service */
  { id: 'itsm', label: 'ITSM-Werkzeug (ServiceNow, Jira Service Management, Matrix42, OTRS, TOPdesk)', kw: ['servicenow', 'service now', 'jira service', 'matrix42', 'otrs', 'topdesk', 'ivanti neurons', 'freshservice', 'helpline', 'itsm'], field: 'service', stage: 2, note: 'ITSM mit Prozessen' },
  { id: 'portal', label: 'Self-Service-Portal / Servicekatalog / Chatbot', kw: ['self-service', 'self service', 'servicekatalog', 'service catalog', 'chatbot', 'virtual agent', 'knowledge base', 'wissensdatenbank'], field: 'service', stage: 3, note: 'Self-Service' },
  { id: 'proactive', label: 'Proaktive Kommunikation / Experience Management (XLA)', kw: ['xla', 'experience level', 'proaktive kommunikation', 'statusseite', 'status page', 'proactive notification'], field: 'service', stage: 4, note: 'proaktive Kommunikation' },
  { id: 'phone-only', label: 'Anfragen nur per Telefon und E-Mail', kw: ['nur per telefon', 'per e-mail an die it', 'kein ticketsystem', 'ohne ticketsystem'], field: 'service', stage: 1, note: 'kein Ticketsystem' },
  /* Sicherheit & Compliance */
  { id: 'av', label: 'Virenschutz und Firewall', kw: ['virenschutz', 'antivirus', 'firewall'], field: 'security', stage: 1, note: 'Basisschutz' },
  { id: 'policies', label: 'Sicherheitsrichtlinien und Awareness', kw: ['sicherheitsrichtlinie', 'security policy', 'awareness', 'iso 27001', 'isms'], field: 'security', stage: 2, note: 'Richtlinien' },
  { id: 'edr', label: 'EDR / XDR (Defender for Endpoint, CrowdStrike, SentinelOne)', kw: ['edr', 'xdr', 'defender for endpoint', 'crowdstrike', 'sentinelone', 'cortex'], field: 'security', stage: 3, note: 'EDR' },
  { id: 'siem', label: 'SIEM (Sentinel, Splunk, QRadar, Elastic Security)', kw: ['siem', 'sentinel', 'splunk', 'qradar', 'elastic security', 'arcsight'], field: 'security', stage: 3, note: 'SIEM' },
  { id: 'vuln', label: 'Risikobasiertes Schwachstellenmanagement (Tenable, Qualys, Defender Vulnerability Management)', kw: ['tenable', 'qualys', 'vulnerability management', 'schwachstellenmanagement', 'rapid7'], field: 'security', stage: 4, note: 'risikobasierte Schwachstellenbehandlung' },
  { id: 'soar', label: 'SOAR / automatisierte Abwehr', kw: ['soar', 'automated response', 'playbook', 'automatisierte abwehr', 'xsoar', 'sentinel playbooks'], field: 'security', stage: 5, note: 'SOAR' },
  /* Organisation, Rollen & Kultur */
  { id: 'itil', label: 'Dokumentierte Prozesse und Rollen (ITIL)', kw: ['itil', 'raci', 'prozesslandkarte', 'rollenmodell', 'betriebshandbuch'], field: 'org', stage: 2, note: 'Rollen und Prozesse' },
  { id: 'autoeng', label: 'Automation Engineering als Rolle', kw: ['automation engineer', 'automatisierungsteam', 'automate first', 'automation team', 'sre'], field: 'org', stage: 3, note: 'Automation Engineering' },
  { id: 'product', label: 'Produktteams / XLA-Steuerung', kw: ['produktteam', 'product team', 'plattformteam', 'platform team', 'xla'], field: 'org', stage: 4, note: 'Produktteams' },
  { id: 'policyorg', label: 'Steuerung über Policies und Leitplanken', kw: ['policy board', 'governance board', 'leitplanken', 'steuerungsfunktion'], field: 'org', stage: 5, note: 'Steuerung über Policies' }
];

/* Kurzinterview: Antworten ja / teilweise / nein. Jede Frage stützt eine Stufe
   eines Handlungsfeldes. */
const QUESTIONS = [
  { id: 'q_inventory', field: 'endpoint', stage: 2, text: 'Gibt es ein vollständiges, gepflegtes Inventar aller Geräte (CMDB) und einen Standard-Hardwarekatalog?' },
  { id: 'q_zerotouch', field: 'endpoint', stage: 3, text: 'Richten sich neue Geräte ohne Eingriff der IT ein (Autopilot, Apple Business Manager)?' },
  { id: 'q_dex', field: 'endpoint', stage: 4, text: 'Erkennt die IT Geräteprobleme (Akku, SSD, Performance) bevor Mitarbeiter sie melden?' },
  { id: 'q_roles', field: 'identity', stage: 2, text: 'Gibt es ein dokumentiertes Rollenmodell und Passwort-Self-Service?' },
  { id: 'q_hr', field: 'identity', stage: 3, text: 'Werden Konten, Berechtigungen und Lizenzen bei Eintritt, Wechsel und Austritt automatisch aus dem HR-System gesteuert?' },
  { id: 'q_ca', field: 'identity', stage: 4, text: 'Werden Zugriffe risikobasiert entschieden (Conditional Access) und Admin-Rechte nur befristet vergeben?' },
  { id: 'q_monitoring', field: 'telemetry', stage: 2, text: 'Werden Server, Netz und Cloud zentral überwacht, mit definierten Schwellwerten?' },
  { id: 'q_e2e', field: 'telemetry', stage: 3, text: 'Laufen Telemetriedaten von Clients, Netz, Anwendungen und Cloud in einer Plattform zusammen und werden Alarme korreliert?' },
  { id: 'q_aiops', field: 'telemetry', stage: 4, text: 'Nutzt die IT Prognosen oder Anomalieerkennung, um Störungen vorherzusagen?' },
  { id: 'q_scripts', field: 'automation', stage: 2, text: 'Sind Skripte versioniert abgelegt und wird Patching zentral geplant?' },
  { id: 'q_workflow', field: 'automation', stage: 3, text: 'Laufen Standardanfragen (Lizenz, Zugriff, Software) als Workflow ohne manuelle Schritte?' },
  { id: 'q_remediation', field: 'automation', stage: 4, text: 'Lösen Alarme automatisch Korrekturmaßnahmen aus?' },
  { id: 'q_itsm', field: 'service', stage: 2, text: 'Laufen alle Anfragen über ein ITSM-Werkzeug mit Servicekatalog und SLAs?' },
  { id: 'q_portal', field: 'service', stage: 3, text: 'Nutzen Mitarbeiter ein Self-Service-Portal oder einen Chatbot für Standardanfragen?' },
  { id: 'q_proactive', field: 'service', stage: 4, text: 'Werden Betroffene informiert, bevor sie eine Störung bemerken?' },
  { id: 'q_patch', field: 'security', stage: 2, text: 'Gibt es feste Patch-Zyklen, dokumentierte Sicherheitsrichtlinien und Awareness-Schulungen?' },
  { id: 'q_edr', field: 'security', stage: 3, text: 'Sind EDR auf allen Geräten, automatisches Patching inklusive Drittanbieter und ein SIEM im Einsatz?' },
  { id: 'q_vuln', field: 'security', stage: 4, text: 'Werden Schwachstellen risikobasiert priorisiert und automatisch geschlossen, Compliance-Nachweise automatisch erzeugt?' },
  { id: 'q_roles_org', field: 'org', stage: 2, text: 'Sind Rollen, Verantwortlichkeiten und Eskalationswege dokumentiert und werden sie regelmäßig überprüft?' },
  { id: 'q_autoeng', field: 'org', stage: 3, text: 'Gibt es eine Rolle Automation Engineering und fest eingeplante Zeit für Automatisierung?' },
  { id: 'q_product', field: 'org', stage: 4, text: 'Arbeitet die IT in Produktteams und steuert über Kennzahlen zum Arbeitserlebnis (XLA)?' }
];

/* Zuordnung von Tickets zu Ereignistypen: Kategorie- und Stichwortregeln,
   deutsch und englisch. Reihenfolge = Priorität. */
const TICKET_RULES = [
  { type: 'mfa', kw: ['passwort', 'password', 'kennwort', 'mfa', 'authenticator', 'zweiter faktor', 'two-factor', '2fa', 'gesperrt', 'locked out', 'account lock', 'anmeldung nicht möglich', 'cannot login', 'login fehlgeschlagen'] },
  { type: 'login', kw: ['phishing', 'verdächtig', 'suspicious', 'security incident', 'sicherheitsvorfall', 'malware', 'virus', 'kompromittiert', 'compromised', 'impossible travel', 'unbekannte anmeldung'] },
  { type: 'onboarding', kw: ['onboarding', 'neuer mitarbeiter', 'new hire', 'new employee', 'eintritt', 'joiner', 'konto anlegen', 'create account', 'erstausstattung', 'arbeitsplatz einrichten'] },
  { type: 'offboarding', kw: ['offboarding', 'austritt', 'leaver', 'kündigung', 'konto deaktivieren', 'disable account', 'rückgabe', 'termination'] },
  { type: 'license', kw: ['lizenz', 'license', 'software bestellen', 'software request', 'installation', 'install ', 'visio', 'adobe', 'zugriff auf', 'access request', 'berechtigung', 'permission', 'freigabe für'] },
  { type: 'storage', kw: ['speicher', 'storage', 'disk full', 'festplatte voll', 'quota', 'fileshare', 'file share', 'netzlaufwerk', 'network drive', 'laufwerk', 'onedrive voll', 'sharepoint speicher'] },
  { type: 'wlan', kw: ['wlan', 'wifi', 'wi-fi', 'access point', 'netzwerk', 'network', 'lan ', 'switch', 'vpn', 'verbindung', 'connectivity', 'kein internet', 'no internet'] },
  { type: 'teams', kw: ['teams', 'call quality', 'anrufqualität', 'telefon', 'voip', 'telefonie', 'audio', 'video', 'konferenz', 'webex', 'zoom'] },
  { type: 'ssd', kw: ['notebook', 'laptop', 'hardware', 'defekt', 'ssd', 'akku', 'battery', 'display', 'bildschirm', 'startet nicht', 'does not boot', 'bluescreen', 'tastatur', 'keyboard', 'monitor', 'docking', 'drucker', 'printer', 'gerät'] },
  { type: 'cve', kw: ['patch', 'update', 'vulnerability', 'schwachstelle', 'cve', 'sicherheitsupdate', 'security update', 'browser update', 'windows update'] },
  { type: 'erp', kw: ['absturz', 'crash', 'anwendung', 'application', 'erp', 'sap', 'fehlermeldung', 'error', 'funktioniert nicht', 'not working', 'langsam', 'slow', 'performance', 'outlook', 'excel', 'office'] }
];

/* ServiceNow-Kategorien (Standard und häufige Varianten) als Vorzuordnung. */
const CATEGORY_MAP = {
  'hardware': 'ssd', 'network': 'wlan', 'netzwerk': 'wlan', 'software': 'erp', 'database': 'erp', 'inquiry / help': 'license', 'inquiry': 'license',
  'security': 'login', 'sicherheit': 'login', 'access': 'license', 'zugriff': 'license', 'account': 'mfa', 'konto': 'mfa', 'telephony': 'teams', 'telefonie': 'teams',
  'storage': 'storage', 'speicher': 'storage', 'onboarding': 'onboarding', 'offboarding': 'offboarding', 'patch': 'cve', 'application': 'erp', 'anwendung': 'erp'
};
