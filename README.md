# Zero-Touch IT Simulator

Interaktive Simulation einer hoch automatisierten, proaktiven IT. Die Anwendung zeigt Kunden, wie sich eine Zero-Touch-IT im Alltag anfühlt, und wie eine Organisation Schritt für Schritt dorthin kommt.

## Was die Simulation zeigt

**Simulation.** Ein Arbeitstag von 07:00 bis 19:30 mit elf typischen Ereignissen: Onboarding, SSD-Verschleiß, kritische Schwachstelle, voller Fileshare, Lizenzanfrage, Kontoübernahme, WLAN-Ausfall, verlorenes MFA-Gerät, Teams-Anrufqualität, Austritt, fehlerhaftes Anwendungs-Update. Jedes Ereignis läuft auf jedem der fünf Reifegrade anders ab. Kennzahlen (offene Fälle, Tickets, IT-Aufwand, Ausfallzeit, manuelle Eingriffe, Experience-Index) und drei Perspektiven (Mitarbeiter, IT-Team, Management) zeigen die Wirkung. Jede Karte lässt sich auf alle fünf Stufen vergleichen.

**Reifegrade.** Die fünf Stufen Reaktiv, Standardisiert, Automatisiert, Proaktiv und Autonom mit Beschreibung, Richtwerten, Rollenverteilung, Diagrammen zum Tagesvergleich und zum Anteil von Mensch, Automatisierung und KI-Agent.

**Ihr Weg.** Selbsteinschätzung über sieben Handlungsfelder (Arbeitsplatz & Geräte, Identität & Zugriff, Telemetrie, Daten & KI, Automatisierung & Orchestrierung, Service Management & Self-Service, Sicherheit & Compliance, Organisation, Rollen & Kultur). Daraus entstehen Standort, Engpass und eine Roadmap mit Schritten, typischer Dauer, Maßnahmen und Erfolgskriterien. Die Einschätzung lässt sich direkt als Simulationsstufe erleben und als Text kopieren.

## Nutzung

Die Anwendung besteht aus statischen Dateien ohne Build-Schritt.

- `index.html` lokal im Browser öffnen oder über einen beliebigen Webserver ausliefern, zum Beispiel `python3 -m http.server`.
- Für GitHub Pages den Branch als Quelle wählen, das Wurzelverzeichnis genügt.

Tastatur: Leertaste für Pause und Weiter, Ziffern 1 bis 5 für den Reifegrad, Pfeil rechts für das Tagesende.

## Inhalte anpassen

Alle fachlichen Inhalte liegen in `data.js`:

- `LEVELS` und `PERSPECTIVES`: Reifegrade, Richtwerte, Zitate.
- `FIELDS`: Handlungsfelder mit je fünf Ausbaustufen (Matrix der Selbsteinschätzung).
- `TRANSITIONS`: Fokus, Dauer, Maßnahmen und Erfolgskriterium je Schritt.
- `EVENTS`: Ereignisse mit fünf Varianten, jede mit Schritten (`a` Akteur, `t` Text, `d` Dauer in Minuten, `w` Wartehinweis) sowie Aufwand (`it`), Ausfallzeit (`user`), Eingriffen (`touches`), Ticket und Kennzeichen `prevented`.

Kennzahlen, Diagramme und der Experience-Index werden aus diesen Daten berechnet. Alle Zahlen sind illustrative Richtwerte, keine Benchmarks.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur |
| `styles.css` | Gestaltung, hell und dunkel |
| `data.js` | Inhalte der Simulation |
| `app.js` | Simulationsengine, Diagramme, Selbsteinschätzung, Roadmap |
