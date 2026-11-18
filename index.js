const PLUGIN_ID = "opencode-freellmapi-sync";
const PROVIDER_ID = "freellmapi";
const FETCH_TIMEOUT_MS = 5000;

function resolveEnvTemplate(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] ?? "");
}

function discoverModels(modelsArray) {
  if (!Array.isArray(modelsArray)) return {};
  const models = {};
  for (const m of modelsArray) {
    if (!m || typeof m.id !== "string" || !m.id) continue;
    if (m.available === false) continue;
    const id = m.id;
    const context = Number(m.context_length || m.context_window || m.limit?.context) || 131072;
    const output = Number(m.max_output_tokens || m.output_limit || m.limit?.output) || 8192;
    models[id] = {
      name: typeof m.name === "string" && m.name ? m.name : id,
      limit: { context, output },
    };
  }
  return models;
}

async function fetchModels(baseURL, apiKey) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  const key = resolveEnvTemplate(apiKey);
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const models = discoverModels(body?.data);
    return Object.keys(models).length ? models : null;
  } catch {
    return null;
  }
}

async function setup(ctx) {
  let currentModels = null;
  let refreshing = null;
  let again = false;

  const getProviderBase = (current) => {
    const existing = current?.[PROVIDER_ID] || {};
    const options = existing.options || {};
    return {
      ...existing,
      id: existing.id || PROVIDER_ID,
      name: existing.name || "FreeLLMAPI",
      npm: existing.npm || "@ai-sdk/openai-compatible",
      options: {
        ...options,
        baseURL: options.baseURL || "http://127.0.0.1:3001/v1",
        apiKey: options.apiKey || "{env:FREELLMAPI_API_KEY}",
      },
    };
  };

  const refreshModels = () => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        // Best-effort: read base config from current transformed state isn't directly available here,
        // so fetch using env/config defaults. The transform below also tries on-the-fly.
        const baseURL = process.env.FREELLMAPI_BASE_URL || "http://127.0.0.1:3001/v1";
        const apiKey = process.env.FREELLMAPI_API_KEY || "";
        const models = await fetchModels(baseURL, apiKey);
        if (models) currentModels = models;
        await ctx.provider?.reload?.();
        await ctx.model?.reload?.();
      } finally {
        refreshing = null;
        if (again) {
          again = false;
          void refreshModels();
        }
      }
    })();
    return refreshing;
  };

  await ctx.provider.transform(async (current) => {
    const provider = getProviderBase(current);
    const fetched = await fetchModels(provider.options.baseURL, provider.options.apiKey);
    if (fetched) currentModels = fetched;
    return {
      ...current,
      [PROVIDER_ID]: {
        ...provider,
        models: currentModels || provider.models || {},
      },
    };
  });

  // Attempt background refresh on startup; ignore failures.
  void refreshModels();

  return () => {};
}

export default { id: PLUGIN_ID, setup };
