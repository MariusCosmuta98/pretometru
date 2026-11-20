import { createGeminiClient } from './client';
import { isPlausibleApiKey, isValidModelId, readAiConfig, readApiKey } from './config';
import { AiError } from './errors';
import { getAiServices } from './services';
import type { ModelInfo } from './types';

export interface ConnectionTestOptions {
  /** A key that is not saved yet; the saved one by default. */
  apiKey?: string;
  /** A model that is not saved yet; the saved one by default. */
  model?: string;
  signal?: AbortSignal | undefined;
}

/**
 * The connection test of the Settings section: asks Google for the description of the model, with
 * the key in its header. That proves the key, the model id and the CORS path in one call, and
 * sends no receipt data (nor any image). It works while the feature is still switched off, so a
 * key can be tried before it is switched on.
 */
export async function testGeminiConnection(
  options: ConnectionTestOptions = {},
): Promise<ModelInfo> {
  const services = getAiServices();
  const db = await services.getDb();
  const apiKey = options.apiKey ?? (await readApiKey(db));
  if (apiKey === undefined) throw new AiError('NO_KEY', 'No API key is saved');
  if (!isPlausibleApiKey(apiKey)) throw new AiError('INVALID_KEY', 'That is not an API key');
  const model = options.model ?? (await readAiConfig(db)).model;
  if (!isValidModelId(model)) throw new AiError('INVALID_MODEL', 'That is not a model id');

  return createGeminiClient({
    apiKey,
    model,
    fetch: services.fetch,
    isOnline: services.isOnline,
    signal: options.signal,
  }).getModel();
}
