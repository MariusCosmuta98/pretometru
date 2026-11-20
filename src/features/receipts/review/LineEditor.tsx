import { LINE_KINDS, PACK_UNITS, QTY_UNITS, type Product, type ParseWarning } from '@/domain';
import type { DraftLine, LineErrors, LineField, LineForm, LineMapping } from '@/import';
import { buttonQuiet, buttonSecondary, card } from '@/ui/controls';
import { LINE_KIND_LABELS, PACK_UNIT_LABELS, QTY_UNIT_LABELS, WARNING_TITLES } from '../labels';
import { SelectField, TextField } from './fields';
import { LineCrop } from './LineCrop';
import { fieldErrorText, normalizeLei, normalizeQty, priceSummary } from './text';

const KIND_OPTIONS = LINE_KINDS.map((kind) => ({ value: kind, label: LINE_KIND_LABELS[kind] }));
const QTY_UNIT_OPTIONS = QTY_UNITS.map((unit) => ({ value: unit, label: QTY_UNIT_LABELS[unit] }));
const PACK_UNIT_OPTIONS = PACK_UNITS.map((unit) => ({
  value: unit,
  label: PACK_UNIT_LABELS[unit],
}));

interface LineEditorProps {
  line: LineForm;
  /** 1-based position on screen. */
  number: number;
  errors: LineErrors | undefined;
  showErrors: boolean;
  /** The line as the form currently reads it (absent while a field is invalid). */
  typed: DraftLine | undefined;
  warnings: readonly ParseWarning[];
  product: Product | undefined;
  categoryName: string | undefined;
  suggestion: LineMapping | undefined;
  /** The photo the receipt was read from, when it is still in memory. */
  original: Blob | undefined;
  onChange: (patch: Partial<LineForm>) => void;
  onRemove: () => void;
  onPickProduct: () => void;
  onAcceptCandidate: (product: Product) => void;
}

export function LineEditor({
  line,
  number,
  errors,
  showErrors,
  typed,
  warnings,
  product,
  categoryName,
  suggestion,
  original,
  onChange,
  onRemove,
  onPickProduct,
  onAcceptCandidate,
}: LineEditorProps) {
  const id = (field: string) => `line-${line.id}-${field}`;
  const suffix = `, linia ${number}`;
  const errorOf = (field: LineField) => {
    const code = errors?.[field];
    return code ? fieldErrorText(field, code) : undefined;
  };
  const isProduct = line.kind === 'product';
  const candidates = product ? [] : (suggestion?.candidates ?? []).slice(0, 3);
  const summary = priceSummary(typed);

  return (
    <li
      id={`line-${line.id}`}
      className={`${card} space-y-3 ${warnings.length > 0 ? 'border-amber-400 dark:border-amber-700' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">
          Linia {number}
          {warnings.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {warnings.map((warning) => WARNING_TITLES[warning.code]).join(', ')}
            </span>
          ) : null}
        </h3>
        <button
          type="button"
          className={buttonQuiet}
          aria-label={`Șterge linia ${number}`}
          onClick={onRemove}
        >
          Șterge
        </button>
      </div>

      {original && line.bbox ? (
        <LineCrop
          original={original}
          bbox={line.bbox}
          label={`Decupaj din bon pentru linia ${number}`}
        />
      ) : null}

      <TextField
        id={id('rawName')}
        label="Denumire"
        suffix={suffix}
        value={line.rawName}
        onChange={(rawName) => {
          onChange({ rawName });
        }}
        error={errorOf('rawName')}
        showError={showErrors}
      />

      <div className="grid grid-cols-2 gap-3">
        <TextField
          id={id('qty')}
          label="Cantitate"
          suffix={suffix}
          value={line.qty}
          inputMode="decimal"
          onChange={(qty) => {
            onChange({ qty });
          }}
          normalize={normalizeQty}
          error={errorOf('qty')}
          showError={showErrors}
        />
        <SelectField
          id={id('qtyUnit')}
          label="Unitate"
          suffix={suffix}
          value={line.qtyUnit}
          options={QTY_UNIT_OPTIONS}
          onChange={(qtyUnit) => {
            onChange({ qtyUnit });
          }}
        />
        <TextField
          id={id('total')}
          label="Total linie (lei)"
          suffix={suffix}
          value={line.total}
          inputMode="decimal"
          onChange={(total) => {
            onChange({ total });
          }}
          normalize={normalizeLei}
          error={errorOf('total')}
          showError={showErrors}
        />
        <TextField
          id={id('discount')}
          label="Reducere (lei)"
          suffix={suffix}
          value={line.discount}
          inputMode="decimal"
          onChange={(discount) => {
            onChange({ discount });
          }}
          normalize={normalizeLei}
          error={errorOf('discount')}
          showError={showErrors}
        />
      </div>

      <SelectField
        id={id('kind')}
        label="Tip"
        suffix={suffix}
        value={line.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => {
          onChange({ kind });
        }}
      />

      {summary ? <p className="text-sm text-slate-600 dark:text-slate-400">{summary}</p> : null}

      {isProduct ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {product ? (
              <span>
                Produs: <strong>{product.name}</strong>
                {categoryName ? ` · ${categoryName}` : ''}
              </span>
            ) : (
              <span className="text-slate-600 dark:text-slate-400">
                Fără produs{categoryName ? ` · ${categoryName}` : ''}
              </span>
            )}
            <button
              type="button"
              className={buttonSecondary}
              aria-label={`${product ? 'Schimbă produsul' : 'Alege produsul'}, linia ${number}`}
              onClick={onPickProduct}
            >
              {product ? 'Schimbă' : 'Alege produsul'}
            </button>
          </div>
          {candidates.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600 dark:text-slate-400">Poate fi:</span>
              {candidates.map((candidate) => (
                <button
                  key={candidate.product.id}
                  type="button"
                  className={buttonSecondary}
                  aria-label={`Acceptă sugestia „${candidate.product.name}”, linia ${number}`}
                  onClick={() => {
                    onAcceptCandidate(candidate.product);
                  }}
                >
                  {candidate.product.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Mai multe detalii<span className="sr-only">{suffix}</span>
        </summary>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <TextField
            id={id('ean')}
            label="EAN"
            suffix={suffix}
            value={line.ean}
            inputMode="numeric"
            onChange={(ean) => {
              onChange({ ean });
            }}
            error={errorOf('ean')}
            showError={showErrors}
          />
          {line.unitPrice !== '' ? (
            <TextField
              id={id('unitPrice')}
              label="Preț unitar tipărit (lei)"
              suffix={suffix}
              value={line.unitPrice}
              inputMode="decimal"
              onChange={(unitPrice) => {
                onChange({ unitPrice });
              }}
              normalize={normalizeLei}
              error={errorOf('unitPrice')}
              showError={showErrors}
            />
          ) : null}
          {isProduct && line.qtyUnit === 'buc' ? (
            <>
              <TextField
                id={id('packQty')}
                label="Mărime ambalaj"
                suffix={suffix}
                value={line.packQty}
                inputMode="decimal"
                onChange={(packQty) => {
                  onChange({ packQty });
                }}
                normalize={normalizeQty}
                error={errorOf('packQty')}
                showError={showErrors}
              />
              <SelectField
                id={id('packUnit')}
                label="Unitate ambalaj"
                suffix={suffix}
                value={line.packUnit}
                options={PACK_UNIT_OPTIONS}
                onChange={(packUnit) => {
                  onChange({ packUnit });
                }}
              />
              <TextField
                id={id('unitsPerPack')}
                label="Bucăți în pachet"
                suffix={suffix}
                value={line.unitsPerPack}
                inputMode="numeric"
                onChange={(unitsPerPack) => {
                  onChange({ unitsPerPack });
                }}
                error={errorOf('unitsPerPack')}
                showError={showErrors}
              />
            </>
          ) : null}
        </div>
        {line.vatRate !== undefined ? (
          <p className="pt-2 text-slate-600 dark:text-slate-400">
            TVA {line.vatRate}%{line.vatClass ? ` (${line.vatClass})` : ''}
          </p>
        ) : null}
      </details>
    </li>
  );
}
