# F1 26

Ein inoffizielles Formel-1-Fan-Spiel zur Saison 2026 im Browser. Gebaut mit Three.js; Autos, Strecken, Gelände und Sound sind prozedural erzeugt, es gibt keine externen Grafiken.

## Starten

Die Dateien müssen über einen lokalen Webserver laufen (ES-Module). Im Hauptordner des Repos:

```bash
python3 -m http.server 8000
```

Dann **http://localhost:8000/f1/** öffnen.

## Spielmodi

| Modus | Beschreibung |
|---|---|
| **Schnelles Rennen** | Fahrer, Strecke, Runden (1–20), KI-Stärke, Startplatz und Reifen wählen |
| **Multiplayer** | 2 Spieler an einem PC im Splitscreen, beide gegen 20 KI-Autos |
| **Weltmeisterschaft** | 8 Rennen mit Fahrer- und Team-WM, Punkte 25-18-15-12-10-8-6-4-2-1; der Stand wird im Browser gespeichert |
| **Zeitfahren** | Allein auf der Strecke, Rekord pro Strecke wird gespeichert |

## Teams und Fahrer 2026

| Team | Fahrer |
|---|---|
| McLaren | Lando Norris (1), Oscar Piastri (81) |
| Ferrari | Charles Leclerc (16), Lewis Hamilton (44) |
| Red Bull Racing | Max Verstappen (3), Isack Hadjar (6) |
| Mercedes | George Russell (63), Kimi Antonelli (12) |
| Aston Martin | Fernando Alonso (14), Lance Stroll (18) |
| Alpine | Pierre Gasly (10), Franco Colapinto (43) |
| Williams | Alexander Albon (23), Carlos Sainz (55) |
| Racing Bulls | Liam Lawson (30), Arvid Lindblad (41) |
| Haas | Esteban Ocon (31), Oliver Bearman (87) |
| Audi | Nico Hülkenberg (27), Gabriel Bortoleto (5) |
| Cadillac | Sergio Pérez (11), Valtteri Bottas (77) |

## Strecken (echte Layouts in Originalgröße)

| Strecke | Länge | Besonderheit im Spiel |
|---|---|---|
| Suzuka (Japan) | 5,807 km | Acht-Form mit Brücke, Riesenrad |
| Monaco | 3,337 km | enger Stadtkurs zwischen Häusern, Jachten |
| Silverstone (Großbritannien) | 5,891 km | schnelle Kurven, bewölkter Himmel |
| Spa-Francorchamps (Belgien) | 7,004 km | Höhenprofil mit Eau Rouge / Raidillon, Wald |
| Zandvoort (Niederlande) | 4,259 km | Steilkurven (19° und 18°), Dünen und Nordsee |
| Monza (Italien) | 5,793 km | lange Vollgas-Geraden |
| Circuit of the Americas (USA) | 5,513 km | steiler Anstieg zur ersten Kurve |
| Yas Marina (Abu Dhabi) | 5,281 km | Nachtrennen unter dem leuchtenden Hotel |

## Realismus

- Fahrphysik mit Abtrieb: bis etwa 5 g in schnellen Kurven und beim Bremsen, rund 340 km/h Spitze. Die Rundenzeiten der KI liegen nah an echten Zeiten (Monza etwa 1:22, Spa etwa 1:43 auf „Profi“).
- Regeln wie 2026: Batterie und **Overtake-Modus** (weniger als 1 Sekunde hinter einem Auto gibt der Boost mehr Tempo), Bremsen lädt die Batterie, das Regenlicht blinkt beim Laden.
- **Track Limits**: viermal komplett neben der Strecke ergibt 5 Sekunden Strafe; im Zeitfahren wird die Runde ungültig.
- Sektorzeiten in Lila (schnellste), Grün (persönliche Bestzeit) und Gelb, Zeitenturm wie im TV, Startampel mit fünf Lichtern.
- Reifen Soft, Medium und Hard mit unterschiedlichem Grip und Verschleiß.
- Kameras: Verfolger, Weit, T-Cam (über der Airbox) und Cockpit mit Halo. T-Cam schwarz für den ersten, gelb für den zweiten Fahrer eines Teams.
- KI überholt, verteidigt und fährt auf einer berechneten Ideallinie.
- Fahrhilfen: Bremshilfe und eingeblendete Ideallinie (grün, gelb, rot).

## Steuerung

| | Spieler 1 (oder allein) | Spieler 2 (Splitscreen) |
|---|---|---|
| Gas / Bremse | `W` / `S` (allein auch `↑` / `↓`) | `↑` / `↓` |
| Lenken | `A` / `D` (allein auch `←` / `→`) | `←` / `→` |
| Boost | `Leertaste` oder `Shift` | `Enter` oder `Shift rechts` |
| Kamera | `C` | `.` |
| Pause / Ton | `Esc` / `M` | |

Gamepad: RT Gas, LT Bremse, linker Stick lenken, X Boost, Y Kamera, Start Pause. Auf Handy und Tablet erscheinen Touch-Tasten (Handy quer halten).

## Code

- `js/data.js` – Teams, Fahrer, Strecken
- `js/track.js` – Streckenaufbau, Ideallinie, Tempoprofil, Gelände und Umgebung
- `js/race.js` – Fahrphysik, KI, Runden, Sektoren, Wertung
- `js/car.js` – prozedurales F1-Auto in Teamfarben
- `js/hud.js` – Zeitenturm, Tacho, Minikarte
- `js/main.js` – Menüs, Kameras, Splitscreen, Weltmeisterschaft
- `js/audio.js`, `js/phys.js` – Motorsound, Physik-Konstanten

## Hinweise

Fan-Projekt ohne Verbindung zur Formel 1, zur FIA oder zu den Teams. Die Streckenverläufe stammen aus [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT-Lizenz, siehe `TRACKS-LICENSE.txt`).
