import { config } from '../shared/config';
import { isLocalServerReachable } from '../shared/http-util';
import type { IntentResult } from '../shared/types';

export interface LLMProvider {
  parseIntent(text: string): Promise<IntentResult>;
}

const SYSTEM_PROMPT = `You are the intent parser for a Windows voice assistant named Saira.
Your job is to understand what the user wants and return a JSON object matching one of the allowed intents.

Allowed intents and required params:
- chat.respond: { message: string } (use this for any general conversation or question)
- reminder.create: { text: string, due: ISO-8601 datetime string }
- reminder.list: {}
- reminder.complete: { id?: number, text?: string }
- todo.create: { text: string }
- todo.list: {}
- todo.complete: { id?: number, text?: string }
- unknown: {} (use only if the request is truly nonsense)

Current date and time: ${new Date().toISOString()}

Important rules:
- If the user asks for something outside these capabilities, do NOT invent an intent. Use "chat.respond" and politely say you cannot do that yet.
- Always respond in valid JSON only. No explanations before or after the JSON.
- For relative times like "tomorrow at 5pm", output a full ISO-8601 datetime.

Example output for "remind me to call mom tomorrow at 10am":
{"intent":"reminder.create","params":{"text":"call mom","due":"2026-07-31T10:00:00"}}`;

class OpenAiLLM implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async parseIntent(text: string): Promise<IntentResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing.');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI LLM failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return JSON.parse(content) as IntentResult;
  }
}

class GroqLLM implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model || 'llama3-8b-8192';
  }

  async parseIntent(text: string): Promise<IntentResult> {
    if (!this.apiKey) throw new Error('Groq API key is missing.');

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq LLM failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return JSON.parse(content) as IntentResult;
  }
}

class GeminiLLM implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model || 'gemini-1.5-flash';
  }

  async parseIntent(text: string): Promise<IntentResult> {
    if (!this.apiKey) throw new Error('Gemini API key is missing.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: SYSTEM_PROMPT }] },
          { role: 'user', parts: [{ text }] },
        ],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini LLM failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = content.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as IntentResult;
  }
}

class OllamaLLM implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl;
    this.model = model || 'llama3.1';
  }

  async parseIntent(text: string): Promise<IntentResult> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${SYSTEM_PROMPT}\n\nUser: ${text}\n\nIntent JSON:`,
        stream: false,
        format: 'json',
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama LLM failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.response || '{}';
    const cleaned = content.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as IntentResult;
  }
}

class CloudflareLLM implements LLMProvider {
  private accountId: string;
  private apiToken: string;
  private gatewayId: string;
  private model: string;

  constructor(accountId: string, apiToken: string, gatewayId = '', model = '@cf/meta/llama-3.1-8b-instruct') {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.gatewayId = gatewayId;
    this.model = model;
  }

  async parseIntent(text: string): Promise<IntentResult> {
    if (!this.apiToken) throw new Error('Cloudflare API Token is missing.');

    if (this.gatewayId && this.accountId) {
      const response = await fetch(
        `https://gateway.ai.cloudflare.com/v1/${this.accountId}/${this.gatewayId}/openai/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiToken}`,
          },
          body: JSON.stringify({
            model: this.model || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: text },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.2,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Cloudflare AI Gateway LLM failed: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '{}';
      return JSON.parse(content) as IntentResult;
    }

    if (!this.accountId) throw new Error('Cloudflare Account ID is missing.');

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Cloudflare Workers AI LLM failed: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.result?.response || data.response || '{}';
    const cleaned = content.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned) as IntentResult;
  }
}

async function shouldUseLocal(): Promise<boolean> {
  const hasApiKey = Boolean(config.llm.apiKey);
  if (!hasApiKey) return true;
  if (config.llm.provider === 'ollama') {
    return isLocalServerReachable(`${config.llm.baseUrl}/api/tags`);
  }
  return false;
}

export async function createLLMProvider(): Promise<LLMProvider> {
  if (await shouldUseLocal()) {
    return new OllamaLLM(config.llm.baseUrl, config.llm.model);
  }

  switch (config.llm.provider) {
    case 'cloudflare':
      return new CloudflareLLM(
        config.cloudflare.accountId,
        config.cloudflare.apiToken,
        config.cloudflare.gatewayId,
        config.cloudflare.llmModel,
      );
    case 'gemini':
      return new GeminiLLM(config.llm.apiKey, config.llm.model);
    case 'groq':
      return new GroqLLM(config.llm.apiKey, config.llm.model);
    case 'ollama':
      return new OllamaLLM(config.llm.baseUrl, config.llm.model);
    case 'openai':
    default:
      return new OpenAiLLM(config.llm.apiKey, config.llm.model);
  }
}
