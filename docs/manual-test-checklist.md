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
- [ ] After the marker fades (6 s), clicks everywhere reach the app below.

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
