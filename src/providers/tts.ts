import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { config } from '../shared/config';

export interface TTSProvider {
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

class SAPI5TTS implements TTSProvider {
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

class LinuxTTS implements TTSProvider {
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

class FishAudioTTS implements TTSProvider {
  private apiKey: string;
  private referenceId: string;
  private model: string;
  private fallback: TTSProvider;

  constructor(apiKey: string, referenceId = '', model = 's2.1-pro-free') {
    this.apiKey = apiKey;
    this.referenceId = referenceId;
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
          console.warn(`[Fish Audio TTS Warning] (${response.status}): ${errText}. Falling back to system TTS.`);
          return await this.fallback.speak(text);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        await playAudioBuffer(buffer);
      } catch (err) {
        console.warn('[Fish Audio TTS Error]:', err, '. Falling back to system TTS.');
        await this.fallback.speak(text);
      }
    }
  }

  stop(): void {
    stopActivePlayback();
    this.fallback.stop();
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

  stop(): void {
    stopActivePlayback();
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

  stop(): void {
    stopActivePlayback();
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

  stop(): void {
    stopActivePlayback();
    this.fallback.stop();
  }
}

async function playAudioBuffer(buffer: Buffer): Promise<void> {
  stopActivePlayback();

  const tempPath = path.join(os.tmpdir(), `saira_tts_${Date.now()}.mp3`);
  fs.writeFileSync(tempPath, buffer);

  const fileUri = `file:///${tempPath.replace(/\\/g, '/')}`;
  const script = `
    Add-Type -AssemblyName presentationCore;
    $player = New-Object System.Windows.Media.MediaPlayer;
    $player.Open([System.Uri]"${fileUri}");
    $player.Play();
    Start-Sleep -Milliseconds 500;
    $count = 0;
    while ($count -lt 300) {
      if ($player.NaturalDuration.HasTimeSpan -and ($player.Position -ge $player.NaturalDuration.TimeSpan)) { break }
      Start-Sleep -Milliseconds 100;
      $count++;
    }
  `;

  return new Promise((resolve) => {
    activePlaybackProcess = spawnPowerShellScript(script);
    
    activePlaybackProcess.on('error', () => {
      activePlaybackProcess = null;
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      resolve();
    });

    activePlaybackProcess.on('close', () => {
      activePlaybackProcess = null;
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
      resolve();
    });
  });
}

class QueuedTTS implements TTSProvider {
  private baseProvider: TTSProvider;
  private queue: Array<{ text: string; resolve: () => void }> = [];
  private isProcessing = false;

  constructor(baseProvider: TTSProvider) {
    this.baseProvider = baseProvider;
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ text, resolve });
      this.processQueue();
    });
  }

  stop(): void {
    console.log('[TTS Queue] Interruption requested. Stopping audio playback and clearing queue.');
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.resolve();
    }
    stopActivePlayback();
    this.baseProvider.stop();
    this.isProcessing = false;
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const current = this.queue[0];
      try {
        await this.baseProvider.speak(current.text);
      } catch (err) {
        console.warn('[TTS Queue] Speech item interrupted or failed:', err);
      } finally {
        this.queue.shift();
        current.resolve();
      }
    }

    this.isProcessing = false;
  }
}

function createFallbackTTS(): TTSProvider {
  if (os.platform() === 'win32') return new SAPI5TTS();
  return new LinuxTTS();
}

export function createTTSProvider(): TTSProvider {
  let provider: TTSProvider;
  switch (config.tts.provider) {
    case 'cloudflare':
      if (config.cloudflare.accountId && config.cloudflare.apiToken) {
        provider = new CloudflareElevenLabsTTS(
          config.cloudflare.accountId,
          config.cloudflare.apiToken,
          config.cloudflare.gatewayId,
          config.cloudflare.ttsModel,
          config.tts.voiceId,
        );
      } else {
        provider = createFallbackTTS();
      }
      break;
    case 'fishaudio':
      provider = config.tts.fishAudioKey
        ? new FishAudioTTS(config.tts.fishAudioKey, config.tts.referenceId, config.tts.model)
        : createFallbackTTS();
      break;
    case 'elevenlabs':
      provider = config.tts.apiKey ? new ElevenLabsTTS(config.tts.apiKey, config.tts.voiceId) : createFallbackTTS();
      break;
    case 'azure':
      provider = (config.tts.apiKey && config.tts.region) ? new AzureTTS(config.tts.apiKey, config.tts.region) : createFallbackTTS();
      break;
    case 'sapi5':
    default:
      provider = createFallbackTTS();
      break;
  }
  return new QueuedTTS(provider);
}
