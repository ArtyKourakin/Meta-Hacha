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
