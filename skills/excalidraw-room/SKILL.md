---
name: excalidraw-room
description: JSON-first CLI for shared Excalidraw rooms. Use when the user wants to inspect, patch, snapshot, restore, or export a shared Excalidraw room through a room URL instead of editing manually in the browser UI.
allowed-tools: Bash(excalidraw-room:*), Bash(npx -y git+https://github.com/toolittlecakes/excalidraw-room-cli.git:*), Bash(bunx github:toolittlecakes/excalidraw-room-cli:*)
hidden: true
---

# excalidraw-room

Fast shared Excalidraw room CLI for AI agents.

Install:

```bash
bun add -g github:toolittlecakes/excalidraw-room-cli
```

or

```bash
npm install -g git+https://github.com/toolittlecakes/excalidraw-room-cli.git
```

This file is a discovery stub, not the usage guide.

Before running any `excalidraw-room` command, load the actual workflow content from the installed CLI:

```bash
excalidraw-room skill
```

The CLI serves skill content that matches the installed version, so instructions stay in sync with the binary.

If the global CLI is not installed, use the fallback:

```bash
npx -y git+https://github.com/toolittlecakes/excalidraw-room-cli.git skill
```

You can list packaged skills with:

```bash
excalidraw-room skills list
```
