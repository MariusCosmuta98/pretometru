/** A photo as it is sent: resized and re-encoded, so nothing of the original file (EXIF included) travels. */
export interface PreparedImage {
  mimeType: 'image/jpeg';
  /** The JPEG bytes, base64 (what the request carries). */
  base64: string;
  width: number;
  height: number;
  /** Size of the JPEG before base64. */
  bytes: number;
}

/** What the connection test learns about the model; no receipt data is involved. */
export interface ModelInfo {
  /** The id that was asked for (`gemini-3.5-flash-lite`). */
  model: string;
  displayName?: string;
}

export type AiPhase = 'preparing' | 'sending';
