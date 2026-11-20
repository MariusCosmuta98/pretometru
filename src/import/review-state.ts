import type { ParseWarning, ReceiptStatus } from '@/domain';
import { addLine, patchLine, removeLine, type LineForm, type ReceiptForm } from './form';
import type { AckCode, Acks } from './review';

/** The review screen's state: the working copy plus what the user has already dealt with. */
export interface ReviewState {
  form: ReceiptForm;
  /** The form as last loaded or saved (serialised); the screen has unsaved edits when it differs. */
  baseline: string;
  /** Ids of the lines the user edited or verified since the import (`RECEIPT_REVIEW_KEY`: the receipt). */
  reviewed: readonly string[];
  acks: Acks;
}

export type ReviewAction =
  | { type: 'edit-receipt'; patch: Partial<ReceiptForm> }
  | { type: 'edit-line'; id: string; patch: Partial<LineForm> }
  | { type: 'add-line'; id: string }
  | { type: 'remove-line'; id: string }
  | { type: 'verify'; key: string }
  | { type: 'accept'; code: AckCode; token: string }
  | { type: 'withdraw'; code: AckCode }
  | {
      type: 'saved';
      receipt: { id: string; storeId: string; status: ReceiptStatus };
      /** What was persisted as the extraction warnings. */
      warnings: ParseWarning[];
    };

export function initialReviewState(form: ReceiptForm, acks: Acks = {}): ReviewState {
  return { form, baseline: JSON.stringify(form), reviewed: [], acks };
}

export function isDirty(state: ReviewState): boolean {
  return JSON.stringify(state.form) !== state.baseline;
}

// Editing any of these means the user looked at the line's price, so the import's doubts about it end.
const REVIEWING_FIELDS: ReadonlyArray<keyof LineForm> = [
  'rawName',
  'kind',
  'qty',
  'qtyUnit',
  'total',
  'discount',
  'unitPrice',
];

const withReviewed = (reviewed: readonly string[], id: string) =>
  reviewed.includes(id) ? reviewed : [...reviewed, id];

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'edit-receipt':
      return { ...state, form: { ...state.form, ...action.patch } };

    case 'edit-line': {
      const touched = REVIEWING_FIELDS.some((field) => field in action.patch);
      return {
        ...state,
        form: patchLine(state.form, action.id, action.patch),
        reviewed: touched ? withReviewed(state.reviewed, action.id) : state.reviewed,
      };
    }

    case 'add-line':
      return { ...state, form: addLine(state.form, action.id) };

    case 'remove-line':
      return { ...state, form: removeLine(state.form, action.id) };

    case 'verify':
      return { ...state, reviewed: withReviewed(state.reviewed, action.key) };

    case 'accept':
      return { ...state, acks: { ...state.acks, [action.code]: action.token } };

    case 'withdraw': {
      const { [action.code]: _withdrawn, ...rest } = state.acks;
      return { ...state, acks: rest };
    }

    case 'saved': {
      const form: ReceiptForm = {
        ...state.form,
        id: action.receipt.id,
        storeId: action.receipt.storeId,
        status: action.receipt.status,
        extraction: { ...state.form.extraction, warnings: action.warnings },
      };
      return { ...state, form, baseline: JSON.stringify(form), reviewed: [] };
    }
  }
}
