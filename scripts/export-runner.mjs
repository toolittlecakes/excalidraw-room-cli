import { chromium } from "playwright-core";
import fs from "node:fs/promises";
import path from "node:path";

const [, , scenePath, bundlePath, outPath, format, chromeBin] = process.argv;

if (!scenePath || !bundlePath || !outPath || !format || !chromeBin) {
  console.error("Usage: node export-runner.mjs <scenePath> <bundlePath> <outPath> <format> <chromeBin>");
  process.exit(1);
}

const payload = JSON.parse(await fs.readFile(scenePath, "utf8"));
const elements = payload.elements.filter((element) => !element.isDeleted);
const cropArea = payload.cropArea ?? null;
const EXPORT_PADDING = 20;

function elementBounds(element) {
  const xs = [element.x, element.x + (element.width ?? 0)];
  const ys = [element.y, element.y + (element.height ?? 0)];
  if (Array.isArray(element.points)) {
    for (const point of element.points) {
      if (Array.isArray(point) && point.length >= 2) {
        xs.push(element.x + point[0]);
        ys.push(element.y + point[1]);
      }
    }
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function sceneBounds(elements) {
  if (elements.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const element of elements) {
    const bounds = elementBounds(element);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function cropRectForExport(elements, cropArea) {
  if (!cropArea) {
    return null;
  }
  const bounds = sceneBounds(elements);
  return {
    x: Math.round(cropArea.x - bounds.minX + EXPORT_PADDING),
    y: Math.round(cropArea.y - bounds.minY + EXPORT_PADDING),
    width: Math.round(cropArea.width),
    height: Math.round(cropArea.height),
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeBin,
});

try {
  const context = await browser.newContext({ viewport: { width: 2400, height: 1800 } });
  const page = await context.newPage();
  await page.setContent("<!doctype html><html><body style='margin:0;background:#fff'></body></html>");
  await page.addScriptTag({ type: "module", path: path.resolve(bundlePath) });
  await page.waitForFunction(() => Boolean(window.__EXCALIDRAW_EXPORT_LIB__));
  const cropRect = cropRectForExport(elements, cropArea);

  if (format === "svg") {
    const svg = await page.evaluate(async ({ scene, cropRect }) => {
      const lib = window.__EXCALIDRAW_EXPORT_LIB__;
      const appState = {
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
        exportEmbedScene: false,
        gridSize: null,
      };
      const svgNode = await lib.exportToSvg({
        elements: scene,
        appState,
          files: {},
          exportPadding: 20,
        });
      if (cropRect) {
        svgNode.setAttribute("viewBox", `${cropRect.x} ${cropRect.y} ${cropRect.width} ${cropRect.height}`);
        svgNode.setAttribute("width", String(cropRect.width));
        svgNode.setAttribute("height", String(cropRect.height));
      }
      return svgNode.outerHTML;
    }, { scene: elements, cropRect });
    await fs.writeFile(outPath, svg, "utf8");
  } else if (format === "png") {
    const pngBytes = await page.evaluate(async ({ scene, cropRect }) => {
      const lib = window.__EXCALIDRAW_EXPORT_LIB__;
      const appState = {
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor: "#ffffff",
        exportEmbedScene: false,
        gridSize: null,
      };
      const canvas = await lib.exportToCanvas({
        elements: scene,
        appState,
        files: {},
        exportPadding: 20,
      });
      let targetCanvas = canvas;
      if (cropRect) {
        const cropped = document.createElement("canvas");
        cropped.width = cropRect.width;
        cropped.height = cropRect.height;
        const ctx = cropped.getContext("2d");
        ctx.drawImage(
          canvas,
          cropRect.x,
          cropRect.y,
          cropRect.width,
          cropRect.height,
          0,
          0,
          cropRect.width,
          cropRect.height,
        );
        targetCanvas = cropped;
      }
      const pngBlob = await new Promise((resolve) => targetCanvas.toBlob(resolve, "image/png", 1));
      const buffer = await pngBlob.arrayBuffer();
      return Array.from(new Uint8Array(buffer));
    }, { scene: elements, cropRect });
    await fs.writeFile(outPath, Buffer.from(pngBytes));
  } else {
    throw new Error(`Unsupported format: ${format}`);
  }
} finally {
  await browser.close();
}
