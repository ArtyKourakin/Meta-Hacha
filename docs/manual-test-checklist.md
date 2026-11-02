# Overlay manual test checklist

Click through these after every overlay change (layout, bubbles, islands, robot).

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
- [ ] **Coexist**: HUD stays usable with the chat expanded and collapsed.

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
