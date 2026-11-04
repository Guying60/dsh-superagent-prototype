/**
 * LLM provider layer — an OpenAI-compatible chat client with retries, timeouts,
 * usage accounting and an injectable transport.
 *
 * DeepSeek's API is OpenAI-compatible (`POST {base}/chat/completions`), so the same
 * client works against any compatible endpoint by changing `baseUrl`.
 *
 * Design notes:
 * - no dependency on an SDK: `fetch` (Node >= 18) is the only transport
 * - retryable = 429 / 5xx / network / timeout. Auth and validation errors are NOT retried,
 *   because retrying a bad API key only burns time.
 * - the API key never appears in an error message or a log line.
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** ask the server for a strict JSON object (supported by deepseek-chat) */
  jsonMode?: boolean;
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmResponse {
  content: string;
  usage: LlmUsage;
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: LlmMessage[], options?: LlmChatOptions): Promise<LlmResponse>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly retryable = false,
    public readonly snippet?: string
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Minimal transport shape so tests can inject a fake fetch without any network. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const defaultFetch: FetchLike = async (url, init) => {
  const fn = (globalThis as unknown as { fetch?: FetchLike }).fetch;
  if (typeof fn !== 'function') {
    throw new LlmError('global fetch is unavailable (Node >= 18 is required)');
  }
  return fn(url, init);
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const estimateTokens = (text: string): number => Math.max(1, Math.ceil((text ?? '').length / 4));

export interface DeepSeekOptions {
  apiKey: string;
  /** default https://api.deepseek.com */
  baseUrl?: string;
  /** default deepseek-chat */
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  temperature?: number;
  maxTokens?: number;
  /** request `response_format: { type: 'json_object' }` */
  jsonMode?: boolean;
  /** injected transport (tests) */
  fetchImpl?: FetchLike;
}

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RETRIES = 2;

export class DeepSeekProvider implements LlmProvider {
  public readonly name = 'deepseek';
  public readonly model: string;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly jsonMode: boolean;
  private readonly fetchImpl: FetchLike;

  constructor(options: DeepSeekOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new LlmError('DEEPSEEK_API_KEY is not set');
    }
    this.apiKey = options.apiKey.trim();
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.temperature = options.temperature ?? 0.2;
    this.maxTokens = options.maxTokens ?? 2048;
    this.jsonMode = options.jsonMode ?? true;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  /** Masked form, safe to print. */
  public describe(): string {
    return `${this.name}:${this.model} @ ${this.baseUrl}`;
  }

  public async chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<LlmResponse> {
    const body: Record<string, any> = {
      model: options.model ?? this.model,
      messages,
      temperature: options.temperature ?? this.temperature,
      max_tokens: options.maxTokens ?? this.maxTokens,
      stream: false
    };
    if (options.jsonMode ?? this.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const payload = JSON.stringify(body);
    let lastError: LlmError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const relay = () => controller.abort();
      options.signal?.addEventListener('abort', relay, { once: true });

      try {
        const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.apiKey}`
          },
          body: payload,
          signal: controller.signal
        });

        const text = await response.text();

        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500;
          const error = new LlmError(
            `DeepSeek request failed with HTTP ${response.status}`,
            response.status,
            retryable,
            redact(text).slice(0, 300)
          );
          if (retryable && attempt < this.maxRetries) {
            lastError = error;
            await sleep(400 * 2 ** attempt + Math.random() * 120);
            continue;
          }
          throw error;
        }

        let parsed: any;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new LlmError('DeepSeek returned a non-JSON body', response.status, false, redact(text).slice(0, 300));
        }

        const content: string | undefined = parsed?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || content.trim().length === 0) {
          throw new LlmError(
            'DeepSeek response contained no message content',
            response.status,
            false,
            redact(text).slice(0, 300)
          );
        }

        const promptTokens: number = parsed?.usage?.prompt_tokens ?? estimateTokens(messages.map(m => m.content).join('\n'));
        const completionTokens: number = parsed?.usage?.completion_tokens ?? estimateTokens(content);

        return {
          content,
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: parsed?.usage?.total_tokens ?? promptTokens + completionTokens
          },
          model: String(parsed?.model ?? body.model),
          latencyMs: Date.now() - started
        };
      } catch (err: any) {
        const aborted = err?.name === 'AbortError' || controller.signal.aborted;
        const error =
          err instanceof LlmError
            ? err
            : new LlmError(
                aborted ? `DeepSeek request timed out after ${timeoutMs}ms` : `DeepSeek transport error: ${err?.message ?? err}`,
                0,
                true
              );

        if (error.retryable && attempt < this.maxRetries) {
          lastError = error;
          await sleep(400 * 2 ** attempt + Math.random() * 120);
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', relay);
      }
    }

    throw lastError ?? new LlmError('DeepSeek request failed');
  }
}

/** Strip anything that looks like a bearer token before it can reach a log. */
export function redact(text: string): string {
  return String(text ?? '').replace(/(sk-|Bearer\s+)[A-Za-z0-9._\-]{6,}/gi, '$1***');
}

// ---------------------------------------------------------------------------
// In-memory provider used by tests (and by `--mock-llm`)
// ---------------------------------------------------------------------------

export type MockHandler = (messages: LlmMessage[], options: LlmChatOptions) => Promise<string> | string;

export class MockLlmProvider implements LlmProvider {
  public readonly name = 'mock';
  public readonly model: string;
  public calls = 0;

  constructor(private handler: MockHandler, model = 'mock-model') {
    this.model = model;
  }

  public async chat(messages: LlmMessage[], options: LlmChatOptions = {}): Promise<LlmResponse> {
    this.calls++;
    const content = await this.handler(messages, options);
    const promptTokens = estimateTokens(messages.map(m => m.content).join('\n'));
    const completionTokens = estimateTokens(content);
    return {
      content,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      model: this.model,
      latencyMs: 1
    };
  }
}
