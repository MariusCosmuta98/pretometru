import type { ParsedReceipt } from '@/domain';
import { createGeminiClient } from './client';
import { convertAnswer } from './convert';
import { readAiConfig, readApiKey } from './config';
import { AiError, isAiError } from './errors';
import { prepareImage } from './image';
import { getAiServices } from './services';
import type { AiPhase } from './types';

export interface ReadOptions {
  signal?: AbortSignal | undefined;
  /** `preparing` while the photo is resized and re-encoded, `sending` from the moment it is sent. */
  onPhase?: (phase: AiPhase) => void;
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new AiError('CANCELLED', 'The reading was cancelled');
}

/**
 * Reads a photo of a receipt with Gemini: the one place where an image leaves the device. It
 * refuses (and sends nothing) unless the feature is on and a key is saved; it works offline-safe
 * (nothing is attempted without a connection), resizes and re-encodes the photo first, sends it
 * once, and turns the answer into a `ParsedReceipt` through the same checks as any other engine
 * (`convertAnswer`). Call it only after the user confirmed what is sent. Fails with an `AiError`.
 */
export async function readReceiptWithGemini(
  image: Blob,
  options: ReadOptions = {},
): Promise<ParsedReceipt> {
  const services = getAiServices();
  const db = await services.getDb();
  const config = await readAiConfig(db);
  if (!config.hasKey) throw new AiError('NO_KEY', 'No API key is saved');
  if (!config.enabled) throw new AiError('NOT_ENABLED', 'The AI reading is switched off');
  const apiKey = await readApiKey(db);
  if (apiKey === undefined) throw new AiError('NO_KEY', 'No API key is saved');
  if (!services.isOnline()) throw new AiError('OFFLINE', 'The device is offline');
  throwIfCancelled(options.signal);

  options.onPhase?.('preparing');
  let prepared;
  try {
    prepared = await (services.prepareImage ?? prepareImage)(image);
  } catch (error) {
    throw isAiError(error)
      ? error
      : new AiError('IMAGE_UNREADABLE', 'The photo cannot be prepared for sending', {
          cause: error,
        });
  }
  throwIfCancelled(options.signal);

  options.onPhase?.('sending');
  const answer = await createGeminiClient({
    apiKey,
    model: config.model,
    fetch: services.fetch,
    isOnline: services.isOnline,
    signal: options.signal,
  }).readReceipt(prepared);
  throwIfCancelled(options.signal);

  return convertAnswer(answer, { model: config.model, now: services.now() });
}
