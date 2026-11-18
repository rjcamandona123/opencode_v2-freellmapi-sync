import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_ID = "opencode-freellmapi-sync";
const PROVIDER_ID = "freellmapi";
const FETCH_TIMEOUT_MS = 5000;
const DEFAULT_BASE_URL = "http://127.0.0.1:3001/v1";
const IS_WINDOWS = process.platform === "win32";

// Auto-activation defaults. All overridable from the environment so the plugin
// stays usable with a non-default install layout.
const START_TIMEOUT_MS = envNumber("FREELLMAPI_AUTOSTART_TIMEOUT_MS", 25000);
const PROBE_TIMEOUT_MS = envNumber("FREELLMAPI_PROBE_TIMEOUT_MS", 1500);
const PROBE_INTERVAL_MS = 400;
const SPAWN_COOLDOWN_MS = 60000;
const LOCK_STALE_MS = 45000;

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function fetchModels(baseURL, apiKey, timeoutMs = FETCH_TIMEOUT_MS) {
  const base = String(baseURL || "").replace(/\/+$/, "");
  const key = resolveEnvTemplate(apiKey);
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const models = discoverModels(body?.data);
    return Object.keys(models).length ? models : null;
  } catch {
    return null;
  }
}

// --- Auto-activation -------------------------------------------------------
// The sync plugin is only useful if the local FreeLLMAPI gateway is up. When
// it isn't, OpenCode surfaces "ECONNREFUSED ... Retrying in 7s". Instead of
// failing silently we start the local server ourselves, detached, and wait for
// it to answer before handing control back to the provider transform.

function isLocalUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host === "::"
    );
  } catch {
    return false;
  }
}

function originOf(baseURL) {
  try {
    return new URL(baseURL).origin;
  } catch {
    return "";
  }
}

function autostartDisabled() {
  return ["0", "false", "off", "no"].includes(String(process.env.FREELLMAPI_AUTOSTART || "").toLowerCase());
}

function isServerHome(dir) {
  if (!dir) return false;
  try {
    return (
      existsSync(path.join(dir, "server", "dist", "index.js")) ||
      existsSync(path.join(dir, "server", "src", "index.ts"))
    );
  } catch {
    return false;
  }
}

function findServerHome() {
  const home = os.homedir && os.homedir();
  // Explicit overrides are trusted as-is (a Docker install dir has no
  // server/src, only docker-compose.yml, and pairs with FREELLMAPI_START_CMD).
  for (const explicit of [process.env.FREELLMAPI_HOME, process.env.FREELLMAPI_DIR, process.env.FREELLMAPI_ROOT]) {
    if (!explicit) continue;
    const resolved = path.resolve(explicit);
    try {
      if (existsSync(resolved)) return resolved;
    } catch {
      /* keep looking */
    }
  }

  const candidates = [];
  const cwd = process.cwd();
  candidates.push(cwd, path.join(cwd, "freellmapi"));

  // Walk up a few levels, checking each parent and its `freellmapi` child, so a
  // session started inside the repo (or beside it) finds the install.
  let dir = cwd;
  for (let i = 0; i < 4; i += 1) {
    const parent = path.dirname(dir);
    if (parent === dir) break;
    candidates.push(parent, path.join(parent, "freellmapi"));
    dir = parent;
  }

  if (home) {
    candidates.push(
      path.join(home, "freellmapi"),
      path.join(home, ".freellmapi", "app"),
      path.join(home, "Documents", "freellmapi"),
      path.join(home, "Projects", "freellmapi"),
    );
  }

  // Windows desktop / per-user installs.
  for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA]) {
    if (!base) continue;
    candidates.push(
      path.join(base, "Programs", "freellmapi"),
      path.join(base, "freellmapi"),
    );
  }

  // Common Linux/macOS service locations.
  candidates.push("/opt/freellmapi", "/usr/local/freellmapi", "/srv/freellmapi");

  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (isServerHome(resolved)) return resolved;
  }
  return null;
}

function readLock(lockPath) {
  try {
    const raw = JSON.parse(readFileSync(lockPath, "utf8"));
    if (!raw || typeof raw.pid !== "number") return null;
    return raw;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function probe(baseURL) {
  const origin = originOf(baseURL);
  if (!origin) return false;
  try {
    // Any HTTP answer (200, 401, 404...) means the gateway is listening. Only a
    // transport failure (ECONNREFUSED/ETIMEDOUT) counts as "not up".
    await fetch(`${origin}/api/health`, {
      method: "GET",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(baseURL, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(baseURL)) return true;
    await delay(PROBE_INTERVAL_MS);
  }
  return probe(baseURL);
}

let starting = null;
let lastSpawnAt = 0;

function resolveNodeBin() {
  // Under Bun, process.execPath is the Bun/OpenCode binary, which is not the
  // Node runtime FreeLLMAPI needs (better-sqlite3 native bindings). Under Node
  // (macOS/Linux/Windows) process.execPath is the right interpreter.
  if (process.versions?.bun) return process.env.FREELLMAPI_NODE || "node";
  return process.execPath;
}

function buildStartCommand(home) {
  // Escape hatch for Docker installs, the desktop app, or a custom supervisor.
  const custom = process.env.FREELLMAPI_START_CMD;
  if (custom) {
    return { command: custom, args: [], cwd: home, shell: true };
  }

  const serverDir = path.join(home, "server");
  const distEntry = path.join(serverDir, "dist", "index.js");
  if (existsSync(distEntry)) {
    return { command: resolveNodeBin(), args: [distEntry], cwd: serverDir, shell: false };
  }

  // Run tsx directly instead of going through npm: identical on every OS and
  // no .cmd/shell quoting problems on Windows.
  const tsxCli = [
    path.join(home, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs"),
  ].find((candidate) => existsSync(candidate));
  if (tsxCli && existsSync(path.join(serverDir, "src", "index.ts"))) {
    return {
      command: resolveNodeBin(),
      args: [tsxCli, "watch", "src/index.ts"],
      cwd: serverDir,
      shell: false,
    };
  }

  // Last resort: the npm workspace script. Windows needs a shell to run npm.cmd
  // (Node refuses to spawn .cmd files directly since 18.20.2 / 20.12.2).
  return {
    command: IS_WINDOWS ? "npm.cmd" : "npm",
    args: ["run", "dev", "-w", "server"],
    cwd: home,
    shell: IS_WINDOWS,
  };
}

function spawnServer(home) {
  const spec = buildStartCommand(home);
  const logPath =
    process.env.FREELLMAPI_AUTOSTART_LOG || path.join(home, "server.autostart.log");

  let out = "ignore";
  try {
    out = openSync(logPath, "a");
  } catch {
    out = "ignore";
  }

  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    shell: spec.shell,
    detached: true,
    // Avoid a console window flash on Windows, and keep stdio detached so the
    // server outlives the OpenCode process on every platform.
    windowsHide: true,
    stdio: out === "ignore" ? "ignore" : ["ignore", out, out],
    env: process.env,
  });

  // ENOENT/EACCES arrive asynchronously. An unhandled 'error' event would take
  // OpenCode down with it, so swallow it (ensureServer falls back to waiting).
  child.on("error", () => {});
  child.unref();

  if (typeof out === "number") {
    try {
      closeSync(out);
    } catch {
      /* already closed */
    }
  }

  if (child.pid) {
    try {
      writeFileSync(
        path.join(home, ".autostart.lock"),
        JSON.stringify({ pid: child.pid, startedAt: Date.now() }),
      );
    } catch {
      /* lock is advisory only */
    }
  }
  return child.pid;
}

function ensureServer(baseURL) {
  if (autostartDisabled() || !isLocalUrl(baseURL)) return Promise.resolve(false);
  if (starting) return starting;

  starting = (async () => {
    if (await probe(baseURL)) return true;

    const home = findServerHome();
    if (!home) return false;

    const lockPath = path.join(home, ".autostart.lock");
    const lock = readLock(lockPath);
    const lockFresh = lock && Date.now() - Number(lock.startedAt || 0) < LOCK_STALE_MS;

    if (lockFresh && pidAlive(lock.pid)) {
      // Someone (another OpenCode window, or a previous load) is already
      // booting the gateway. Just wait for it.
      return waitForServer(baseURL, START_TIMEOUT_MS);
    }

    if (Date.now() - lastSpawnAt < SPAWN_COOLDOWN_MS) {
      return waitForServer(baseURL, START_TIMEOUT_MS);
    }

    lastSpawnAt = Date.now();
    try {
      spawnServer(home);
    } catch {
      return false;
    }

    return waitForServer(baseURL, START_TIMEOUT_MS);
  })().finally(() => {
    starting = null;
  });

  return starting;
}

// --- Plugin ----------------------------------------------------------------

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
        baseURL: options.baseURL || DEFAULT_BASE_URL,
        apiKey: options.apiKey || "{env:FREELLMAPI_API_KEY}",
      },
    };
  };

  const refreshModels = (baseURL = process.env.FREELLMAPI_BASE_URL || DEFAULT_BASE_URL) => {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = (async () => {
      try {
        // Best-effort: read base config from current transformed state isn't directly available here,
        // so fall back to env/config defaults. The transform below also tries on-the-fly.
        const apiKey = process.env.FREELLMAPI_API_KEY || "";
        let models = await fetchModels(baseURL, apiKey);
        if (!models) {
          // Activation may still be in flight (or the gateway was stopped after
          // load); make one more attempt after ensuring the server is up.
          if (await ensureServer(baseURL)) {
            models = await fetchModels(baseURL, apiKey);
          }
        }
        if (models) currentModels = models;
        await ctx.provider?.reload?.();
        await ctx.model?.reload?.();
      } finally {
        refreshing = null;
        if (again) {
          again = false;
          void refreshModels(baseURL);
        }
      }
    })();
    return refreshing;
  };

  await ctx.provider.transform(async (current) => {
    const provider = getProviderBase(current);
    const { baseURL, apiKey } = provider.options;

    // Start the local gateway first (no-op when already up), so the very first
    // model fetch doesn't hit ECONNREFUSED.
    await ensureServer(baseURL);

    const fetched = await fetchModels(baseURL, apiKey);
    if (fetched) currentModels = fetched;
    return {
      ...current,
      [PROVIDER_ID]: {
        ...provider,
        models: currentModels || provider.models || {},
      },
    };
  });

  // Attempt background refresh on startup; ignore failures. Kick the activation
  // off immediately as well, so it overlaps with OpenCode boot instead of
  // waiting for the first request.
  void ensureServer(process.env.FREELLMAPI_BASE_URL || DEFAULT_BASE_URL);
  void refreshModels();

  return () => {};
}

export { ensureServer, findServerHome, isLocalUrl, probe };
export default { id: PLUGIN_ID, setup };
