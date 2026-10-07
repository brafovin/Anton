# Aschenfeuer

Ein 3D-Mittelalter-Soulslike im Browser (Three.js, alle Modelle, Texturen und Sounds sind prozedural – keine externen Assets).

## Starten

Die Dateien müssen über einen lokalen Webserver geliefert werden (ES-Module):

```bash
python3 -m http.server 8000   # dann http://localhost:8000 öffnen
```

## Steuerung

| Taste | Aktion |
|---|---|
| W A S D | Laufen |
| Maus | Kamera (Pfeiltasten alternativ) |
| Shift (antippen) | Rolle – kurze Unverwundbarkeit |
| Shift (halten) | Sprinten |
| Leertaste | Springen |
| Linke Maustaste | Leichter Angriff (3er-Kombo) |
| Rechte Maustaste | Schwerer Angriff |
| F | Parry (1,5 s Abklingzeit, nach gelungenem Parry fast sofort wieder bereit) – bei Erfolg Riposte mit Angriff |
| Q | Ash of War der Waffe: Katana „Unsheathe“ (25 FP) / Großschwert „Aschenschlag“ (30 FP); FP füllen sich durch Treffer |
| R | Estus-Flasche trinken (HP, am Leuchtfeuer aufgefüllt) |
| T | Aschen-Flasche trinken (stellt FP wieder her, am Leuchtfeuer aufgefüllt) |
| E | Interagieren: Leuchtfeuer entfachen / rasten, Nebeltor, Beute aufnehmen |
| C | Waffe wechseln (sobald du die Boss-Klinge besitzt) |
| U | Am Leuchtfeuer: Aufleveln (1–4 wählt das Attribut) |
| Mausrad-Klick / Tab | Ziel erfassen (Lock-on) |
| M / Esc | Ton / Pause |

## Spielelemente

- **Leuchtfeuer** (3 + eines nach dem Boss): entfachen, rasten (heilt, füllt Estus, setzt Gegner zurück), Teleport zwischen entfachten Leuchtfeuern.
- **Aufleveln:** Am Leuchtfeuer (`U`) tauscht du Seelen gegen Level: Vitalität (HP), Geist (FP), Ausdauer, Stärke (Schaden). Die Kosten steigen mit jedem Level.
- **Boss-Rüstung & Beute:** *Sir Hadrian* trägt eine schwarz-goldene Stachelrüstung mit glühendem Emblem – ganz anders als dein stählernes Outfit. Besiegst du ihn, kannst du seine **Hadrians Ascheklinge** (Großschwert: langsamer, härter, größere Reichweite, eigene Kombo, Heavy und Ash of War) aufnehmen und mit `C` zwischen den Waffen wechseln.
- **Cutscenes:** Jeder Boss hat ein eigenes Intro (nach dem Nebeltor) mit Kamerafahrt, Untertiteln und Titelkarte – Hadrian steht kniend am Schwert auf, Morwen erscheint schwebend im Violett der Kristalle, Gorm bricht mit Erdbeben aus dem Geröll, Vael tritt aus der Dunkelheit. Beim Tod des Bosses folgt ein kurzes Zeitlupen-Outro mit letzten Worten. Das Intro läuft nur beim ersten Mal pro Boss (wird mitgespeichert); bei weiteren Versuchen erscheint nur der Bossname. Überspringen mit `Leertaste`, `Enter`, `E` oder `Esc`.
- **Speicherstand:** Fortschritt (Level, Waffen, Leuchtfeuer, Boss) wird automatisch im Browser gespeichert; auf dem Startbildschirm gibt es „Neues Spiel“.
- **Tod:** „YOU DIED“, Seelen bleiben als Fleck zurück und können wieder eingesammelt werden.
- **Gegner:** Hohle Soldaten und Wachritter (blocken mit dem Schild – schwere Angriffe brechen die Deckung).
- **4 Bosse in fester Reihenfolge** – jeder ist stärker als der vorherige (mehr Leben, härtere Treffer, höheres Tempo, kürzere Pausen). Das Nebeltor des nächsten Bosses ist **versiegelt**, bis der Vorgänger besiegt ist. Jeder Boss hat eigene Arena, Bonfire nach dem Sieg und zwei Phasen:

| # | Boss | Ort | Fähigkeiten | Belohnung |
|---|---|---|---|---|
| 1 | **Sir Hadrian**, Wächter der Asche | Burg (Norden) | Rundumschlag, Zerschmettern (rot), Sturmstoß, Sprung (Phase 2) | Hadrians Ascheklinge |
| 2 | **Morwen**, Hexe der Asche | Hexenhain (Westen) | Feuersalve, verfolgende Seelenorbs (mit einem Schlag zerstörbar), Flammenfelder, Teleport hinter dich, Aschenwelle | +1 Aschen-Flasche |
| 3 | **Gorm**, der Grabriese | Steinbruch (Osten) | Hieb, Zermalmen (rot), Ansturm (läuft er in die Wand, ist er benommen → Riposte), Erdstoß-Schockwelle (überspringen!), Felswurf | +1 Estus-Flasche |
| 4 | **Vael**, der Henker | Henkersplatz (Süden) | Schattenstoß, 3-fache Sensenkombo, Todeswirbel (rot), verschwindet und greift von hinten an, beschwört Schatten (Phase 2) | +1 Estus & +1 Aschen-Flasche |
- **Rot glühende Boss-Angriffe sind nicht parierbar** – rollen oder springen!

## Code

- `js/main.js` – Szene, Eingabe, Kamera, Spielablauf
- `js/player.js` – Kampfsystem des Spielers
- `js/enemies.js` – Gegner-KI und Boss
- `js/models.js` – Humanoide mit IK, Waffen
- `js/world.js` – Gelände, Burg, Leuchtfeuer, Nebeltor
- `js/fx.js`, `js/ui.js`, `js/audio.js` – Effekte, HUD, Synth-Sound
