---
name: gt-worktree-setup-runs-sync-not-render
kind: gotcha
description: The .gt.yaml setup template runs `agtk sync` on every clone and `gt wt add`, so a new worktree can relock the ref:main stacks over the network.
anchors:
  - path: .gt.yaml
    blob: a2a023011bad
  - path: .agentic-toolkit.lock.yaml
    blob: 307c97fc2da2
confidence: verified
---

The `agentic-toolkit` setup template in `.gt.yaml` bootstraps `.claude/` and `CLAUDE.md` for each
new checkout. It calls `agtk sync` on both branches: the worktree phase (`.gt.yaml:9-10`) and the
clone phase (`.gt.yaml:12-13`, with `--config` pointing at the default branch). It never calls
`agtk render`.

The rendered `CLAUDE.md` (section "Keeping ignored output fresh") recommends `render` for
automatic, unattended triggers. The reason given is that `sync` relocks whenever the lockfile
looks stale, which resolves mutable refs over the network. Both stacks here are pinned to
`ref: main` (`.agentic-toolkit.lock.yaml:4,7`). So each `gt wt add` can:

- render whatever the stacks' `main` currently is, not what the lockfile pins;
- rewrite `.agentic-toolkit.lock.yaml`, leaving an unexpected diff in the new worktree.

If sibling worktrees render different `.claude/` content, or a lockfile diff appears that nobody
made, check this template before assuming someone edited the file by hand.
