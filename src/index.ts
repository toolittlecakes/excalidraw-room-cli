import { generateKeyBetween } from "fractional-indexing";
import { io, Socket } from "socket.io-client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type RoomRef = {
  roomId: string;
  roomKey: string;
};

type FirestoreDoc = {
  fields?: {
    sceneVersion?: { integerValue?: string };
    ciphertext?: { bytesValue?: string };
    iv?: { bytesValue?: string };
  };
};

type BoundElementRef = {
  id: string;
  type: string;
};

type Binding = {
  elementId: string;
  fixedPoint: [number, number];
  mode: "inside" | "orbit";
};

type ExcalidrawElement = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: string | null;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: BoundElementRef[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  index?: string | null;
  [key: string]: unknown;
};

type ExcalidrawTextElement = ExcalidrawElement & {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  containerId: string | null;
  originalText: string;
  autoResize: boolean;
  lineHeight: number;
};

type ExcalidrawArrowElement = ExcalidrawElement & {
  type: "arrow";
  points: [number, number][];
  startBinding: Binding | null;
  endBinding: Binding | null;
  startArrowhead: string | null;
  endArrowhead: string | null;
  elbowed: boolean;
};

type SocketUpdate =
  | { type: "SCENE_INIT"; payload: { elements: ExcalidrawElement[] } }
  | { type: "SCENE_UPDATE"; payload: { elements: ExcalidrawElement[] } }
  | { type: "INVALID_RESPONSE" }
  | { type: string; payload?: unknown };

type SceneChange = {
  next: ExcalidrawElement[];
  changed: ExcalidrawElement[];
  summary: string;
};

type AnchorPoint = {
  x: number;
  y: number;
  binding: Binding | null;
  boundToId: string | null;
};

type CropArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ElementBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type AddRectSpec = {
  type: "addRect";
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  strokeColor?: string;
  label?: string;
  labelFontSize?: number;
  labelColor?: string;
};

type AddTextSpec = {
  type: "addText";
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  strokeColor?: string;
  textAlign?: "left" | "center" | "right";
};

type AddArrowSpec = {
  type: "addArrow";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  fromId?: string;
  toId?: string;
  strokeColor?: string;
  endArrowhead?: string | null;
};

type DeleteSpec = {
  type: "delete";
  ids: string[];
};

type MoveSpec = {
  type: "move";
  id: string;
  dx?: number;
  dy?: number;
  x?: number;
  y?: number;
};

type AgentSpec =
  | AddRectSpec
  | AddTextSpec
  | AddArrowSpec
  | DeleteSpec
  | MoveSpec;

const FIREBASE_API_KEY = "AIzaSyAd15pYlMci_xIp9ko6wkEsDzAAA0Dn0RU";
const FIREBASE_PROJECT_ID = "excalidraw-room-persistence";
const WS_SERVER_URL = "https://oss-collab.excalidraw.com";
const DEFAULT_FONT_FAMILY = 1;
const DEFAULT_LINE_HEIGHT = 1.25;
const CLI_BIN_NAME = "excalidraw-room";
const CLI_PACKAGE_NAME = "excalidraw-room-cli";
const PACKAGE_ROOT = path.resolve(import.meta.dir, "..");
const APP_HOME = path.join(os.homedir(), ".excalidraw-room-cli");
const CACHE_DIR = path.join(APP_HOME, "cache");
const SNAPSHOTS_DIR = path.join(APP_HOME, "snapshots");
const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");
const SKILL_DATA_DIR = path.join(PACKAGE_ROOT, "skill-data");
const DISCOVERY_SKILL_NAME = "excalidraw-room";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function helpText(): string {
  return `Excalidraw Room CLI

JSON-first CLI for shared Excalidraw rooms.

Main commands:
  ${CLI_BIN_NAME} help
  ${CLI_BIN_NAME} skill
  ${CLI_BIN_NAME} setup [--claude|--codex|--cursor|--universal|--all-agents]
  ${CLI_BIN_NAME} status <roomUrl>
  ${CLI_BIN_NAME} dump <roomUrl> [out.json]
  ${CLI_BIN_NAME} watch <roomUrl>
  ${CLI_BIN_NAME} snapshot <roomUrl> [out.json]
  ${CLI_BIN_NAME} restore <roomUrl> <snapshot.json>
  ${CLI_BIN_NAME} apply-json <roomUrl> [spec.json|-]
  ${CLI_BIN_NAME} send-file <roomUrl> <elements.json> [--mode append|replace]
  ${CLI_BIN_NAME} export-image <roomUrl> <out.png|out.svg> [--format png|svg] [--crop <x,y,w,h> | --crop-element <id> | --crop-elements <id1,id2,...>] [--padding <n>]

Recommended flow:
  1. Read current state with status / dump / snapshot
  2. Apply JSON operations with apply-json
  3. Export PNG/SVG with export-image

apply-json input:
  - file path: apply-json <roomUrl> spec.json
  - stdin:     apply-json <roomUrl>
  - stdin:     apply-json <roomUrl> -

Spec formats:
  1. Array of operations:
     [ { "type": "addRect", ... }, { "type": "addArrow", ... } ]
  2. Object with mode + ops:
     { "mode": "append|replace|patch", "ops": [ ... ] }
  3. Raw elements payload:
     { "mode": "append|replace", "elements": [ ... ] }

Supported operations:
  addRect  { x, y, width, height, backgroundColor?, strokeColor?, label?, labelFontSize?, labelColor? }
  addText  { x, y, text, fontSize?, strokeColor?, textAlign? }
  addArrow { x1,y1,x2,y2 | fromId,toId, strokeColor?, endArrowhead? }
  move     { id, dx?, dy?, x?, y? }
  delete   { ids: [...] }

Agent heredoc example:
  ${CLI_BIN_NAME} apply-json '<roomUrl>' <<'JSON'
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
        "label": "Agent\\nentrypoint"
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

Notes:
  - replace and restore create tombstones so open clients see deletions immediately
  - export-image renders from scene JSON, not from a page screenshot
  - crop coordinates are Excalidraw scene coordinates`;
}

function usage(exitCode = 1): never {
  const output = helpText();
  if (exitCode === 0) {
    console.log(output);
  } else {
    console.error(output);
  }
  process.exit(exitCode);
}

async function readPackagedText(relativePath: string): Promise<string> {
  return await fs.readFile(path.join(PACKAGE_ROOT, relativePath), "utf8");
}

function parseOptionalStringFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    throw new Error(`Missing ${flag}`);
  }
  return args[index + 1];
}

function defaultSkillInstallDirs(): string[] {
  return [
    skillInstallDirForAgent("codex"),
    skillInstallDirForAgent("claude"),
    skillInstallDirForAgent("universal"),
  ];
}

function skillInstallDirForAgent(agent: "codex" | "claude" | "cursor" | "universal"): string {
  const home = os.homedir();
  switch (agent) {
    case "codex":
      return path.join(home, ".codex", "skills", DISCOVERY_SKILL_NAME);
    case "claude":
      return path.join(home, ".claude", "skills", DISCOVERY_SKILL_NAME);
    case "cursor":
      return path.join(home, ".cursor", "skills", DISCOVERY_SKILL_NAME);
    case "universal":
      return path.join(home, ".agents", "skills", DISCOVERY_SKILL_NAME);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function resolveSkillInstallTargets(args: string[]): string[] {
  const customTarget = parseOptionalStringFlag(args, "--target");
  if (customTarget) {
    return [customTarget];
  }

  if (args.includes("--all-agents")) {
    return unique([
      skillInstallDirForAgent("codex"),
      skillInstallDirForAgent("claude"),
      skillInstallDirForAgent("cursor"),
      skillInstallDirForAgent("universal"),
    ]);
  }

  const selected: string[] = [];
  if (args.includes("--codex")) {
    selected.push(skillInstallDirForAgent("codex"));
  }
  if (args.includes("--claude")) {
    selected.push(skillInstallDirForAgent("claude"));
  }
  if (args.includes("--cursor")) {
    selected.push(skillInstallDirForAgent("cursor"));
  }
  if (args.includes("--universal")) {
    selected.push(skillInstallDirForAgent("universal"));
  }

  return selected.length > 0 ? unique(selected) : defaultSkillInstallDirs();
}

function parseRoomUrl(roomUrl: string): RoomRef {
  const hash = new URL(roomUrl).hash;
  const match = hash.match(/^#room=([a-zA-Z0-9_-]+),([a-zA-Z0-9_-]+)$/);
  if (!match) {
    throw new Error("Invalid room URL");
  }
  return { roomId: match[1], roomKey: match[2] };
}

function bytesFromBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function bytesToBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

async function importAesKey(roomKey: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      alg: "A128GCM",
      ext: true,
      k: roomKey,
      key_ops: ["encrypt", "decrypt"],
      kty: "oct",
    },
    {
      name: "AES-GCM",
      length: 128,
    },
    false,
    [usage],
  );
}

async function encryptJson(roomKey: string, value: unknown): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const key = await importAesKey(roomKey, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    ciphertext: new Uint8Array(encrypted),
    iv,
  };
}

async function decryptBytes(roomKey: string, iv: Uint8Array, ciphertext: Uint8Array): Promise<string> {
  const key = await importAesKey(roomKey, "decrypt");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return decoder.decode(new Uint8Array(decrypted));
}

async function readScene(room: RoomRef): Promise<ExcalidrawElement[]> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents/scenes/${room.roomId}?key=${FIREBASE_API_KEY}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Firestore read failed: ${response.status}`);
  }
  const doc = (await response.json()) as FirestoreDoc;
  const ciphertext = doc.fields?.ciphertext?.bytesValue;
  const iv = doc.fields?.iv?.bytesValue;
  if (!ciphertext || !iv) {
    return [];
  }
  const json = await decryptBytes(room.roomKey, bytesFromBase64(iv), bytesFromBase64(ciphertext));
  return JSON.parse(json) as ExcalidrawElement[];
}

function getSceneVersion(elements: ExcalidrawElement[]): number {
  return elements.reduce((sum, element) => sum + element.version, 0);
}

async function writeScene(room: RoomRef, elements: ExcalidrawElement[]): Promise<void> {
  const { ciphertext, iv } = await encryptJson(room.roomKey, elements);
  const url =
    `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents/scenes/${room.roomId}?key=${FIREBASE_API_KEY}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        sceneVersion: { integerValue: String(getSceneVersion(elements)) },
        ciphertext: { bytesValue: bytesToBase64(ciphertext) },
        iv: { bytesValue: bytesToBase64(iv) },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Firestore write failed: ${response.status} ${await response.text()}`);
  }
}

function randomId(): string {
  return Bun.randomUUIDv7();
}

function randomInt(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

function nextIndex(elements: ExcalidrawElement[]): string {
  const indexes = elements
    .map((element) => element.index)
    .filter((value): value is string => Boolean(value))
    .sort();
  const last = indexes.length > 0 ? indexes[indexes.length - 1] : null;
  return generateKeyBetween(last, null);
}

function now(): number {
  return Date.now();
}

function estimateTextWidth(text: string, fontSize: number): number {
  const longestLine = text.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
  return Math.max(8, Math.round(longestLine * fontSize * 0.58));
}

function estimateTextHeight(text: string, fontSize: number, lineHeight = DEFAULT_LINE_HEIGHT): number {
  const lines = Math.max(1, text.split("\n").length);
  return Math.round(lines * fontSize * lineHeight);
}

function createBaseElement(args: {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor?: string;
  backgroundColor?: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness?: number;
  opacity?: number;
  roundness?: { type: number } | null;
  index: string;
}): ExcalidrawElement {
  return {
    id: randomId(),
    type: args.type,
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    angle: 0,
    strokeColor: args.strokeColor ?? "#1e1e1e",
    backgroundColor: args.backgroundColor ?? "transparent",
    fillStyle: args.fillStyle ?? "solid",
    strokeWidth: args.strokeWidth ?? 2,
    strokeStyle: args.strokeStyle ?? "solid",
    roughness: args.roughness ?? 1,
    opacity: args.opacity ?? 100,
    groupIds: [],
    frameId: null,
    roundness: args.roundness ?? null,
    seed: randomInt(),
    version: 1,
    versionNonce: randomInt(),
    isDeleted: false,
    boundElements: null,
    updated: now(),
    link: null,
    locked: false,
    index: args.index,
  };
}

function createRectangle(args: {
  x: number;
  y: number;
  width: number;
  height: number;
  backgroundColor?: string;
  strokeColor?: string;
  index: string;
}): ExcalidrawElement {
  return createBaseElement({
    type: "rectangle",
    x: args.x,
    y: args.y,
    width: args.width,
    height: args.height,
    backgroundColor: args.backgroundColor ?? "#a5d8ff",
    strokeColor: args.strokeColor ?? "#1e1e1e",
    roundness: { type: 3 },
    index: args.index,
  });
}

function createText(args: {
  x: number;
  y: number;
  text: string;
  fontSize?: number;
  strokeColor?: string;
  textAlign?: "left" | "center" | "right";
  index: string;
}): ExcalidrawTextElement {
  const fontSize = args.fontSize ?? 20;
  const width = estimateTextWidth(args.text, fontSize);
  const height = estimateTextHeight(args.text, fontSize);
  const offsetX = args.textAlign === "center" ? width / 2 : args.textAlign === "right" ? width : 0;

  return {
    ...createBaseElement({
      type: "text",
      x: Math.round(args.x - offsetX),
      y: args.y,
      width,
      height,
      strokeColor: args.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
      strokeWidth: 1,
      roughness: 0,
      index: args.index,
    }),
    text: args.text,
    fontSize,
    fontFamily: DEFAULT_FONT_FAMILY,
    textAlign: args.textAlign ?? "left",
    verticalAlign: "top",
    containerId: null,
    originalText: args.text,
    autoResize: true,
    lineHeight: DEFAULT_LINE_HEIGHT,
  };
}

function getElementById(elements: ExcalidrawElement[], id: string): ExcalidrawElement {
  const element = elements.find((candidate) => candidate.id === id && !candidate.isDeleted);
  if (!element) {
    throw new Error(`Element not found: ${id}`);
  }
  return element;
}

function getElementCenter(element: ExcalidrawElement): { x: number; y: number } {
  return {
    x: element.x + element.width / 2,
    y: element.y + element.height / 2,
  };
}

function getAnchorForElement(element: ExcalidrawElement, side: "start" | "end"): AnchorPoint {
  const center = getElementCenter(element);
  const binding: Binding =
    side === "start"
      ? { elementId: element.id, fixedPoint: [1, 0.5], mode: "orbit" }
      : { elementId: element.id, fixedPoint: [0, 0.5], mode: "orbit" };

  return {
    x: side === "start" ? element.x + element.width : element.x,
    y: center.y,
    binding,
    boundToId: element.id,
  };
}

function createArrow(args: {
  start: AnchorPoint;
  end: AnchorPoint;
  strokeColor?: string;
  endArrowhead?: string | null;
  index: string;
}): ExcalidrawArrowElement {
  const x = args.start.x;
  const y = args.start.y;
  return {
    ...createBaseElement({
      type: "arrow",
      x,
      y,
      width: args.end.x - args.start.x,
      height: args.end.y - args.start.y,
      strokeColor: args.strokeColor ?? "#1e1e1e",
      backgroundColor: "transparent",
      index: args.index,
    }),
    points: [
      [0, 0],
      [args.end.x - args.start.x, args.end.y - args.start.y],
    ],
    startBinding: args.start.binding,
    endBinding: args.end.binding,
    startArrowhead: null,
    endArrowhead: args.endArrowhead ?? "arrow",
    elbowed: false,
  };
}

function touchElement<T extends ExcalidrawElement>(element: T, patch: Partial<T>): T {
  return {
    ...element,
    ...patch,
    version: element.version + 1,
    versionNonce: randomInt(),
    updated: now(),
  };
}

function appendBoundElement(target: ExcalidrawElement, ref: BoundElementRef): ExcalidrawElement {
  const boundElements = [...(target.boundElements ?? [])];
  if (!boundElements.some((item) => item.id === ref.id)) {
    boundElements.push(ref);
  }
  return touchElement(target, { boundElements });
}

async function joinRoomSocket(room: RoomRef): Promise<Socket> {
  const socket = io(WS_SERVER_URL, {
    transports: ["websocket"],
    forceNew: true,
    extraHeaders: {
      Origin: "https://excalidraw.com",
      "User-Agent": "Mozilla/5.0",
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Socket join timeout"));
    }, 10_000);

    socket.once("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    socket.on("init-room", () => {
      socket.emit("join-room", room.roomId);
    });

    const done = () => {
      clearTimeout(timeout);
      resolve();
    };

    socket.once("first-in-room", done);
    socket.once("room-user-change", () => done());
  });

  return socket;
}

async function encryptSocketPayload(roomKey: string, payload: SocketUpdate): Promise<{ encrypted: Uint8Array; iv: Uint8Array }> {
  const key = await importAesKey(roomKey, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { encrypted: new Uint8Array(encrypted), iv };
}

async function broadcastUpdate(room: RoomRef, changedElements: ExcalidrawElement[]): Promise<void> {
  const socket = await joinRoomSocket(room);
  try {
    const { encrypted, iv } = await encryptSocketPayload(room.roomKey, {
      type: "SCENE_UPDATE",
      payload: { elements: changedElements },
    });
    socket.emit("server-broadcast", room.roomId, encrypted.buffer, iv);
    await new Promise((resolve) => setTimeout(resolve, 300));
  } finally {
    socket.close();
  }
}

async function persistChange(room: RoomRef, change: SceneChange): Promise<void> {
  await writeScene(room, change.next);
  await broadcastUpdate(room, change.changed);
  console.log(change.summary);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function parseOptionalNumberFlag(args: string[], flag: string): number | null {
  const index = args.indexOf(flag);
  if (index === -1) {
    return null;
  }
  if (index === args.length - 1) {
    throw new Error(`Missing ${flag}`);
  }
  const value = Number(args[index + 1]);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid number for ${flag}`);
  }
  return value;
}

function parseRequiredStringFlag(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index === -1 || index === args.length - 1) {
    throw new Error(`Missing ${flag}`);
  }
  return args[index + 1];
}

function parseMode(args: string[]): "append" | "replace" {
  const index = args.indexOf("--mode");
  if (index === -1) {
    return "append";
  }
  const value = args[index + 1];
  if (value !== "append" && value !== "replace") {
    throw new Error("Mode must be append or replace");
  }
  return value;
}

async function readJsonInput(source: string | undefined): Promise<string> {
  if (!source || source === "-") {
    return await new Response(Bun.stdin.stream()).text();
  }
  return await Bun.file(source).text();
}

function normalizeElementsFile(value: unknown): ExcalidrawElement[] {
  if (Array.isArray(value)) {
    return value as ExcalidrawElement[];
  }
  if (value && typeof value === "object" && Array.isArray((value as { elements?: unknown }).elements)) {
    return (value as { elements: ExcalidrawElement[] }).elements;
  }
  throw new Error("Expected an elements array or an object with elements");
}

function summarizeScene(elements: ExcalidrawElement[]): string {
  const live = elements.filter((element) => !element.isDeleted);
  const byType = new Map<string, number>();
  for (const element of live) {
    byType.set(element.type, (byType.get(element.type) ?? 0) + 1);
  }
  const parts = [...byType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `${type}:${count}`);
  return `live=${live.length} deleted=${elements.length - live.length}${parts.length ? ` ${parts.join(" ")}` : ""}`;
}

function getLiveElements(elements: ExcalidrawElement[]): ExcalidrawElement[] {
  return elements.filter((element) => !element.isDeleted);
}

function getElementBounds(element: ExcalidrawElement): ElementBounds {
  const xs = [element.x, element.x + (element.width ?? 0)];
  const ys = [element.y, element.y + (element.height ?? 0)];

  if (Array.isArray((element as { points?: unknown }).points)) {
    for (const point of (element as { points: unknown[] }).points) {
      if (Array.isArray(point) && point.length >= 2) {
        xs.push(element.x + Number(point[0]));
        ys.push(element.y + Number(point[1]));
      }
    }
  }

  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function mergeBounds(boundsList: ElementBounds[]): ElementBounds {
  if (boundsList.length === 0) {
    throw new Error("Cannot merge empty bounds list");
  }
  return boundsList.reduce(
    (acc, bounds) => ({
      minX: Math.min(acc.minX, bounds.minX),
      minY: Math.min(acc.minY, bounds.minY),
      maxX: Math.max(acc.maxX, bounds.maxX),
      maxY: Math.max(acc.maxY, bounds.maxY),
    }),
    boundsList[0],
  );
}

function boundsToCropArea(bounds: ElementBounds, padding: number): CropArea {
  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  return await Bun.file(targetPath).exists();
}

async function resolveChromeExecutablePath(): Promise<string> {
  const fromEnv = process.env.EXCALIDRAW_ROOM_CHROME_BIN;
  if (fromEnv) {
    return fromEnv;
  }

  const commonPaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];

  for (const candidate of commonPaths) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Chrome/Chromium executable not found. Set EXCALIDRAW_ROOM_CHROME_BIN to your browser binary path.",
  );
}

function buildReplaceScene(current: ExcalidrawElement[], incoming: ExcalidrawElement[]): SceneChange {
  const incomingIds = new Set(incoming.map((element) => element.id));
  const tombstones = current
    .filter((element) => !incomingIds.has(element.id) && !element.isDeleted)
    .map((element) => touchElement(element, { isDeleted: true }));

  return {
    next: [...incoming, ...tombstones],
    changed: [...incoming, ...tombstones],
    summary: `Replaced scene with ${incoming.length} live element(s)`,
  };
}

function snapshotDefaultPath(room: RoomRef): string {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  return path.join(SNAPSHOTS_DIR, `${room.roomId}-${stamp}.json`);
}

async function ensureBrowserExporterBundle(): Promise<string> {
  const outPath = path.join(CACHE_DIR, "browser-export.js");
  await Bun.$`mkdir -p ${CACHE_DIR}`.quiet();
  await Bun.$`bun build ${path.join(PACKAGE_ROOT, "src/browser-export.ts")} --outfile ${outPath} --target browser`.quiet();
  return outPath;
}

function detectExportFormat(outPath: string, args: string[]): "png" | "svg" {
  const explicit = hasFlag(args, "--format") ? parseRequiredStringFlag(args, "--format") : null;
  if (explicit === "png" || explicit === "svg") {
    return explicit;
  }
  if (outPath.endsWith(".png")) {
    return "png";
  }
  if (outPath.endsWith(".svg")) {
    return "svg";
  }
  throw new Error("Cannot infer export format; use .png/.svg extension or --format png|svg");
}

function parseCropArea(args: string[], elements: ExcalidrawElement[]): CropArea | null {
  const liveElements = getLiveElements(elements);
  const explicitCrop = hasFlag(args, "--crop");
  const cropElement = hasFlag(args, "--crop-element");
  const cropElements = hasFlag(args, "--crop-elements");
  const modeCount = [explicitCrop, cropElement, cropElements].filter(Boolean).length;

  if (modeCount === 0) {
    return null;
  }
  if (modeCount > 1) {
    throw new Error("Use only one crop mode: --crop or --crop-element or --crop-elements");
  }

  const padding = parseOptionalNumberFlag(args, "--padding") ?? 0;
  if (padding < 0) {
    throw new Error("Padding must be non-negative");
  }

  if (explicitCrop) {
    const raw = parseRequiredStringFlag(args, "--crop");
    const parts = raw.split(",").map((value) => Number(value.trim()));
    if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
      throw new Error("Invalid --crop value, expected x,y,w,h");
    }
    const [x, y, width, height] = parts;
    if (width <= 0 || height <= 0) {
      throw new Error("Crop width/height must be positive");
    }
    return {
      x: x - padding,
      y: y - padding,
      width: width + padding * 2,
      height: height + padding * 2,
    };
  }

  const ids =
    cropElement
      ? [parseRequiredStringFlag(args, "--crop-element")]
      : parseRequiredStringFlag(args, "--crop-elements")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);

  if (ids.length === 0) {
    throw new Error("No ids provided for crop selection");
  }

  const selected = ids.map((id) => getElementById(liveElements, id));
  const bounds = mergeBounds(selected.map(getElementBounds));
  return boundsToCropArea(bounds, padding);
}

async function exportSceneImage(
  elements: ExcalidrawElement[],
  outPath: string,
  format: "png" | "svg",
  cropArea: CropArea | null,
): Promise<void> {
  const bundlePath = await ensureBrowserExporterBundle();
  const chromeBin = await resolveChromeExecutablePath();
  const tmpScenePath = `/tmp/excalidraw-room-cli-scene-${Date.now()}.json`;
  const outDir = path.dirname(outPath);
  await Bun.$`mkdir -p ${outDir}`.quiet();
  await Bun.write(tmpScenePath, JSON.stringify({ elements: getLiveElements(elements), cropArea }));
  await Bun.$`node ${path.join(PACKAGE_ROOT, "scripts/export-runner.mjs")} ${tmpScenePath} ${path.resolve(bundlePath)} ${outPath} ${format} ${chromeBin}`.quiet();
}

function applyAddRect(elements: ExcalidrawElement[], spec: AddRectSpec): SceneChange {
  const rect = createRectangle({
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    backgroundColor: spec.backgroundColor,
    strokeColor: spec.strokeColor,
    index: nextIndex(elements),
  });
  if (!spec.label) {
    return {
      next: [...elements, rect],
      changed: [rect],
      summary: `Added rectangle ${rect.id}`,
    };
  }

  const labelText = createText({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2 - estimateTextHeight(spec.label, spec.labelFontSize ?? 22) / 2,
    text: spec.label,
    fontSize: spec.labelFontSize ?? 22,
    strokeColor: spec.labelColor ?? spec.strokeColor ?? "#1e1e1e",
    textAlign: "center",
    index: nextIndex([...elements, rect]),
  });
  return {
    next: [...elements, rect, labelText],
    changed: [rect, labelText],
    summary: `Added labeled rectangle ${rect.id}`,
  };
}

function applyAddText(elements: ExcalidrawElement[], spec: AddTextSpec): SceneChange {
  const text = createText({
    x: spec.x,
    y: spec.y,
    text: spec.text,
    fontSize: spec.fontSize,
    strokeColor: spec.strokeColor,
    textAlign: spec.textAlign,
    index: nextIndex(elements),
  });
  return {
    next: [...elements, text],
    changed: [text],
    summary: `Added text ${text.id}`,
  };
}

function resolveArrowEndpoint(
  elements: ExcalidrawElement[],
  side: "start" | "end",
  spec: AddArrowSpec,
): AnchorPoint {
  if (side === "start" && spec.fromId) {
    return getAnchorForElement(getElementById(elements, spec.fromId), "start");
  }
  if (side === "end" && spec.toId) {
    return getAnchorForElement(getElementById(elements, spec.toId), "end");
  }

  const x = side === "start" ? spec.x1 : spec.x2;
  const y = side === "start" ? spec.y1 : spec.y2;
  if (x == null || y == null) {
    throw new Error(`Missing coordinates for arrow ${side}`);
  }
  return { x, y, binding: null, boundToId: null };
}

function applyAddArrow(elements: ExcalidrawElement[], spec: AddArrowSpec): SceneChange {
  const start = resolveArrowEndpoint(elements, "start", spec);
  const end = resolveArrowEndpoint(elements, "end", spec);
  const arrow = createArrow({
    start,
    end,
    strokeColor: spec.strokeColor,
    endArrowhead: spec.endArrowhead,
    index: nextIndex(elements),
  });

  let next = [...elements, arrow];
  const changed: ExcalidrawElement[] = [arrow];

  for (const targetId of [start.boundToId, end.boundToId]) {
    if (!targetId) {
      continue;
    }
    const target = getElementById(next, targetId);
    const updated = appendBoundElement(target, { id: arrow.id, type: "arrow" });
    next = next.map((element) => (element.id === updated.id ? updated : element));
    changed.push(updated);
  }

  return {
    next,
    changed,
    summary: `Added arrow ${arrow.id}`,
  };
}

function applyDelete(elements: ExcalidrawElement[], spec: DeleteSpec): SceneChange {
  const idSet = new Set(spec.ids);
  const changed: ExcalidrawElement[] = [];
  const next = elements.map((element) => {
    if (!idSet.has(element.id) || element.isDeleted) {
      return element;
    }
    const deleted = touchElement(element, { isDeleted: true });
    changed.push(deleted);
    return deleted;
  });
  return {
    next,
    changed,
    summary: `Deleted ${changed.length} element(s)`,
  };
}

function applyMove(elements: ExcalidrawElement[], spec: MoveSpec): SceneChange {
  const target = getElementById(elements, spec.id);
  const nextX = spec.x ?? target.x + (spec.dx ?? 0);
  const nextY = spec.y ?? target.y + (spec.dy ?? 0);
  const moved = touchElement(target, { x: nextX, y: nextY });
  const next = elements.map((element) => (element.id === moved.id ? moved : element));
  return {
    next,
    changed: [moved],
    summary: `Moved ${moved.id} to (${Math.round(nextX)}, ${Math.round(nextY)})`,
  };
}

function applyAgentOp(elements: ExcalidrawElement[], spec: AgentSpec): SceneChange {
  switch (spec.type) {
    case "addRect":
      return applyAddRect(elements, spec);
    case "addText":
      return applyAddText(elements, spec);
    case "addArrow":
      return applyAddArrow(elements, spec);
    case "delete":
      return applyDelete(elements, spec);
    case "move":
      return applyMove(elements, spec);
  }
}

async function commandDump(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const outPath = args[1];
  const elements = await readScene(room);
  const json = JSON.stringify({ elements }, null, 2);
  if (outPath) {
    await Bun.write(outPath, json);
    console.log(`Saved ${elements.length} elements to ${outPath}`);
    return;
  }
  console.log(json);
}

async function commandStatus(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const elements = await readScene(room);
  const live = elements.filter((element) => !element.isDeleted);
  console.log(summarizeScene(elements));
  for (const element of live.slice(0, 50)) {
    const label =
      element.type === "text"
        ? JSON.stringify(String((element as ExcalidrawTextElement).text).slice(0, 40))
        : `${Math.round(element.width)}x${Math.round(element.height)}`;
    console.log(`${element.id} ${element.type} @(${Math.round(element.x)},${Math.round(element.y)}) ${label}`);
  }
}

async function commandWatch(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const initial = await readScene(room);
  console.log(`Initial scene: ${initial.length} elements`);

  const socket = await joinRoomSocket(room);
  socket.on("client-broadcast", async (encryptedData: ArrayBuffer, iv: Uint8Array) => {
    try {
      const json = await decryptBytes(room.roomKey, iv, new Uint8Array(encryptedData));
      console.log(json);
    } catch (error) {
      console.error("Failed to decrypt update:", error);
    }
  });

  await new Promise(() => {});
}

async function commandSnapshot(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const outPath = args[1] ?? snapshotDefaultPath(room);
  const elements = await readScene(room);
  await Bun.$`mkdir -p ${path.dirname(outPath)}`.quiet();
  await Bun.write(outPath, JSON.stringify({ roomId: room.roomId, elements }, null, 2));
  console.log(`Saved snapshot to ${outPath}`);
}

async function commandRestore(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const filePath = args[1];
  if (!filePath) {
    usage();
  }
  const input = JSON.parse(await Bun.file(filePath).text());
  const elements = normalizeElementsFile(input);
  const current = await readScene(room);
  const change = buildReplaceScene(current, elements);
  await persistChange(room, { ...change, summary: `Restored ${elements.length} elements from ${filePath}` });
}

async function commandSkill(): Promise<void> {
  process.stdout.write(await readPackagedText("skill-data/core/SKILL.md"));
}

async function commandSkills(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand === "list") {
    console.log("core");
    return;
  }
  if (subcommand === "get") {
    const skillName = args[1];
    if (!skillName) {
      throw new Error("Usage: excalidraw-room skills get <name>");
    }
    if (skillName !== "core") {
      throw new Error(`Unknown skill: ${skillName}`);
    }
    process.stdout.write(await readPackagedText("skill-data/core/SKILL.md"));
    return;
  }
  throw new Error("Usage: excalidraw-room skills list | skills get <name>");
}

async function commandInstall(args: string[]): Promise<void> {
  if (!args.includes("--skill")) {
    throw new Error("Usage: excalidraw-room install --skill [--target <dir>]");
  }

  const targets = resolveSkillInstallTargets(args);
  const stub = await readPackagedText("skills/excalidraw-room/SKILL.md");

  for (const targetDir of targets) {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "SKILL.md"), stub, "utf8");
    console.log(`Installed discovery skill to ${path.join(targetDir, "SKILL.md")}`);
  }
}

async function commandSetup(args: string[]): Promise<void> {
  const targets = resolveSkillInstallTargets(args);
  const stub = await readPackagedText("skills/excalidraw-room/SKILL.md");

  for (const targetDir of targets) {
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "SKILL.md"), stub, "utf8");
    console.log(`Installed discovery skill to ${path.join(targetDir, "SKILL.md")}`);
  }

  console.log(`Run '${CLI_BIN_NAME} skill' to view the agent-facing usage guide.`);
}

async function commandSendFile(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const filePath = args[1];
  if (!filePath) {
    usage();
  }
  const mode = parseMode(args);
  const input = JSON.parse(await Bun.file(filePath).text());
  const incoming = normalizeElementsFile(input);
  const current = await readScene(room);
  if (mode === "replace") {
    await persistChange(room, { ...buildReplaceScene(current, incoming), summary: `Sent ${incoming.length} elements with mode=replace` });
    return;
  }
  await writeScene(room, [...current, ...incoming]);
  await broadcastUpdate(room, incoming);
  console.log(`Sent ${incoming.length} elements with mode=append`);
}

async function applyJsonSpec(room: RoomRef, input: AgentSpec[] | { mode?: "append" | "replace" | "patch"; ops?: AgentSpec[]; elements?: ExcalidrawElement[] }): Promise<void> {
  const current = await readScene(room);
  let scene = current;
  let changed: ExcalidrawElement[] = [];
  const summaries: string[] = [];

  if (Array.isArray(input)) {
    for (const op of input) {
      const result = applyAgentOp(scene, op);
      scene = result.next;
      changed.push(...result.changed);
      summaries.push(result.summary);
    }
  } else if (Array.isArray(input.elements)) {
    const mode = input.mode ?? "append";
    if (mode === "replace") {
      const result = buildReplaceScene(scene, input.elements);
      scene = result.next;
      changed = result.changed;
      summaries.push(result.summary);
    } else {
      scene = [...scene, ...input.elements];
      changed = input.elements;
      summaries.push(`Applied raw elements mode=${mode}`);
    }
  } else if (Array.isArray(input.ops)) {
    if (input.mode === "replace") {
      const cleared = buildReplaceScene(scene, []);
      scene = cleared.next;
      changed.push(...cleared.changed);
      summaries.push("Cleared current scene");
    }
    for (const op of input.ops) {
      const result = applyAgentOp(scene, op);
      scene = result.next;
      changed.push(...result.changed);
      summaries.push(result.summary);
    }
  } else {
    throw new Error("Unsupported spec format");
  }

  if (summaries.length === 0) {
    console.log("No changes");
    return;
  }

  await writeScene(room, scene);
  await broadcastUpdate(room, changed.length > 0 ? changed : scene);
  console.log(summaries.join("; "));
}

async function commandApplyJson(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const source = args[1];
  const raw = await readJsonInput(source);
  if (!raw.trim()) {
    throw new Error("Empty JSON input");
  }
  const input = JSON.parse(raw) as
    | AgentSpec[]
    | { mode?: "append" | "replace" | "patch"; ops?: AgentSpec[]; elements?: ExcalidrawElement[] };
  await applyJsonSpec(room, input);
}

async function commandApplySpec(args: string[]): Promise<void> {
  await commandApplyJson(args);
}

async function commandExportImage(args: string[]): Promise<void> {
  const room = parseRoomUrl(args[0] ?? usage());
  const outPath = args[1];
  if (!outPath) {
    usage();
  }
  const format = detectExportFormat(outPath, args);
  const elements = await readScene(room);
  const cropArea = parseCropArea(args, elements);
  await exportSceneImage(elements, outPath, format, cropArea);
  console.log(
    cropArea
      ? `Exported ${format.toUpperCase()} crop ${cropArea.x},${cropArea.y},${cropArea.width},${cropArea.height} to ${outPath}`
      : `Exported ${format.toUpperCase()} to ${outPath}`,
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    usage(0);
  }

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      usage(0);
      return;
    case "setup":
      await commandSetup(rest);
      return;
    case "install":
      await commandInstall(rest);
      return;
    case "skill":
      await commandSkill();
      return;
    case "skills":
      await commandSkills(rest);
      return;
    case "dump":
      await commandDump(rest);
      return;
    case "status":
      await commandStatus(rest);
      return;
    case "watch":
      await commandWatch(rest);
      return;
    case "snapshot":
      await commandSnapshot(rest);
      return;
    case "restore":
      await commandRestore(rest);
      return;
    case "apply-json":
      await commandApplyJson(rest);
      return;
    case "send-file":
      await commandSendFile(rest);
      return;
    case "apply-spec":
      await commandApplySpec(rest);
      return;
    case "export-image":
      await commandExportImage(rest);
      return;
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
