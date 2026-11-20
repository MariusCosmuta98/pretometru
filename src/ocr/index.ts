// Public surface of the OCR module. Heavy parts (Tesseract.js, its WASM core and the language
// data) load lazily on the first `recognizeImage` call, so importing this costs almost nothing.
export { cropRegion, clampRegion, type Region } from './crop';
export { OcrError, type OcrErrorCode } from './errors';
export { DEFAULT_PREPROCESS, type PreprocessOptions } from './preprocess';
export { recognizeImage, type OcrTextSource, type RecognizeOptions } from './recognize';
export { sharedEngine as ocrEngine } from './engine';
