# Excalidraw Room CLI

JSON-first CLI для shared-room Excalidraw.

## Установка

Требования:
- `bun`
- `node` для export runner
- `Google Chrome` или `Chromium`

Основной путь сейчас: установка прямо с GitHub.

Через `bun`:

```bash
bun add -g github:toolittlecakes/excalidraw-room-cli
```

Через `npm`:

```bash
npm install -g git+https://github.com/toolittlecakes/excalidraw-room-cli.git
```

Потом:

```bash
excalidraw-room help
excalidraw-room setup --all-agents
```

Если позже пакет будет опубликован в npm, тогда install станет ещё проще:

```bash
bun add -g excalidraw-room-cli
npm install -g excalidraw-room-cli
```

## Публикация в npm через GitHub Actions

В репозитории уже есть workflow:
- [.github/workflows/publish.yml](/Users/sne/ai_assistant/excalidraw-room-cli/.github/workflows/publish.yml:1)

Он рассчитан на npm trusted publishing через OIDC, без `NPM_TOKEN`.

Что нужно один раз сделать на стороне npm:
- открыть [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- добавить trusted publisher для GitHub Actions
- repository: `toolittlecakes/excalidraw-room-cli`
- workflow file: `.github/workflows/publish.yml`
- environment: не нужен

После этого публикация идёт автоматически по git tag вида `v*`.

Пример релиза:

```bash
cd /Users/sne/ai_assistant/excalidraw-room-cli
npm version patch
git push origin main --tags
```

Или вручную:

```bash
git tag v0.1.1
git push origin main --tags
```

Workflow `Publish to npm` сработает автоматически на push такого тега.

Для локальной разработки и ручного линка:

```bash
cd /Users/sne/ai_assistant/excalidraw-room-cli
bun install
bun link
```

После этого команда будет доступна как:

```bash
excalidraw-room help
```

Чтобы установить discovery skill локально для агентных тулов:

```bash
excalidraw-room setup --all-agents
```

Это положит stub `SKILL.md` в стандартные директории:
- `~/.codex/skills/excalidraw-room`
- `~/.claude/skills/excalidraw-room`
- `~/.cursor/skills/excalidraw-room`
- `~/.agents/skills/excalidraw-room`

Если Chrome лежит не в стандартном месте, укажи путь:

```bash
export EXCALIDRAW_ROOM_CHROME_BIN='/path/to/chrome'
```

Основная идея:
- агент читает комнату через `status` / `dump` / `snapshot`
- агент пишет изменения через один JSON payload в `apply-json`
- JSON можно передавать файлом или через `stdin` / heredoc
- PNG/SVG экспортируется через `export-image`

## Основные команды

```bash
excalidraw-room help
excalidraw-room version
excalidraw-room skill
excalidraw-room setup --all-agents
excalidraw-room skills list
excalidraw-room skills get core
excalidraw-room status 'https://excalidraw.com/#room=...,...'
excalidraw-room dump 'https://excalidraw.com/#room=...,...'
excalidraw-room snapshot 'https://excalidraw.com/#room=...,...'
excalidraw-room apply-json 'https://excalidraw.com/#room=...,...' spec.json
excalidraw-room apply-json 'https://excalidraw.com/#room=...,...' <<'JSON'
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
JSON

excalidraw-room export-image 'https://excalidraw.com/#room=...,...' /tmp/room.png
```

## `version`

```bash
excalidraw-room version
```

Проверяет установленную версию против `latest` в npm registry. Если вышла новая версия, CLI печатает команды обновления:

```bash
npm install -g excalidraw-room-cli@latest
bun add -g github:toolittlecakes/excalidraw-room-cli
```

## `apply-json`

Главная команда записи:

```bash
excalidraw-room apply-json <roomUrl> [spec.json|-]
```

Поддерживает три режима ввода:
- `apply-json <roomUrl> spec.json`
- `apply-json <roomUrl> -`
- `apply-json <roomUrl>` и дальше JSON через `stdin`

## `skill`

```bash
excalidraw-room skill
```

Короткий встроенный agent-facing контракт:
- какой workflow считать правильным
- как писать через heredoc
- почему по умолчанию надо использовать `append`
- как правильно читать и патчить room через JSON
- как заметить, что вышла новая версия CLI

Перед основным текстом `skill` печатает update notice, если в npm доступна более новая версия. Агент должен сообщить об этом пользователю и не обновлять глобальный CLI без явного разрешения.

## `setup`

Основной install-flow для агентов:

```bash
excalidraw-room setup --all-agents
```

Или точечно:

```bash
excalidraw-room setup --claude
excalidraw-room setup --codex
excalidraw-room setup --cursor
excalidraw-room setup --universal
```

Это устанавливает discovery stub в skill-директории выбранных агентов.

## `skills`

По паттерну `agent-browser`, discovery stub и основной skill разделены:

```bash
excalidraw-room skills list
excalidraw-room skills get core
```

- `skills/excalidraw-room/SKILL.md` это тонкий discovery stub
- `skill-data/core/SKILL.md` это основной agent-facing workflow
- `skill` это удобный alias к `skills get core`

### Формат 1: массив операций

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

### Формат 2: объект с `mode` и `ops`

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
    },
    {
      "type": "addRect",
      "x": 420,
      "y": 80,
      "width": 260,
      "height": 140,
      "backgroundColor": "#c3fae8",
      "label": "Room\nwriter"
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
```

### Формат 3: raw elements

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

## Поддерживаемые операции

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

По координатам:

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

По элементам:

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

или

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

## Экспорт

```bash
excalidraw-room export-image '<roomUrl>' /tmp/room.png
excalidraw-room export-image '<roomUrl>' /tmp/room.svg
excalidraw-room export-image '<roomUrl>' /tmp/crop.png --crop 80,360,1900,980
excalidraw-room export-image '<roomUrl>' /tmp/one.png --crop-element <id> --padding 40
excalidraw-room export-image '<roomUrl>' /tmp/group.png --crop-elements <id1,id2,id3> --padding 60
```

Заметки:
- это не page screenshot, а offscreen export из scene JSON через `@excalidraw/excalidraw`
- все crop-координаты в координатах сцены Excalidraw

## Служебные команды

- `status`
- `dump`
- `watch`
- `snapshot`
- `restore`
- `send-file`

`apply-spec` пока оставлен как совместимый alias к `apply-json`, но основной интерфейс теперь именно `apply-json`.

Служебные файлы CLI хранит в:
- snapshots: `~/.excalidraw-room-cli/snapshots`
- export bundle cache: `~/.excalidraw-room-cli/cache`
