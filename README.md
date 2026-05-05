# Excalidraw Room CLI

`excalidraw-room` is a JSON-first CLI for reading, editing, and exporting shared Excalidraw rooms.

It is useful when you want a script or an AI agent to make precise changes to a live Excalidraw room without clicking around in the browser UI.

## Requirements

- Bun 1.1+
- Node.js, used by the export runner
- Google Chrome or Chromium for PNG/SVG export

If Chrome is not in a standard location, set:

```bash
export EXCALIDRAW_ROOM_CHROME_BIN="/path/to/chrome"
```

## Install

From npm:

```bash
npm install -g excalidraw-room-cli@latest
```

From GitHub with Bun:

```bash
bun add -g github:toolittlecakes/excalidraw-room-cli
```

Check the install:

```bash
excalidraw-room help
excalidraw-room version
```

## Quick Start

Use an Excalidraw shared room URL:

```bash
ROOM_URL="https://excalidraw.com/#room=...,..."
```

Inspect the room:

```bash
excalidraw-room status "$ROOM_URL"
excalidraw-room dump "$ROOM_URL" room.json
```

Add elements:

```bash
excalidraw-room apply-json "$ROOM_URL" <<'JSON'
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

Export the room:

```bash
excalidraw-room export-image "$ROOM_URL" room.png
excalidraw-room export-image "$ROOM_URL" room.svg
```

## Commands

```bash
excalidraw-room help
excalidraw-room version
excalidraw-room status <roomUrl>
excalidraw-room dump <roomUrl> [out.json]
excalidraw-room watch <roomUrl>
excalidraw-room snapshot <roomUrl> [out.json]
excalidraw-room restore <roomUrl> <snapshot.json>
excalidraw-room apply-json <roomUrl> [spec.json|-]
excalidraw-room send-file <roomUrl> <elements.json> [--mode append|replace]
excalidraw-room export-image <roomUrl> <out.png|out.svg> [options]
```

Agent integration commands:

```bash
excalidraw-room skill
excalidraw-room skills list
excalidraw-room skills get core
excalidraw-room setup --all-agents
```

## Version Check

```bash
excalidraw-room version
```

Prints the installed package version, checks the latest version in npm, and shows update commands when a newer version is available.

## Apply JSON

`apply-json` is the main write command:

```bash
excalidraw-room apply-json <roomUrl> [spec.json|-]
```

Input can come from:

- a file: `apply-json <roomUrl> spec.json`
- stdin: `apply-json <roomUrl> -`
- stdin without `-`: `apply-json <roomUrl>`

### Format 1: Operation Array

```json
[
  {
    "type": "addRect",
    "x": 80,
    "y": 80,
    "width": 260,
    "height": 140,
    "backgroundColor": "#dbe4ff",
    "label": "Planner\nstep"
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

### Format 2: Mode and Operations

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
      "label": "Planner\nstep"
    }
  ]
}
```

Supported modes:

- `append`: add new elements without removing existing elements
- `replace`: replace the scene
- `patch`: update existing elements by id

### Format 3: Raw Elements

```json
{
  "mode": "replace",
  "elements": [
    {
      "id": "custom-id",
      "type": "rectangle"
    }
  ]
}
```

## Operations

### `addRect`

```json
{
  "type": "addRect",
  "x": 80,
  "y": 80,
  "width": 260,
  "height": 140,
  "backgroundColor": "#dbe4ff",
  "strokeColor": "#1e1e1e",
  "label": "Agent\nentrypoint",
  "labelFontSize": 24,
  "labelColor": "#1e1e1e"
}
```

### `addText`

```json
{
  "type": "addText",
  "x": 220,
  "y": 240,
  "text": "Free note",
  "fontSize": 24,
  "strokeColor": "#1e1e1e",
  "textAlign": "center"
}
```

### `addArrow`

By coordinates:

```json
{
  "type": "addArrow",
  "x1": 340,
  "y1": 150,
  "x2": 420,
  "y2": 150,
  "strokeColor": "#1e1e1e"
}
```

Between existing elements:

```json
{
  "type": "addArrow",
  "fromId": "left-card-id",
  "toId": "right-card-id",
  "strokeColor": "#1e1e1e"
}
```

### `move`

```json
{
  "type": "move",
  "id": "element-id",
  "dx": 40,
  "dy": 20
}
```

or:

```json
{
  "type": "move",
  "id": "element-id",
  "x": 600,
  "y": 320
}
```

### `delete`

```json
{
  "type": "delete",
  "ids": ["id-1", "id-2", "id-3"]
}
```

## Export

```bash
excalidraw-room export-image "$ROOM_URL" room.png
excalidraw-room export-image "$ROOM_URL" room.svg
excalidraw-room export-image "$ROOM_URL" crop.png --crop 80,360,1900,980
excalidraw-room export-image "$ROOM_URL" one.png --crop-element <id> --padding 40
excalidraw-room export-image "$ROOM_URL" group.png --crop-elements <id1,id2,id3> --padding 60
```

Export uses Excalidraw scene JSON and `@excalidraw/excalidraw`. It is not a browser screenshot.

Crop coordinates use Excalidraw scene coordinates.

## Agent Setup

Install the local discovery skill for supported agents:

```bash
excalidraw-room setup --all-agents
```

Or install it for one target:

```bash
excalidraw-room setup --claude
excalidraw-room setup --codex
excalidraw-room setup --cursor
excalidraw-room setup --universal
```

This writes a small discovery `SKILL.md` into standard local skill directories. The full agent workflow is available through:

```bash
excalidraw-room skill
```

## Local Files

The CLI stores runtime files under:

- snapshots: `~/.excalidraw-room-cli/snapshots`
- export cache: `~/.excalidraw-room-cli/cache`

## Compatibility

`apply-spec` is still accepted as a compatibility alias for `apply-json`. Prefer `apply-json` for new usage.
