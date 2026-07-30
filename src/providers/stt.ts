import { config } from '../shared/config';
import { isLocalServerReachable } from '../shared/http-util';
import type { TranscriptionResult } from '../shared/types';

export interface STTProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

class OpenAiSTT implements STTProvider {
  private apiKey: ***  constructor(apiKey: *** {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing.');

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: *** ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`OpenAI STT failed: ${response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

class GroqSTT implements STTProvider {
  private apiKey: ***  constructor(apiKey: *** {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('Groq API key is missing.');

    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: *** ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`Groq STT failed: ${response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

class OfflineWhisperSTT implements STTProvider {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    formData.append('audio', blob, 'recording.wav');

    const response = await fetch(`${this.baseUrl}/transcribe`, {
      method: 'POST',
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`Offline STT failed: ${response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

async function shouldUseOffline(): Promise<boolean> {
  const hasApiKeys = Boolean(config.stt.apiKey);
  if (!hasApiKeys) return true;
  return isLocalServerReachable(config.stt.offlineBaseUrl);
}

export async function createSTTProvider(): Promise<STTProvider> {
  if (await shouldUseOffline()) {
    return new OfflineWhisperSTT(config.stt.offlineBaseUrl);
  }

  switch (config.stt.provider) {
    case 'groq':
      return new GroqSTT(config.stt.apiKey);
    case 'openai':
    default:
      return new OpenAiSTT(config.stt.apiKey);
  }
}
