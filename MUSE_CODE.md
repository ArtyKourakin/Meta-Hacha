# Project rules for Muse Code

Read this file before every task. If a request conflicts with these rules, stop and ask.

## What we are building

A desktop AI assistant for beginner game creators, built for the Meta Global AI Developer Hackathon (Oct 26 - Nov 4, 2026). All code in this repo must be written during the hackathon.

It floats over the screen next to the mouse cursor and shows the user where to click inside the Godot 4 editor. It can also generate 2D sprites and GDScript files and save them into the user's Godot project.

Core features:
1. On-screen guidance: on a hotkey, capture a region around the cursor, ask Muse Spark where the target UI element is, draw an arrow on a transparent overlay.
2. Advisor chat: the user describes the game, the agent guides step by step.
3. Asset generation: Muse Image creates a sprite, SAM 3.1 removes the background, PNG is saved to `ai_assets/`.
4. Script generation: Muse Spark writes `.gd` files into `ai_assets/`.

## Stack

- Electron + React + TypeScript (macOS first)
- Meta Model API, OpenAI-compatible. Base URL `https://api.meta.ai/v1`
- API key: `MODEL_API_KEY` from `.env`. Pass it explicitly to the OpenAI SDK, never rely on `OPENAI_API_KEY`.
- Models: `muse-spark-1.3` (vision, reasoning, code), `muse-image-1.0` (sprites), SAM 3.1 (background removal). Standard tier only, never `-contributor` IDs.
- API calls happen only in the Electron main process, never in the renderer.

Do not add dependencies without asking first.

## Hard rules

- The repo is PUBLIC. Secrets only in `.env`, which is in `.gitignore`. Keep `.env.example` with empty values.
- Never hardcode screen coordinates for UI elements. Every target location must come from the model at runtime. This is what the judges verify.
- Write files only inside `<chosen project>/ai_assets/`. Never overwrite an existing file without asking the user.
- Never generate `.tscn` scene files.
- Never log or save screenshots, prompts or model responses, except in the `spike/` test folder on the developer machine (gitignored outputs).
- No copyrighted characters, logos or brands in generated assets.
- Account for Retina scaling: model coordinates are in image pixels, convert to screen points before drawing.

## How to work

- Small steps, one feature per task. Show a plan before big changes.
- After each change, run the build and lint and fix errors before reporting done.
- Commit after each working step with a clear message (git history is evidence of hackathon work).
- Out of scope: 3D assets, other engines, Windows, installers, code signing, accounts, backend server.
