# Zero-Touch IT Simulator

Eine Simulation der IT der Zukunft. Sie verteilen ein Budget auf sieben Handlungsfelder, lassen einen Arbeitstag mit elf typischen Ereignissen in einer 3D-Szene ablaufen und sehen in der Auswertung, welche Maßnahme wie gewirkt hat und welche Investition als nächste am meisten bringt.

## Ablauf

Eine feste Kopfleiste zeigt den Ablauf als vier Schritte (1 Planen, 2 Arbeitstag, 3 Auswertung, 4 Prognose) und führt rechts zu den Wissensseiten Reifegrade und Standort. Jeder Schritt ist über die Kopfleiste erreichbar, sobald er sinnvoll ist; jede Ansicht hat eine Adresse (`#planen`, `#arbeitstag`, `#auswertung`, `#prognose`, `#reifegrade`, `#standort`), sodass Browser-Zurück, Neuladen und Direktlinks für Präsentationen funktionieren. Wer aus dem Arbeitstag auf eine Wissensseite wechselt, pausiert ihn und kommt über „Zurück zum Arbeitstag“ wieder hinein.


1. **Planen.** Budget wählen (12, 20, 30 Punkte oder unbegrenzt) und in der Investitionsmatrix je Handlungsfeld die Zielstufe kaufen. Stufe 4 setzt End-to-End-Telemetrie voraus, Stufe 5 zusätzlich AIOps und Auto-Remediation. Die Organisation begrenzt alles: Ereignisse laufen höchstens eine Stufe über der Organisation. Eine Vorschau zeigt vor dem Start, auf welcher Stufe jedes Ereignis laufen wird und welches Feld es begrenzt.
2. **Beobachten.** Der Arbeitstag läuft von 07:00 bis 19:30 in einem stilisierten Bürogeschoss mit Großraumbüro, Serverraum, Besprechungsraum und Service Desk. Techniker laufen zu Störungen, Automatisierung erscheint als Lichtsäule, der KI-Agent als Drohne, Freigaben als Häkchen am Service Desk. Rote Bildschirme zeigen blockierte Mitarbeiter, Ticketstapel die Warteschlange. Kennzahlen, Experience-Index und Ereignisprotokoll laufen live mit. Die Kamera folgt neuen Ereignissen, Maus ziehen dreht, Mausrad zoomt.
3. **Auswerten.** Kennzahlen im Vergleich zu „Ohne Investition“ und zum letzten Durchlauf, Ergebnis je Ereignis mit begrenzendem Feld, und die beste nächste Investition (je eine Stufe mehr in einem Feld, bewertet an diesem Tag). Danach neu planen.

4. **Prognose und Roadmap.** Die Seite ist in vier Abschnitte gegliedert: A Ausgangslage (die Planung je Handlungsfeld mit Jahreswerten), B die drei Wirkregeln mit einer Abhängigkeitsmatrix Ereignis × Handlungsfeld, C je Handlungsfeld eine Maßnahmenkarte „heute Stufe n → Maßnahme Stufe n+1“ mit Voraussetzungen, Wirkung und Partnerschritt, D der Roadmap-Vorschlag als Zeitstrahl. Ausgehend von der aktuellen Konfiguration simuliert die Analyse viele zufällig variierte Jahre: Jeder Ereignistyp tritt mit seiner typischen Häufigkeit auf (Poisson-verteilt, skaliert nach Mitarbeiterzahl und Abdeckung), Aufwände streuen. Daraus entstehen Jahreswerte mit Bandbreiten (10. bis 90. Perzentil) für die Ausgangslage und für jede mögliche nächste Maßnahme: Investition, erwartete Ersparnis, Nettonutzen nach laufenden Kosten, Nutzen je investiertem Euro, Amortisation, Wirkung auf einzelne Ereignistypen, freigeschaltete Stufen und der beste Partner-Schritt. Ein Optimierer schlägt eine Roadmap vor: Er wählt Schritt für Schritt die Maßnahme mit dem höchsten Nettonutzen je Euro und schaut dabei bis zu drei Schritte voraus, damit reine Voraussetzungen (etwa Telemetrie vor Auto-Remediation) richtig eingeordnet werden. Alle Annahmen (Mitarbeiter, Abdeckung, Stundensätze, Ticketkosten, Investition je Punkt, laufende Kosten, Streuung, Häufigkeiten je Ereignistyp) sind in der Oberfläche änderbar. Die Roadmap lässt sich ganz oder schrittweise in die Planung übernehmen und direkt als Tag simulieren. Mit „Tag variieren“ wählt auch die sichtbare Simulation Ereignisse, Zeiten und Aufwände zufällig.

Ergänzend zwei Wissensseiten: **Reifegrade** (fünf Stufen mit Richtwerten, Perspektiven und Diagrammen) und **Standort** (Selbsteinschätzung über sieben Handlungsfelder mit Entwicklungspfad in Etappen). Die Einschätzung lässt sich als Ausgangslage in die Simulation übernehmen; vorhandene Stufen kosten dann kein Budget.

## Nutzung

Statische Dateien ohne Build-Schritt. `index.html` lokal öffnen oder über einen Webserver ausliefern (zum Beispiel `python3 -m http.server`), für GitHub Pages genügt das Wurzelverzeichnis. three.js wird von cdnjs geladen, Schriften von Google Fonts. Ohne WebGL funktionieren Planung, Protokoll und Auswertung weiterhin.

Tastatur während des Arbeitstages: Leertaste für Pause und Weiter, Pfeil rechts für das Tagesende, Escape pausiert, 1, 2 und 4 setzen die Geschwindigkeit. Abbrechen fragt nach, solange der Tag läuft.

## Inhalte anpassen

Alle fachlichen Inhalte liegen in `data.js`:

- `LEVELS`, `PERSPECTIVES`: Reifegrade, Richtwerte, Zitate.
- `FIELDS`: Handlungsfelder mit Kurztiteln (`short`) und Beschreibungen (`stages`) je Stufe.
- `STAGE_COST`, `BUDGETS`, `stageBlocker()`, `effectiveLevel()`: Kosten, Budgets, Voraussetzungen und die Regel, auf welcher Stufe ein Ereignis läuft.
- `TRANSITIONS`: Fokus, Dauer, Maßnahmen und Erfolgskriterium je Schritt der Roadmap.
- `PARAMS`: Annahmen der Prognose (Mitarbeiter, Abdeckung, Kostensätze, Investition je Punkt, laufende Kosten, Simulationsläufe, Streuung).
- `EVENTS`: Ereignisse mit beteiligten Feldern (`fields`), Häufigkeit je Monat (`freq`, je 100 Mitarbeiter oder `perCompany`) und fünf Varianten, jede mit Schritten (`a` Akteur, `t` Text, `d` Dauer in Minuten, `w` Wartehinweis) sowie Aufwand (`it`), Ausfallzeit (`user`), Eingriffen (`touches`), Ticket und Kennzeichen `prevented`.

Alle Zahlen sind illustrative Richtwerte, keine Benchmarks.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur: 3D-Bühne, Overlays, Wissensseiten |
| `styles.css` | Gestaltung, hell und dunkel |
| `data.js` | Inhalte und Simulationsregeln |
| `game.js` | 3D-Szene (three.js): Gebäude, Figuren, Marker, Effekte, Kamera |
| `analysis.js` | Prognose: Erwartungswerte, Monte-Carlo-Simulation, Maßnahmenbewertung, Roadmap-Optimierer |
| `app.js` | Ablauf, Planung, Simulationsengine, HUD, Auswertung, Wissensseiten |
