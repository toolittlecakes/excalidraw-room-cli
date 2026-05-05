---
name: core
description: Core excalidraw-room usage guide. Read this before running excalidraw-room commands. Covers the JSON-first workflow for reading a shared room, applying append or replace patches via heredoc or file input, restoring snapshots, sending raw elements, and exporting PNG or SVG from scene JSON.
allowed-tools: Bash(excalidraw-room:*), Bash(npx excalidraw-room-cli:*), Bash(bunx excalidraw-room-cli:*)
---

# excalidraw-room core

JSON-first CLI for shared Excalidraw rooms.

Use this tool when the user wants to inspect or modify a shared Excalidraw room through its room URL, not by driving the browser UI manually.

## The core loop

```bash
excalidraw-room version                     # 0. check installed vs latest version
excalidraw-room status '<roomUrl>'          # 1. inspect current state
excalidraw-room dump '<roomUrl>'            # 2. read full scene if ids/layout matter
excalidraw-room apply-json '<roomUrl>'      # 3. apply one JSON payload via stdin
excalidraw-room export-image '<roomUrl>' /tmp/room.png   # 4. verify visually when needed
```

Prefer one `apply-json` payload per logical change.

If `excalidraw-room skill` prints an update notice, tell the user a newer CLI exists before relying on version-sensitive behavior. Do not update the global CLI without explicit user approval.

## Write path

Use `apply-json` as the main mutation path:

```bash
excalidraw-room apply-json '<roomUrl>' [spec.json|-]
```

Accepted inputs:

- file path: `apply-json <roomUrl> spec.json`
- stdin: `apply-json <roomUrl>`
- explicit stdin: `apply-json <roomUrl> -`

Default to `"mode": "append"`.

Use `"mode": "replace"` only when the task explicitly requires rebuilding the scene.

## JSON formats

### Array of operations

```json
[
  {
    "type": "addRect",
    "x": 80,
    "y": 80,
    "width": 260,
    "height": 140,
    "backgroundColor": "#dbe4ff",
    "label": "Agent\nentrypoint"
  },
  {
    "type": "addArrow",
    "x1": 340,
    "y1": 150,
    "x2": 420,
    "y2": 150
  }
]
```

### Object with mode and ops

```json
{
  "mode": "append",
  "ops": [
    {
      "type": "addRect",
      "x": 80,
      "y": 80,
      "width": 260,
      "height": 140,
      "backgroundColor": "#dbe4ff",
      "label": "Agent\nentrypoint"
    }
  ]
}
```

### Raw elements payload

```json
{
  "mode": "append",
  "elements": [
    {
      "id": "custom-id",
      "type": "rectangle"
    }
  ]
}
```

## Supported ops

- `addRect`
- `addText`
- `addArrow`
- `move`
- `delete`

## Rules

- Read before writing when existing ids or layout matter.
- For multiline text in JSON, use `\n`, not `\\n`.
- For labeled boxes, prefer `addRect` with `label`.
- `replace` and `restore` create tombstones so open clients see deletions immediately.

## Examples

### Heredoc patch

```bash
excalidraw-room apply-json '<roomUrl>' <<'JSON'
{
  "mode": "append",
  "ops": [
    {
      "type": "addRect",
      "x": 80,
      "y": 80,
      "width": 260,
      "height": 140,
      "backgroundColor": "#dbe4ff",
      "label": "Agent\nentrypoint"
    },
    {
      "type": "addArrow",
      "x1": 340,
      "y1": 150,
      "x2": 420,
      "y2": 150
    }
  ]
}
JSON
```

### Snapshot and restore

```bash
excalidraw-room snapshot '<roomUrl>'
excalidraw-room restore '<roomUrl>' ~/.excalidraw-room-cli/snapshots/example.json
```

### Export

```bash
excalidraw-room export-image '<roomUrl>' /tmp/room.png
excalidraw-room export-image '<roomUrl>' /tmp/crop.png --crop 80,360,1900,980
excalidraw-room export-image '<roomUrl>' /tmp/one.png --crop-element <id> --padding 40
```

## Skill commands

```bash
excalidraw-room version
excalidraw-room skills list
excalidraw-room skills get core
excalidraw-room setup --all-agents
```

`setup` writes the discovery stub into standard local skill directories so agent tooling can discover this CLI as a skill.

`version` checks the installed package version against npm latest and prints update commands when a newer version is available.
