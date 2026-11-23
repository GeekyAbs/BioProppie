import { json } from "../lib/http.js";
import { getMode } from "../lib/policy.js";

export async function onRequestGet() {
  return json({ ok: true, mode: getMode() });
}
