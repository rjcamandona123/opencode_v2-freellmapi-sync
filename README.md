# opencode_v2-freellmapi-sync

[![OpenCode v2 Plugin](https://img.shields.io/badge/OpenCode-v2%20Plugin-111111?style=for-the-badge&logo=opencode&logoColor=white)](https://opencode.ai/)
[![FreeLLMAPI Compatible](https://img.shields.io/badge/FreeLLMAPI-Compatible-2563EB?style=for-the-badge)](https://github.com/tashfeenahmed/freellmapi)
[![License: MIT](https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge)](LICENSE)
[![JavaScript ESM](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000000)](./index.js)
[![GitHub Repo](https://img.shields.io/badge/GitHub-rjcamandona123%2Fopencode__v2--freellmapi--sync-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/rjcamandona123/opencode_v2-freellmapi-sync)

OpenCode v2 plugin that automatically syncs [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) models into your `provider.freellmapi` catalog.

It hooks into OpenCode's provider transform on startup/load and fetches the live model list from your running FreeLLMAPI gateway, so you don't have to manually re-run `setup-opencode` every time the catalog changes.

## What it does

- Reads `provider.freellmapi.options.baseURL` and `provider.freellmapi.options.apiKey` from your OpenCode config
- Resolves `{env:VAR}` placeholders in `apiKey` (e.g. `{env:FREELLMAPI_API_KEY}`)
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
| `FREELLMAPI_HOME` | auto-detected | FreeLLMAPI checkout/install directory (the one containing `server/`) |
| `FREELLMAPI_AUTOSTART` | `1` | Set to `0` / `false` to disable auto-start |
| `FREELLMAPI_AUTOSTART_TIMEOUT_MS` | `25000` | How long to wait for the server to become reachable |
| `FREELLMAPI_AUTOSTART_LOG` | `<home>/server.autostart.log` | Where server stdout/stderr is written |
| `FREELLMAPI_NODE` | `node` | Node binary used when the plugin itself runs under Bun |
| `FREELLMAPI_BASE_URL` | `http://127.0.0.1:3001/v1` | Used for the background refresh when config isn't available |

Detection looks at `FREELLMAPI_HOME`/`FREELLMAPI_DIR`/`FREELLMAPI_ROOT`, then
the current directory and its parents (plus a sibling `freellmapi/`), then
`~/freellmapi`, `~/.freellmapi/app`, and `/opt/freellmapi`. A directory is
accepted when it contains `server/dist/index.js` or `server/src/index.ts`.

> Auto-start only ever runs for local gateways. A remote `baseURL` is never
> spawned and simply syncs (or fails quietly) as before.

## Requirements

- OpenCode v2 plugin API (exports default `{ id, setup }`)
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
