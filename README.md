# Saira — Windows Voice Assistant

A Siri-like voice assistant for Windows built with Electron, TypeScript, SQLite, and pluggable STT/LLM/TTS providers.

## What you need to provide

**Only the API keys you already have.** The app auto-selects providers based on what is filled in, and falls back to free/local options for everything else.

| What the user has | What they type into `.env` | What the app does for them |
|---|---|---|
| **Nothing** | leave all API keys blank | Windows SAPI5 TTS, local Ollama LLM, local faster-whisper STT |
| **OpenAI key** | `OPENAI_API_KEY=*** | Whisper STT + GPT-4o-mini intent + SAPI5 TTS |
| **ElevenLabs key** | `ELEVENLABS_API_KEY=*** + optional `ELEVENLABS_VOICE_ID` | Premium voice TTS (STT/LLM still auto-fall back) |
| **Gemini key** | `GEMINI_API_KEY=*** | Gemini Flash intent (STT/TTS still auto-fall back) |
| **Groq key** | `GROQ_API_KEY=*** | Fast Whisper STT + Llama intent + SAPI5 TTS |
| **Privacy-first** | leave all API keys blank + run local services | faster-whisper + Ollama, fully offline |

No one has to provide every API. Each category is independent.

## Current scope (v0)

- Conversational chat
- Create reminders
- Create to-do items
- Native Windows notifications for reminders
- Capability gating — clearly refuses tasks it cannot do yet

## Stack

| Part | Technology |
|---|---|
| Desktop app | Electron + React + Tailwind CSS |
| IPC | Socket.io |
| Speech-to-text | OpenAI Whisper, Groq, or local faster-whisper |
| Intent parsing | OpenAI, Google Gemini, Groq, or local Ollama |
| Text-to-speech | Windows SAPI5, ElevenLabs, or Azure |
| Storage | SQLite + Drizzle ORM |
| Scheduling | node-cron + node-notifier |
| Packaging | electron-builder |

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment variables
cp .env.example .env

# 3. Edit .env with the providers you have (one key per category is enough)
powershell notepad .env    # or VS Code, Cursor, etc.

# 4. Run database migrations
pnpm db:generate
pnpm db:migrate

# 5. Start in development mode
pnpm dev
pnpm start
```

## Building the installer

```bash
pnpm build
pnpm pack
```

Output appears in `release/`.

---

## How provider selection works

The app asks: "For this category, what do I actually have access to?"

### Speech-to-Text
1. If `STT_PROVIDER=openai` and `OPENAI_API_KEY` is set → OpenAI Whisper
2. If `STT_PROVIDER=groq` and `GROQ_API_KEY` is set → Groq Whisper
3. If **no STT API key is set**, ping `OFFLINE_STT_URL` (default `http://localhost:8000`). If reachable, use the local faster-whisper server.

### Intent parsing (LLM)
1. If `LLM_PROVIDER=openai/gemini/groq` and its API key is set → that provider
2. If **no LLM API key is set**, use local Ollama at `OLLAMA_BASE_URL`
3. If `LLM_PROVIDER=ollama` is explicitly chosen, it verifies Ollama is reachable first

### Text-to-Speech
1. If `TTS_PROVIDER=elevenlabs` and `ELEVENLABS_API_KEY` is set → ElevenLabs
2. If `TTS_PROVIDER=azure` and `AZURE_SPEECH_KEY` is set → Azure
3. Otherwise → **Windows SAPI5** (free, offline)

| Category | Options |
|---|---|
| STT | OpenAI Whisper API, Groq Whisper, local faster-whisper |
| LLM | OpenAI GPT-4o-mini, Gemini Flash, Groq Llama, local Ollama |
| TTS | Windows SAPI5 (free/offline), ElevenLabs (premium), Azure Neural TTS |

Fallback to SAPI5 means the app never breaks.

## Architecture

```
Electron tray app
  ↕ Socket.io
Orchestrator service (Node.js)
  ↕ HTTP/API calls
Pluggable providers: STT, LLM, TTS
  ↕
Action executor + SQLite store
```
