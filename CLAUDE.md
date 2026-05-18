# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server (host exposed for LAN/device testing).
- `npm run build` — `tsc` typecheck then `vite build` into `dist/`.
- `npm run lint` — ESLint over `ts,tsx` with `--max-warnings 0` (treat any warning as a failure).
- `npm run preview` — preview the production build.
- Android sync after a web build: `npx cap sync android`, then `cd android && ./gradlew assembleRelease`.
- The web GH Pages build is served under a subpath; set `VITE_BASE=/PaperKnife/` (see `.github/workflows/deploy.yml`). Local/Android builds use relative `./` base.
- The F-Droid "Lite" variant is built by deleting `public/tesseract/` and setting `VITE_DISABLE_OCR=true` before `npm run build` (see `android-release.yml`). This flag must work end-to-end; respect it when adding OCR features.

## Architecture

PaperKnife is a privacy-focused **single-page React + TypeScript app** that processes PDFs entirely client-side. The same Vite-built `dist/` is shipped two ways:

1. As a PWA / GitHub Pages site (`vite-plugin-pwa`, hash-routed for static hosting).
2. Wrapped as an Android app via **Capacitor** (`capacitor.config.ts`, `webDir: 'dist'`).

Because the codebase targets both shells from one source, **`Capacitor.isNativePlatform()`** is the runtime branch used throughout (e.g. `src/utils/pdfHelpers.ts` for file save/share, `src/App.tsx` for default `ViewMode`). Two parallel UI trees exist: `WebView` and `AndroidView` / `AndroidToolsView` / `AndroidHistoryView`, selected by `viewMode` in `App.tsx`. The "Chameleon" dev-only toggle (bottom-right) flips between them in dev builds.

### Routing & tool registry

`src/App.tsx` is the source of truth:

- The `tools` array (and exported `activeTools`, filtered by `IS_OCR_DISABLED`) drives the home grids, the QuickDrop modal, and the Android tools view. Adding a tool means: add to `tools`, add a `<Route>`, and create a component under `src/components/tools/`.
- Routes are `HashRouter`-based (required for static hosting under a subpath and for Capacitor's `file://` scheme).
- Tool components are statically imported (not lazy), intentionally — the comment in `App.tsx` notes that dynamic imports break in the Android APK shell.

### File pipeline between tools

`PipelineProvider` (`src/utils/pipelineContext.tsx`) holds an in-memory `Uint8Array` buffer so the user can hand a processed PDF to the next tool without re-uploading. Use `setPipelineFile` / `consumePipelineFile` rather than reintroducing a fresh file picker when chaining tools. `lastPipelinedFile` is retained for re-use after consumption.

### PDF processing

- Heavy work happens in `src/utils/pdfWorker.ts`, a Web Worker that handles `MERGE_PDFS`, `SPLIT_PDF`, and `COMPRESS_PDF_ASSEMBLY`. The worker uses `pdf-lib` only; canvas rasterization (for compress) is done on the main thread before posting `imageBytes` into the worker, because OffscreenCanvas isn't reliable across all targets.
- `pdfjs-dist` is used for rendering/previews; `pdfHelpers.ts` wires its worker via `?url` import and sets `cMapUrl` differently for web vs. Capacitor.
- `tesseract.js` powers `PdfToTextTool` OCR. Tesseract WASM/traineddata is fetched into `public/tesseract/` at CI build time, not committed.
- `vite.config.ts` `manualChunks` splits `pdf-lib`, `pdfjs-dist`, `tesseract.js`, and vendor UI libs into separate chunks — keep new heavy deps out of the main bundle by adding them here.

### Save / share abstraction

Never use raw `<a download>` or browser blob downloads directly. Use `downloadFile` in `src/utils/pdfHelpers.ts` — it routes to `Capacitor.Filesystem` + `Share` on Android and to a blob link on web, including chunked base64 conversion for large buffers.

### Android "Open With" / share intents

`src/App.tsx` listens for a `fileIntent` window event (dispatched by the Android shell) and reads the URI via `Filesystem.readFile`. There's also a global `open-quick-drop` window event used as a cross-component trigger to surface the QuickDrop modal. Prefer these events over prop drilling when a deep component needs to hand a file to the root.

### Theming, view mode, privacy auto-wipe

- Theme is `light | dark | system`, persisted in `localStorage` (`theme`), with a media-query listener for `system`.
- `autoWipe` + `autoWipeTimer` localStorage keys drive the inactivity wipe in `App.tsx` (calls `clearActivity()` from `recentActivity.ts`). Don't write user-data persistence that bypasses this — privacy is the product.

### Privacy invariant

All file processing must remain local. No telemetry, no remote uploads of user PDFs, no analytics SDKs. This is enforced socially, not by code — keep it that way when adding dependencies.
