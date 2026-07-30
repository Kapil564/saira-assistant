import { Server } from 'socket.io';
import { createServer } from 'node:http';
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
        const transcription = await stt.transcribe(audioBuffer);
        socket.emit('transcript', { text: transcription.text });

        const intent = await llm.parseIntent(transcription.text);
        socket.emit('intent', intent);

        const response = await executeIntent(intent);
        socket.emit('response', response);

        await tts.speak(response.spoken || 'Done.');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
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
