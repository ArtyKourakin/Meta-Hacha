# Overlay manual test checklist

Click through these after every overlay change (layout, bubbles, islands, robot).

## Clean-clone install

- [ ] **Clone**: fresh `git clone` to /tmp, `cd app`, `npm install`.
- [ ] **No key**: `cp .env.example .env` (leave it empty), `npm run dev`.
      Pointing and chat show "MODEL_API_KEY is missing — add it to
      app/.env, then restart".
- [ ] **Key**: paste a key into `app/.env`, restart. Cmd+Shift+Space
      points; Cmd+Option+A opens the chat; Cmd+Option+L and
      Cmd+Option+P fire.
- [ ] **Permissions**: on first capture macOS asks for Screen
      Recording for the terminal app; enabling it plus a full
      quit/reopen makes captures work.
- [ ] **Untracked**: `git status` shows no `.env` (it stays ignored).

## Step bubble buttons

- [ ] **Next**: hotkey a free query is not enough — start a plan in chat, Show me,
      click **Next** in the bubble. Marker advances to the next step.
- [ ] **Done**: on the last step the bubble shows **Done**. Click it. Marker and
      bubble disappear, robot flashes happy.
- [ ] **Wrong spot**: on any step marker, click **Wrong spot**. A fresh marker
      appears at a different spot (or the unsure message). Retry chains.

## Recovery bubble

- [ ] Switch the app so the step target is not visible, Show me. The recovery
      bubble appears; click **Show me**. The original step is retried.

## Still mouse

- [ ] Keep the mouse perfectly still, trigger a marker under the cursor
      (Show me on a step near the cursor). Without moving the mouse, the bubble
      buttons are clickable on the first click.

## Screen edges

Point at a target near each edge (free query on a visible UI element there).
The robot and bubble never overlap each other, neither covers the ring, and
the bubble stays fully readable:

- [ ] Top (below the menu bar)
- [ ] Bottom (near the Dock)
- [ ] Left edge
- [ ] Right edge (the chat window auto-collapses first if the target is under it)

## Step verification

- [ ] **Done step**: complete the current step, press Next. It advances
      (robot thinks briefly first).
- [ ] **Undone step**: press Next without doing the step. The bubble says the
      step isn't done yet, with "Show me again" and "It's done".
- [ ] **Show me again**: re-points the current step without advancing.
- [ ] **It's done**: advances anyway with no further check.
- [ ] **Toggle off**: uncheck "Check my steps" in the ⋯ menu; Next advances
      immediately. Re-check; restart the app; the toggle state persists.
- [ ] **Replan**: get the screen into an unexpected state (open a dialog the
      plan didn't mention), complete the step, press Next. The remaining steps
      update to match; the chat plan list shows the new steps.
- [ ] **One blink**: press Next with verification on. Windows hide and
      restore exactly once (no double blink).
- [ ] **Highlight first**: during thinking, chat and HUD already highlight
      the NEW step; the step 1 marker and bubble are gone.
- [ ] **Revert**: press Next on an undone step. The highlight jumps back
      to the old step with the not-done bubble.
- [ ] **Collapsed stays**: auto-collapse the chat with a marker, press
      Next. The chat stays collapsed until the new marker shows, then
      expands only if the marker is outside it.
- [ ] **Network off**: disable the network, press Next. It advances to
      the new step and shows "Lookup failed — try again" (no recovery,
      no hang). Re-enable after.
- [ ] **Debug line**: with SH0_DEBUG=1, one `[next]` line per Next shows
      capture/verify/locate ms and `captures=1` (2 after a recovery).

## Click-through

- [ ] With a bubble showing, click outside the bubble: the click reaches the app
      below (e.g. focuses a text field, clicks a button). Nothing is swallowed.
- [ ] After the marker is dismissed (✕ or timeout), clicks everywhere
      reach the app below.

## Chat window (floating)

Click through these after every chat-window change (bounds, drag, collapse).

- [ ] **Drag**: drag the window by the header to the middle of the screen.
      Header buttons (menu, collapse) still click.
- [ ] **Resize**: resize from a corner/edge; it stops at the 320x420 minimum.
- [ ] **Restart**: move + resize, quit and relaunch, open the chat: position
      and size are restored. (Delete `chat-bounds.json` from userData to test
      the first-launch default near the right edge.)
- [ ] **Collapse/expand**: collapse to the tab (header button), expand again:
      the window returns to its last position and size. Cmd+Option+A toggles.
- [ ] **Auto-collapse**: Show me a step whose target is under the window: the
      window collapses to the tab first, and expands back on Next/Done.
- [ ] **Minimized stays minimized**: minimize the chat with the yellow
      window button, then fire the look-at-cursor hotkey, a free-query
      point, and Show me. The chat stays minimized through every capture.
- [ ] **Hotkey restores minimized**: with the chat minimized, press
      Cmd+Option+A. The chat restores and focuses.

## Chat history sidebar

- [ ] **New chat**: send a message, open the sidebar (☰), click **New chat**.
      The view clears; the old chat appears in the list with a title.
- [ ] **Switch**: with two chats, click the other one. Messages, plan, step,
      app, research and the check-steps toggle all restore. The current chat
      is highlighted.
- [ ] **Busy**: while the assistant is thinking, sidebar switching, New chat
      and Delete are disabled.
- [ ] **Rename**: hover a chat, Rename, type a name, Enter. Restart the app:
      the name sticks (no auto-title overwrite).
- [ ] **Delete**: hover a chat, Delete, click again (Sure?). The chat and its
      file disappear. Deleting the current chat clears the view.
- [ ] **Greeting**: reopen a workspace with several chats: "Last time" names
      the most recently updated one.
- [ ] **Migration**: with an old single-file history (`<sha>.json.enc`, no
      per-workspace folder), open the workspace. It becomes the first chat
      with its messages and plan intact, and the old file is gone.
- [ ] **Wide window**: widen past 640 px: the sidebar becomes a permanent
      left column and ☰ hides. Narrow again: back to the drawer.
- [ ] **No workspace**: with no workspace selected, the sidebar says to
      choose a workspace; nothing is saved.
- [ ] **Clear**: "Clear history for this workspace" empties the sidebar and
      the view. "Delete all history" wipes every workspace.

## Workspace list

- [ ] **List**: with several workspaces, open the Workspace menu. All
      appear, most recently opened first; the current one has a
      checkmark; folder workspaces show a Godot badge. Long names
      truncate with an ellipsis.
- [ ] **Switch**: click another workspace. The menu closes; its messages,
      plan and step restore; any visible marker or bubble is gone.
- [ ] **Dedup**: create a workspace with an existing name (or pick the
      same folder again). It just opens — no second row appears.
- [ ] **Unavailable**: rename a Godot project folder away, reopen the
      menu. Its row cannot be switched but can still be deleted.
      Rename the folder back after.
- [ ] **Delete**: Delete, then Sure?. The row disappears and the menu
      stays open. A deleted Godot project's files are untouched.
- [ ] **Delete current**: delete the current workspace. The most recent
      remaining one opens. Delete the last one: "No workspace
      selected" with an empty chat; restart the app, nothing reopens.
- [ ] **Busy**: while the assistant is thinking, rows and Delete buttons
      are disabled.
- [ ] **Delete all**: "Delete all history" empties the workspace list too.

## Plan list collapse

- [ ] **Header**: with a plan, the list shows "Plan · Step N of M"
      with a chevron above it.
- [ ] **Collapse**: click the header. Only the step list hides; Show
      me, Back, Next and Continue stay visible, and the step number
      stays in the header.
- [ ] **New plan**: collapse the list, then get a new plan. It starts
      expanded.

## Collapsed tab

- [ ] Tab shows the robot face with antenna and the full "SH-01" label on one
      vertical line. No dark band, no clipping, no wrap.
- [ ] Click the tab: the chat window expands at its saved position and size.
- [ ] Eyes follow the cursor when it is near the tab; idle animations
      (blink, look around) run otherwise.

## Step action types

- [ ] **Type**: a "type" step points at the input field; the bubble shows
      "Type: \<text\>" with **Copy**. Click Copy, paste elsewhere: the exact
      text pastes.
- [ ] **Drag**: a "drag" step shows two markers (source ring + destination
      ring) joined by a dashed arrow; the robot sits beside the source. The
      bubble says "Drag this onto \<name\>". Robot and bubble overlap
      neither ring.
- [ ] **Drag Wrong spot**: on a drag marker, click **Wrong spot**. Both
      endpoints are re-located on a fresh screenshot.
- [ ] **Shortcut**: a "shortcut" step shows the keys as key caps in the
      bubble. With a target: a marker points at it. Without a target: no
      model call, no ring — the bubble sits next to the cursor (targetless).
- [ ] **Read**: a "read" step with no target shows the bubble next to the
      cursor with no marker. With a target, it points normally.
- [ ] **Targetless Next**: on a targetless shortcut/read bubble there is no
      **Wrong spot** button; **Next** still verifies and advances.

## Code blocks

- [ ] **Render**: ask for a script. The chat shows a monospace block with the
      purpose caption, the filename, **Copy**, and (Godot workspace only)
      **Save to project**.
- [ ] **Copy**: click Copy, paste into an editor: the exact code pastes (no
      fence, no "# purpose:" line).
- [ ] **Save**: in a Godot workspace, click **Save to project**. The chat
      notice says "Saved as res://ai_assets/\<file\>" and the file exists
      under \<project\>/ai_assets/.
- [ ] **No overwrite**: save the same code again. A second file appears with
      a _2 suffix; the first file is untouched.
- [ ] **Non-Godot workspace**: with a named (non-folder) workspace, the code
      block shows **Copy** only — no **Save to project**.
- [ ] **Script path**: ask for a script with a plan. The attach steps
      name res://ai_assets/<file> exactly — never the project root.

## Faster plans

- [ ] **Short plans**: ask for something big (e.g. "make a full platformer
      level"). The plan has at most 6 steps and the reply says it continues
      later.
- [ ] **Continue**: on the last step the chat plan row shows **Continue**.
      Click it: new steps are appended (old ones kept), and the marker moves
      onto the first new step.
- [ ] **Continue disabled**: mid-plan there is no **Continue** button; while
      the advisor is thinking it is disabled.
- [ ] **Duration**: run with SH0_DEBUG=1; each advisor turn logs
      `[advisor] ms=<n>`.

## Select steps

- [ ] **One step**: ask for something behind a menu (e.g. "open Project
      Settings"). Opening the menu and picking the item is ONE step, not two.
- [ ] **Bubble**: Show me points at the dropdown/menu; the bubble says "Open
      this and choose: A → B" with a **Show option** button.
- [ ] **Show option**: open the menu, click **Show option**. The marker moves
      to the option on a fresh screenshot; the bubble says "Now choose: …".
      Each press advances one label in a multi-level path.
- [ ] **Last option**: after the last label there is no **Show option**
      button anymore.
- [ ] **Wrong spot**: on an option marker, **Wrong spot** re-locates the
      option (not the menu).
- [ ] **Verify**: Next on a select step checks the right value is selected;
      an unopened menu reports "isn't done yet".

## Chat input

- [ ] **Grow**: type several lines. The input grows up to 5 lines, then
      scrolls inside. Enter sends, Shift+Enter inserts a new line.
- [ ] **Shrink**: after sending, the input is one line again.
- [ ] **Expand**: with more than 5 lines, a ⤢ icon appears in the input
      corner. Click it: a large editor opens with the same text.
- [ ] **Editor**: edit text, click **Done**: back to the normal input with
      the edits kept. Esc also closes keeping the text. Cmd+Enter sends.
- [ ] **Counter**: past 3500 characters a counter shows "n / 4000"; past
      4000 it turns warning-colored and **Send** is disabled.
- [ ] **Over limit**: with 4000+ characters, sending is blocked with a
      clear message — nothing is silently truncated.
- [ ] **Align**: the Send button and the "Look at my screen" checkbox stay
      aligned with the bottom of the input as it grows.
- [ ] **Improve**: type a vague request, click **Improve with Muse**.
      The input is replaced with clearer text; nothing is sent.
- [ ] **Undo**: after improving, click **Undo**. The original text
      returns. Typing or sending retires Undo.
- [ ] **Improving**: while it works, the button shows "Improving…" and
      the input is disabled; hotkeys and pointing still work.
- [ ] **Improve fails**: disable the network, click Improve. A short
      notice shows and the original text stays. Re-enable after.
- [ ] **Improve disabled**: the button is disabled with empty input
      and while the assistant is thinking.
- [ ] **Improve detailed**: improve a vague request. The result is a few
      sentences covering goal, app and the finished result, with
      "Default:" lines for missing details instead of questions.

## Voice input

- [ ] **Record**: press the mic button, speak, press again. Recording
      shows with elapsed time, then "Transcribing…", then the text
      appears at the end of the input. Nothing is sent.
- [ ] **Append**: with text already in the input, dictate. The
      transcript lands after it with a space in between.
- [ ] **Esc**: press Esc mid-recording. The take is discarded, no
      transcription runs, the input is untouched.
- [ ] **Auto-stop**: record for 60 seconds. It stops by itself and
      transcribes.
- [ ] **Denied**: deny Microphone access (or revoke it in Settings),
      press the mic. A notice with **Open Settings** appears; the
      button opens Privacy & Security > Microphone.
- [ ] **No speech**: record a few seconds of silence. "No speech
      detected" shows.
- [ ] **Network off**: disable the network, dictate. A connection
      notice shows. Re-enable after.
- [ ] **Non-blocking**: while transcribing, hotkeys and pointing
      still work; the chat never shows the thinking state for it.

## Image creation

- [ ] **Open**: click the Create image button in the chat header. A
      small always-on-top window opens with the SH-01 style.
- [ ] **Generate**: describe an image, press Generate. Progress shows;
      the image appears with Save and Copy prompt buttons.
- [ ] **Iterate**: with an image showing, prompt "make it blue". The
      new image edits the current one. **New image** starts over.
- [ ] **Edit mode**: after the first image, "Editing the latest image"
      shows above the composer, the placeholder asks what to change,
      and the button says **Apply changes**. **New image** restores
      Generate mode.
- [ ] **Change this image**: under the latest image, click it. The
      composer input focuses.
- [ ] **Regenerate**: with one image, click Regenerate under it. The
      same prompt generates a fresh image. After an edit, Regenerate
      repeats the edit from the previous image.
- [ ] **Improve + voice**: Improve with Muse rewrites the prompt with
      Undo; the mic dictates into it. Same behavior as the chat.
- [ ] **Enlarge**: click an image. It shows larger inside the window;
      click again to close.
- [ ] **Save**: click Save. A native dialog offers a PNG name; the
      file lands where chosen. Cancel saves nothing.
- [ ] **Copy prompt**: click it, paste elsewhere. The exact prompt
      pastes.
- [ ] **Failure**: disable the network, press Generate. A clear
      notice shows and the prompt stays for retry. Re-enable after.
- [ ] **Capture**: with the window open, fire the look-at-cursor
      hotkey. The window hides for the capture and returns after.
- [ ] **Limit**: at 20 images, Generate is blocked with a notice
      until New image.
- [ ] **Advisor**: ask the chat for an image. It points to the Create
      image button instead of an external tool.

## Discovery dialogue

- [ ] **Simple question**: ask "where is the export button?". Direct reply,
      no questions. A marker appears only if pointing helps.
- [ ] **Clarify**: ask to build something vague ("make a character"). At most
      3 questions appear with tappable option chips.
- [ ] **Chip answer**: with several questions, tapping chips only selects
      them (highlighted); **Send answers (n/m)** stays disabled until every
      question has one. It sends ONE multi-line message, one round total.
- [ ] **Single question**: with one question, tapping a chip sends
      immediately, no button.
- [ ] **Toggle**: tapping another option replaces the pick; tapping the
      picked one clears it.
- [ ] **Free text**: type with picks selected. The picks are prepended to
      the same message; free text sends even with questions unanswered.
- [ ] **Picks reset**: switch to another chat and back, or get new
      questions. Old picks are gone.
- [ ] **No app ask**: during clarify/confirm, no "open the app" request
      appears; it only comes when the plan is due.
- [ ] **Brief survives ready**: confirm, then get "open the app". After
      "I'm ready" the plan arrives directly without re-confirming.
- [ ] **No double card**: while waiting for the app, only the "I'm ready"
      card shows — the confirm card is hidden until the plan arrives.
- [ ] **Confirm**: the brief card shows 3-6 bullets with "Yes, make the
      plan" and "Change something".
- [ ] **Yes**: click "Yes, make the plan". The plan arrives and follows the
      brief; the card disappears.
- [ ] **Change something**: click it. The input focuses; type a change and
      send; the advisor adjusts (new brief or plan).
- [ ] **Skip**: click "Skip questions" during clarify or confirm. A plan
      arrives immediately with stated defaults.
- [ ] **Brief persists**: restart the app mid-plan and reopen the chat. The
      plan still verifies against the brief (no error, no re-ask).
- [ ] **Old history**: open a chat saved before this feature. No discovery
      card appears; the chat works as before.
- [ ] **Describe it yourself**: in a clarify card, click it next to Skip.
      A text field opens; type, pick a chip, Send description. The
      message leads with "My own description:" plus the pick, and the
      advisor moves to confirm with a following brief.
- [ ] **Describe cancel**: Cancel closes the field without sending.
- [ ] **Plan hidden**: with a plan, trigger clarify. The plan list and
      its buttons hide in the chat; the HUD asks to answer in the chat.
      Steer discovery to a plain answer (no new plan): the old plan
      returns in both.

## Research mode

- [ ] **Automatic**: ask about an unfamiliar app. "Researching \<app\>…"
      appears, then Sources links and a plan using the research.
- [ ] **Asked**: say "check the documentation for …". Research runs;
      there is no manual button anymore.
- [ ] **Quiet otherwise**: with a known app and stored research, only
      the Sources links show; with no research at all, no strip shows.

## HUD step window

- [ ] **Toggle**: Cmd+Option+P opens the HUD; again closes it. The chat
      header remote button toggles too and stays highlighted while open.
- [ ] **First click**: with another app focused, click a HUD button. It
      works on the first click without stealing focus.
- [ ] **Content**: header shows the robot, "Step N of M" and the goal;
      progress segments track done/current/upcoming; current step shows
      the full instruction plus action details; "Next: …" previews ahead.
- [ ] **Long step**: a long step text is fully visible (scrolls inside
      only past ~240 px); header and buttons stay visible.
- [ ] **Grows/shrinks**: Next through steps of different lengths. The
      window grows and shrinks to fit, never taller than ~420 px.
- [ ] **Buttons**: Show me, Next (verifies), Back, Wrong spot all mirror
      the chat/bubble state.
- [ ] **Continue**: on the last step Next becomes Continue; it appends
      steps like the chat button.
- [ ] **✕**: closes the HUD; the header button highlight clears.
- [ ] **Drag + restore**: drag the HUD elsewhere, restart the app, reopen:
      position restored.
- [ ] **Captures**: with the HUD open, Show me / look-at-cursor. The HUD
      is absent from captures and reappears after.
- [ ] **Auto-hide**: Show me a step whose target is under the HUD: the HUD
      hides while the marker shows, returns on Next/Done.
- [ ] **Pause**: click Pause. Robot, marker and bubble hide; pointing
      stops. Resume re-shows the current step.
- [ ] **No plan**: with no plan, the HUD says to open the chat; the button
      expands and focuses the chat.
- [ ] **Open chat restores minimized**: with no plan, minimize the chat,
      open the HUD (Cmd+Option+P), click the open-chat button. The chat
      restores and focuses.
- [ ] **Coexist**: HUD stays usable with the chat expanded and collapsed.

## Shortcuts help

- [ ] **First launch**: with a fresh profile (clear `sh01-shortcuts-seen`
      from localStorage), the panel opens automatically once. Relaunch:
      it stays closed.
- [ ] **? button**: the header button (next to the step remote) opens the
      panel and stays highlighted while it is open. Clicking it again
      closes the panel.
- [ ] **Content**: robot icon, "Welcome to SH-01", four "Anywhere on your
      Mac" rows matching the real hotkeys (try each one), three "In the
      chat" rows; one key cap per key, descriptions in one column.
- [ ] **Close**: "Got it", ✕ and Esc all close; focus returns to the chat
      input. Esc closes only the panel (no other side effect).
- [ ] **Small window**: shrink the chat; the panel scrolls inside it and
      "Got it" stays reachable.

## Bubble lifetime

- [ ] **Step persists**: Show me a step, wait 60 s idle. Bubble, ring and
      robot are all still there.
- [ ] **Recovery persists**: trigger a recovery bubble, wait. It stays
      until Show me is clicked.
- [ ] **Not-done persists**: trigger "isn't done yet", wait. It stays
      until Show me again / It's done.
- [ ] **✕**: click ✕ on any bubble. Marker, ring and robot vanish; an
      auto-collapsed chat / auto-hidden HUD returns.
- [ ] **Short query**: free query with a few words. Bubble lasts ~12 s.
- [ ] **Long answer**: look-at-cursor with a long answer. Bubble lasts
      longer (0.5 s/word) but never more than ~30 s.
- [ ] **Hover pause**: park the cursor over a free-query bubble. It never
      dismisses while hovered; the remaining time restarts on leave.
- [ ] **Co-lifetime**: when a free-query bubble times out, its ring and
      robot vanish at the same moment.
