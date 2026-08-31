# Memories

Agents that keep long-term memory write it to files: a note about how you like your code reviewed, a
gotcha in your CI, a fact about your stack. That happens quietly in the middle of a turn, and until
now the only trace was one more file-write row scrolling past in the work log.

The **Memories** surface in the right panel collects them. Open it from the right panel's surface
launcher, from the **+** menu in the tab bar, or by pressing <kbd>M</kbd> while the launcher is
showing.

## What it shows

Every memory file the agent wrote during the current thread, newest first:

- The file name, with its full path underneath when you expand a row
- Whether it is a single memory, the index the agent keeps beside its entries, or an
  agent-instructions file
- When it was saved, and how many times the thread wrote it
- The file's current contents, read on demand when you expand the row

Repeated writes to the same file collapse into one row. An agent that updates its index after every
save produces one index row that says "4 writes", not four identical rows.

The list is scoped to one thread and covers that thread's whole history, so reopening an old thread
still shows what it saved.

## The badge

While the right panel is closed or showing another surface, its toggle carries a count of everything
waiting inside: subagents currently working plus memory files this thread has saved. Hovering the
toggle spells out what the number is made of. Opening the Memories surface clears the memory part of
the count.

## What counts as a memory

T3 Code recognizes a memory by where the file lands, which keeps this working across providers
rather than for one of them:

- Any file written inside a `memory/` or `memories/` directory, wherever that directory lives. This
  covers relocated memory stores and remote environments with a different home directory.
- `AGENTS.md`, `CLAUDE.md`, and `.cursorrules` anywhere, since those hold durable knowledge too.
- Files under `.cursor/rules/`, which is Cursor's equivalent of a single instructions file.

Files that failed to write, or that you declined, are not listed.

### One provider exception

Codex can consolidate memory in a hidden background thread of its own. T3 Code deliberately keeps
that background activity out of your conversation, so those writes produce nothing for this surface
to show. Memories Codex writes as part of the visible conversation — editing `AGENTS.md`, or a file
in a memory directory — appear normally.

## Reading contents

Expanding a row reads the file fresh from the environment that ran the thread, so you see what is on
disk now rather than what was written at the time. If the file has since been moved or deleted, the
row says so instead of showing stale text.

Contents need a live connection to that environment. Rows still list without one; only the previews
are unavailable.

## Limits

This surface is read-only. It reports what an agent saved — it does not edit or delete memories, and
it does not let you add one by hand. Ask the agent to change its memory, or edit the file through the
**Files** surface.

Memories are a web and desktop surface. The mobile app does not have the right panel.
