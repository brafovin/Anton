// Gemeinsame Fahrphysik-Konstanten (Spieler, KI und Ideallinie nutzen dieselben Werte).
// Werte grob an echte F1-Autos angelehnt: bis ~5 g Querbeschleunigung und Bremsen, ~340 km/h.
export const PHYS = {
  VMAX: 95,     // Höchstgeschwindigkeit in m/s (≈ 342 km/h)
  A0: 12.5,     // Beschleunigung aus dem Stand (m/s²)
  GA: 16,       // Grip: Querbeschleunigung = GA + GB · v (Abtrieb wächst mit dem Tempo)
  GB: 0.55,
  KMAX: 1 / 6.5, // engster Lenkradius bei Schritttempo
  G: 9.81,
  CAR_LEN: 5.4,
  CAR_WID: 1.95,
};

export const grip = (v, extra = 0) => PHYS.GA + extra + PHYS.GB * Math.abs(v);
export const brakeDecel = v => 18 + 0.32 * Math.abs(v); // bis ~4,8 g bei Höchsttempo

// Kurvengrenztempo für eine Krümmung k (1/m): k·v² = f·(GA + extra + GB·v)
export function cornerSpeed(k, f = 1, extra = 0) {
  k = Math.abs(k);
  if (k < 1e-5) return Infinity;
  const b = f * PHYS.GB, c = f * (PHYS.GA + extra);
  return (b + Math.sqrt(b * b + 4 * k * c)) / (2 * k);
}

export const accelAt = (v, vmax, a0 = PHYS.A0) => a0 * Math.max(0, 1 - (v / vmax) ** 2);

// 8 Gänge: Endgeschwindigkeit je Gang als Anteil von VMAX
export const GEARS = [0.27, 0.39, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
export function gearInfo(v, vmax) {
  const r = Math.abs(v) / vmax;
  let g = 0;
  while (g < 7 && r > GEARS[g]) g++;
  const lo = g ? GEARS[g - 1] * 0.86 : 0;
  const rpm = Math.min(1, Math.max(0.32, (r - lo) / (GEARS[g] - lo)));
  return { gear: v < -0.5 ? 'R' : (Math.abs(v) < 0.5 ? 'N' : String(g + 1)), g, rpm };
}
