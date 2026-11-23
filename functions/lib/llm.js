function systemPrompt() {
  return [
    "You are a biotech research analyst. Answer only from the supplied context.",
    'For every factual claim, include a short verbatim quote in double quotes followed by the source ID in square brackets, like "ORR was 23.4%" [PMID-36689692].',
    "Never invent a quote or an ID. Be concise. If the context is insufficient, say so plainly.",
  ].join(" ");
}

function contextString(documents) {
  return documents.slice(0, 8).map((doc) =>
    `[${doc.id}] ${doc.title || ""} (${doc.display_date || doc.date || ""})\n${(doc.content || "").slice(0, 2200)}`,
  ).join("\n\n");
}

export function llmConfig(env) {
  if (env.OPENAI_API_KEY) {
    return { provider: "openai", model: env.OPENAI_MODEL || "gpt-4o-mini", host: "api.openai.com" };
  }
  if (env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest", host: "api.anthropic.com" };
  }
  return null;
}

export async function synthesize(env, query, documents) {
  const config = llmConfig(env);
  if (!config) return { text: null, host: null, error: null, config: null };

  const system = systemPrompt();
  const user = `Question: ${query}\n\nContext:\n${contextString(documents)}`;
  try {
    let text = "";
    if (config.provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.1,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
        }),
      });
      if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
      const payload = await response.json();
      text = payload.choices?.[0]?.message?.content || "";
    } else {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 1000,
          temperature: 0.1,
          system,
          messages: [{ role: "user", content: user }],
        }),
      });
      if (!response.ok) throw new Error(`Anthropic returned ${response.status}`);
      const payload = await response.json();
      text = (payload.content || []).map((block) => block.text || "").join("");
    }
    return { text: text.trim(), host: config.host, error: null, config };
  } catch (error) {
    return { text: null, host: config.host, error: `${error.name}: ${error.message}`, config };
  }
}
