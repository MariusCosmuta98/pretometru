export type OcrErrorCode =
  /** The file is not an image the browser can decode. */
  | 'DECODE_FAILED'
  /** The OCR engine could not start (missing asset, no WASM/worker support) or failed on the image. */
  | 'ENGINE_FAILED'
  /** The requested region has no pixels inside the image. */
  | 'EMPTY_REGION';

/** Thrown by the OCR module. A cancelled call rejects with the signal's `AbortError` instead. */
export class OcrError extends Error {
  readonly code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OcrError';
    this.code = code;
  }
}
