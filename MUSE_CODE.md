# Project rules for Muse Code

Read this file before every task. If a request conflicts with these rules, stop and ask.

## What we are building

Product and mascot name: SH-0 (reads "show").

SH-0 guides beginners in any application on screen; Godot 4 is the main demo.

A desktop AI assistant for beginner game creators, built for the Meta Global AI Developer Hackathon (Oct 26 - Nov 4, 2026). All code in this repo must be written during the hackathon.

Positioning: "AI that shows you where to click, instead of telling you." Text instructions confuse beginners; a pointer on the screen does not.

It floats over the screen next to the mouse cursor and shows the user where to click inside whatever app is on screen.

Core feature (most of the effort goes here):
1. On-screen guidance: on a hotkey, capture the screen, ask Muse Spark where the target UI element is, show a marker on a transparent overlay. Later: a small original mascot that flies to the target and points at it.

Secondary features (small, only after the core is reliable):
2. Advisor chat: the user describes the goal, the agent guides step by step and points at each step.
3. Script generation: Muse Spark writes `.gd` files into `ai_assets/`, then points where to attach them.
4. Simple 2D sprite generation with Muse Image into `ai_assets/`. For 3D the agent says an external tool is needed and points where to import the result.

## Stack

- Electron + React + TypeScript (macOS first)
- Meta Model API, OpenAI-compatible. Base URL `https://api.meta.ai/v1`
- API key: `MODEL_API_KEY` loaded from `~/.secrets/game-agent.env` (outside the repo). Pass it explicitly to the OpenAI SDK, never rely on `OPENAI_API_KEY`.
- Models: `muse-spark-1.3` (vision, reasoning, code), `muse-image-1.0` (sprites), SAM 3.1 (background removal). Standard tier only, never `-contributor` IDs.
- API calls happen only in the Electron main process, never in the renderer.

Do not add dependencies without asking first.

## Hard rules

- The repo is PUBLIC. The API key lives in `~/.secrets/game-agent.env`, outside the repo. Code loads it from that path. Never read, print or open that file or anything in `~/.secrets`. Use `.env.example` to learn variable names.
- Never hardcode screen coordinates for UI elements. Every target location must come from the model at runtime. This is what the judges verify.
- Write files only inside `<chosen project>/ai_assets/`. Never overwrite an existing file without asking the user.
- Never generate `.tscn` scene files.
- Never log or save screenshots, prompts or model responses, except in the `spike/` test folder on the developer machine (gitignored outputs).
- No copyrighted characters, logos or brands in generated assets.
- Always ask the model for coordinates on a 0-1000 normalized scale, never raw pixels (tested in spike/: normalized hit 15/15, pixels often missed). Convert to screen points in code: x_pt = x/1000 * display width in points. This also removes Retina scaling issues.
- Default `reasoning_effort: "minimal"` for pointing (~2.6s). Known weakness: it can confuse small look-alike icons (e.g. zoom + vs -). Retry with `"low"` when the user says the marker is wrong.
- Hide the overlay before every screen capture so our own marker never appears in the screenshot sent to the model.

## How to work

- Small steps, one feature per task. Show a plan before big changes.
- After each change, run the build and lint and fix errors before reporting done.
- Commit after each working step with a clear message (git history is evidence of hackathon work).
- Out of scope: 3D assets, other engines, Windows, installers, code signing, accounts, backend server.
Architecture note for the next step (do not build it yet, just structure the code for it):
- Keep a single Session store in the main process: chat messages, a plan (list of steps, each with "instruction" and "target"), and currentStepIndex.
- Put the pointing logic in one function locate(target: string, context?: string) in the main process, so a chat window and a "next step" hotkey can call it later with the current step and a short summary of the user's goal.
- Never run git push and never look for credentials (keychain, ~/.git-credentials, tokens, SSH keys, env vars). Commit only; the user pushes.
- Muse Spark spends hidden reasoning tokens before the visible answer. Never set max_tokens below 2000 for any call, or the JSON comes back empty or truncated.