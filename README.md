# SH-01

AI that shows you where to click, instead of telling you.

SH-01 is a desktop assistant for beginners: a small pixel robot that floats over your screen, points at the exact button, field, or menu you need next, and walks you through multi-step tasks in any app. Godot 4 is the main demo, but it guides in whatever application is on screen.

Demo video: (link coming soon)

## Requirements

- **macOS only.** SH-01 is built and tested on macOS; other platforms are not supported.
- **Node.js 22.12 or newer** (required by Electron 45).
- **A Meta Model API key.** Create one in the Meta Model API dashboard (dev.meta.ai → API keys). Calls go to `https://api.meta.ai/v1` using your key.

## Setup

```sh
git clone https://github.com/ArtyKourakin/Meta-Hacha_SH-01.git
cd Meta-Hacha_SH-01/app
npm install
cp .env.example .env
```

Open `.env`, paste your key after `MODEL_API_KEY=`, then run:

```sh
npm run dev
```

Optional: set `SH0_MODEL` in `.env` to call a different model instead of the default `muse-spark-1.3`. A shell-exported `MODEL_API_KEY` or `SH0_MODEL` always wins over `.env`.

## Permissions

On first use, macOS asks for **Screen Recording** permission for the app that runs SH-01 (Terminal, iTerm, or VS Code — whichever you launched `npm run dev` from). Without it, SH-01 cannot see your screen.

1. Open System Settings → Privacy & Security → Screen Recording (SH-01 also shows an "Open Settings" button that takes you there).
2. Enable the toggle for your terminal app.
3. **Fully quit that app (Cmd+Q) and reopen it**, then run `npm run dev` again. The permission only takes effect after a restart.

## Usage

Global hotkeys (work anywhere on your Mac):

- **Cmd+Shift+Space** — ask where something is, and SH-01 points to it.
- **Cmd+Option+A** — open or hide the chat.
- **Cmd+Option+L** — ask about what's under your cursor.
- **Cmd+Option+P** — open or hide the step remote (HUD).

In the chat: **Enter** sends, **Shift+Enter** starts a new line, **Esc** closes. A "?" button in the chat header shows this list inside the app.

### Walkthrough: Godot 4

1. Open Godot 4 with a scene (an empty scene is fine).
2. Press Cmd+Option+A. Click **Workspace** → **Godot project folder** and pick your project (it must contain `project.godot`).
3. Keep **Look at my screen** checked and describe your goal, e.g. "Make a 2D character that moves and jumps".
4. Answer the clarifying questions, then click **Yes, make the plan**.
5. Click **Show me** and follow the robot. **Next** checks each step against your screen before advancing.

### Walkthrough: Meta Ads Manager

1. In the chat, click **Workspace** → **New workspace** and name it, e.g. "Meta Ads".
2. Open Meta Ads Manager in your browser.
3. Ask, e.g. "Help me change my ad budget in Meta Ads Manager". If the app is not on screen, SH-01 asks you to open it and press **I'm ready**.
4. For unfamiliar screens SH-01 may research the official docs first (sources appear as links in the chat).
5. Follow the plan with **Show me** / **Next**. Steps that spend money carry a warning.

## Cost

Every answer uses your own Meta API key and your own tokens. Web research additionally uses the Responses API `web_search` tool, which Meta bills separately.

## Privacy

- Your key is stored in `app/.env`, which is gitignored and never committed. SH-01 never logs it.
- Screenshots, prompts, and model responses are never logged or saved, except `spike/` debug outputs on the developer's own machine (gitignored).
- Chat history is stored only on your Mac, encrypted, one file per workspace.
- Screenshots are sent to the Meta API only to answer your current request. SH-01 never stores them.

## Troubleshooting

- **"MODEL_API_KEY is missing"** — your `.env` has no key. Open `app/.env`, set `MODEL_API_KEY=<your key>`, and restart (`npm run dev`).
- **Black screenshots / "Allow Screen Recording" message** — follow the Permissions steps above, then fully quit and reopen your terminal app.
- **A hotkey does nothing** — another app may own that shortcut. Check the terminal where `npm run dev` runs: SH-01 prints `Failed to register global shortcut …` for each conflict. Free the shortcut or quit the conflicting app, then restart.

## Meta models used

- `muse-spark-1.3` (default for pointing, chat, verification, recovery, and look-at-cursor; overridable via `SH0_MODEL`).
- The Responses API `web_search` tool, used only in web research for unfamiliar apps.

SH-01 does not generate sprites or 3D models. For those, it points you to external tools and guides the import.

## Built during the hackathon

All code in this repo was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Third-party libraries: `electron`, `electron-vite`, `openai`, `react`, `react-dom`, `dotenv`, `@vitejs/plugin-react`, `typescript`, `@types/node`, `@types/react`, `@types/react-dom` (see `app/package.json`). The SH-01 landing page was built with Lovable and is not part of this repo.

## License

SH-01 is source-available: you are free to use and modify it, but you may not sell it or build a competing product with it. See the `LICENSE` file (PolyForm Shield License 1.0.0) — that file is what applies.
