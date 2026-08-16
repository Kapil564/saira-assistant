import { getOllamaStatus, pullLocalModel, type OllamaStatus } from './ollama-manager';
import { getWhisperStatus, downloadWhisperModel, type WhisperStatus } from './whisper-manager';
import { getPiperStatus, downloadPiperVoice, type PiperStatus } from './piper-manager';

export interface SetupStatus {
  isComplete: boolean;
  overallProgress: number; // 0 to 100
  stepText: string;
  ollama: OllamaStatus;
  whisper: WhisperStatus;
  piper: PiperStatus;
}

let isSettingUp = false;

/**
 * Returns complete setup status combining Ollama LLM (~2GB), Whisper STT (~460MB), and Piper TTS (~50-60MB).
 */
export async function getFullSetupStatus(): Promise<SetupStatus> {
  const ollama = await getOllamaStatus();
  const whisper = getWhisperStatus();
  const piper = getPiperStatus();

  const ollamaReady = ollama.modelDownloaded || !ollama.running;
  const whisperReady = whisper.modelDownloaded;
  const piperReady = piper.voiceDownloaded;
  const isComplete = ollamaReady && whisperReady && piperReady;

  let overallProgress = 100;
  if (!isComplete) {
    const oPart = ollamaReady ? 70 : (ollama.downloadProgress / 100) * 70;
    const wPart = whisperReady ? 20 : (whisper.downloadProgress / 100) * 20;
    const pPart = piperReady ? 10 : (piper.downloadProgress / 100) * 10;
    overallProgress = Math.round(oPart + wPart + pPart);
  }

  let stepText = 'Saira local offline models are fully set up and ready.';
  if (!ollamaReady) {
    stepText = `Setting up Saira (1/3): Pulling Ollama LLM model (${ollama.downloadProgress}%)...`;
  } else if (!whisperReady) {
    stepText = `Setting up Saira (2/3): Downloading Whisper STT model (${whisper.downloadProgress}%)...`;
  } else if (!piperReady) {
    stepText = `Setting up Saira (3/3): Downloading Piper voice model (${piper.downloadProgress}%)...`;
  }

  return {
    isComplete,
    overallProgress,
    stepText,
    ollama,
    whisper,
    piper,
  };
}

/**
 * Runs the unified 3-step first-run setup sequence combining LLM, STT, and TTS downloads into a single progress flow.
 */
export async function runFullSetupSequence(
  onProgress?: (overallPercent: number, statusText: string) => void
): Promise<boolean> {
  if (isSettingUp) {
    console.log('[Setup Manager] Setup sequence already in progress.');
    return true;
  }

  isSettingUp = true;
  console.log('[Setup Manager] Starting 3-step unified first-run setup sequence...');

  try {
    // Step 1: Ensure Ollama local LLM model is ready (~2GB, 70% weight)
    const ollamaStatus = await getOllamaStatus();
    if (ollamaStatus.running && !ollamaStatus.modelDownloaded) {
      console.log('[Setup Manager] Step 1 of 3: Pulling local Ollama LLM model...');
      await pullLocalModel((percent) => {
        const overall = Math.round((percent / 100) * 70);
        if (onProgress) {
          onProgress(overall, `Step 1/3 (Ollama LLM): ${percent}%`);
        }
      });
    }

    // Step 2: Ensure Whisper local STT model is downloaded (~460MB, 20% weight)
    const whisperStatus = getWhisperStatus();
    if (!whisperStatus.modelDownloaded) {
      console.log('[Setup Manager] Step 2 of 3: Downloading local Whisper STT model...');
      await downloadWhisperModel(whisperStatus.modelName, (percent) => {
        const overall = Math.round(70 + (percent / 100) * 20);
        if (onProgress) {
          onProgress(overall, `Step 2/3 (Whisper STT): ${percent}%`);
        }
      });
    }

    // Step 3: Ensure Piper local TTS voice model is downloaded (~50-60MB, 10% weight)
    const piperStatus = getPiperStatus();
    if (!piperStatus.voiceDownloaded) {
      console.log('[Setup Manager] Step 3 of 3: Downloading local Piper TTS voice model...');
      await downloadPiperVoice(piperStatus.voiceName, (percent) => {
        const overall = Math.round(90 + (percent / 100) * 10);
        if (onProgress) {
          onProgress(overall, `Step 3/3 (Piper TTS): ${percent}%`);
        }
      });
    }

    isSettingUp = false;
    console.log('[Setup Manager] 3-step setup sequence completed successfully.');
    if (onProgress) {
      onProgress(100, 'Saira local offline models fully set up!');
    }
    return true;
  } catch (err) {
    console.error('[Setup Manager Error] Exception during setup sequence:', err);
    isSettingUp = false;
    return false;
  }
}

let lastReportedOverall = -1;

/**
 * Non-blocking auto-check executed on application startup.
 */
export async function ensureFullSetupReady(): Promise<void> {
  const status = await getFullSetupStatus();
  if (!status.isComplete) {
    console.log('[Setup Manager] Auto-triggering 3-step background setup for offline models...');
    runFullSetupSequence((percent, text) => {
      // Throttle logging to 10% step intervals to prevent spam
      const step10 = Math.floor(percent / 10) * 10;
      if (step10 !== lastReportedOverall || percent === 100) {
        lastReportedOverall = step10;
        console.log(`[Setup Progress]: Overall ${percent}% | ${text}`);
      }
    }).catch((err) => {
      console.error('[Setup Auto-Run Error]:', err);
    });
  }
}
