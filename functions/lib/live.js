import { requireCloudApproved } from "./policy.js";

const EUROPE_PMC_URL = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const STOP = new Set([
  "a", "an", "and", "against", "are", "as", "at", "be", "by", "compare", "decision", "did",
  "for", "from", "in", "internal", "is", "it", "live", "literature", "meeting",
  "of", "on", "our", "paper", "pubmed", "the", "to", "we", "what", "with",
]);

function clean(value) {
  return String(value || "")
    .replace(/<h4>(.*?)<\/h4>/gi, "\n\n$1: ")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayDate(value) {
  if (!value) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(new Date(value.slice(0, 10)));
  } catch {
    return value;
  }
}

export function buildLiveQuery(question) {
  const lowered = String(question || "").toLowerCase();
  const tokens = (String(question || "").match(/[A-Za-z0-9]+/g) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => !STOP.has(token) && token.length > 2);

  if (lowered.includes("cd3") || lowered.includes("bispecific")) {
    if (["affinity", "cytokine", "crs"].some((term) => lowered.includes(term))) {
      return '("bispecific" AND "CD3" AND ("affinity" OR "cytokine release syndrome" OR "T-cell engager")) AND HAS_ABSTRACT:Y';
    }
    return '("bispecific" AND "CD3" AND ("T-cell engager" OR "BCMA" OR "affinity")) AND HAS_ABSTRACT:Y';
  }
  if (["adc", "linker"].some((term) => lowered.includes(term))) {
    return '("antibody-drug conjugate" AND ("linker" OR "bystander" OR "topoisomerase")) AND HAS_ABSTRACT:Y';
  }
  if (["infection", "ivig"].some((term) => lowered.includes(term))) {
    return '("BCMA" AND "bispecific" AND ("infection" OR "immunoglobulin")) AND HAS_ABSTRACT:Y';
  }

  const terms = [];
  for (const token of tokens.slice(0, 6)) {
    if (!terms.some((term) => term.toUpperCase() === token.toUpperCase())) terms.push(token);
  }
  if (!terms.length) terms.push("bispecific antibodies");
  const clauses = terms.slice(0, 5).map((term) => (term.includes(" ") ? `"${term}"` : term));
  return `(${clauses.join(" AND ")}) AND HAS_ABSTRACT:Y`;
}

export async function searchEuropePmc(question) {
  requireCloudApproved("europepmc_search", question);
  const query = buildLiveQuery(question);
  const url = new URL(EUROPE_PMC_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", "4");

  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Europe PMC returned ${response.status}`);
  const payload = await response.json();

  const documents = [];
  for (const item of payload?.resultList?.result || []) {
    const pmid = String(item.pmid || item.id || "");
    if (!pmid || !item.abstractText) continue;
    documents.push({
      id: `PMID-${pmid}`,
      type: "paper",
      title: clean(item.title),
      date: String(item.firstPublicationDate || "").slice(0, 10),
      display_date: displayDate(item.firstPublicationDate),
      journal: item.journalInfo?.journal?.title || "",
      authors: item.authorString || "",
      url: `https://europepmc.org/article/MED/${pmid}`,
      pmid,
      pmcid: item.pmcid || null,
      doi: item.doi || null,
      content: clean(item.abstractText),
      live: true,
    });
  }

  return [
    documents,
    {
      query,
      hit_count: payload.hitCount ?? 0,
      returned: documents.length,
      host: "ebi.ac.uk",
      fetched_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    },
  ];
}
