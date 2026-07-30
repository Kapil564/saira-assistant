import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [messages, setMessages] = useState<{ from: 'user' | 'saira'; text: string }[]>([]);
  const [listening, setListening] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const addMessage = (from: 'user' | 'saira', text: string) => {
    setMessages((prev) => [...prev, { from, text }]);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
        const arrayBuffer = await blob.arrayBuffer();
        (window as any).assistant.sendAudio(arrayBuffer);
        setListening(false);
      };

      mediaRecorder.start();
      setListening(true);
    } catch (err) {
      addMessage('saira', 'Microphone access is required.');
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const toggleRecording = () => {
    if (listening) stopRecording();
    else startRecording();
  };

  useEffect(() => {
    const assistant = (window as any).assistant;
    if (!assistant) return;

    assistant.onResponse((response: { spoken?: string; display?: string }) => {
      addMessage('saira', response.display || response.spoken || 'Done.');
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-slate-900 text-white p-4">
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
              m.from === 'user' ? 'ml-auto bg-blue-600' : 'bg-slate-700'
            }`}
          >
            {m.text}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-center">
        <button
          onClick={toggleRecording}
          className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-lg transition-transform ${
            listening ? 'bg-red-500 animate-pulse scale-110' : 'bg-blue-500 hover:scale-105'
          }`}
        >
          {listening ? '◼' : '🎙'}
        </button>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
