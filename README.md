# SH-01

Don't tell me. Show me.

SH-01 is a desktop assistant for beginners. It looks at your screen, points at the exact button, field, or menu you need next, and walks you through multi-step tasks in any app. Godot 4 is the main demo, but it guides in whatever application is on screen.

Website: https://sh-01.app/

Demo video: https://youtu.be/mUPoozql9wA

## Why it exists

Most AI assistants explain what to do in words. Beginners read the explanation and still don't know where to click. SH-01 points at the thing on their own screen instead, one step at a time.

## What it does

- **On-screen pointing.** Press the point hotkey, ask where something is, and a small robot marks the spot with an instruction bubble (Next, Done, Wrong spot).
- **Discovery questions.** For vague goals, SH-01 asks a few multiple-choice questions, shows a confirm card, and lets you **Skip questions** — or **Describe it yourself** in your own words.
- **Step-by-step plans.** Each step has one instruction and one target. **Show me** points at it; **Next** / **Back** move through the plan.
- **Step checking and recovery.** With **Check my steps** on, each step is verified against your screen before advancing. **Wrong spot** re-points, and menu steps offer **Show option**.
- **Web research.** For apps it doesn't know well, SH-01 looks up the official docs first; sources appear as links in the chat. The shortcuts help also lists a **Check the documentation for this app** command.
- **Step remote (HUD).** A small floating window with the current step and Show me / Next / Back buttons, so you can hide the chat.
- **Look at cursor.** Ask about whatever is under your mouse pointer.
- **Voice input.** Dictate into the chat (up to 60 seconds per take). The transcript lands in the input; it is never sent automatically. Voice input supports 25 languages with automatic detection: Arabic, Bengali, Dutch, English, French, German, Hebrew, Hindi, Indonesian, Italian, Japanese, Kannada, Korean, Malay, Mandarin Chinese, Marathi, Polish, Portuguese, Spanish, Tagalog, Tamil, Telugu, Thai, Turkish and Vietnamese.
- **Improve with Muse.** Rewrites a vague request into a detailed one, with Undo.
- **Create image.** A separate window for generating images. Follow-ups edit the latest image (**Apply changes**, **Regenerate**, **New image**; up to 20 images per session). Each image has **Save** and **Copy prompt**, and opens larger on click.
- **GDScript code.** The chat can write a script and save it into your Godot project's `ai_assets/` folder with **Save to project** (Godot workspaces only).
- **Workspaces and chats.** Named workspaces or Godot project folders, each with its own chat history. Switch and delete workspaces, and rename and delete chats, from the menus.
- **Shortcuts help.** The "?" button lists hotkeys and useful commands. It opens once on first launch.

## How it works

SH-01 captures your screen (hiding its own windows first) and sends the screenshot to the model, which answers with the target's position on a normalized 0–1000 grid. The app converts that to screen points and draws the marker on a transparent overlay. Nothing is hardcoded: every position comes from the model at runtime. With step checking on, Next captures the screen again and asks the model whether the step actually looks done before moving on.

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

Voice input needs the **Microphone** too: the first time you press the mic button, macOS asks for Microphone access. If you denied it, open System Settings → Privacy & Security → Microphone and enable it (SH-01 shows an "Open Settings" button that takes you there).

## Usage

Global hotkeys (work anywhere on your Mac):

- **Cmd+Shift+Space** — ask where something is, and SH-01 points to it.
- **Cmd+Option+A** — open or hide the chat.
- **Cmd+Option+L** — ask about what's under your cursor.
- **Cmd+Option+P** — open or hide the step remote.

In the chat: **Enter** sends, **Shift+Enter** starts a new line, **Esc** closes the help panel or the expanded editor. A "?" button in the chat header shows this list inside the app.

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
5. Follow the plan with **Show me** / **Next**. SH-01 adds a warning to steps it recognizes as risky, like steps that spend money. Always review them yourself.

## Meta models used

- `muse-spark-1.3` — pointing, chat, step checking, recovery, look-at-cursor, and prompt improving. The default for every direct call; overridable via `SH0_MODEL`.
- `muse-voice-transcribe-1.0` — voice input in the chat composer.
- `muse-image-1.0` — the Create image window.
- The Responses API `web_search` tool, used only in web research for unfamiliar apps.

## Cost

Every answer uses your own Meta API key and your own tokens, billed by Meta — check Meta's pricing for current rates. Web research additionally uses the Responses API `web_search` tool, which Meta bills separately.

## Privacy

- Your key lives in `app/.env`, which is gitignored and never committed. SH-01 never logs it.
- Your chat history (messages, plans, workspaces) stays on your Mac, encrypted.
- Screenshots and voice recordings are sent to the Meta API only to answer the current request. SH-01 does not store them.
- Chat messages go to the Meta API as conversation context, and are kept in your encrypted on-Mac history.
- Generated images and their prompts stay in memory, and reach disk only when you click Save.

## Limitations

- macOS only.
- Results vary in apps SH-01 doesn't know well (it researches the docs, but may still miss).
- Generated images have no transparent background.
- No 3D generation: for 3D, SH-01 points you to external tools and guides the import.

## Troubleshooting

- **"MODEL_API_KEY is missing"** — your `.env` has no key. Open `app/.env`, set `MODEL_API_KEY=<your key>`, and restart (`npm run dev`).
- **Black screenshots / "Allow Screen Recording" message** — follow the Permissions steps above, then fully quit and reopen your terminal app.
- **A hotkey does nothing** — another app may own that shortcut. Check the terminal where `npm run dev` runs: SH-01 prints `Failed to register global shortcut …` for each conflict. Free the shortcut or quit the conflicting app, then restart.

## Built during the hackathon

All code in this repo was written during the Meta Global AI Developer Hackathon (Oct 26 – Nov 4, 2026). Most of this app was written with Muse Code. Claude Code was used for design polish at the end of the project. Third-party libraries: `electron`, `electron-vite`, `openai`, `react`, `react-dom`, `dotenv`, `@vitejs/plugin-react`, `typescript`, `@types/node`, `@types/react`, `@types/react-dom` (see `app/package.json`). The SH-01 landing page was built with Lovable and is not part of this repo.

## License

SH-01 is open source under the Apache License 2.0. See the LICENSE and NOTICE files.
