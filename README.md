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
| F | Parry – bei Erfolg Riposte mit Angriff |
| Q | Ash of War „Unsheathe“ (25 FP, FP füllen sich durch Treffer) |
| R | Estus-Flasche trinken (5, am Leuchtfeuer aufgefüllt) |
| E | Interagieren: Leuchtfeuer entfachen / rasten, Nebeltor |
| Mausrad-Klick / Tab | Ziel erfassen (Lock-on) |
| M / Esc | Ton / Pause |

## Spielelemente

- **Leuchtfeuer** (3 + eines nach dem Boss): entfachen, rasten (heilt, füllt Estus, setzt Gegner zurück), Teleport zwischen entfachten Leuchtfeuern.
- **Tod:** „YOU DIED“, Seelen bleiben als Fleck zurück und können wieder eingesammelt werden.
- **Gegner:** Hohle Soldaten, Wachritter (blocken mit dem Schild – schwere Angriffe brechen die Deckung) und der Boss *Sir Hadrian* (zwei Phasen).
- **Rot glühende Boss-Angriffe sind nicht parierbar** – rollen oder springen!

## Code

- `js/main.js` – Szene, Eingabe, Kamera, Spielablauf
- `js/player.js` – Kampfsystem des Spielers
- `js/enemies.js` – Gegner-KI und Boss
- `js/models.js` – Humanoide mit IK, Waffen
- `js/world.js` – Gelände, Burg, Leuchtfeuer, Nebeltor
- `js/fx.js`, `js/ui.js`, `js/audio.js` – Effekte, HUD, Synth-Sound
