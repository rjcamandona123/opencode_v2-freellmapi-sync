# opencode_v2-freellmapi-sync

[![OpenCode v2 Plugin](https://img.shields.io/badge/OpenCode-v2%20Plugin-111111?style=for-the-badge&logo=opencode&logoColor=white)](https://opencode.ai/)
[![FreeLLMAPI Compatible](https://img.shields.io/badge/FreeLLMAPI-Compatible-2563EB?style=for-the-badge)](https://github.com/tashfeenahmed/freellmapi)
[![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge)](LICENSE)
[![JavaScript ESM](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000000)](./index.js)
[![GitHub Repo](https://img.shields.io/badge/GitHub-rjcamandona123%2Fopencode__v2--freellmapi--sync-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/rjcamandona123/opencode_v2-freellmapi-sync)

OpenCode v2 plugin that automatically syncs [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) models into your `provider.freellmapi` catalog.

It hooks into OpenCode's provider transform on startup/load and fetches the live model list from your running FreeLLMAPI gateway, so you don't have to manually re-run `setup-opencode` every time the catalog changes.

## New to this? Start here

[FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) is a local, open-source
router that puts many free-tier LLM providers behind **one OpenAI-compatible
endpoint** (`http://localhost:3001/v1`). You run it on your own machine, add your
own provider keys in its dashboard, and it hands you a single `freellmapi-…`
unified key. Requests are routed to whichever enabled model is available, with
fallbacks.

That makes it a practical **first-time alternative** when you want to try OpenCode
without buying an API key:

- no account and no paid plan — the free tiers come from providers you enable
- everything stays local; provider keys never leave your machine
- one config block (`provider.freellmapi`) covers every model the gateway serves

This plugin is the convenience layer: it **starts the gateway for you**, keeps the
OpenCode model catalog in sync with what the gateway actually serves, and ships a
**`/setup` command** that walks you from "nothing installed" to a working first
message.

### First-time setup: `/setup`

Copy the bundled command into your OpenCode commands directory once:

```sh
mkdir -p ~/.config/opencode/commands
curl -fsSL https://raw.githubusercontent.com/rjcamandona123/opencode_v2-freellmapi-sync/main/commands/setup.md \
  -o ~/.config/opencode/commands/setup.md
```

Then run `/setup` in OpenCode. It will:

1. check whether the gateway is running (and start it if it is not),
2. open the dashboard flow for adding a provider key and copying the unified key,
3. validate the key against `/v1/models`,
4. run `npx freellmapi setup-opencode` and verify a real completion.

Already have a key? Pass it directly: `/setup freellmapi-yourkey`. On Windows the
command path is `%USERPROFILE%\.config\opencode\commands\setup.md`.

> If FreeLLMAPI is not installed at all, `/setup` stops and shows the install
> options (Docker one-liner, source checkout, or the desktop app) instead of
> guessing.


## What it does

- Reads `provider.freellmapi.options.baseURL` and `provider.freellmapi.options.apiKey` from your OpenCode config
- Resolves `{env:VAR}` placeholders in `apiKey` (e.g. `{env:FREELLMAPI_API_KEY}`) and falls back to the unified key in OpenCode's `auth.json`, which newer FreeLLMAPI generators use instead of the placeholder
- Calls `GET {baseURL}/models` with `Authorization: Bearer <apiKey>`
- Builds model entries from the gateway response and updates `provider.freellmapi.models`
- **Auto-activates the local gateway:** if the configured `baseURL` is local
  (`localhost` / `127.0.0.1`) and nothing answers, it starts the FreeLLMAPI
  server detached, waits for it to come up, then syncs the catalog. This removes
  the `ECONNREFUSED ... Retrying in 7s` loop you get when the server isn't
  running.
- Falls back to leaving OpenCode untouched if activation isn't possible

## Auto-activation

When `GET /v1/models` fails with a connection error and `baseURL` points at a
local address, the plugin:

1. Locates the FreeLLMAPI install (see `FREELLMAPI_HOME` below).
2. Starts it in the background, detached from OpenCode:
   - `node server/dist/index.js` if a production build exists, otherwise
   - `node node_modules/tsx/dist/cli.mjs watch src/index.ts` when the TypeScript
     source and `tsx` are present (no npm shell needed), otherwise
   - `npm run dev -w server` (server workspace only — the Vite dashboard is not
     needed for OpenCode).
3. Probes `GET /api/health` until it answers (any HTTP status counts).
4. Fetches the model list and reloads the provider/model catalog.

Server output is appended to `server.autostart.log` in the install directory.
Only one activation is attempted per minute, and a `.autostart.lock` file stops
several OpenCode windows from starting duplicate servers.

### Activation settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `FREELLMAPI_HOME` | auto-detected | FreeLLMAPI checkout/install directory (trusted as-is when set explicitly) |
| `FREELLMAPI_AUTOSTART` | `1` | Set to `0` / `false` to disable auto-start |
| `FREELLMAPI_AUTOSTART_TIMEOUT_MS` | `25000` | How long to wait for the server to become reachable |
| `FREELLMAPI_AUTOSTART_LOG` | `<home>/server.autostart.log` | Where server stdout/stderr is written |
| `FREELLMAPI_START_CMD` | — | Custom command run via the platform shell in `<home>` (Docker, desktop app, custom supervisor) |
| `FREELLMAPI_NODE` | `node` | Node binary used when the plugin runs under Bun |
| `FREELLMAPI_BASE_URL` | `http://127.0.0.1:3001/v1` | Used for the background refresh when config isn't available |

Detection looks at `FREELLMAPI_HOME`/`FREELLMAPI_DIR`/`FREELLMAPI_ROOT`, then
the current directory and its parents (plus a sibling `freellmapi/`), then
`~/freellmapi`, `~/.freellmapi/app`, `~/Documents/freellmapi`,
`~/Projects/freellmapi`, the Windows per-user locations
(`%LOCALAPPDATA%\Programs\freellmapi`, `%LOCALAPPDATA%\freellmapi`,
`%APPDATA%\freellmapi`), and `/opt`, `/usr/local`, `/srv`. A directory is
accepted when it contains `server/dist/index.js` or `server/src/index.ts`, or
when you named it explicitly in `FREELLMAPI_HOME`.

> Auto-start only ever runs for local gateways. A remote `baseURL` is never
> spawned and simply syncs (or fails quietly) as before.

### Cross-platform behavior

| | macOS | Linux / Termux | Windows |
| --- | --- | --- | --- |
| Server runtime | `node` (native) | `node` (native) | `node.exe` |
| Build path | `node server/dist/index.js` | same | same |
| Dev path | `tsx` from `node_modules` | same | same (no `.cmd` needed) |
| npm fallback | `npm` | `npm` | `npm.cmd` via shell |
| Detached child | `detached` + `unref` | same | same, with `windowsHide` so no console flash |
| Lock/log paths | `node:path` + `os.homedir()` | same | `node:path` + `%LOCALAPPDATA%`/`%APPDATA%` candidates |

Spawn failures are swallowed (`child.on("error")`), so a missing `node`/`npm`
degrades to "server not started" instead of crashing OpenCode.

### Docker / desktop installs

The official one-liner and the desktop app don't keep a `server/` source tree
next to the data, so there is nothing to spawn directly. Either leave
auto-start off (`FREELLMAPI_AUTOSTART=0`), or give it a command:

```sh
# Docker install (the compose file lives in ~/freellmapi)
export FREELLMAPI_HOME="$HOME/freellmapi"
export FREELLMAPI_START_CMD="docker compose up -d"
```

## Launcher (optional, all platforms)

If you want the gateway up *before* OpenCode boots instead of during plugin
load, use the bundled launcher. It is plain Node, so the same file works on
macOS, Linux, Termux and Windows:

```sh
# macOS / Linux / Termux: put this repo's bin/ before the real opencode
export PATH="/path/to/opencode_v2-freellmapi-sync/bin:$PATH"
opencode            # starts the gateway, then OpenCode
```

```bat
rem Windows: same idea, bin\opencode.cmd is used by PATHEXT
set PATH=C:\path\to\opencode_v2-freellmapi-sync\bin;%PATH%
opencode
```

The launcher waits for the gateway (bounded by
`FREELLMAPI_AUTOSTART_TIMEOUT_MS`), then `exec`s the real OpenCode binary found
later in `PATH`. Set `OPENCODE_BIN` if you prefer an explicit path. It skips
its own directory during lookup, so there is no recursion.

## Requirements

- OpenCode v2 plugin API (exports default `{ id, setup }`)
- Node.js 20.18+ (same as FreeLLMAPI) — or Bun for the plugin itself; the server
  is always started with `node`
- A FreeLLMAPI gateway (default: `http://127.0.0.1:3001/v1`); if local, it can
  be auto-started as described above
- An existing `provider.freellmapi` configuration in OpenCode

## Install

### With OpenCode CLI (recommended)

```sh
opencode plugin add git+https://github.com/rjcamandona123/opencode_v2-freellmapi-sync.git
```

Then reload/restart OpenCode if needed.

### Local plugin file (manual)

Copy `index.js` to your OpenCode plugins directory (for example `~/.config/opencode/plugins/freellmapi-sync.js`) and reload/restart OpenCode.

### Manual config entry (Git spec)

If you prefer editing config directly, add the plugin to your OpenCode config (example):

```jsonc
{
  "plugins": [
    "git+https://github.com/rjcamandona123/opencode_v2-freellmapi-sync.git"
  ]
}
```

> Plugin spec formats can vary by OpenCode version/environment. If `opencode plugin add` or the git spec above doesn’t work in your setup, use the local plugin file method.

## Example OpenCode provider config

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "freellmapi/auto",
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "http://127.0.0.1:3001/v1",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      },
      "models": {}
    }
  }
}
```

Set the unified key in your environment before starting OpenCode:

```sh
export FREELLMAPI_API_KEY="freellmapi-..."
```

## Notes

- This plugin refreshes models from the gateway when loaded (and attempts a background refresh). It complements `npx freellmapi setup-opencode ...`, which can still be used for initial setup or manual refresh.
- Model discovery expects a FreeLLMAPI-compatible `/v1/models` response (`data[]` with fields like `id`, `name`, `available`, `context_length`).
- This is a community plugin and not an official OpenCode or FreeLLMAPI package.

## License

MIT
