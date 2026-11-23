import { errorResponse, json, readJson } from "../lib/http.js";
import { getMode, setMode, snapshot } from "../lib/policy.js";

export async function onRequestPost({ request }) {
  try {
    const body = await readJson(request);
    const entry = setMode(body.mode);
    return json({ privacy_mode: getMode(), audit_entry: entry, audit_log: snapshot() });
  } catch (error) {
    return errorResponse(error);
  }
}
