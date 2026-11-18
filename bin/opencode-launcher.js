#!/usr/bin/env node
/**
 * Cross-platform OpenCode launcher that activates the local FreeLLMAPI gateway
 * first (macOS, Linux, Windows — Node 20+ or Bun).
 *
 * Usage:
 *   node bin/opencode-launcher.js [opencode args...]
 *
 * Or put this directory first in PATH and use the `opencode` shims:
 *   bin/opencode      (macOS / Linux / Termux)
 *   bin/opencode.cmd  (Windows)
 *
 * Env:
 *   OPENCODE_BIN   real OpenCode binary (skips PATH lookup)
 *   FREELLMAPI_*   see README (autostart, home, base URL, start command...)
 */
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ensureServer } from "../index.js";

const IS_WINDOWS = process.platform === "win32";
const HERE = path.dirname(fileURLToPath(import.meta.url));

function isRunnable(file) {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, IS_WINDOWS ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function candidateNames() {
  if (!IS_WINDOWS) return ["opencode"];
  const exts = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return exts.map((ext) => `opencode${ext.toLowerCase()}`);
}

function findRealOpenCode() {
  const override = process.env.OPENCODE_BIN;
  if (override) return override;

  const names = candidateNames();
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    let resolvedDir;
    try {
      resolvedDir = path.resolve(dir);
    } catch {
      continue;
    }
    // Never resolve to the shim in this directory (that would recurse forever).
    if (resolvedDir === HERE) continue;
    for (const name of names) {
      const candidate = path.join(resolvedDir, name);
      if (existsSync(candidate) && isRunnable(candidate)) return candidate;
    }
  }
  return null;
}

const baseURL = process.env.FREELLMAPI_BASE_URL || "http://127.0.0.1:3001/v1";

// Best effort: never let gateway trouble stop OpenCode from starting.
try {
  await ensureServer(baseURL);
} catch {
  /* ignore */
}

const real = findRealOpenCode();
if (!real) {
  console.error(
    "[freellmapi-launcher] Could not find the OpenCode binary. Set OPENCODE_BIN or put the real opencode first in PATH.",
  );
  process.exit(127);
}

const child = spawn(real, process.argv.slice(2), {
  stdio: "inherit",
  shell: false,
  windowsHide: false,
});

child.on("error", (err) => {
  console.error(`[freellmapi-launcher] Failed to start ${real}: ${err.message}`);
  process.exit(1);
});

// Forward termination when this process is signalled directly (service
// managers, `kill <pid>`). Ctrl+C already reaches the child via the terminal.
process.on("SIGTERM", () => {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
});

child.on("exit", (code, signal) => {
  if (signal && process.platform !== "win32") {
    try {
      process.kill(process.pid, signal);
      return;
    } catch {
      /* fall through */
    }
  }
  process.exit(code == null ? 1 : code);
});
