import { VECTOR_DIMS } from "../data.generated.js";
import { tokenize } from "./text.js";

export function fnv1a(value) {
  let h = 2166136261 >>> 0;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    h ^= byte;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function embedVector(value, dims = VECTOR_DIMS) {
  const vector = new Float64Array(dims);
  const features = new Map();
  const add = (key, amount) => features.set(key, (features.get(key) || 0) + amount);

  for (const token of tokenize(value || "")) add(`t:${token}`, 1);

  const clean = String(value || "").toLowerCase();
  for (const raw of clean.split(/\s+/)) {
    const cleaned = raw.replace(/[^a-z0-9]/g, "");
    if (cleaned.length < 3) continue;
    add(`w:${cleaned}`, 1);
    for (let i = 0; i < cleaned.length - 2; i += 1) {
      add(`c:${cleaned.slice(i, i + 3)}`, 0.35);
    }
  }

  for (const [feature, count] of features) {
    const digest = fnv1a(feature);
    const bucket = digest % dims;
    const sign = (digest >>> 16) & 1 ? -1 : 1;
    vector[bucket] += sign * (1 + Math.log(count));
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dims; i += 1) vector[i] /= norm;
  return Array.from(vector);
}

export function cosine(a, b) {
  let dot = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) dot += a[i] * b[i];
  return dot;
}
