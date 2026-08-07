import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['openai', 'gemini', 'groq', 'ollama', 'cloudflare']);
const sttSchema = z.enum(['openai', 'groq', 'cloudflare']);
const ttsSchema = z.enum(['sapi5', 'elevenlabs', 'azure']);

const openAiKey = process.env.OPENAI_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';
const azureKey = process.env.AZURE_SPEECH_KEY || '';

const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || '';
const cloudflareGatewayId = process.env.CLOUDFLARE_GATEWAY_ID || '';

export const config = {
  cloudflare: {
    accountId: cloudflareAccountId,
    apiToken: cloudflareApiToken,
    gatewayId: cloudflareGatewayId,
    sttModel: process.env.CLOUDFLARE_STT_MODEL || '@cf/openai/whisper',
    llmModel: process.env.CLOUDFLARE_LLM_MODEL || '@cf/meta/llama-3.1-8b-instruct',
  },
  stt: {
    provider: sttSchema.default('openai').parse(process.env.STT_PROVIDER),
    apiKey: openAiKey || groqKey || cloudflareApiToken,
    offlineBaseUrl: process.env.OFFLINE_STT_URL || 'http://localhost:8000',
  },
  llm: {
    provider: providerSchema.default('openai').parse(process.env.LLM_PROVIDER),
    apiKey: openAiKey || geminiKey || groqKey || cloudflareApiToken,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  },
  tts: {
    provider: ttsSchema.default('sapi5').parse(process.env.TTS_PROVIDER),
    apiKey: elevenLabsKey || azureKey,
    voiceId: process.env.ELEVENLABS_VOICE_ID || '',
    region: process.env.AZURE_SPEECH_REGION || '',
  },
  server: {
    port: Number(process.env.PORT || 16123),
  },
};
