import * as ExcalidrawLib from "@excalidraw/excalidraw";

declare global {
  interface Window {
    __EXCALIDRAW_EXPORT_LIB__?: typeof ExcalidrawLib;
    __EXCALIDRAW_EXPORT_KEYS__?: string[];
  }
}

window.__EXCALIDRAW_EXPORT_LIB__ = ExcalidrawLib;
window.__EXCALIDRAW_EXPORT_KEYS__ = Object.keys(ExcalidrawLib);
