// FSRS-5 Gedächtnismodell (Free Spaced Repetition Scheduler), Standardparameter.
// Stabilität S = Tage, bis die Abrufwahrscheinlichkeit auf 90 % fällt; Schwierigkeit D in [1, 10].
export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };

const DECAY = -0.5;
const FACTOR = 19 / 81;
const DAY = 86400000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function retrievability(elapsedDays, s) {
  return Math.pow(1 + FACTOR * elapsedDays / s, DECAY);
}

export function intervalDays(s, retention = 0.9) {
  return s / FACTOR * (Math.pow(retention, 1 / DECAY) - 1);
}

const initDifficulty = g => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

function nextDifficulty(d, g) {
  const damped = d + (-W[6] * (g - 3)) * (10 - d) / 9;
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}

function recallStability(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
}

function forgetStability(d, s, r) {
  return Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
}

// mem: { s, d, last } oder null für eine neue Karte. Liefert das neue { s, d }.
export function review(mem, g, now) {
  if (!mem || !mem.s) return { s: W[g - 1], d: initDifficulty(g) };
  const elapsed = (now - mem.last) / DAY;
  let s;
  if (elapsed < 1) {
    s = mem.s * Math.exp(W[17] * (g - 3 + W[18]));
  } else {
    const r = retrievability(elapsed, mem.s);
    s = g === 1 ? forgetStability(mem.d, mem.s, r) : recallStability(mem.d, mem.s, r, g);
  }
  return { s: Math.max(0.1, s), d: nextDifficulty(mem.d, g) };
}
