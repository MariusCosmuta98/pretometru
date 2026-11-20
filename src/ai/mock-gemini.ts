/**
 * Test-only: an in-memory Gemini API behind a `fetch`. It answers the two calls the app makes (the
 * description of a model and `generateContent`) with the status codes and error bodies of
 * generativelanguage.googleapis.com (the shape of a wrong-key answer was checked against the real
 * service on 2026-11-20 with a made-up key), refuses what a browser or the documentation would
 * refuse (a header outside the CORS allow-list, the key in an address, sampling parameters), and
 * lets a test break things on purpose (offline, a quota error, a blocked prompt, a held request).
 * Everything in it is fake data: never use a real key. It depends on nothing but Web APIs (no `@/`
 * import), so a browser test can serve the real app from it too (`e2e/ai.spec.ts`). Never import
 * this from application code.
 */

const API_ORIGIN = 'https://generativelanguage.googleapis.com';
// What a browser may send: the headers the preflight of the real service allows (2026-11-20).
const ALLOWED_HEADERS = new Set(['x-goog-api-key', 'content-type']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_INLINE_BYTES = 20 * 1024 * 1024;
// The generation parameters that current models ignore and that are to become errors, plus the
// field the documentation calls "an internal detail" (use responseJsonSchema).
const FORBIDDEN_CONFIG = ['temperature', 'topP', 'topK', 'thinkingConfig', 'responseSchema'];

export interface MockRequest {
  method: string;
  /** Without the query string. */
  path: string;
  query: string;
  /** Lower-case names. */
  headers: Record<string, string>;
  body: unknown;
  status: number;
}

export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** What the mock saw in a `generateContent` request. */
export interface GenerateRequest {
  model: string;
  systemInstruction: string;
  /** The text part (the instruction after the image). */
  prompt: string;
  imageMimeType: string;
  /** The image bytes, decoded from base64. */
  image: Uint8Array;
  generationConfig: Record<string, unknown>;
}

type Answer = string | MockReply | ((request: GenerateRequest) => string | MockReply);

interface Interception<T> {
  match: RegExp;
  times: number;
  value: T;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  });

/** The error answer of the real service. */
export function googleError(
  code: number,
  status: string,
  message: string,
  details: unknown[] = [],
): MockReply {
  return { status: code, body: { error: { code, message, status, details } } };
}

export const wrongKeyReply: MockReply = googleError(
  400,
  'INVALID_ARGUMENT',
  'API key not valid. Please pass a valid API key.',
  [
    {
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason: 'API_KEY_INVALID',
      domain: 'googleapis.com',
      metadata: { service: 'generativelanguage.googleapis.com' },
    },
  ],
);

/** A `generateContent` answer with one candidate. */
export function candidateReply(text: string, finishReason = 'STOP'): MockReply {
  return {
    status: 200,
    body: {
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason, index: 0 }],
      usageMetadata: { promptTokenCount: 1300, candidatesTokenCount: 400, totalTokenCount: 1700 },
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

function decodeBase64(data: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) return undefined;
  const binary = atob(data);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export class MockGemini {
  /** Every request that reached the server, in order. */
  readonly requests: MockRequest[] = [];
  /** Requests a browser or the documentation would have refused, or that leak what must not leave. */
  readonly violations: string[] = [];
  /** What `generateContent` answers: JSON text, a ready reply, or a function of the request. */
  answer: Answer = JSON.stringify({ lines: [] });

  private readonly keys = new Set<string>();
  private readonly models = new Map<string, { displayName: string; methods: string[] }>();
  private readonly faults: Array<Interception<MockReply>> = [];
  private readonly holds: Array<Interception<Promise<void>>> = [];
  private offline = false;
  private disposed = false;
  private wake: () => void = () => undefined;
  private readonly over = new Promise<void>((resolve) => {
    this.wake = resolve;
  });

  constructor(options: { keys?: string[]; models?: string[] } = {}) {
    for (const key of options.keys ?? []) this.keys.add(key);
    for (const model of options.models ?? ['gemini-3.5-flash-lite']) this.addModel(model);
  }

  addKey(key: string): this {
    this.keys.add(key);
    return this;
  }

  revokeKey(key: string): void {
    this.keys.delete(key);
  }

  addModel(id: string, methods: string[] = ['generateContent', 'countTokens']): this {
    this.models.set(id, { displayName: id, methods });
    return this;
  }

  setOffline(offline: boolean): void {
    this.offline = offline;
  }

  /** Answers the next `times` requests whose path matches with `reply`, instead of the normal answer. */
  failNext(match: RegExp, reply: MockReply, times = 1): void {
    this.faults.push({ match, times, value: reply });
  }

  /** Holds the next request whose path matches until `release` is called (or the request is aborted). */
  hold(match: RegExp): { release: () => void } {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.push({ match, times: 1, value: gate });
    return { release };
  }

  /** Lets go of every held request: call it when a test is over. */
  dispose(): void {
    this.disposed = true;
    this.wake();
  }

  /** The `generateContent` requests, parsed. */
  get generates(): GenerateRequest[] {
    return this.requests.flatMap((request) =>
      request.path.endsWith(':generateContent') && this.parsed.has(request)
        ? [this.parsed.get(request) as GenerateRequest]
        : [],
    );
  }

  private readonly parsed = new WeakMap<MockRequest, GenerateRequest>();

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const raw = typeof init.body === 'string' ? init.body : undefined;

    if (this.offline) throw new TypeError('Failed to fetch');
    if (init.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');

    const entry: MockRequest = {
      method,
      path: url.pathname,
      query: url.search,
      headers,
      body: undefined,
      status: 0,
    };
    this.requests.push(entry);
    try {
      entry.body = raw === undefined ? undefined : (JSON.parse(raw) as unknown);
    } catch {
      entry.body = raw;
    }
    this.audit(url, entry);

    await this.holdWhile(entry.path, init.signal ?? undefined);
    const reply = this.reply(entry, url);
    entry.status = reply.status;
    return json(reply.status, reply.body, reply.headers);
  };

  private audit(url: URL, entry: MockRequest): void {
    if (url.origin !== API_ORIGIN) this.violations.push(`request to another origin: ${url.origin}`);
    if (/[?&]key=/i.test(url.search)) {
      this.violations.push('the API key is in the address, it must travel in a header');
    }
    for (const name of Object.keys(entry.headers)) {
      if (!ALLOWED_HEADERS.has(name)) {
        this.violations.push(`header outside the CORS allow-list: ${name}`);
      }
    }
    if (entry.method === 'POST' && entry.headers['content-type'] !== 'application/json') {
      this.violations.push('a POST without Content-Type: application/json');
    }
  }

  private async holdWhile(path: string, signal: AbortSignal | undefined): Promise<void> {
    const index = this.holds.findIndex((hold) => hold.match.test(path));
    const [hold] = index < 0 ? [] : this.holds.splice(index, 1);
    if (!hold) return;
    const aborted = new Promise<never>((_, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        },
        { once: true },
      );
    });
    await Promise.race([hold.value, this.over, aborted]);
    if (this.disposed) throw new TypeError('Failed to fetch');
  }

  private nextFault(path: string): MockReply | undefined {
    const index = this.faults.findIndex((fault) => fault.match.test(path));
    const fault = this.faults[index];
    if (!fault) return undefined;
    fault.times -= 1;
    if (fault.times <= 0) this.faults.splice(index, 1);
    return fault.value;
  }

  private reply(entry: MockRequest, url: URL): MockReply {
    const fault = this.nextFault(entry.path);
    if (fault) return fault;

    const key = entry.headers['x-goog-api-key'];
    if (key === undefined) {
      return googleError(403, 'PERMISSION_DENIED', 'Permission denied on the service.', [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_DENIED' },
      ]);
    }
    if (!this.keys.has(key)) return wrongKeyReply;

    const match = /^\/v1beta\/models\/([^/:]+)(:generateContent)?$/.exec(url.pathname);
    if (!match?.[1]) return googleError(404, 'NOT_FOUND', 'Method not found.');
    const model = decodeURIComponent(match[1]);
    const known = this.models.get(model);
    if (!known) {
      return googleError(
        404,
        'NOT_FOUND',
        `models/${model} is not found for API version v1beta, or is not supported for generateContent.`,
      );
    }

    if (match[2] === undefined) {
      if (entry.method !== 'GET') return googleError(405, 'UNIMPLEMENTED', 'Method not allowed.');
      return {
        status: 200,
        body: {
          name: `models/${model}`,
          displayName: known.displayName,
          supportedGenerationMethods: known.methods,
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
        },
      };
    }
    if (entry.method !== 'POST') return googleError(405, 'UNIMPLEMENTED', 'Method not allowed.');
    if (!known.methods.includes('generateContent')) {
      return googleError(
        400,
        'INVALID_ARGUMENT',
        `models/${model} does not support generateContent.`,
      );
    }
    return this.generate(entry, model);
  }

  private generate(entry: MockRequest, model: string): MockReply {
    const bad = (message: string): MockReply => googleError(400, 'INVALID_ARGUMENT', message);
    const body = entry.body;
    if (!isRecord(body)) return bad('Invalid JSON payload received.');

    const contents = body['contents'];
    const parts =
      Array.isArray(contents) && isRecord(contents[0]) ? contents[0]['parts'] : undefined;
    if (!Array.isArray(parts) || parts.length < 2) return bad('contents[0].parts is required.');
    const [imagePart, textPart] = parts as unknown[];
    const inline = isRecord(imagePart) ? imagePart['inline_data'] : undefined;
    if (!isRecord(inline)) {
      this.violations.push('the image part must come first, as inline_data');
      return bad('The first part must be inline_data.');
    }
    const mimeType = textOf(inline['mime_type']);
    if (!IMAGE_TYPES.has(mimeType)) return bad(`Unsupported MIME type: ${mimeType}`);
    const image = decodeBase64(textOf(inline['data']));
    if (!image || image.length === 0) return bad('Base64 decoding failed for the image.');
    if (image.length > MAX_INLINE_BYTES) return bad('The request is larger than 20 MB.');
    if (
      mimeType === 'image/jpeg' &&
      !(image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff)
    ) {
      this.violations.push('the image is declared as JPEG but does not start like one');
    }
    if (mimeType !== 'image/jpeg') {
      this.violations.push(`the app re-encodes every photo as JPEG, not ${mimeType}`);
    }
    const prompt = isRecord(textPart) ? textOf(textPart['text']) : '';
    if (prompt === '') return bad('The text part is required after the image.');

    const config = isRecord(body['generationConfig']) ? body['generationConfig'] : {};
    if (config['responseMimeType'] !== 'application/json') {
      this.violations.push('structured output needs responseMimeType: application/json');
    }
    if (!isRecord(config['responseJsonSchema'])) {
      this.violations.push('structured output needs a responseJsonSchema object');
    }
    for (const name of FORBIDDEN_CONFIG) {
      if (name in config) this.violations.push(`generationConfig.${name} must not be sent`);
    }
    const system = body['systemInstruction'];
    const systemInstruction =
      isRecord(system) && Array.isArray(system['parts']) && isRecord(system['parts'][0])
        ? textOf(system['parts'][0]['text'])
        : '';

    const request: GenerateRequest = {
      model,
      systemInstruction,
      prompt,
      imageMimeType: mimeType,
      image,
      generationConfig: config,
    };
    this.parsed.set(entry, request);

    const answer = typeof this.answer === 'function' ? this.answer(request) : this.answer;
    return typeof answer === 'string' ? candidateReply(answer) : answer;
  }
}
