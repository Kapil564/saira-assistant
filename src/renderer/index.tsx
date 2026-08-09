import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');

  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function App() {
  const [messages, setMessages] = useState<{ from: 'user' | 'saira'; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [inputText, setInputText] = useState('');

  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, status]);

  const addMessage = (from: 'user' | 'saira', text: string) => {
    setMessages((prev) => [...prev, { from, text }]);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      pcmChunksRef.current = [];

      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(inputData));
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setListening(true);
      setStatus('🎙 Listening... Speak now');
    } catch (err) {
      addMessage('saira', 'Microphone access is required.');
      setStatus('');
    }
  };

  const stopRecording = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    const chunks = pcmChunksRef.current;
    const totalSamples = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalSamples === 0) {
      setListening(false);
      setStatus('');
      return;
    }

    const pcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const chunk of chunks) {
      pcm.set(chunk, offset);
      offset += chunk.length;
    }

    const wavBuffer = encodeWav(pcm, 16000);
    setStatus('⚡ Transcribing audio...');
    const assistant = (window as any).assistant;
    if (assistant?.sendAudio) {
      assistant.sendAudio(wavBuffer);
    } else {
      addMessage('saira', 'Error: Assistant bridge is not connected.');
      setStatus('');
    }
    setListening(false);
  };

  const toggleRecording = () => {
    if (listening) stopRecording();
    else startRecording();
  };

  const handleSendText = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    const text = inputText.trim();
    setInputText('');
    setStatus('🧠 Processing request...');
    const assistant = (window as any).assistant;
    if (assistant?.sendText) {
      assistant.sendText(text);
    } else {
      addMessage('saira', 'Error: Assistant bridge is not connected.');
      setStatus('');
    }
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    assistant.onTranscript?.((data: { text: string }) => {
      if (data.text) {
        addMessage('user', data.text);
        setStatus('🧠 Processing intent...');
      } else {
        setStatus('');
      }
    });

    assistant.onResponse?.((response: { spoken?: string; display?: string }) => {
      addMessage('saira', response.display || response.spoken || 'Done.');
      setStatus('');
    });

    assistant.onError?.((error: { message: string }) => {
      addMessage('saira', `Error: ${error.message}`);
      setStatus('');
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-900 text-white p-4">
      {/* Header */}
      <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-sm">Saira Assistant</span>
        </div>
        {status && <span className="text-xs text-slate-400 italic">{status}</span>}
      </div>

      {/* Messages List */}
      <div className="flex-1 overflow-y-auto space-y-3 py-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-xs mt-12">
            Click the microphone or type below to start chatting.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
              m.from === 'user' ? 'ml-auto bg-blue-600 text-white' : 'bg-slate-800 text-slate-100 border border-slate-700'
            }`}
          >
            {m.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Controls */}
      <div className="pt-3 border-t border-slate-800 flex flex-col space-y-3">
        <form onSubmit={handleSendText} className="flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a message or command..."
            className="flex-1 bg-slate-800 text-sm border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-blue-500 transition-colors placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="bg-blue-600 disabled:opacity-40 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors"
          >
            ➤
          </button>
        </form>

        <div className="flex items-center justify-center pt-1">
          <button
            onClick={toggleRecording}
            className={`w-14 h-14 rounded-full flex items-center justify-center text-xl shadow-lg transition-all ${
              listening
                ? 'bg-red-500 animate-pulse scale-105 shadow-red-500/50'
                : 'bg-blue-600 hover:bg-blue-500 hover:scale-105 shadow-blue-500/30'
            }`}
          >
            {listening ? '◼' : '🎙'}
          </button>
        </div>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
