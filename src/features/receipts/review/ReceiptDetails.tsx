import { CHAINS, DOC_TYPES, type Chain, type DocType } from '@/domain';
import { CHAIN_LABELS, type FormErrors, type ReceiptForm } from '@/import';
import { card } from '@/ui/controls';
import { DOC_TYPE_LABELS } from '../labels';
import { SelectField, TextField } from './fields';
import { fieldErrorText, normalizeLei } from './text';

const CHAIN_OPTIONS = CHAINS.map((chain) => ({ value: chain, label: CHAIN_LABELS[chain] }));
const DOC_TYPE_OPTIONS = DOC_TYPES.map((type) => ({ value: type, label: DOC_TYPE_LABELS[type] }));

interface ReceiptDetailsProps {
  form: ReceiptForm;
  errors: FormErrors['receipt'];
  showErrors: boolean;
  onChange: (patch: Partial<ReceiptForm>) => void;
}

/** Store, date, document and totals: everything about the receipt except its lines. */
export function ReceiptDetails({ form, errors, showErrors, onChange }: ReceiptDetailsProps) {
  const errorOf = (field: keyof FormErrors['receipt']) => {
    const code = errors[field];
    return code ? fieldErrorText(field, code) : undefined;
  };

  return (
    <section aria-labelledby="receipt-details-title" className={`${card} space-y-3`}>
      <h2 id="receipt-details-title" className="font-semibold">
        Detalii bon
      </h2>

      <SelectField<Chain>
        id="receipt-chain"
        label="Magazin"
        value={form.chain}
        options={CHAIN_OPTIONS}
        onChange={(chain) => {
          onChange({ chain });
        }}
      />
      {form.chain === 'unknown' ? (
        <TextField
          id="receipt-storeName"
          label="Denumirea magazinului"
          hint="Unele bonuri (de exemplu Mega Image) nu tipăresc numele magazinului: alege-l din listă."
          value={form.storeName}
          onChange={(storeName) => {
            onChange({ storeName });
          }}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <TextField
          id="receipt-date"
          type="date"
          label="Data"
          value={form.date}
          onChange={(date) => {
            onChange({ date });
          }}
          error={errorOf('date')}
          showError={showErrors}
        />
        <TextField
          id="receipt-time"
          type="time"
          label="Ora"
          step={form.time.length > 5 ? 1 : 60}
          value={form.time}
          onChange={(time) => {
            onChange({ time });
          }}
          error={errorOf('time')}
          showError={showErrors}
        />
        <SelectField<DocType>
          id="receipt-docType"
          label="Tip document"
          value={form.docType}
          options={DOC_TYPE_OPTIONS}
          onChange={(docType) => {
            onChange({ docType });
          }}
        />
        <TextField
          id="receipt-documentNo"
          label="Număr document"
          value={form.documentNo}
          onChange={(documentNo) => {
            onChange({ documentNo });
          }}
        />
        <TextField
          id="receipt-total"
          label="Total bon (lei)"
          inputMode="decimal"
          value={form.total}
          onChange={(total) => {
            onChange({ total });
          }}
          normalize={normalizeLei}
          error={errorOf('total')}
          showError={showErrors}
        />
        <TextField
          id="receipt-paid"
          label="Plătit (lei)"
          hint="Doar dacă diferă de total (de exemplu după un tichet)."
          inputMode="decimal"
          value={form.paid}
          onChange={(paid) => {
            onChange({ paid });
          }}
          normalize={normalizeLei}
          error={errorOf('paid')}
          showError={showErrors}
        />
      </div>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">Detalii magazin</summary>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <TextField
            id="receipt-city"
            label="Oraș"
            value={form.city}
            onChange={(city) => {
              onChange({ city });
            }}
          />
          <TextField
            id="receipt-branchCode"
            label="Cod magazin"
            value={form.branchCode}
            onChange={(branchCode) => {
              onChange({ branchCode });
            }}
          />
        </div>
      </details>
    </section>
  );
}
