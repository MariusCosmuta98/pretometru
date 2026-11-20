// Public surface of the optional Gemini reading of a photo (React-free). Import from '@/ai'.
//
// Importing this costs almost nothing: the settings, the Romanian texts and two thin wrappers. The
// REST client, the prompt, the conversion of the answer and the image code load with the first
// reading or connection test (a chunk of their own), so a user who never switches the feature on
// never downloads or runs them. Docs: docs/architecture.md section 16.
import type { ParsedReceipt } from '@/domain';
import type { ConnectionTestOptions } from './connection';
import type { ReadOptions } from './read';
import type { ModelInfo } from './types';

export * from './errors';
export {
  AI_CONFIG_KEY,
  AI_KEY_KEY,
  DEFAULT_MODEL,
  isAiEnabled,
  isPlausibleApiKey,
  isValidModelId,
  readAiConfig,
  removeApiKey,
  saveApiKey,
  setAiEnabled,
  setAiModel,
  type AiConfig,
} from './config';
export * from './messages';
export * from './notice';
export { getAiServices, resetAiServices, setAiServices, type AiServices } from './services';
export type { ConnectionTestOptions } from './connection';
export type { ReadOptions } from './read';
export type { AiPhase, ModelInfo, PreparedImage } from './types';

/**
 * Reads a photo of a receipt with Gemini: the one call that sends an image. Only after the user
 * confirmed what is sent; refuses unless the feature is on. Fails with an `AiError`.
 */
export async function readReceiptWithGemini(
  image: Blob,
  options?: ReadOptions,
): Promise<ParsedReceipt> {
  return (await import('./read')).readReceiptWithGemini(image, options);
}

/** Asks Google for the description of the model: checks the key and the model id, sends no receipt data. */
export async function testGeminiConnection(options?: ConnectionTestOptions): Promise<ModelInfo> {
  return (await import('./connection')).testGeminiConnection(options);
}
