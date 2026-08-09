import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config } from '../shared/config';

export interface TTSProvider {
  speak(text: string): Promise<void>;
}

class SAPI5TTS implements TTSProvider {
  async speak(text: string): Promise<void> {
    const escaped = text.replace(/"/g, '\\"');
    const script = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $synth.Speak(\"${escaped}\");
    `;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-Command', script], { windowsHide: true });
      child.on('error', reject);
      child.on('close', resolve);
    });
  }
}

class LinuxTTS implements TTSProvider {
  async speak(text: string): Promise<void> {
    const trimmed = text.replace(/"/g, '\\"');
    const command = os.platform() === 'darwin' ? 'say' : 'espeak';
    const args = os.platform() === 'darwin' ? [trimmed] : ['-v', 'en', trimmed];
    return new Promise((resolve, reject) => {
      const child = spawn(command, args);
      child.on('error', reject);
      child.on('close', resolve);
    });
  }
}

class ElevenLabsTTS implements TTSProvider {
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId || '21m00Tcm4TlvDq8ikWAM';
  }

  async speak(text: string): Promise<void> {
    if (!this.apiKey) throw new Error('ElevenLabs API key is missing.');

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS failed: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }
}

class AzureTTS implements TTSProvider {
  private apiKey: string;
  private region: string;

  constructor(apiKey: string, region: string) {
    this.apiKey = apiKey;
    this.region = region;
  }

  async speak(text: string): Promise<void> {
    if (!this.apiKey || !this.region) {
      throw new Error('Azure Speech key and region are required.');
    }

    const tokenResponse = await fetch(
      `https://${this.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': this.apiKey },
      },
    );

    if (!tokenResponse.ok) {
      throw new Error(`Azure token request failed: ${tokenResponse.statusText}`);
    }

    const token = await tokenResponse.text();
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="en-US-JennyNeural">${text.replace(/</g, '&lt;')}</voice></speak>`;

    const response = await fetch(
      `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
          Authorization: `Bearer ${token}`,
        },
        body: ssml,
      },
    );

    if (!response.ok) {
      throw new Error(`Azure TTS failed: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }
}

class CloudflareElevenLabsTTS implements TTSProvider {
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;
  private voiceId: string;
  private fallback: TTSProvider;

  constructor(
    accountId: string,
    apiToken: string,
    gatewayId = '',
    model = 'elevenlabs/eleven-multilingual-v2',
    voiceId = '',
  ) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.gatewayId = gatewayId;
    this.model = model;
    this.voiceId = voiceId || 'QTKSa2Iyv0yoxvXY2V8a';
    this.fallback = createFallbackTTS();
  }

  async speak(text: string): Promise<void> {
    if (!this.accountId || !this.apiToken) {
      return this.fallback.speak(text);
    }

    try {
      let url: string;
      let body: string;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      };

      if (this.gatewayId) {
        url = `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/elevenlabs/v1/text-to-speech/${this.voiceId}`;
        if (process.env.ELEVENLABS_API_KEY) {
          headers['xi-api-key'] = process.env.ELEVENLABS_API_KEY;
        }
        body = JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
        });
      } else {
        let targetModel = this.model || '@cf/myshell/melotts-english';
        if (targetModel.includes('elevenlabs')) {
          console.warn('[Cloudflare TTS Warning] ElevenLabs models require Cloudflare AI Gateway (CLOUDFLARE_GATEWAY_ID). Switching to native Cloudflare Workers AI model @cf/myshell/melotts-english.');
          targetModel = '@cf/myshell/melotts-english';
        }
        url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${targetModel}`;
        body = JSON.stringify({ text });
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Cloudflare TTS Warning] (${response.status}): ${errText || response.statusText}. Falling back to system TTS.`);
        return await this.fallback.speak(text);
      }

      const contentType = response.headers.get('content-type') || '';
      let buffer: Buffer;

      if (contentType.includes('application/json')) {
        const data = await response.json();
        const audioData = data.result?.audio || data.result?.wav || data.audio;
        if (audioData) {
          buffer = Buffer.from(audioData, 'base64');
        } else {
          console.warn('[Cloudflare TTS Warning] No audio field in JSON response. Falling back to system TTS.');
          return await this.fallback.speak(text);
        }
      } else {
        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      await playAudioBuffer(buffer);
    } catch (err) {
      console.warn('[Cloudflare TTS Error]:', err, '. Falling back to system TTS.');
      await this.fallback.speak(text);
    }
  }
}

async function playAudioBuffer(buffer: Buffer): Promise<void> {
  const tempPath = path.join(process.cwd(), `temp_tts_${Date.now()}.mp3`);
  fs.writeFileSync(tempPath, buffer);

  const escapedPath = tempPath.replace(/"/g, '\\"');
  const script = `
    $wmp = New-Object -ComObject WMPlayer.OCX;
    $wmp.URL = "${escapedPath}";
    $wmp.controls.play();
    while ($wmp.playState -ne 1 -and $wmp.playState -ne 0) { Start-Sleep -Milliseconds 100 }
  `;

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-Command', script], { windowsHide: true });
    child.on('error', reject);
    child.on('close', () => {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
      resolve();
    });
  });
}

function createFallbackTTS(): TTSProvider {
  if (os.platform() === 'win32') return new SAPI5TTS();
  return new LinuxTTS();
}

export function createTTSProvider(): TTSProvider {
  switch (config.tts.provider) {
    case 'cloudflare':
      if (config.cloudflare.accountId && config.cloudflare.apiToken) {
        return new CloudflareElevenLabsTTS(
          config.cloudflare.accountId,
          config.cloudflare.apiToken,
          config.cloudflare.gatewayId,
          config.cloudflare.ttsModel,
          config.tts.voiceId,
        );
      }
      break;
    case 'elevenlabs':
      if (config.tts.apiKey) return new ElevenLabsTTS(config.tts.apiKey, config.tts.voiceId);
      break;
    case 'azure':
      if (config.tts.apiKey && config.tts.region) {
        return new AzureTTS(config.tts.apiKey, config.tts.region);
      }
      break;
    case 'sapi5':
    default:
      break;
  }
  return createFallbackTTS();
}
