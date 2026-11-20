import type { ParsedReceipt, Receipt, ReceiptSource } from '@/domain';
import {
  draftFromParsed,
  lineMetaOf,
  type DraftOrigin,
  type ReceiptDraft,
  type SourceKind,
} from './draft';
import { detectInputKind, SNIFF_BYTES, type InputKind } from './detect';
import { duplicateWarning, findDraftDuplicates } from './duplicates';
import { ImportError, isAbortError, isImportError, throwIfCancelled } from './errors';
import { sha256Hex } from './hash';
import { saveDraft, type SavedReceipt } from './persist';
import type { ImportServices } from './services';
import { openReviewSession, type ReviewSession } from './session';

export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_TEXT_CHARS = 200_000;

export type ImportPhase = 'reading' | 'extracting' | 'parsing' | 'checking' | 'saving';

export interface ImportProgress {
  phase: ImportPhase;
  /** 0..1 within the phase, when the engine reports it (OCR does). */
  fraction?: number;
}

export interface ImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}

export type ImportInput = { kind: 'file'; file: File } | { kind: 'text'; text: string };

/** The result of reading a file or pasted text; nothing is persisted yet. */
export interface ImportedReceipt {
  /** Parsed and checked, including a `DUPLICATE` warning when the database already has it. */
  draft: ReceiptDraft;
  duplicates: Receipt[];
  /** The original image and per-line details, to keep in memory while the receipt is reviewed. */
  session: ReviewSession;
}

export interface ImportOutcome extends ImportedReceipt {
  saved: SavedReceipt;
}

interface Prepared {
  origin: DraftOrigin;
  /** An image to keep in memory for line crops. */
  original?: Blob;
  /** Turns the input into parser input. */
  read: () => Promise<ReceiptSource>;
}

const SOURCE_KIND: Record<InputKind, SourceKind> = { pdf: 'pdf', image: 'image', text: 'text' };

/** Wraps an engine call: cancellation and engine failures become `ImportError`s. */
async function runEngine<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    throwIfCancelled(signal);
    return result;
  } catch (error) {
    if (isImportError(error)) throw error;
    if (signal?.aborted || isAbortError(error)) {
      throw new ImportError('CANCELLED', 'The import was cancelled', { cause: error });
    }
    throw new ImportError('EXTRACTION_FAILED', 'The text could not be extracted', {
      cause: error,
    });
  }
}

function hasText(source: ReceiptSource): boolean {
  switch (source.kind) {
    case 'pdf-text':
      return source.pages.some((page) => page.items.some((item) => item.str.trim() !== ''));
    case 'ocr-text':
      return (
        source.text.trim() !== '' ||
        (source.lines?.some((line) => line.text.trim() !== '') ?? false)
      );
    case 'pasted-text':
      return source.text.trim() !== '';
  }
}

async function prepareFile(
  services: ImportServices,
  file: File,
  options: ImportOptions,
  report: (progress: ImportProgress) => void,
): Promise<Prepared> {
  const { signal } = options;
  if (file.size === 0) throw new ImportError('EMPTY_INPUT', 'The file is empty');
  if (file.size > MAX_FILE_BYTES) throw new ImportError('FILE_TOO_LARGE', 'The file is too large');

  report({ phase: 'reading' });
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (cause) {
    throw new ImportError('EXTRACTION_FAILED', 'The file could not be read', { cause });
  }
  throwIfCancelled(signal);

  const kind = detectInputKind(
    file,
    new Uint8Array(bytes, 0, Math.min(SNIFF_BYTES, bytes.byteLength)),
  );
  if (kind === undefined) {
    throw new ImportError('UNSUPPORTED_FORMAT', `Unsupported file: ${file.type || file.name}`);
  }

  // Hash first: a PDF engine may take ownership of the buffer.
  const fileHash = await sha256Hex(bytes);
  const origin: DraftOrigin = {
    kind: SOURCE_KIND[kind],
    ...(fileHash ? { fileHash } : {}),
    fileName: file.name,
  };

  switch (kind) {
    case 'pdf':
      return {
        origin,
        read: () => runEngine(signal, () => services.engines.extractPdfText(bytes)),
      };
    case 'image':
      return {
        origin,
        original: file,
        read: () =>
          runEngine(signal, () =>
            services.engines.recognizeImage(file, {
              ...(signal ? { signal } : {}),
              onProgress: (fraction) => {
                report({ phase: 'extracting', fraction });
              },
            }),
          ),
      };
    case 'text': {
      const source = textSource(new TextDecoder().decode(bytes));
      return { origin, read: () => Promise.resolve(source) };
    }
  }
}

function textSource(text: string): ReceiptSource {
  if (text.trim() === '') throw new ImportError('EMPTY_INPUT', 'There is no text to read');
  if (text.length > MAX_TEXT_CHARS) throw new ImportError('FILE_TOO_LARGE', 'The text is too long');
  return { kind: 'pasted-text', text };
}

async function prepareText(
  text: string,
  report: (progress: ImportProgress) => void,
): Promise<Prepared> {
  report({ phase: 'reading' });
  const source = textSource(text);
  const fileHash = await sha256Hex(new TextEncoder().encode(text));
  return {
    origin: { kind: 'text', ...(fileHash ? { fileHash } : {}) },
    read: () => Promise.resolve(source),
  };
}

function parse(services: ImportServices, source: ReceiptSource): ParsedReceipt {
  try {
    return services.parser.parseReceipt(source, { now: services.now() });
  } catch (cause) {
    if (isImportError(cause)) throw cause;
    throw new ImportError('EXTRACTION_FAILED', 'The receipt could not be parsed', { cause });
  }
}

/**
 * Reads a picked file or pasted text: format detection, the matching engine (pdf.js text, OCR or
 * the text itself), the store parser, a SHA-256 of the input and the duplicate check. Reports
 * progress and honours `signal` between steps (and inside OCR). Nothing is persisted: see
 * `importToDraft` for that. Fails with an `ImportError` whose `code` the screen turns into text.
 */
export async function importReceipt(
  services: ImportServices,
  input: ImportInput,
  options: ImportOptions = {},
): Promise<ImportedReceipt> {
  const report = (progress: ImportProgress) => {
    options.onProgress?.(progress);
  };
  throwIfCancelled(options.signal);

  const prepared =
    input.kind === 'file'
      ? await prepareFile(services, input.file, options, report)
      : await prepareText(input.text, report);

  report({ phase: 'extracting' });
  const source = await prepared.read();
  if (!hasText(source)) {
    throw new ImportError('NO_TEXT', 'No text could be found in the input');
  }

  report({ phase: 'parsing' });
  const parsed = parse(services, source);
  throwIfCancelled(options.signal);
  if (parsed.lines.length === 0) {
    throw new ImportError('NOTHING_RECOGNIZED', 'No receipt line was recognised');
  }

  report({ phase: 'checking' });
  const draft = draftFromParsed(parsed, prepared.origin, services.newId);
  const duplicates = await findDraftDuplicates(await services.getDb(), draft);
  if (duplicates.length > 0) draft.extraction.warnings.push(duplicateWarning(duplicates));

  return {
    draft,
    duplicates,
    session: {
      ...(prepared.original ? { original: prepared.original } : {}),
      ...(draft.vat ? { vat: draft.vat } : {}),
      lines: Object.fromEntries(draft.lines.map((line) => [line.id, lineMetaOf(line)])),
    },
  };
}

/**
 * `importReceipt` and then saves the result as a `draft` receipt, so the review screen
 * (`bonuri/:receiptId`) can open it. The original image stays in memory only, for the crops.
 */
export async function importToDraft(
  services: ImportServices,
  input: ImportInput,
  options: ImportOptions = {},
): Promise<ImportOutcome> {
  const imported = await importReceipt(services, input, options);
  throwIfCancelled(options.signal);
  options.onProgress?.({ phase: 'saving' });
  const saved = await saveDraft(services, imported.draft, 'draft');
  openReviewSession(saved.receipt.id, imported.session);
  return { ...imported, saved };
}
