import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answerText,
  buildGenerateRequest,
  createGeminiClient,
  errorFromReply,
  GEMINI_API,
} from './client';
import { AiError } from './errors';
import { candidateReply, googleError, MockGemini, wrongKeyReply } from './mock-gemini';
import { MAX_OUTPUT_TOKENS, RESPONSE_SCHEMA, SYSTEM_INSTRUCTION } from './prompt';
import { FAKE_KEY, fakePreparedImage } from './testing';

const MODEL = 'gemini-3.5-flash-lite';
let mock: MockGemini;
beforeEach(() => {
  mock = new MockGemini({ keys: [FAKE_KEY] });
});
afterEach(() => {
  mock.dispose();
});

function client(overrides: Partial<Parameters<typeof createGeminiClient>[0]> = {}) {
  return createGeminiClient({
    apiKey: FAKE_KEY,
    model: MODEL,
    fetch: mock.fetch,
    isOnline: () => true,
    ...overrides,
  });
}

async function failure(run: () => Promise<unknown>): Promise<AiError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AiError) return error;
    throw error;
  }
  throw new Error('It did not fail');
}

describe('the request', () => {
  it('is a generateContent call with the key in a header and nothing else that a browser would refuse', async () => {
    const api = client();
    mock.answer = JSON.stringify({ lines: [] });
    await api.readReceipt(fakePreparedImage());

    const [request] = mock.requests;
    expect(request).toMatchObject({
      method: 'POST',
      path: `/v1beta/models/${MODEL}:generateContent`,
      query: '',
      status: 200,
    });
    expect(request?.headers).toEqual({
      'x-goog-api-key': FAKE_KEY,
      'content-type': 'application/json',
    });
    expect(mock.violations).toEqual([]);
    // The key travels in the header alone.
    expect(JSON.stringify(request?.body)).not.toContain(FAKE_KEY);
  });

  it('carries the image first, then the instruction, and asks for JSON in the schema', async () => {
    const api = client();
    mock.answer = JSON.stringify({ lines: [] });
    const image = fakePreparedImage();
    await api.readReceipt(image);

    const [sent] = mock.generates;
    expect(sent).toMatchObject({
      model: MODEL,
      imageMimeType: 'image/jpeg',
      systemInstruction: SYSTEM_INSTRUCTION,
    });
    expect(btoa(String.fromCharCode(...(sent?.image ?? [])))).toBe(image.base64);
    expect(sent?.prompt).toContain('Read this receipt');
    expect(sent?.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    expect(buildGenerateRequest(image).contents[0]?.parts[0]).toHaveProperty('inline_data');
  });

  it('asks for exactly the fields the answer is read from', () => {
    const line = RESPONSE_SCHEMA.properties.lines.items;
    expect(Object.keys(RESPONSE_SCHEMA.properties).sort()).toEqual(
      [
        'chain',
        'city',
        'documentNumber',
        'documentType',
        'lines',
        'paid',
        'purchasedAt',
        'store',
        'storeCode',
        'total',
      ].sort(),
    );
    expect(Object.keys(line.properties).sort()).toEqual(
      [
        'discount',
        'ean',
        'kind',
        'name',
        'quantity',
        'total',
        'uncertain',
        'unit',
        'unitPrice',
      ].sort(),
    );
  });

  it('is only a GET of the model for the connection test: the key, nothing else', async () => {
    const info = await client().getModel();
    expect(info).toEqual({ model: MODEL, displayName: MODEL });
    expect(mock.requests).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: `/v1beta/models/${MODEL}`,
        headers: { 'x-goog-api-key': FAKE_KEY },
        body: undefined,
      }),
    ]);
    expect(mock.violations).toEqual([]);
  });

  it('puts the model id in the path as one segment, whatever it contains', async () => {
    const api = client({ model: 'a/b:c' });
    await expect(api.getModel()).rejects.toBeInstanceOf(AiError);
    expect(mock.requests[0]?.path).toBe('/v1beta/models/a%2Fb%3Ac');
    expect(GEMINI_API).toBe('https://generativelanguage.googleapis.com');
  });

  it('is checked by a mock that has teeth: a key in the address, an extra header, a sampling parameter', async () => {
    const stray = new MockGemini({ keys: [FAKE_KEY] });
    await stray.fetch(`${GEMINI_API}/v1beta/models/${MODEL}?key=${FAKE_KEY}`, {
      headers: { authorization: 'Bearer x', 'x-goog-api-key': FAKE_KEY },
    });
    await stray.fetch(`${GEMINI_API}/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': FAKE_KEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: fakePreparedImage().base64 } },
              { text: 'x' },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    expect(stray.violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining('in the address'),
        expect.stringContaining('authorization'),
        expect.stringContaining('responseMimeType'),
        expect.stringContaining('generationConfig.temperature'),
      ]),
    );
    stray.dispose();
  });
});

describe('what Google answers when it refuses', () => {
  const key = FAKE_KEY;
  const quota = (quotaId: string, retryDelay?: string) =>
    googleError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.', [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId }] },
      ...(retryDelay ? [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] : []),
    ]);
  const body = (reply: { body?: unknown }) => JSON.stringify(reply.body);

  it('tells a wrong key from a key that may not use the API', () => {
    expect(errorFromReply(400, body(wrongKeyReply), key)).toMatchObject({
      code: 'BAD_KEY',
      status: 400,
    });
    expect(errorFromReply(401, '', key).code).toBe('BAD_KEY');
    expect(
      errorFromReply(
        400,
        body(
          googleError(400, 'INVALID_ARGUMENT', 'API Key not found. Please pass a valid API key.'),
        ),
        key,
      ).code,
    ).toBe('BAD_KEY');
    expect(
      errorFromReply(
        403,
        body(googleError(403, 'PERMISSION_DENIED', 'Requests from referer <empty> are blocked.')),
        key,
      ).code,
    ).toBe('FORBIDDEN');
  });

  it('tells a missing model, an account without the free tier and a request that is just wrong', () => {
    expect(
      errorFromReply(404, body(googleError(404, 'NOT_FOUND', 'models/x is not found')), key).code,
    ).toBe('MODEL_NOT_FOUND');
    expect(
      errorFromReply(
        400,
        body(
          googleError(
            400,
            'FAILED_PRECONDITION',
            'User location is not supported for the API use.',
          ),
        ),
        key,
      ).code,
    ).toBe('REGION');
    expect(
      errorFromReply(400, body(googleError(400, 'INVALID_ARGUMENT', 'Unknown name "foo".')), key)
        .code,
    ).toBe('REJECTED');
    expect(errorFromReply(418, '', key).code).toBe('REJECTED');
  });

  it('tells the per-minute limit from the daily quota and passes on how long to wait', () => {
    const minute = errorFromReply(
      429,
      body(quota('GenerateContentInputTokensPerModelPerMinute-FreeTier', '34s')),
      key,
    );
    expect(minute).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 34 });
    const day = errorFromReply(
      429,
      body(quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '34.5s')),
      key,
    );
    expect(day).toMatchObject({ code: 'QUOTA', retryAfterSeconds: 35 });
    expect(errorFromReply(429, body(quota('X', '99999s')), key).retryAfterSeconds).toBe(3600);
    expect(errorFromReply(429, '', key)).toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: undefined,
    });
  });

  it('calls a server failure a server failure, with or without a JSON body', () => {
    expect(
      errorFromReply(503, body(googleError(503, 'UNAVAILABLE', 'The model is overloaded.')), key)
        .code,
    ).toBe('SERVER');
    expect(errorFromReply(500, '<html>oops</html>', key).code).toBe('SERVER');
    expect(errorFromReply(504, '', key).code).toBe('SERVER');
  });

  it('never repeats the key, even when Google echoes it', () => {
    const echoing = googleError(
      400,
      'INVALID_ARGUMENT',
      `Bad request for key ${key} (really: ${key})`,
    );
    const error = errorFromReply(400, body(echoing), key);
    expect(error.detail).toContain('…');
    expect(`${error.message} ${error.detail}`).not.toContain(key);
  });

  it('comes out of a real call as the same error', async () => {
    const api = client();
    mock.failNext(/generateContent/, quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    await expect(failure(() => api.readReceipt(fakePreparedImage()))).resolves.toMatchObject({
      code: 'QUOTA',
      status: 429,
    });

    const wrong = createGeminiClient({
      apiKey: 'a-key-the-mock-never-heard-of-0000',
      model: MODEL,
      fetch: mock.fetch,
      isOnline: () => true,
    });
    await expect(failure(() => wrong.getModel())).resolves.toMatchObject({ code: 'BAD_KEY' });
    await expect(failure(() => client({ model: 'gemini-gone' }).getModel())).resolves.toMatchObject(
      { code: 'MODEL_NOT_FOUND' },
    );
  });

  it('notices a model that cannot generate content', async () => {
    const api = client({ model: 'text-embedding-x' });
    mock.addModel('text-embedding-x', ['embedContent']);
    await expect(failure(() => api.getModel())).resolves.toMatchObject({
      code: 'MODEL_UNSUPPORTED',
    });
  });
});

describe('what the answer can be', () => {
  const reply = (candidate: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ candidates: [candidate], ...extra });
  const text = (value: string, finishReason?: string) => ({
    content: { parts: [{ text: value }] },
    ...(finishReason ? { finishReason } : {}),
  });
  const failing = (body: string): AiError => {
    try {
      answerText(body);
    } catch (error) {
      if (error instanceof AiError) return error;
    }
    throw new Error('It was accepted');
  };

  it('is the text of a finished candidate; thoughts are not part of it', () => {
    expect(answerText(reply(text('{"lines":[]}', 'STOP')))).toBe('{"lines":[]}');
    expect(
      answerText(
        reply({
          content: {
            parts: [{ text: 'thinking…', thought: true }, { text: '{"a":' }, { text: '1}' }],
          },
        }),
      ),
    ).toBe('{"a":1}');
  });

  it('is blocked when the prompt or the answer was stopped by a filter, and the reason is kept', () => {
    expect(failing(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }))).toMatchObject({
      code: 'BLOCKED',
      detail: 'SAFETY',
    });
    expect(failing(reply(text('x', 'SPII')))).toMatchObject({ code: 'BLOCKED', detail: 'SPII' });
    expect(failing(reply(text('x', 'PROHIBITED_CONTENT'))).code).toBe('BLOCKED');
    expect(failing(reply(text('x', 'RECITATION'))).code).toBe('BLOCKED');
  });

  it('is cut or broken when the limit was reached or Gemini says so', () => {
    expect(failing(reply(text('{"lines":[{"na', 'MAX_TOKENS'))).code).toBe('TRUNCATED');
    expect(failing(reply(text('x', 'MALFORMED_RESPONSE'))).code).toBe('MALFORMED');
  });

  it('is empty without a candidate or without text', () => {
    expect(failing('{}').code).toBe('EMPTY_ANSWER');
    expect(failing(reply({ content: { parts: [] }, finishReason: 'STOP' })).code).toBe(
      'EMPTY_ANSWER',
    );
    expect(failing(reply(text('   ', 'STOP'))).code).toBe('EMPTY_ANSWER');
  });

  it('is malformed when the reply is not the reply of the API', () => {
    expect(failing('<html></html>').code).toBe('MALFORMED');
    expect(failing(JSON.stringify({ candidates: 'x' })).code).toBe('MALFORMED');
    expect(failing(JSON.stringify({ candidates: [{ content: { parts: 'x' } }] })).code).toBe(
      'MALFORMED',
    );
  });

  it('reaches the caller through a real call', async () => {
    const api = client();
    mock.answer = candidateReply('{"lines":[]}', 'SAFETY');
    await expect(failure(() => api.readReceipt(fakePreparedImage()))).resolves.toMatchObject({
      code: 'BLOCKED',
      detail: 'SAFETY',
    });
  });
});

describe('the connection', () => {
  it('fails fast offline, without a request', async () => {
    const api = client({ isOnline: () => false });
    await expect(failure(() => api.readReceipt(fakePreparedImage()))).resolves.toMatchObject({
      code: 'OFFLINE',
    });
    expect(mock.requests).toEqual([]);
  });

  it('tells "could not reach Google" from "the device is offline"', async () => {
    mock.setOffline(true);
    await expect(failure(() => client().getModel())).resolves.toMatchObject({ code: 'NETWORK' });

    // The device goes offline between the check before the request and the failure of the request.
    let calls = 0;
    const flipping = client({ isOnline: () => ++calls < 2 });
    await expect(failure(() => flipping.getModel())).resolves.toMatchObject({ code: 'OFFLINE' });
  });

  it('stops when the caller cancels, and gives up after the timeout', async () => {
    const controller = new AbortController();
    const cancelling = client({ signal: controller.signal });
    mock.hold(/models/);
    const pending = failure(() => cancelling.getModel());
    controller.abort();
    await expect(pending).resolves.toMatchObject({ code: 'CANCELLED' });

    const slow = client({ timeoutMs: 20 });
    mock.hold(/models/);
    await expect(failure(() => slow.getModel())).resolves.toMatchObject({ code: 'TIMEOUT' });
  });
});
