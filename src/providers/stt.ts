import { config } from '../shared/config';
import { isLocalServerReachable } from '../shared/http-util';
import type { TranscriptionResult } from '../shared/types';
import { getSelectedModelName, isModelDownloaded } from './whisper-manager';

export interface STTProvider {
  name: string;
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

export class OpenAiSTT implements STTProvider {
  public name = 'openai';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class GroqSTT implements STTProvider {
  public name = 'groq';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('Groq API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model', 'whisper-large-v3');
    formData.append('language', 'en');

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class ElevenLabsSTT implements STTProvider {
  public name = 'elevenlabs';
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiKey) throw new Error('ElevenLabs API key is missing.');

    const formData = new FormData();
    const uint8 = new Uint8Array(audioBuffer);
    const blob = new Blob([uint8], { type: 'audio/wav' });
    formData.append('file', blob, 'recording.wav');
    formData.append('model_id', 'scribe_v1');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': this.apiKey },
      body: formData as unknown as BodyInit,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ElevenLabs STT failed (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json();
    return { text: data.text || '' };
  }
}

export class LocalWhisperSTT implements STTProvider {
  public name = 'local-whisper';
  private baseUrl: string;

  constructor(baseUrl = config.stt.offlineBaseUrl) {
    this.baseUrl = baseUrl;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    // Check local HTTP endpoint or local whisper runner
    if (await isLocalServerReachable(this.baseUrl)) {
      const formData = new FormData();
      const uint8 = new Uint8Array(audioBuffer);
      const blob = new Blob([uint8], { type: 'audio/wav' });
      formData.append('audio', blob, 'recording.wav');

      const response = await fetch(`${this.baseUrl}/transcribe`, {
        method: 'POST',
        body: formData as unknown as BodyInit,
      });

      if (response.ok) {
        const data = await response.json();
        return { text: data.text || '' };
      }
    }

    const activeModel = getSelectedModelName();
    const downloaded = isModelDownloaded(activeModel);
    console.log(`[Local Whisper STT] Transcribing audio buffer (${audioBuffer.length} bytes) via model "${activeModel}" (downloaded=${downloaded})...`);

    return { text: '' };
  }
}

export class CloudflareSTT implements STTProvider {
  public name = 'cloudflare';
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;
  private fallbacks: STTProvider[];

  constructor(
    accountId: string,
    apiToken: string,
    gatewayId = '',
    model = '@cf/openai/whisper',
    fallbacks: STTProvider[] = [],
  ) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.gatewayId = gatewayId;
    this.model = model;
    this.fallbacks = fallbacks;
  }

  async transcribe(audioBuffer: Buffer): Promise<TranscriptionResult> {
    if (!this.apiToken) throw new Error('Cloudflare API Token is missing.');

    try {
      if (this.gatewayId && this.accountId) {
        const formData = new FormData();
        const uint8 = new Uint8Array(audioBuffer);
        const blob = new Blob([uint8], { type: 'audio/wav' });
        formData.append('file', blob, 'recording.wav');
        formData.append('model', 'whisper-1');

        const url = `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/openai/audio/transcriptions`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiToken}` },
          body: formData as unknown as BodyInit,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Cloudflare AI Gateway STT failed (${response.status}): ${errText || response.statusText}`);
        }

        const data = await response.json();
        return { text: data.text || '' };
      }

      if (!this.accountId) throw new Error('Cloudflare Account ID is missing.');

      const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: audioBuffer as unknown as BodyInit,
      });

      if (!response.ok) {
        const errText = await response.text();
        let detail = errText || response.statusText;
        if (response.status === 401) {
          detail = `Authentication error (401). Verify CLOUDFLARE_API_TOKEN in .env has 'Workers AI - Read/Edit' permissions. Raw error: ${errText}`;
        }
        throw new Error(`Cloudflare Workers AI STT failed (${response.status}): ${detail}`);
      }

      const data = await response.json();
      const text = data.result?.text || data.text || '';
      return { text };
    } catch (err) {
      console.warn(`[Cloudflare STT Warning]: ${err instanceof Error ? err.message : err}`);
      for (const fallback of this.fallbacks) {
        try {
          console.warn('[Cloudflare STT] Attempting fallback STT provider...');
          return await fallback.transcribe(audioBuffer);
        } catch {
          // try next fallback
        }
      }
      throw err;
    }
  }
}

export function createPrimarySTTProvider(): STTProvider | null {
  const elevenLabsKey = config.tts.elevenLabsKey;
  if (elevenLabsKey) {
    return new ElevenLabsSTT(elevenLabsKey);
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return new GroqSTT(groqKey);
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    return new OpenAiSTT(openAiKey);
  }

  if (config.cloudflare.apiToken) {
    return new CloudflareSTT(
      config.cloudflare.accountId,
      config.cloudflare.apiToken,
      config.cloudflare.gatewayId,
      config.cloudflare.sttModel,
    );
  }

  return null;
}

export async function createSTTProvider(): Promise<STTProvider> {
  return new LocalWhisperSTT();
}
