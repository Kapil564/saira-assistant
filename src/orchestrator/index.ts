import { Server } from 'socket.io';
import { createServer } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { executeIntent } from '../actions/executor';
import { createLLMProvider, type LLMProvider } from '../providers/llm';
import { createSTTProvider, type STTProvider } from '../providers/stt';
import { createTTSProvider, type TTSProvider } from '../providers/tts';
import { config } from '../shared/config';

export interface Orchestrator {
  io: Server;
  tts: TTSProvider;
}

export async function createOrchestrator(): Promise<Orchestrator> {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const stt = await createSTTProvider();
  const llm = await createLLMProvider();
  const tts = createTTSProvider();

  io.on('connection', (socket) => {
    console.log('renderer connected');

    socket.on('audio', async (audioBuffer: Buffer) => {
      try {
        const debugPath = path.join(process.cwd(), 'recorded_debug.wav');
        fs.writeFileSync(debugPath, audioBuffer);
        console.log(`[Audio Debug] Received ${audioBuffer.length} bytes. Saved to recorded_debug.wav`);

        if (audioBuffer.length < 100) {
          console.warn('[Audio Debug Warning] Audio buffer is nearly empty! Check microphone permissions.');
        }

        console.log(`[STT] Sending audio to provider "${config.stt.provider}"...`);
        const transcription = await stt.transcribe(audioBuffer);
        console.log(`[STT Output]: "${transcription.text}"`);
        socket.emit('transcript', { text: transcription.text });

        console.log('[LLM] Parsing intent...');
        const intent = await llm.parseIntent(transcription.text);
        console.log('[LLM Output]:', JSON.stringify(intent));
        socket.emit('intent', intent);

        console.log('[Action] Executing intent...');
        const response = await executeIntent(intent);
        console.log('[Action Output]:', JSON.stringify(response));
        socket.emit('response', response);

        console.log('[TTS] Synthesizing speech...');
        await tts.speak(response.spoken || 'Done.');
        console.log('[TTS] Finished speaking.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Pipeline Error]:', message);
        socket.emit('error', { message });
        await tts.speak('Sorry, something went wrong.');
      }
    });

    socket.on('text', async (text: string) => {
      try {
        console.log(`[Text Input]: "${text}"`);
        socket.emit('transcript', { text });

        console.log('[LLM] Parsing intent...');
        const intent = await llm.parseIntent(text);
        console.log('[LLM Output]:', JSON.stringify(intent));
        socket.emit('intent', intent);

        console.log('[Action] Executing intent...');
        const response = await executeIntent(intent);
        console.log('[Action Output]:', JSON.stringify(response));
        socket.emit('response', response);

        console.log('[TTS] Synthesizing speech...');
        await tts.speak(response.spoken || 'Done.');
        console.log('[TTS] Finished speaking.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[Pipeline Error]:', message);
        socket.emit('error', { message });
        await tts.speak('Sorry, something went wrong.');
      }
    });

    socket.on('disconnect', () => {
      console.log('renderer disconnected');
    });
  });

  httpServer.listen(config.server.port, () => {
    console.log(`Saira orchestrator listening on port ${config.server.port}`);
  });

  return { io, tts };
}
