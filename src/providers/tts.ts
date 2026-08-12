import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config } from '../shared/config';
import { getSelectedVoiceName, isVoiceDownloaded } from './piper-manager';

export interface TTSProvider {
  name: string;
  speak(text: string): Promise<void>;
  stop(): void;
}

let activePlaybackProcess: ChildProcess | null = null;

function stopActivePlayback(): void {
  if (activePlaybackProcess && !activePlaybackProcess.killed) {
    try {
      const pid = activePlaybackProcess.pid;
      activePlaybackProcess.kill('SIGKILL');
      if (os.platform() === 'win32' && pid) {
        spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
      }
    } catch {
      // ignore cleanup errors
    }
    activePlaybackProcess = null;
  }
}

function spawnPowerShellScript(script: string): ChildProcess {
  const encodedCommand = Buffer.from(script, 'utf-16le').toString('base64');
  return spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], {
    windowsHide: true,
  });
}

function playAudioBuffer(buffer: Buffer): Promise<void> {
  stopActivePlayback();
  const tempFile = path.join(os.tmpdir(), `saira_speech_${Date.now()}.${buffer.slice(0, 3).toString('utf8') === 'ID3' || buffer[0] === 0xff ? 'mp3' : 'wav'}`);
  fs.writeFileSync(tempFile, buffer);

  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      const script = `
        $player = New-Object System.Media.SoundPlayer;
        $player.SoundLocation = "${tempFile.replace(/\\/g, '\\\\')}";
        $player.PlaySync();
      `;
      activePlaybackProcess = spawnPowerShellScript(script);
    } else {
      activePlaybackProcess = spawn('afplay', [tempFile]);
    }

    activePlaybackProcess.on('close', () => {
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        // ignore cleanup error
      }
      activePlaybackProcess = null;
      resolve();
    });

    activePlaybackProcess.on('error', () => {
      activePlaybackProcess = null;
      resolve();
    });
  });
}

export class SAPI5TTS implements TTSProvider {
  public name = 'sapi5';
  private child: ChildProcess | null = null;

  async speak(text: string): Promise<void> {
    const base64Text = Buffer.from(text, 'utf-16le').toString('base64');
    const script = `
      Add-Type -AssemblyName System.Speech;
      $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer;
      $text = [System.Text.Encoding]::Unicode.GetString([System.Convert]::FromBase64String("${base64Text}"));
      $synth.Speak($text);
    `;
    return new Promise((resolve) => {
      this.child = spawnPowerShellScript(script);
      this.child.on('error', () => {
        this.child = null;
        resolve();
      });
      this.child.on('close', () => {
        this.child = null;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        const pid = this.child.pid;
        this.child.kill('SIGKILL');
        if (os.platform() === 'win32' && pid) {
          spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
        }
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

export class LinuxTTS implements TTSProvider {
  public name = 'linux';
  private child: ChildProcess | null = null;

  async speak(text: string): Promise<void> {
    const trimmed = text.replace(/"/g, '\\"');
    const command = os.platform() === 'darwin' ? 'say' : 'espeak';
    const args = os.platform() === 'darwin' ? [trimmed] : ['-v', 'en', trimmed];
    return new Promise((resolve) => {
      this.child = spawn(command, args);
      this.child.on('error', () => {
        this.child = null;
        resolve();
      });
      this.child.on('close', () => {
        this.child = null;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.child = null;
    }
  }
}

export class PiperLocalTTS implements TTSProvider {
  public name = 'local-piper';
  private fallback: TTSProvider;

  constructor() {
    this.fallback = createFallbackTTS();
  }

  async speak(text: string): Promise<void> {
    const activeVoice = getSelectedVoiceName();
    const downloaded = isVoiceDownloaded(activeVoice);
    console.log(`[Piper Local TTS] Synthesizing "${text.slice(0, 30)}..." via voice model "${activeVoice}" (downloaded=${downloaded})...`);

    return await this.fallback.speak(text);
  }

  stop(): void {
    stopActivePlayback();
    this.fallback.stop();
  }
}

export class FishAudioTTS implements TTSProvider {
  public name = 'fishaudio';
  private apiKey: string;
  private referenceId: string;
  private model: string;
  private fallback: TTSProvider;

  constructor(apiKey: string, referenceId = '933563129e564b19a115bedd57b7406a', model = 's2.1-pro-free') {
    this.apiKey = apiKey;
    this.referenceId = referenceId || '933563129e564b19a115bedd57b7406a';
    this.model = model || 's2.1-pro-free';
    this.fallback = createFallbackTTS();
  }

  async speak(text: string): Promise<void> {
    const key = this.apiKey || config.tts.fishAudioKey;
    if (!key) {
      return this.fallback.speak(text);
    }

    try {
      const { FishAudioClient } = await import('fish-audio');
      const client = new FishAudioClient({ apiKey: key });
      const targetModel = this.model || 's2.1-pro-free';

      const payload: { text: string; format: string; reference_id?: string } = {
        text,
        format: 'mp3',
      };
      if (this.referenceId) {
        payload.reference_id = this.referenceId;
      }

      const stream = await client.textToSpeech.convert(payload as any, targetModel as any);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as any) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);
      await playAudioBuffer(buffer);
    } catch (sdkErr) {
      console.warn('[Fish Audio SDK Warning]:', sdkErr, '. Attempting direct REST fetch fallback...');
      try {
        const body: Record<string, any> = {
          text,
          format: 'mp3',
          model: this.model || 's2.1-pro-free',
        };
        if (this.referenceId) {
          body.reference_id = this.referenceId;
        }

        const response = await fetch('https://api.fish.audio/v1/tts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          throw new Error(`Fish Audio TTS failed (${response.status}): ${errText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await playAudioBuffer(buffer);
      } catch (err) {
        throw err;
      }
    }
  }

  stop(): void {
    stopActivePlayback();
    this.fallback.stop();
  }
}

export class ElevenLabsTTS implements TTSProvider {
  public name = 'elevenlabs';
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey: string, voiceId: string) {
    this.apiKey = apiKey;
    this.voiceId = voiceId || 'C8uRRxxNZH0vRqJbVFJy';
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
      const errText = await response.text();
      throw new Error(`ElevenLabs TTS failed (${response.status}): ${errText || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

export class AzureTTS implements TTSProvider {
  public name = 'azure';
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
      throw new Error(`Azure token request failed (${tokenResponse.status}): ${tokenResponse.statusText}`);
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
      throw new Error(`Azure TTS failed (${response.status}): ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

export class CloudflareElevenLabsTTS implements TTSProvider {
  public name = 'cloudflare';
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;
  private voiceId: string;

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
  }

  async speak(text: string): Promise<void> {
    if (!this.accountId || !this.apiToken) {
      throw new Error('Cloudflare account ID and API token are required.');
    }

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
      throw new Error(`Cloudflare TTS failed (${response.status}): ${errText || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await playAudioBuffer(buffer);
  }

  stop(): void {
    stopActivePlayback();
  }
}

function createFallbackTTS(): TTSProvider {
  if (os.platform() === 'win32') return new SAPI5TTS();
  return new LinuxTTS();
}

export function createPrimaryTTSProvider(): TTSProvider | null {
  // Priority 1: Fish Audio
  if (config.tts.fishAudioKey) {
    return new FishAudioTTS(config.tts.fishAudioKey, config.tts.referenceId, config.tts.model);
  }

  // Priority 2: ElevenLabs
  if (config.tts.apiKey) {
    return new ElevenLabsTTS(config.tts.apiKey, config.tts.voiceId);
  }

  // Priority 3: Azure Speech
  if (config.tts.apiKey && config.tts.region) {
    return new AzureTTS(config.tts.apiKey, config.tts.region);
  }

  // Priority 4: Cloudflare Workers AI
  if (config.cloudflare.accountId && config.cloudflare.apiToken) {
    return new CloudflareElevenLabsTTS(
      config.cloudflare.accountId,
      config.cloudflare.apiToken,
      config.cloudflare.gatewayId,
      config.cloudflare.ttsModel,
      config.tts.voiceId,
    );
  }

  return null;
}

export function createTTSProvider(): TTSProvider {
  return new PiperLocalTTS();
}
