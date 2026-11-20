/**
 * Local OCR benchmark. It is not part of `npm run check` or CI: it needs the private originals,
 * which are not in the repository. For every real fixture that has a photo in the samples folder
 * it runs the app's OCR (the same preprocessing and Tesseract.js engine as `recognizeImage`) and
 * the real parsers, then compares the receipt with the fixture's ground truth (`expected.json`).
 *
 * It prints metrics only (counts, percentages, warning codes), never a line of a receipt.
 *
 *   npm run ocr:bench
 *   npm run ocr:bench -- --channel=red --scale=4 --threshold=140
 *   npm run ocr:bench -- --sweep      channel x scale grid, to tune the preprocessing defaults
 *
 * Originals: `<samples>/<fixture id>.jpg|.jpeg` (default samples folder
 * `~/.pretometru-private/samples`, override with --samples or PRETOMETRU_SAMPLES). They must be
 * upright: the app applies the EXIF rotation, this script does not.
 */
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { decode } from 'jpeg-js';
import { createServer } from 'vite';
import { OCR_LANGUAGES, resolveOcrAssets } from '../config/ocr-assets.ts';
import type { ParsedReceipt, ReceiptSource } from '../src/domain';
import type { RawPage } from '../src/ocr/lines';
import type { PreprocessOptions, RgbaImage } from '../src/ocr/preprocess';
import { compareReceipts, ratio, type ReceiptMetrics } from './ocr-bench-metrics.ts';

const ROOT = resolve(import.meta.dirname, '..');

const USAGE = `Usage: npm run ocr:bench -- [options]

  --samples <dir>    folder with the private originals (default ~/.pretometru-private/samples)
  --only <id,id>     only these fixtures
  --channel <name>   auto (default), green, red, blue, luma or min
  --scale <n>        upscale factor, 1 or more (default 3)
  --threshold <t>    otsu (default), none, or a level 0-255
  --no-stretch       skip the contrast stretch
  --psm <n>          Tesseract page segmentation mode (default 6, as in the app)
  --sweep            try several channels and scales, one row each
`;

const CHANNELS = ['auto', 'green', 'red', 'blue', 'luma', 'min'] as const;
const SWEEP_CHANNELS = ['auto', 'green', 'red', 'luma'] as const;
const SWEEP_SCALES = [2, 3, 4] as const;

interface Options {
  samplesDir: string;
  only: string[] | undefined;
  settings: Array<Partial<PreprocessOptions>>;
  psm: string;
}

class UsageError extends Error {}

const isParseArgsError = (error: unknown): error is Error =>
  error instanceof Error && String((error as { code?: unknown }).code).startsWith('ERR_PARSE_ARGS');

function readOptions(args: string[]): Options | 'help' {
  const { values } = parseArgs({
    args,
    options: {
      samples: { type: 'string' },
      only: { type: 'string' },
      channel: { type: 'string' },
      scale: { type: 'string' },
      threshold: { type: 'string' },
      'no-stretch': { type: 'boolean' },
      psm: { type: 'string' },
      sweep: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) return 'help';

  const channel = CHANNELS.find((name) => name === values.channel);
  if (values.channel !== undefined && !channel) {
    throw new UsageError(`--channel must be one of ${CHANNELS.join(', ')}`);
  }
  const scale = values.scale === undefined ? undefined : Number(values.scale);
  if (scale !== undefined && !(scale >= 1 && scale <= 8)) {
    throw new UsageError('--scale must be a number from 1 to 8');
  }
  let threshold: PreprocessOptions['threshold'] | undefined;
  if (values.threshold === 'otsu' || values.threshold === 'none') threshold = values.threshold;
  else if (values.threshold !== undefined) {
    threshold = Number(values.threshold);
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) {
      throw new UsageError('--threshold must be otsu, none or a level from 0 to 255');
    }
  }
  const psm = values.psm ?? '6';
  if (!/^(?:[0-9]|1[0-3])$/.test(psm)) throw new UsageError('--psm must be a number from 0 to 13');

  const shared: Partial<PreprocessOptions> = {
    ...(threshold !== undefined && { threshold }),
    ...(values['no-stretch'] && { stretch: false }),
  };
  const settings = values.sweep
    ? SWEEP_CHANNELS.flatMap((name) =>
        SWEEP_SCALES.map((factor) => ({ ...shared, channel: name, scale: factor })),
      )
    : [{ ...shared, ...(channel && { channel }), ...(scale !== undefined && { scale }) }];

  return {
    samplesDir:
      values.samples ??
      process.env['PRETOMETRU_SAMPLES'] ??
      join(homedir(), '.pretometru-private', 'samples'),
    only: values.only?.split(',').map((id) => id.trim()),
    settings,
    psm,
  };
}

// What this script uses of the modules it loads through Vite (they use the `@/` alias and
// `import.meta.glob`, so Node cannot import them directly).
interface FixtureLike {
  id: string;
  now: string;
  expected: ParsedReceipt;
  sources: Array<{ kind: string }>;
}
interface RawEngine {
  recognize(image: Uint8Array): Promise<RawPage>;
  terminate(): Promise<void>;
}
interface Modules {
  fixtures: readonly FixtureLike[];
  parseReceipt(source: ReceiptSource, opts: { now: Date }): ParsedReceipt;
  preprocess: typeof import('../src/ocr/preprocess.ts').preprocess;
  defaults: PreprocessOptions;
  encodePng: typeof import('../src/ocr/png.ts').encodePng;
  toOcrText: typeof import('../src/ocr/lines.ts').toOcrText;
  createTesseractEngine(
    config: { languages: string; pageSegMode: string; langPath: string },
    onStatus: () => void,
  ): Promise<RawEngine>;
}

async function loadModules(
  root: string,
): Promise<{ modules: Modules; close: () => Promise<void> }> {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    resolve: {
      alias: { '@fixtures': join(root, 'tests/fixtures'), '@': join(root, 'src') },
    },
  });
  const load = <T>(path: string) => server.ssrLoadModule(path) as Promise<T>;
  const [fixtures, parsers, preprocessing, png, lines, engine] = await Promise.all([
    load<{ fixtures: Modules['fixtures'] }>('/tests/fixtures/index.ts'),
    load<{ parseReceipt: Modules['parseReceipt'] }>('/src/parsers/index.ts'),
    load<typeof import('../src/ocr/preprocess.ts')>('/src/ocr/preprocess.ts'),
    load<typeof import('../src/ocr/png.ts')>('/src/ocr/png.ts'),
    load<typeof import('../src/ocr/lines.ts')>('/src/ocr/lines.ts'),
    load<{ createTesseractEngine: Modules['createTesseractEngine'] }>('/src/ocr/engine.ts'),
  ]);
  return {
    modules: {
      fixtures: fixtures.fixtures,
      parseReceipt: parsers.parseReceipt,
      preprocess: preprocessing.preprocess,
      defaults: preprocessing.DEFAULT_PREPROCESS,
      encodePng: png.encodePng,
      toOcrText: lines.toOcrText,
      createTesseractEngine: engine.createTesseractEngine,
    },
    close: () => server.close(),
  };
}

interface Sample {
  fixture: FixtureLike;
  pixels: RgbaImage;
}

/** `<id>.jpg` or `<id>.jpeg` in the samples folder, decoded to RGBA. */
function readSamples(
  fixtures: readonly FixtureLike[],
  options: Options,
): { samples: Sample[]; unsupported: string[] } {
  const files = existsSync(options.samplesDir) ? readdirSync(options.samplesDir) : [];
  const samples: Sample[] = [];
  const unsupported: string[] = [];
  for (const fixture of fixtures) {
    if (options.only && !options.only.includes(fixture.id)) continue;
    if (!fixture.sources.some((source) => source.kind === 'ocr-text')) continue;
    const file = files.find((name) => /\.jpe?g$/i.test(name) && stem(name) === fixture.id);
    if (!file) {
      if (files.some((name) => stem(name) === fixture.id)) unsupported.push(fixture.id);
      continue;
    }
    const { width, height, data } = decode(readFileSync(join(options.samplesDir, file)), {
      useTArray: true,
      formatAsRGBA: true,
      maxMemoryUsageInMB: 1024,
    });
    samples.push({ fixture, pixels: { width, height, data } });
  }
  return { samples, unsupported };
}

const stem = (file: string) => basename(file).replace(/\.[^.]+$/, '');

/** The traineddata files in one folder, which is what Tesseract.js's `langPath` expects. */
function stageLanguageData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pretometru-ocr-'));
  for (const asset of resolveOcrAssets()) {
    if (asset.name.startsWith('lang/')) copyFileSync(asset.file, join(dir, basename(asset.name)));
  }
  return dir;
}

interface Row {
  setting: string;
  sample: string;
  parser: string;
  channel: string;
  confidence: number;
  seconds: number;
  metrics: ReceiptMetrics;
}

const codes = (warnings: ReceiptMetrics['warnings']) =>
  Object.entries(warnings)
    .map(([code, count]) => (count > 1 ? `${code}x${count}` : code))
    .join(' ');

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((title, col) =>
    Math.max(title.length, ...rows.map((row) => row[col]!.length)),
  );
  const format = (cells: string[]) =>
    cells
      .map((cell, col) => cell.padEnd(widths[col]!))
      .join('  ')
      .trimEnd();
  console.log(format(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(format(row));
}

function settingLabel(setting: PreprocessOptions): string {
  const threshold = setting.threshold === 'otsu' ? '' : ` thr=${setting.threshold}`;
  return `${setting.channel} x${setting.scale}${threshold}${setting.stretch ? '' : ' no-stretch'}`;
}

function report(rows: Row[], sweep: boolean): void {
  const header = [
    ...(sweep ? ['setting'] : []),
    'sample',
    'parser',
    'channel',
    'conf',
    'total',
    'sum',
    'lines',
    'read',
    'prices',
    'qty',
    'silent',
    'time',
    'warnings',
  ];
  const cells = (row: Row) => {
    const { metrics } = row;
    return [
      ...(sweep ? [row.setting] : []),
      row.sample,
      row.parser,
      row.channel,
      String(Math.round(row.confidence)),
      metrics.totalCorrect ? 'ok' : 'WRONG',
      metrics.sum === 'ok' ? 'ok' : metrics.sum === 'mismatch' ? 'MISMATCH' : 'NO TOTAL',
      ratio(metrics.found, metrics.truthLines),
      String(metrics.readLines),
      ratio(metrics.exactPrices, metrics.truthLines),
      ratio(metrics.exactQuantities, metrics.truthLines),
      String(metrics.silentErrors),
      `${row.seconds.toFixed(1)}s`,
      codes(metrics.warnings),
    ];
  };

  const lines: string[][] = [];
  for (const setting of new Set(rows.map((row) => row.setting))) {
    const group = rows.filter((row) => row.setting === setting);
    lines.push(...group.map(cells));
    if (group.length < 2) continue;

    const all = group.map((row) => row.metrics);
    const sum = (pick: (metrics: ReceiptMetrics) => number) =>
      all.reduce((total, metrics) => total + pick(metrics), 0);
    const truthLines = sum((metrics) => metrics.truthLines);
    lines.push([
      ...(sweep ? [setting] : []),
      '(all)',
      '',
      '',
      '',
      ratio(all.filter((metrics) => metrics.totalCorrect).length, all.length),
      ratio(all.filter((metrics) => metrics.sum === 'ok').length, all.length),
      ratio(
        sum((metrics) => metrics.found),
        truthLines,
      ),
      String(sum((metrics) => metrics.readLines)),
      ratio(
        sum((metrics) => metrics.exactPrices),
        truthLines,
      ),
      ratio(
        sum((metrics) => metrics.exactQuantities),
        truthLines,
      ),
      String(sum((metrics) => metrics.silentErrors)),
      '',
      '',
    ]);
  }
  printTable(header, lines);
  console.log(
    '\nlines/prices/qty: of the lines of the truth; silent: wrong prices that no warning flags.\n' +
      'Metrics only: no receipt text is printed or stored.',
  );
}

async function main(): Promise<number> {
  let options: Options | 'help';
  try {
    options = readOptions(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError) && !isParseArgsError(error)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options === 'help') {
    console.log(USAGE);
    return 0;
  }

  const { modules, close } = await loadModules(ROOT);
  const languageData = stageLanguageData();
  let engine: RawEngine | undefined;
  try {
    const { samples, unsupported } = readSamples(modules.fixtures, options);
    if (unsupported.length > 0) {
      console.log(`Skipped (only JPEG originals are supported): ${unsupported.join(', ')}`);
    }
    if (samples.length === 0) {
      console.log(
        'No originals to benchmark: put <fixture id>.jpg of a real fixture with OCR text in ' +
          `${options.samplesDir} (see tests/fixtures/README.md).`,
      );
      return 0;
    }

    engine = await modules.createTesseractEngine(
      { languages: OCR_LANGUAGES.join('+'), pageSegMode: options.psm, langPath: languageData },
      () => undefined,
    );
    const rows: Row[] = [];
    for (const overrides of options.settings) {
      const setting = { ...modules.defaults, ...overrides };
      for (const { fixture, pixels } of samples) {
        const started = performance.now();
        const prepared = modules.preprocess(pixels, overrides);
        const page = await engine.recognize(modules.encodePng(prepared.image));
        const imageSize = { w: pixels.width, h: pixels.height };
        const text = modules.toOcrText(page, { scale: prepared.scale, imageSize });
        const receipt = modules.parseReceipt(
          { kind: 'ocr-text', ...text, imageSize },
          { now: new Date(fixture.now) },
        );
        rows.push({
          setting: settingLabel(setting),
          sample: fixture.id,
          parser: receipt.meta.parser,
          channel: prepared.channel,
          confidence: text.confidence,
          seconds: (performance.now() - started) / 1000,
          metrics: compareReceipts(receipt, fixture.expected),
        });
      }
    }
    console.log(`Tesseract ron+eng, psm ${options.psm}; ${samples.length} original(s)\n`);
    report(rows, options.settings.length > 1);
    return 0;
  } finally {
    await engine?.terminate();
    rmSync(languageData, { recursive: true, force: true });
    await close();
  }
}

process.exit(
  await main().catch((error: unknown) => {
    // Only the error's name: messages and stacks of OCR or parser failures could quote receipt text.
    console.error(`ocr:bench failed (${error instanceof Error ? error.name : 'unknown error'})`);
    return 1;
  }),
);
