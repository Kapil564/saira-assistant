import * as os from 'node:os';
import { isLocalServerReachable } from '../shared/http-util';
import { config } from '../shared/config';

export interface OllamaStatus {
  installed: boolean;
  running: boolean;
  modelName: string;
  modelDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  ramGbTotal: number;
  ramGbFree: number;
  ramWarning: boolean;
}

const DEFAULT_LOCAL_MODEL = process.env.OLLAMA_FALLBACK_MODEL || 'llama3.2:3b';

let currentDownloadProgress = 0;
let isDownloading = false;

/**
 * Checks system RAM specifications.
 */
export function checkSystemRam() {
  const bytesTotal = os.totalmem();
  const bytesFree = os.freemem();
  const ramGbTotal = Math.round((bytesTotal / (1024 * 1024 * 1024)) * 10) / 10;
  const ramGbFree = Math.round((bytesFree / (1024 * 1024 * 1024)) * 10) / 10;
  // Non-blocking warning if total system RAM is under 4GB
  const ramWarning = ramGbTotal < 4;

  if (ramWarning) {
    console.warn(`[RAM Warning] System RAM (${ramGbTotal} GB) is under the 4GB recommended specification.`);
  }

  return { ramGbTotal, ramGbFree, ramWarning };
}

/**
 * Retrieves current Ollama runtime status, RAM specs, and model availability.
 */
export async function getOllamaStatus(): Promise<OllamaStatus> {
  const ramInfo = checkSystemRam();
  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
  const running = await isLocalServerReachable(`${baseUrl}/api/tags`);

  if (!running) {
    return {
      installed: false,
      running: false,
      modelName: DEFAULT_LOCAL_MODEL,
      modelDownloaded: false,
      downloading: false,
      downloadProgress: 0,
      statusText: 'Ollama server is not running locally on port 11434.',
      ...ramInfo,
    };
  }

  let modelDownloaded = false;
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      if (Array.isArray(data.models)) {
        modelDownloaded = data.models.some((m) =>
          m.name.toLowerCase().includes(DEFAULT_LOCAL_MODEL.toLowerCase()) ||
          DEFAULT_LOCAL_MODEL.toLowerCase().includes(m.name.toLowerCase())
        );
      }
    }
  } catch (err) {
    console.error('[Ollama Status Error] Failed to fetch tags:', err);
  }

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading ${DEFAULT_LOCAL_MODEL} (${currentDownloadProgress}%)...`;
  } else if (!modelDownloaded) {
    statusText = `Model ${DEFAULT_LOCAL_MODEL} not downloaded yet.`;
  }

  return {
    installed: true,
    running: true,
    modelName: DEFAULT_LOCAL_MODEL,
    modelDownloaded,
    downloading: isDownloading,
    downloadProgress: currentDownloadProgress,
    statusText,
    ...ramInfo,
  };
}

/**
 * Pulls the default local Ollama model (llama3.2:3b) with streaming NDJSON progress updates.
 */
export async function pullLocalModel(
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const baseUrl = config.llm.baseUrl || 'http://localhost:11434';
  const isRunning = await isLocalServerReachable(`${baseUrl}/api/tags`);

  if (!isRunning) {
    console.warn('[Ollama Pull] Cannot pull model: Ollama server is not running.');
    return false;
  }

  if (isDownloading) {
    console.log('[Ollama Pull] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentDownloadProgress = 0;
  console.log(`[Ollama Pull] Starting auto-pull for model "${DEFAULT_LOCAL_MODEL}"...`);

  try {
    const res = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: DEFAULT_LOCAL_MODEL, stream: true }),
    });

    if (!res.ok || !res.body) {
      const errText = await res.text();
      console.error(`[Ollama Pull Failed] HTTP ${res.status}: ${errText}`);
      isDownloading = false;
      return false;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { status?: string; completed?: number; total?: number };
          if (parsed.completed && parsed.total && parsed.total > 0) {
            const percent = Math.round((parsed.completed / parsed.total) * 100);
            currentDownloadProgress = percent;
            if (onProgress) {
              onProgress(percent, `Downloading ${DEFAULT_LOCAL_MODEL}: ${percent}%`);
            }
          }
        } catch {
          // Skip invalid JSON lines
        }
      }
    }

    currentDownloadProgress = 100;
    isDownloading = false;
    console.log(`[Ollama Pull] Successfully downloaded model "${DEFAULT_LOCAL_MODEL}".`);
    if (onProgress) {
      onProgress(100, `Model ${DEFAULT_LOCAL_MODEL} download complete.`);
    }
    return true;
  } catch (err) {
    console.error('[Ollama Pull Exception]:', err);
    isDownloading = false;
    return false;
  }
}

/**
 * Auto-checks and ensures local model readiness on app startup.
 */
export async function ensureLocalModelReady(): Promise<void> {
  const status = await getOllamaStatus();
  if (status.running && !status.modelDownloaded && !status.downloading) {
    console.log('[Ollama Init] Auto-triggering first-run model pull for fallback readiness...');
    pullLocalModel((percent) => {
      if (percent % 25 === 0) {
        console.log(`[Ollama Model Download Progress]: ${percent}%`);
      }
    }).catch((err) => {
      console.error('[Ollama Model Download Error]:', err);
    });
  }
}
