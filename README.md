# Zero-Touch IT Simulator

Eine Simulation der IT der Zukunft. Sie verteilen ein Budget auf sieben Handlungsfelder, lassen einen Arbeitstag mit elf typischen Ereignissen in einer 3D-Szene ablaufen und sehen in der Auswertung, welche Maßnahme wie gewirkt hat und welche Investition als nächste am meisten bringt.

## Ablauf

1. **Planen.** Budget wählen (12, 20, 30 Punkte oder unbegrenzt) und in der Investitionsmatrix je Handlungsfeld die Zielstufe kaufen. Stufe 4 setzt End-to-End-Telemetrie voraus, Stufe 5 zusätzlich AIOps und Auto-Remediation. Die Organisation begrenzt alles: Ereignisse laufen höchstens eine Stufe über der Organisation. Eine Vorschau zeigt vor dem Start, auf welcher Stufe jedes Ereignis laufen wird und welches Feld es begrenzt.
2. **Beobachten.** Der Arbeitstag läuft von 07:00 bis 19:30 in einem stilisierten Bürogeschoss mit Großraumbüro, Serverraum, Besprechungsraum und Service Desk. Techniker laufen zu Störungen, Automatisierung erscheint als Lichtsäule, der KI-Agent als Drohne, Freigaben als Häkchen am Service Desk. Rote Bildschirme zeigen blockierte Mitarbeiter, Ticketstapel die Warteschlange. Kennzahlen, Experience-Index und Ereignisprotokoll laufen live mit. Die Kamera folgt neuen Ereignissen, Maus ziehen dreht, Mausrad zoomt.
3. **Auswerten.** Kennzahlen im Vergleich zu „Ohne Investition“ und zum letzten Durchlauf, Ergebnis je Ereignis mit begrenzendem Feld, und die beste nächste Investition (je eine Stufe mehr in einem Feld, bewertet an diesem Tag). Danach neu planen.

Ergänzend zwei Wissensseiten: **Reifegrade** (fünf Stufen mit Richtwerten, Perspektiven und Diagrammen) und **Ihr Weg** (Selbsteinschätzung über sieben Handlungsfelder mit Roadmap). Die Einschätzung lässt sich als Ausgangslage in die Simulation übernehmen; vorhandene Stufen kosten dann kein Budget.

## Nutzung

Statische Dateien ohne Build-Schritt. `index.html` lokal öffnen oder über einen Webserver ausliefern (zum Beispiel `python3 -m http.server`), für GitHub Pages genügt das Wurzelverzeichnis. three.js wird von cdnjs geladen, Schriften von Google Fonts. Ohne WebGL funktionieren Planung, Protokoll und Auswertung weiterhin.

Tastatur während des Tages: Leertaste für Pause und Weiter, Pfeil rechts für das Tagesende, Escape für Neu planen.

## Inhalte anpassen

Alle fachlichen Inhalte liegen in `data.js`:

- `LEVELS`, `PERSPECTIVES`: Reifegrade, Richtwerte, Zitate.
- `FIELDS`: Handlungsfelder mit Kurztiteln (`short`) und Beschreibungen (`stages`) je Stufe.
- `STAGE_COST`, `BUDGETS`, `stageBlocker()`, `effectiveLevel()`: Kosten, Budgets, Voraussetzungen und die Regel, auf welcher Stufe ein Ereignis läuft.
- `TRANSITIONS`: Fokus, Dauer, Maßnahmen und Erfolgskriterium je Schritt der Roadmap.
- `EVENTS`: Ereignisse mit beteiligten Feldern (`fields`) und fünf Varianten, jede mit Schritten (`a` Akteur, `t` Text, `d` Dauer in Minuten, `w` Wartehinweis) sowie Aufwand (`it`), Ausfallzeit (`user`), Eingriffen (`touches`), Ticket und Kennzeichen `prevented`.

Alle Zahlen sind illustrative Richtwerte, keine Benchmarks.

## Dateien

| Datei | Inhalt |
|---|---|
| `index.html` | Seitenstruktur: 3D-Bühne, Overlays, Wissensseiten |
| `styles.css` | Gestaltung, hell und dunkel |
| `data.js` | Inhalte und Simulationsregeln |
| `game.js` | 3D-Szene (three.js): Gebäude, Figuren, Marker, Effekte, Kamera |
| `app.js` | Ablauf, Planung, Simulationsengine, HUD, Auswertung, Wissensseiten |
