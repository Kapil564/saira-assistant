import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.enum(['openai', 'gemini', 'groq', 'ollama', 'cloudflare']);
const sttSchema = z.enum(['openai', 'groq', 'cloudflare']);
const ttsSchema = z.enum(['sapi5', 'fishaudio', 'elevenlabs', 'azure', 'cloudflare']);

const openAiKey = process.env.OPENAI_API_KEY || '';
const groqKey = process.env.GROQ_API_KEY || '';
const geminiKey = process.env.GEMINI_API_KEY || '';
const fishAudioKey = process.env.FISH_AUDIO_API_KEY || process.env.FISH_AUDIO_KEY || '';
const elevenLabsKey = process.env.ELEVENLABS_API_KEY || '';
const azureKey = process.env.AZURE_SPEECH_KEY || '';

const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || '';
const cloudflareGatewayId = process.env.CLOUDFLARE_GATEWAY_ID || '';

const defaultStt = (cloudflareAccountId && cloudflareApiToken) ? 'cloudflare' : (groqKey ? 'groq' : 'openai');
const defaultLlm = (cloudflareAccountId && cloudflareApiToken) ? 'cloudflare' : (geminiKey ? 'gemini' : (groqKey ? 'groq' : 'openai'));
const defaultTts = fishAudioKey ? 'fishaudio' : (elevenLabsKey ? 'elevenlabs' : ((cloudflareAccountId && cloudflareApiToken) ? 'cloudflare' : (azureKey ? 'azure' : 'sapi5')));

export const config = {
  cloudflare: {
    accountId: cloudflareAccountId,
    apiToken: cloudflareApiToken,
    gatewayId: cloudflareGatewayId,
    sttModel: process.env.CLOUDFLARE_STT_MODEL || '@cf/openai/whisper',
    llmModel: process.env.CLOUDFLARE_LLM_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    ttsModel: process.env.CLOUDFLARE_TTS_MODEL || (cloudflareGatewayId ? 'elevenlabs/eleven-multilingual-v2' : '@cf/myshell/melotts-english'),
  },
  stt: {
    provider: sttSchema.default(defaultStt).parse(process.env.STT_PROVIDER),
    apiKey: openAiKey || groqKey || cloudflareApiToken,
    offlineBaseUrl: process.env.OFFLINE_STT_URL || 'http://localhost:8000',
  },
  llm: {
    provider: providerSchema.default(defaultLlm).parse(process.env.LLM_PROVIDER),
    apiKey: openAiKey || geminiKey || groqKey || cloudflareApiToken,
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  },
  tts: {
    provider: ttsSchema.default(defaultTts).parse(process.env.TTS_PROVIDER),
    apiKey: fishAudioKey || elevenLabsKey || azureKey || cloudflareApiToken,
    fishAudioKey,
    elevenLabsKey,
    azureKey,
    referenceId: process.env.FISH_AUDIO_REFERENCE_ID || process.env.FISH_AUDIO_VOICE_ID || '933563129e564b19a115bedd57b7406a',
    model: process.env.FISH_AUDIO_MODEL || 's2.1-pro-free',
    voiceId: process.env.ELEVENLABS_VOICE_ID || 'C8uRRxxNZH0vRqJbVFJy',
    region: process.env.AZURE_SPEECH_REGION || '',
  },
  server: {
    port: Number(process.env.PORT || 16123),
  },
};

