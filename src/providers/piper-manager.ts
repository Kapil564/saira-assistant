import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppPaths } from '../shared/paths';

export interface PiperStatus {
  voiceName: string; // 'en_US-amy-medium' | 'en_US-lessac-medium' | 'en_GB-alan-medium'
  voiceDownloaded: boolean;
  downloading: boolean;
  downloadProgress: number; // 0 to 100
  statusText: string;
  voicePath: string;
}

const VOICE_URLS: Record<string, { onnx: string; json: string }> = {
  'en_US-amy-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
  },
  'en_US-lessac-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
  },
  'en_GB-alan-medium': {
    onnx: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx',
    json: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json',
  },
};

let currentVoice = process.env.PIPER_LOCAL_VOICE || 'en_US-amy-medium';
let isDownloading = false;
let currentProgress = 0;

/**
 * Returns voices directory in per-user AppData: %APPDATA%\Saira\voices\
 */
export function getVoicesDir(): string {
  const paths = getAppPaths();
  const voicesDir = path.join(paths.userDataDir, 'voices');
  if (!fs.existsSync(voicesDir)) {
    fs.mkdirSync(voicesDir, { recursive: true });
  }
  return voicesDir;
}

export function getSelectedVoiceName(): string {
  return currentVoice;
}

export function setSelectedVoiceName(voiceName: string): void {
  if (VOICE_URLS[voiceName]) {
    currentVoice = voiceName;
    console.log(`[Piper Manager] Selected local voice model changed to: "${currentVoice}"`);
  }
}

/**
 * Checks if a specific Piper voice model (.onnx and .onnx.json) exists in %APPDATA%\Saira\voices\
 */
export function isVoiceDownloaded(voiceName = currentVoice): boolean {
  const onnxPath = path.join(getVoicesDir(), `${voiceName}.onnx`);
  const jsonPath = path.join(getVoicesDir(), `${voiceName}.onnx.json`);
  return fs.existsSync(onnxPath) && fs.existsSync(jsonPath) && fs.statSync(onnxPath).size > 5 * 1024 * 1024;
}

export function getVoicePath(voiceName = currentVoice): string {
  return path.join(getVoicesDir(), `${voiceName}.onnx`);
}

/**
 * Returns current status of local Piper voice model storage.
 */
export function getPiperStatus(): PiperStatus {
  const downloaded = isVoiceDownloaded(currentVoice);
  const voicePath = getVoicePath(currentVoice);

  let statusText = 'Ready';
  if (isDownloading) {
    statusText = `Downloading Piper voice ${currentVoice} (${currentProgress}%)...`;
  } else if (!downloaded) {
    statusText = `Piper voice ${currentVoice} not downloaded yet.`;
  }

  return {
    voiceName: currentVoice,
    voiceDownloaded: downloaded,
    downloading: isDownloading,
    downloadProgress: currentProgress,
    statusText,
    voicePath,
  };
}

/**
 * Downloads Piper voice ONNX model and JSON config into %APPDATA%\Saira\voices\
 * with progress tracking.
 */
export async function downloadPiperVoice(
  voiceName = currentVoice,
  onProgress?: (progressPercent: number, statusText: string) => void
): Promise<boolean> {
  const urls = VOICE_URLS[voiceName];
  if (!urls) {
    console.error(`[Piper Download] Unknown voice name: ${voiceName}`);
    return false;
  }

  if (isVoiceDownloaded(voiceName)) {
    console.log(`[Piper Download] Voice model "${voiceName}" is already downloaded.`);
    if (onProgress) onProgress(100, `Piper voice ${voiceName} ready.`);
    return true;
  }

  if (isDownloading) {
    console.log('[Piper Download] Download already in progress.');
    return true;
  }

  isDownloading = true;
  currentProgress = 0;
  console.log(`[Piper Download] Starting download for voice "${voiceName}"...`);

  try {
    // 1. Download JSON config
    const jsonRes = await fetch(urls.json);
    if (jsonRes.ok) {
      const jsonText = await jsonRes.text();
      const jsonPath = path.join(getVoicesDir(), `${voiceName}.onnx.json`);
      fs.writeFileSync(jsonPath, jsonText, 'utf-8');
    }

    // 2. Download ONNX model file
    const res = await fetch(urls.onnx);
    if (!res.ok || !res.body) {
      console.error(`[Piper Download Failed] HTTP ${res.status}: ${res.statusText}`);
      isDownloading = false;
      return false;
    }

    const contentLengthHeader = res.headers.get('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 55 * 1024 * 1024;
    let loadedBytes = 0;

    const targetPath = getVoicePath(voiceName);
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
          onProgress(percent, `Downloading Piper voice ${voiceName}: ${percent}%`);
        }
      }
    }

    fileStream.end();

    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
    fs.renameSync(tempPath, targetPath);

    currentProgress = 100;
    isDownloading = false;
    console.log(`[Piper Download] Successfully downloaded voice "${voiceName}" to ${targetPath}.`);
    if (onProgress) {
      onProgress(100, `Piper voice ${voiceName} download complete.`);
    }
    return true;
  } catch (err) {
    console.error(`[Piper Download Error] Failed downloading voice ${voiceName}:`, err);
    isDownloading = false;
    return false;
  }
}
