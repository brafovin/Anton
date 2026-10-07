# Aschenfeuer

Ein 3D-Mittelalter-Soulslike im Browser (Three.js, alle Modelle, Texturen und Sounds sind prozedural – keine externen Assets).

## Starten

Die Dateien müssen über einen lokalen Webserver geliefert werden (ES-Module):

```bash
python3 -m http.server 8000   # dann http://localhost:8000 öffnen
```

## Hauptmenü & Klassen

Beim Start gibt es **Neues Spiel**, **Spiel laden** und **Steuerung**. Bei einem neuen Spiel wählst du eine Startklasse (mit 3D-Vorschau):

| Klasse | Ausrüstung | Eigenschaften |
|---|---|---|
| **Ninja** | Katana (Ash of War: Unsheathe), Ninja-Rüstung | schnell (+10 % Tempo), viel Ausdauer, Rolle kostet weniger, wenig HP |
| **Magier** | Magierstab, Robe & Spitzhut, **5 Zauber** | sehr viel FP, Zauber skalieren mit Geist, wenig HP/Nahkampf |
| **Ritter** | Eisen-Großschwert (Aschenschlag), schwere Plattenrüstung | viel HP & Stärke, langsamer, Rolle teurer |

**Zauber (Magier mit Stab):** Die Zauber liegen auf den Maustasten: **M1** und **M2** wirken je einen gewählten Zauber (kein Nahkampf mit dem Stab). **Mausrad oder 1–5** wählt den M1-Zauber, **Q** wechselt den M2-Zauber (die Leiste links zeigt die Belegung). Standard: M1 Seelenpfeil, M2 Flammenkugel.

| # | Zauber | FP | Wirkung |
|---|---|---|---|
| 1 | Seelenpfeil | 9 | schneller Pfeil, folgt dem Ziel |
| 2 | Flammenkugel | 16 | explodiert, bricht Deckung |
| 3 | Blitzschlag | 22 | schlägt am Ziel ein (kurze Vorwarnung) |
| 4 | Heilendes Licht | 28 | stellt HP wieder her |
| 5 | Aschenschild | 20 | halbiert den Schaden für 10 s |

**Flaschen verteilen (wie in Elden Ring):** Am Leuchtfeuer `F` drücken. Die Gesamtzahl der Flaschen bleibt gleich, du entscheidest, wie viele HP- (R) und FP-Flaschen (T) du hast (`1`/`→` mehr HP, `2`/`←` mehr FP). Boss-Belohnungen erhöhen die Gesamtzahl (max. 14).

**Speichern/Laden:** Es wird automatisch gespeichert (Leuchtfeuer, Level-Up, Bosse …); im Pausenmenü (`Esc`) gibt es außerdem *Speichern* und *Hauptmenü*. „Neues Spiel“ überschreibt den Spielstand (mit Warnhinweis).

## Steuerung

| Taste | Aktion |
|---|---|
| W A S D | Laufen |
| Maus | Kamera (Pfeiltasten alternativ) |
| Shift (antippen) | Rolle – kurze Unverwundbarkeit |
| Shift (halten) | Sprinten |
| Leertaste | Springen |
| Linke Maustaste | Leichter Angriff (3er-Kombo) · Magier: M1-Zauber |
| Rechte Maustaste | Schwerer Angriff (Ash of War = etwa das Doppelte) · Magier: M2-Zauber |
| F | Parry (1,5 s Abklingzeit, nach gelungenem Parry fast sofort wieder bereit) – bei Erfolg Riposte mit Angriff |
| Q | Ash of War der Waffe: Katana „Unsheathe“ (25 FP) / Großschwert „Aschenschlag“ (30 FP); FP füllen sich durch Treffer. Mit dem Magierstab: **M2-Zauber wechseln** |
| Mausrad / 1–5 | M1-Zauber wählen (nur mit Magierstab) |
| R | Estus-Flasche trinken (HP, am Leuchtfeuer aufgefüllt) |
| T | Aschen-Flasche trinken (stellt FP wieder her, am Leuchtfeuer aufgefüllt) |
| F (am Leuchtfeuer) | Flaschen zwischen HP und FP verteilen |
| E | Interagieren: Leuchtfeuer entfachen / rasten, Nebeltor, Beute aufnehmen |
| C | Waffe wechseln (sobald du die Boss-Klinge besitzt) |
| U | Am Leuchtfeuer: Aufleveln (1–4 wählt das Attribut) |
| Mausrad-Klick / Tab | Ziel erfassen (Lock-on) |
| M / Esc | Ton / Pause |

## Spielelemente

- **Leuchtfeuer** (3 + eines nach dem Boss): entfachen, rasten (heilt, füllt Estus, setzt Gegner zurück), Teleport zwischen entfachten Leuchtfeuern.
- **Aufleveln:** Am Leuchtfeuer (`U`) tauscht du Seelen gegen Level: Vitalität (HP), Geist (FP), Ausdauer, Stärke (Schaden). Die Kosten steigen mit jedem Level.
- **Boss-Rüstung & Beute:** *Sir Hadrian* trägt eine schwarz-goldene Stachelrüstung mit glühendem Emblem – ganz anders als dein stählernes Outfit. Besiegst du ihn, kannst du seine **Hadrians Ascheklinge** (Großschwert: langsamer, härter, größere Reichweite, eigene Kombo, Heavy und Ash of War) aufnehmen und mit `C` zwischen den Waffen wechseln.
- **Endboss & Teleport:** Hast du alle vier Wächter besiegt, wirst du automatisch zum **Thronsaal** teleportiert (Leuchtfeuer „Thronsaal-Vorhof“, später auch per Teleport-Menü erreichbar). Dort wartet der mächtige Aschenkönig Aldrar mit eigener Cutscene. Nach seinem Sturz folgt der Abspann – danach kannst du weiterspielen.
- **Cutscenes:** Jeder Boss hat ein eigenes Intro (nach dem Nebeltor) mit Kamerafahrt, Untertiteln und Titelkarte – Hadrian steht kniend am Schwert auf, Morwen erscheint schwebend im Violett der Kristalle, Gorm bricht mit Erdbeben aus dem Geröll, Vael tritt aus der Dunkelheit. Beim Tod des Bosses folgt ein kurzes Zeitlupen-Outro mit letzten Worten. Das Intro läuft nur beim ersten Mal pro Boss (wird mitgespeichert); bei weiteren Versuchen erscheint nur der Bossname. Überspringen mit `Leertaste`, `Enter`, `E` oder `Esc`.
- **Tod:** „YOU DIED“, Seelen bleiben als Fleck zurück und können wieder eingesammelt werden.
- **Gegner:** Hohle Soldaten und Wachritter (blocken mit dem Schild – schwere Angriffe brechen die Deckung).
- **5 Bosse in fester Reihenfolge** (4 Wächter + der Endboss) – jeder ist stärker als der vorherige (mehr Leben, härtere Treffer, höheres Tempo, kürzere Pausen). Das Nebeltor des nächsten Bosses ist **versiegelt**, bis der Vorgänger besiegt ist. Jeder Boss hat eigene Arena, Bonfire nach dem Sieg und zwei Phasen:

| # | Boss | Ort | Fähigkeiten | Belohnung |
|---|---|---|---|---|
| 1 | **Sir Hadrian**, Wächter der Asche | Burg (Norden) | Rundumschlag, Zerschmettern (rot), Sturmstoß, Sprung (Phase 2) | Hadrians Ascheklinge |
| 2 | **Morwen**, Hexe der Asche | Hexenhain (Westen) | Feuersalve, verfolgende Seelenorbs (mit einem Schlag zerstörbar), Flammenfelder, Teleport hinter dich, Aschenwelle | +1 Aschen-Flasche |
| 3 | **Gorm**, der Grabriese | Steinbruch (Osten) | Hieb, Zermalmen (rot), Ansturm (läuft er in die Wand, ist er benommen → Riposte), Erdstoß-Schockwelle (überspringen!), Felswurf | +1 Estus-Flasche |
| 4 | **Vael**, der Henker | Henkersplatz (Süden) | Schattenstoß, 3-fache Sensenkombo, Todeswirbel (rot), verschwindet und greift von hinten an, beschwört Schatten (Phase 2, höchstens alle 35 s, max. 2 gleichzeitig) | +1 Estus & +1 Aschen-Flasche |
| 5 | **Aldrar**, der Aschenkönig (Endboss) | Thronsaal hoch über der Welt | **3 Phasen:** Königlicher Hieb, Zorn der Krone (rot), Thronstoß, dreifache Klinge, **Erdbeben des Königs** (mehrere Stampf-Wellen hintereinander – nur **Springen** hilft, Rollen nicht) · **Bogen:** Pfeilhagel (Salven direkt auf dich) und ab Phase 2 Pfeilregen · Phase 2: Flammenschwingen (Fächer, zielt auf dich), Flammensäulen, Sturz des Königs · Phase 3: Sternenfall (Meteore), Thronsprung (Teleport + Schlag), noch schneller | +1 Estus & +1 Aschen-Flasche, das Ende |
- **Rot glühende Boss-Angriffe sind nicht parierbar** – rollen oder springen!

## Code

- `js/main.js` – Szene, Eingabe, Kamera, Spielablauf
- `js/player.js` – Kampfsystem des Spielers
- `js/enemies.js` – Gegner-KI und Boss
- `js/models.js` – Humanoide mit IK, Waffen
- `js/world.js` – Gelände, Burg, Leuchtfeuer, Nebeltor
- `js/fx.js`, `js/ui.js`, `js/audio.js` – Effekte, HUD, Synth-Sound
