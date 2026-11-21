---
description: First-time FreeLLMAPI setup — start the gateway, get a unified key, connect OpenCode
---

You are running first-time FreeLLMAPI setup. Follow these steps in order, using your shell tool, and pause whenever the user has to act.

Raw arguments: $ARGUMENTS

Background you should use in your explanations:
- FreeLLMAPI is a local, open-source router that puts many free-tier LLM providers behind one OpenAI-compatible endpoint (`http://127.0.0.1:3001/v1`). It is a good alternative when the user has no paid API key yet.
- The user adds their own provider keys (Groq, Gemini, Mistral, etc.) on the dashboard at `http://localhost:3001`, under **Keys**.
- The dashboard then shows one **unified key** starting with `freellmapi-`. That is the only credential OpenCode needs.
- The FreeLLMAPI install directory is whatever `FREELLMAPI_HOME` points at, otherwise a checkout such as `~/freellmapi`, `~/Documents/freellmapi`, `~/Projects/freellmapi`, or an equivalent path on Windows/this machine.

Steps:

1. **Check whether the gateway is already running.**
   Probe `http://127.0.0.1:3001/api/health`. Any HTTP response means it is up; a connection error means it is not. Do not treat `401`/`404` as failure.

2. **If it is not running, locate the install and start it detached.**
   - Prefer a built server: `node server/dist/index.js` from the install root (the `server/` directory as working directory), appending output to `server.autostart.log`.
   - Otherwise start the dev server from the install root: `npm run dev -w server` (only the server workspace; the dashboard on port 5173 is optional).
   - Use the platform's syntax: `nohup … &` on macOS/Linux/Termux, `Start-Process -WindowStyle Hidden` in PowerShell on Windows.
   - Wait for `/api/health` to answer, up to 60 seconds.
   - If the install cannot be found, do **not** invent one. Explain the options and stop:
     - Docker one-liner: `curl -fsSL https://freellmapi.co/install.sh | bash`
     - From source: `git clone https://github.com/tashfeenahmed/freellmapi.git`, then `npm install`, then `npm run dev`
     - Desktop app: <https://github.com/tashfeenahmed/freellmapi/releases/latest>
     Ask the user to run one of them and then re-run `/setup`.

3. **Get the unified key.**
   - If the command arguments contain a key starting with `freellmapi-`, use that one.
   - Otherwise ask the user to open `http://localhost:3001`, add at least one provider key on the **Keys** page, and paste the unified key from the same page.
   - Never print the key back, never write it into a repository file, and do not continue until you have a key.

4. **Validate the key before changing any config.**
   Call `GET http://127.0.0.1:3001/v1/models` with `Authorization: Bearer <key>`. A `200` with a non-empty `data` array means the key works. On `401`, ask the user to copy the key again.

5. **Configure OpenCode with the official generator.**
   - Back up the current config first (`~/.config/opencode/opencode.json` on macOS/Linux, `%USERPROFILE%\.config\opencode\opencode.json` on Windows).
   - Run: `npx -y freellmapi setup-opencode --url http://127.0.0.1:3001 --api-key <key>`
   - This writes the `provider.freellmapi` entry, sets `model` to `freellmapi/auto`, and imports the live model list. Preserve any unrelated settings the user already has.
   - Key storage depends on the generator version:
     - Published `freellmapi` **0.8.x** (what `npx` installs) puts `apiKey: "{env:FREELLMAPI_API_KEY}"` in the config and prints a reminder to export that variable; it does **not** write `auth.json`. Tell the user to export `FREELLMAPI_API_KEY` before starting OpenCode.
     - Newer in-repo / desktop-app generators write the key to `~/.local/share/opencode/auth.json` (`%USERPROFILE%\.local\share\opencode\auth.json` on Windows) and leave `apiKey` undefined in the config. No export is needed; the sync plugin reads `auth.json` for its catalog refresh too.

6. **Verify end to end.**
   Send a tiny completion to `POST http://127.0.0.1:3001/v1/chat/completions` with `{"model":"auto","messages":[{"role":"user","content":"Say OK"}],"max_tokens":8}` and the unified key. Report which upstream model answered.

7. **Finish.**
   Tell the user to run `/reload` so the new provider catalog is picked up, then suggest a first message like “hello”. Mention:
   - Dashboard: `http://localhost:3001` (add/replace provider keys there any time)
   - Diagnose problems: `npx freellmapi doctor`
   - The sync plugin keeps the model list fresh and can start the gateway automatically on later launches.

If any step fails, show the exact command and its error output, explain the likely cause in one sentence, and stop rather than guessing.
