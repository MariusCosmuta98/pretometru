import { z } from 'zod';
import { AiError, isAbortError } from './errors';
import { MAX_OUTPUT_TOKENS, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION, USER_PROMPT } from './prompt';
import type { ModelInfo, PreparedImage } from './types';

/** The only host the module talks to (plan §11; the CSP allows exactly this origin). */
export const GEMINI_API = 'https://generativelanguage.googleapis.com';

/** A model that thinks can take a while; after this the request is given up. */
export const REQUEST_TIMEOUT_MS = 120_000;

export interface GeminiClientOptions {
  /** Travels in the `x-goog-api-key` header, never in an address. */
  apiKey: string;
  /** Validated by the caller (`isValidModelId`): it becomes part of the path. */
  model: string;
  fetch: typeof fetch;
  /** `false` fails fast with `OFFLINE`; the default trusts `navigator.onLine`. */
  isOnline?: () => boolean;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

export interface GeminiClient {
  /**
   * The model's description. It checks the key and the model id and sends nothing but them: the
   * connection test of the Settings section.
   */
  getModel(): Promise<ModelInfo>;
  /** Sends the photo and returns the JSON text the model answered with. */
  readReceipt(image: PreparedImage): Promise<string>;
}

/**
 * The body of `generateContent`: the image part first and the instruction after it (the order
 * Google's guide recommends), JSON out in the shape of `RESPONSE_SCHEMA`. No `temperature`,
 * `topP`, `topK` or `thinkingConfig`: the first three are ignored (and soon refused) by current
 * models and the last is an error on older ones.
 */
export function buildGenerateRequest(image: PreparedImage) {
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: image.mimeType, data: image.base64 } },
          { text: USER_PROMPT },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };
}

const GoogleErrorSchema = z.looseObject({
  error: z.looseObject({
    message: z.string().optional(),
    status: z.string().optional(),
    details: z
      .array(
        z.looseObject({
          reason: z.string().optional(),
          retryDelay: z.string().optional(),
          violations: z.array(z.looseObject({ quotaId: z.string().optional() })).optional(),
        }),
      )
      .optional(),
  }),
});

const MAX_DETAIL = 300;

function redact(text: string, apiKey: string): string {
  return apiKey === '' ? text : text.split(apiKey).join('…');
}

/** `RetryInfo.retryDelay` is a duration such as `"34s"` or `"34.5s"`. */
function retryAfterSeconds(delay: string | undefined): number | undefined {
  const match = delay === undefined ? null : /^(\d+(?:\.\d+)?)s$/.exec(delay);
  return match ? Math.min(3600, Math.max(1, Math.ceil(Number(match[1])))) : undefined;
}

/**
 * Google's error answer as an `AiError`. `Retry-After` is not exposed to a browser, so the wait
 * comes from the body (`RetryInfo`). The key is removed from whatever Google wrote back.
 */
export function errorFromReply(status: number, body: string, apiKey: string): AiError {
  let google: z.infer<typeof GoogleErrorSchema>['error'] | undefined;
  try {
    const parsed = GoogleErrorSchema.safeParse(JSON.parse(body));
    if (parsed.success) google = parsed.data.error;
  } catch {
    // Not JSON (a proxy's page, an empty answer): the status alone decides.
  }
  const details = google?.details ?? [];
  const message = google?.message ?? '';
  const detail = redact([google?.status, message].filter(Boolean).join(': '), apiKey)
    .slice(0, MAX_DETAIL)
    .trim();
  const options = { status, ...(detail === '' ? {} : { detail }) };

  if (
    status === 401 ||
    details.some((item) => item.reason === 'API_KEY_INVALID') ||
    (status === 400 && /api key/i.test(message))
  ) {
    return new AiError('BAD_KEY', 'Google rejected the API key', options);
  }
  if (status === 400 && google?.status === 'FAILED_PRECONDITION') {
    return new AiError('REGION', 'Google refused the request: a precondition failed', options);
  }
  if (status === 403)
    return new AiError('FORBIDDEN', 'The key may not use the Gemini API', options);
  if (status === 404) return new AiError('MODEL_NOT_FOUND', 'The model was not found', options);
  if (status === 429) {
    const wait = retryAfterSeconds(details.find((item) => item.retryDelay)?.retryDelay);
    const daily =
      details.some((item) => item.violations?.some((v) => /perday/i.test(v.quotaId ?? ''))) ||
      /per day|daily/i.test(message);
    return new AiError(daily ? 'QUOTA' : 'RATE_LIMITED', 'Google limited the requests', {
      ...options,
      ...(wait === undefined ? {} : { retryAfterSeconds: wait }),
    });
  }
  if (status >= 500 || status === 408) {
    return new AiError('SERVER', `Google answered ${status}`, options);
  }
  if (status >= 400)
    return new AiError('REJECTED', `Google refused the request (${status})`, options);
  return new AiError('UNEXPECTED', `Google answered ${status}`, options);
}

const ReplySchema = z.looseObject({
  candidates: z
    .array(
      z.looseObject({
        content: z
          .looseObject({
            parts: z
              .array(
                z.looseObject({ text: z.string().optional(), thought: z.boolean().optional() }),
              )
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
});

/**
 * The text of the first candidate of a `generateContent` answer. A blocked prompt, an answer cut
 * by the output limit or stopped by a filter (the finish reason is kept as `detail`) and an empty
 * answer are errors: only a finished answer with text comes back.
 */
export function answerText(body: string): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (cause) {
    throw new AiError('MALFORMED', 'The reply of Gemini is not JSON', { cause });
  }
  const reply = ReplySchema.safeParse(json);
  if (!reply.success) throw new AiError('MALFORMED', 'The reply of Gemini has an unexpected shape');

  const candidate = reply.data.candidates?.[0];
  if (!candidate) {
    const reason = reply.data.promptFeedback?.blockReason;
    throw reason
      ? new AiError('BLOCKED', 'Google blocked the request', { detail: reason })
      : new AiError('EMPTY_ANSWER', 'Gemini returned no candidate');
  }
  const reason = candidate.finishReason;
  if (reason === 'MAX_TOKENS') {
    throw new AiError('TRUNCATED', 'The answer reached the output limit', { detail: reason });
  }
  if (reason === 'MALFORMED_RESPONSE') {
    throw new AiError('MALFORMED', 'Gemini reported a malformed response', { detail: reason });
  }
  if (reason !== undefined && reason !== 'STOP' && reason !== 'FINISH_REASON_UNSPECIFIED') {
    throw new AiError('BLOCKED', `The answer was stopped: ${reason}`, { detail: reason });
  }

  const text = (candidate.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? '')
    .join('');
  if (text.trim() === '') throw new AiError('EMPTY_ANSWER', 'Gemini returned no text');
  return text;
}

const ModelSchema = z.looseObject({
  displayName: z.string().optional(),
  supportedGenerationMethods: z.array(z.string()).optional(),
});

/** An abort signal that fires when the caller's does or when `timeoutMs` pass. */
function withTimeout(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * A client of the two Gemini REST calls the app needs: the description of a model (connection
 * test) and `generateContent` (the reading). Only `x-goog-api-key` and `Content-Type` are ever
 * sent: the two headers that generativelanguage.googleapis.com's CORS policy lets a browser use
 * (checked 2026-11-20, docs/architecture.md section 16). Failures are `AiError`s.
 */
export function createGeminiClient(options: GeminiClientOptions): GeminiClient {
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const model = `${GEMINI_API}/v1beta/models/${encodeURIComponent(options.model)}`;

  async function send(
    method: 'GET' | 'POST',
    url: string,
    body?: unknown,
  ): Promise<{ status: number; text: string }> {
    if (!isOnline()) throw new AiError('OFFLINE', 'The device is offline');
    const link = withTimeout(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const response = await options.fetch(url, {
        method,
        headers: {
          'x-goog-api-key': options.apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? null : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
        signal: link.signal,
      });
      return { status: response.status, text: await response.text() };
    } catch (error) {
      if (link.timedOut()) {
        throw new AiError('TIMEOUT', 'Gemini did not answer in time', { cause: error });
      }
      if (isAbortError(error) || options.signal?.aborted) {
        throw new AiError('CANCELLED', 'The reading was cancelled', { cause: error });
      }
      throw isOnline()
        ? new AiError('NETWORK', 'Google could not be reached', { cause: error })
        : new AiError('OFFLINE', 'The device is offline', { cause: error });
    } finally {
      link.dispose();
    }
  }

  return {
    async getModel() {
      const reply = await send('GET', model);
      if (reply.status !== 200) throw errorFromReply(reply.status, reply.text, options.apiKey);
      let info: z.infer<typeof ModelSchema> = {};
      try {
        const parsed = ModelSchema.safeParse(JSON.parse(reply.text));
        if (parsed.success) info = parsed.data;
      } catch {
        // A 200 without a readable body still proves the key and the model.
      }
      if (
        info.supportedGenerationMethods &&
        !info.supportedGenerationMethods.includes('generateContent')
      ) {
        throw new AiError('MODEL_UNSUPPORTED', 'The model cannot generate content');
      }
      return {
        model: options.model,
        ...(info.displayName ? { displayName: info.displayName } : {}),
      };
    },

    async readReceipt(image) {
      const reply = await send('POST', `${model}:generateContent`, buildGenerateRequest(image));
      if (reply.status !== 200) throw errorFromReply(reply.status, reply.text, options.apiKey);
      return answerText(reply.text);
    },
  };
}
