import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
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
      $synth.Speak("${escaped}");
    `;
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-Command', script], { windowsHide: true });
      child.on('error', reject);
      child.on('close', resolve);
    });
  }
}

class ElevenLabsTTS implements TTSProvider {
  private apiKey: ***  private voiceId: string;

  constructor(apiKey: *** voiceId: string) {
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
  private apiKey: ***  private region: string;

  constructor(apiKey: *** region: string) {
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
          Authorization: *** ${token}`,
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

async function playAudioBuffer(buffer: Buffer): Promise<void> {
  const tempPath = path.join(process.cwd(), 'temp_tts.mp3');
  fs.writeFileSync(tempPath, buffer);

  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-Command',
      `(New-Object Media.SoundPlayer "${tempPath}").PlaySync();`,
    ], { windowsHide: true });

    child.on('error', reject);
    child.on('close', () => {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
      resolve();
    });
  });
}

export function createTTSProvider(): TTSProvider {
  switch (config.tts.provider) {
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
  return new SAPI5TTS();
}
