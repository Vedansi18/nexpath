/**
 * LLMPort — abstracts OpenAI-compatible chat completions.
 *
 * CLI implementation: OpenAILLMAdapter (wraps openai npm package).
 * Browser implementation: FetchLLMAdapter (uses window.fetch → api.openai.com).
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
  timeoutMs?: number;
}

export interface LLMPort {
  /** Returns the raw content string from the first choice. Never throws on API errors — callers catch. */
  chat(params: LLMChatParams): Promise<string>;
}
