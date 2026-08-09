# Problems Faced & Resolutions

This document logs technical challenges, root causes, and resolutions encountered during the setup and development of **Saira Assistant**.

---

## 1. Electron Binary Installation Error

- **Symptom**: `Error: Electron failed to install correctly, please delete node_modules/electron...`
- **Root Cause**: The post-install script for Electron was interrupted during `pnpm install`, leaving the executable binary unextracted.
- **Resolution**: Ran `node node_modules/electron/install.js` to download and configure the Electron binary for Windows.

---

## 2. Main Process Entry Point Path Mismatch

- **Symptom**: `Cannot find module .../dist/main/index.js. Please verify that package.json has a valid "main" entry.`
- **Root Cause**: [package.json](file:///c:/Users/kapil/Desktop/space/saira-assistant/package.json) specified `"main": "dist/main/index.js"`, but [tsup.config.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/tsup.config.ts) was configured with entry `main: './src/main/index.ts'`, which emitted `dist/main.js`.
- **Resolution**: Changed entry key in `tsup.config.ts` to `'main/index': './src/main/index.ts'`, building directly to `dist/main/index.js`.

---

## 3. Native Module ABI Incompatibility (`better-sqlite3`)

- **Symptom**: `Error: Could not locate the bindings file. Tried: ... better_sqlite3.node`
- **Root Cause**: `better-sqlite3` is a native C++ module. The compiled `.node` binary matched standard Node.js ABI headers instead of Electron's Node runtime headers.
- **Resolution**:
  1. Ran `npx @electron/rebuild` to recompile `better-sqlite3` native binaries against Electron v31 headers.
  2. Added `'better-sqlite3'` to the `external` array in `tsup.config.ts` so native bindings are resolved at runtime.

---

## 4. Unhandled Promise Rejection on Missing Tray Icon

- **Symptom**: `UnhandledPromiseRejectionWarning: Error: Failed to load image from path .../assets/icon.png`
- **Root Cause**: `src/main/index.ts` attempted `new Tray('.../assets/icon.png')`, but the `assets/` folder did not exist.
- **Resolution**:
  1. Generated an app icon PNG and created `assets/icon.png`.
  2. Updated [src/main/index.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/main/index.ts) with `getAppIcon()` helper using `nativeImage.createFromPath()` and `nativeImage.createEmpty()` fallback.

---

## 5. Blank Window (`ReferenceError: require is not defined`)

- **Symptom**: Saira desktop window rendered a blank dark blue screen.
- **Root Cause**: `tsup.config.ts` bundled `src/renderer/index.tsx` using `platform: 'node'`. In Electron browser context (`nodeIntegration: false`), `require()` does not exist, causing Chromium to throw `Uncaught ReferenceError: require is not defined`.
- **Resolution**: Split `tsup.config.ts` into a dual configuration array:
  - Node target (`cjs`, `platform: 'node'`) for main, preload, and db scripts.
  - Browser target (`iife`, `platform: 'browser'`, `noExternal: ['react', 'react-dom']`) for renderer.

---

## 6. TTS Pipeline Freezing on MP3 Audio Playback

- **Symptom**: Orchestrator pipeline stalled indefinitely at `[TTS] Synthesizing speech...`.
- **Root Cause**: `playAudioBuffer` in `src/providers/tts.ts` used PowerShell's `System.Speech.SoundPlayer`, which **only supports raw `.wav` audio**. MP3 audio returned by ElevenLabs or Azure TTS caused PowerShell to hang or throw header errors.
- **Resolution**: Replaced `SoundPlayer` in [src/providers/tts.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/tts.ts) with Windows Media Player COM object (`WMPlayer.OCX`), which natively streams and plays MP3 audio files synchronously without freezing.

---

## 7. Electron Preload Sandbox Script Crash (`module not found: fs` / `module not found: socket.io-client`)

- **Symptom**: `Unable to load preload script: .../dist/main/preload.js Error: module not found: fs` (or `socket.io-client`). `window.assistant` bridge was `undefined`, preventing audio/text requests from reaching backend.
- **Root Cause**: `preload.js` imported `socket.io-client`, which attempts to `require('fs')`, `require('net')`, and other Node core modules inside Electron's isolated renderer preload sandbox where Node module imports are blocked.
- **Resolution**: Refactored `preload.ts` to use 100% native Electron `ipcRenderer` (`sendAudio`, `sendText`, `onTranscript`, `onResponse`, `onError`) with **zero `node_modules` dependencies**. Moved Socket.io networking to Electron's main process (`src/main/index.ts`).

---

## 8. LLM Content Parser Exception (`TypeError: content.replace is not a function`)

- **Symptom**: `TypeError: content.replace is not a function` during LLM intent parsing step.
- **Root Cause**: Cloudflare Workers AI (or structured JSON model outputs) returned `content` as a pre-parsed JavaScript object instead of a raw string. Attempting `.replace()` on a non-string object threw a TypeError.
- **Resolution**: Added `parseContentToIntent` helper in [src/providers/llm.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/llm.ts#L32-L46) that safely handles pre-parsed objects, strings with markdown code blocks, and fallback JSON formatting.

---

## 9. Cloudflare TTS HTTP 400 Unhandled Promise Rejection

- **Symptom**: `Cloudflare ElevenLabs TTS failed: Bad Request (UnhandledPromiseRejectionWarning)`.
- **Root Cause**: Cloudflare Workers AI model parameters differ across account tiers/models. Uncaught network/API errors threw unhandled promise rejections that stalled the process.
- **Resolution**: Enhanced `CloudflareElevenLabsTTS` in [src/providers/tts.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/tts.ts#L128-L168) with error detail logging and an **automatic fallback to Windows SAPI5 system TTS** so speech synthesis never crashes.

---

## 10. Cloudflare Workers AI TTS Model Route Error (`code: 7000, message: "No route for that URI"`)

- **Symptom**: Cloudflare returned `code: 7000, message: "No route for that URI"` when requesting `elevenlabs/eleven-multilingual-v2` via standard Workers AI run endpoint.
- **Root Cause**: `elevenlabs/eleven-multilingual-v2` is an AI Gateway proxy route, not a direct Workers AI model. Native Cloudflare Workers AI text-to-speech models use `@cf/myshell/melotts-english` or `@cf/deepgram/aura-1`.
- **Resolution**: Updated default Cloudflare TTS model in [src/shared/config.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/shared/config.ts#L29) to `@cf/myshell/melotts-english`. Updated `CloudflareElevenLabsTTS` in [src/providers/tts.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/tts.ts#L128-L200) to support both native `@cf/` models and AI Gateway proxy routes.

---

## 11. Whisper STT Hallucinating Single Words (`"you"` or `"You."`)

- **Symptom**: STT consistently transcribed spoken sentences as just `"you"` or `"You."`.
- **Root Cause**: `MediaRecorder` captured Opus compressed audio (`audio/webm`), but `index.tsx` wrapped the Blob header as `audio/wav`. When Whisper attempted to parse a corrupt container header, it assumed silence, causing Whisper's default silence hallucination `"you"`.
- **Resolution**: Updated `src/renderer/index.tsx` to preserve `audio/webm;codecs=opus` container headers and updated `CloudflareSTT` in [src/providers/stt.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/stt.ts#L140-L155) to stream raw binary octet-streams to `@cf/openai/whisper`.

---

## 12. Cloudflare AI Gateway STT Invalid Path Error (`code: 2001, message: "Invalid request path"`)

- **Symptom**: `Cloudflare AI Gateway STT failed (400): {"code":2001,"message":"Invalid request path. Expected path prefix /v1/:accountTag/:gatewayId"}`.
- **Root Cause**: Cloudflare AI Gateway does not proxy OpenAI `/v1/audio/transcriptions` binary audio uploads without custom stored OpenAI provider keys.
- **Resolution**: Refactored `CloudflareSTT` in [src/providers/stt.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/stt.ts#L103-L135) to always stream binary audio directly to Cloudflare Workers AI (`/client/v4/accounts/:id/ai/run/@cf/openai/whisper`), bypassing AI Gateway proxy paths for STT.

---

## 13. Cloudflare Workers AI STT 401 Authentication Error (`code: 10000, message: "Authentication error"`)

- **Symptom**: `Cloudflare Workers AI STT failed (401): {"result":null,"success":false,"errors":[{"code":10000,"message":"Authentication error"}],"messages":[]}`.
- **Root Cause**: `CLOUDFLARE_API_TOKEN` in `.env` was either invalid, expired, lacked the required `Workers AI - Read` / `Workers AI - Edit` permission, or was set to a Cloudflare Global API Key (which cannot be authenticated via standard Bearer tokens).
- **Resolution**:
  1. Enhanced `CloudflareSTT` in [src/providers/stt.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/stt.ts#L103-L192) to catch authentication and network errors, logging clear diagnostic instructions.
  2. Implemented a STT provider fallback chain (`Groq` -> `OpenAI` -> `Offline Whisper`) so transcription continues without crashing the app when Cloudflare authentication fails.

---

## 14. Out-of-Order Responses, Resource Leaks, and Speech Stacking During Rapid Pipeline Interruptions

- **Symptom**:
  1. **Out-of-Order Responses**: When sending a new prompt or audio before a previous one finishes processing (interrupting), older responses complete after newer ones and get displayed out-of-order in the UI.
  2. **Speech Stacking**: Older TTS speech outputs play over the speaker after a new question has already been submitted.
  3. **Resource & Quota Leaks**: Interrupted STT and LLM HTTP API requests continue running in the background, consuming CPU, bandwidth, and API rate limits.
- **Root Cause**:
  1. **No Monotonic Request Tracking**: Asynchronous socket handlers (`socket.on('audio')`, `socket.on('text')`) executed in parallel without a sequence ID. Dynamic API latencies allowed shorter/later requests to complete before earlier/longer requests.
  2. **No Request Cancellation Signal**: AI provider HTTP calls lacked an `AbortController` signal to terminate pending web API requests upon interruption.
  3. **No TTS Preemption Mechanism**: TTS playback subprocesses (PowerShell / Windows Media Player) ran to completion without an active kill/stop trigger.
- **Resolution**:
  1. **Monotonic Request ID Tracking**: Maintained an `activeRequestId` counter in [src/orchestrator/index.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/orchestrator/index.ts). Each new user input increments `activeRequestId`. Before emitting socket events (`transcript`, `intent`, `response`) or triggering TTS, the orchestrator checks `if (currentReqId !== activeRequestId) return;` to silently discard stale responses.
  2. **AbortController Request Signals**: Created and passed an `AbortSignal` for each active request so that pending STT and LLM HTTP requests are immediately aborted when a new user input arrives.
  3. **TTS Preemption & Audio Halting**: Added a `stop()` method to `TTSProvider` ([src/providers/tts.ts](file:///c:/Users/kapil/Desktop/space/saira-assistant/src/providers/tts.ts)) to terminate ongoing PowerShell audio synthesis and playback processes instantly upon interruption.

