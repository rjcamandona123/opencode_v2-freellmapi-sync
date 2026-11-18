# opencode_v2-freellmapi-sync

OpenCode v2 plugin that automatically syncs [FreeLLMAPI](https://github.com/tashfeenahmed/freellmapi) models into your `provider.freellmapi` catalog.

It hooks into OpenCode's provider transform on startup/load and fetches the live model list from your running FreeLLMAPI gateway, so you don't have to manually re-run `setup-opencode` every time the catalog changes.

## What it does

- Reads `provider.freellmapi.options.baseURL` and `provider.freellmapi.options.apiKey` from your OpenCode config
- Resolves `{env:VAR}` placeholders in `apiKey` (e.g. `{env:FREELLMAPI_API_KEY}`)
- Calls `GET {baseURL}/models` with `Authorization: Bearer <apiKey>`
- Builds model entries from the gateway response and updates `provider.freellmapi.models`
- Fails silently/unobtrusively if FreeLLMAPI is unreachable (OpenCode can still start)

## Requirements

- OpenCode v2 plugin API (exports default `{ id, setup }`)
- A running FreeLLMAPI gateway (default: `http://127.0.0.1:3001/v1`)
- An existing `provider.freellmapi` configuration in OpenCode

## Install

### Local plugin file (simple)

Copy `index.js` to your OpenCode plugins directory (for example `~/.config/opencode/plugins/freellmapi-sync.js`) and reload/restart OpenCode.

### From Git (if supported by your OpenCode setup)

Add the plugin to your OpenCode config (example):

```jsonc
{
  "plugins": [
    "opencode_v2-freellmapi-sync@git+https://github.com/rjcamandona123/opencode_v2-freellmapi-sync.git"
  ]
}
```

> Plugin loading/install syntax can vary by OpenCode version/environment. If your setup doesn't load git plugins directly, use the local plugin file method.

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
