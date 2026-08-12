import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';

export interface WhisperStatus {
  modelName: string; // 'small.en' | 'base.en'
  modelDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  modelPath: string;
}

const MODEL_URLS: Record<string, string> = {
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
};

let currentModel = process.env.WHISPER_LOCAL_MODEL || 'small.en';
let isDownloading = false;
let currentProgress = 0;

/**
 * Returns the models directory inside per-user AppData: %APPDATA%\Saira\models\
 */
export function getModelsDir(): string {
  const paths = getAppPaths();
  const modelsDir = path.join(paths.userDataDir, 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  return modelsDir;
}

export function getSelectedModelName(): string {
  return currentModel;
}

export function setSelectedModelName(modelName: string): void {
  if (MODEL_URLS[modelName]) {
    currentModel = modelName;
    console.log(`[Whisper Manager] Selected local STT model changed to: "${currentModel}"`);
  }
}

/**
 * Checks if a specific model binary exists in %APPDATA%\Saira\models\
 */
export function isModelDownloaded(modelName = currentModel): boolean {
  const modelPath = path.join(getModelsDir(), `ggml-${modelName}.bin`);
  return fs.existsSync(modelPath) && fs.statSync(modelPath).size > 10 * 1024 * 1024;
}

export function getModelPath(modelName = currentModel): string {
  return path.join(getModelsDir(), `ggml-${modelName}.bin`);
}

/**
 * Returns current status of local Whisper model storage.
 */
export function getWhisperStatus(): WhisperStatus {
  const downloaded = isModelDownloaded(currentModel);
  const modelPath = getModelPath(currentModel);

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading Whisper model ${currentModel} (${currentProgress}%)...`;
  } else if (!downloaded) {
    statusText = `Whisper model ${currentModel} not downloaded yet.`;
  }

  return {
    modelName: currentModel,
    modelDownloaded: downloaded,
    downloading: isDownloading,
    downloadProgress: currentProgress,
    statusText,
    modelPath,
  };
}

/**
 * Downloads GGML Whisper model binary (small.en or base.en) directly into %APPDATA%\Saira\models\
 * with streaming progress tracking.
 */
export async function downloadWhisperModel(
  modelName = currentModel,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const url = MODEL_URLS[modelName];
  if (!url) {
    console.error(`[Whisper Download] Unknown model name: ${modelName}`);
    return false;
  }

  if (isModelDownloaded(modelName)) {
    console.log(`[Whisper Download] Model "${modelName}" is already downloaded.`);
    if (onProgress) onProgress(100, `Whisper model ${modelName} ready.`);
    return true;
  }

  if (isDownloading) {
    console.log('[Whisper Download] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentProgress = 0;
  console.log(`[Whisper Download] Starting download for model "${modelName}" from ${url}...`);

  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      console.error(`[Whisper Download Failed] HTTP ${res.status}: ${res.statusText}`);
      isDownloading = false;
      return false;
    }

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 460 * 1024 * 1024;
    let loadedBytes = 0;

    const targetPath = getModelPath(modelName);
    const tempPath = `${targetPath}.tmp`;
    const fileStream = fs.createWriteStream(tempPath);

    const reader = res.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      loadedBytes += value.length;
      fileStream.write(Buffer.from(value));

      if (totalBytes > 0) {
        const percent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
        currentProgress = percent;
        if (onProgress) {
          onProgress(percent, `Downloading Whisper model ${modelName}: ${percent}%`);
        }
      }
    }

    fileStream.end();

    // Rename temp file to final .bin file
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(tempPath, targetPath);

    currentProgress = 100;
    isDownloading = false;
    console.log(`[Whisper Download] Successfully downloaded Whisper model "${modelName}" to ${targetPath}.`);
    if (onProgress) {
      onProgress(100, `Whisper model ${modelName} download complete.`);
    }
    return true;
  } catch (err) {
    console.error(`[Whisper Download Error] Failed downloading model ${modelName}:`, err);
    isDownloading = false;
    return false;
  }
}
