import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Link, useBlocker, useLocation, useNavigate } from 'react-router';
import { formatLei, type Product, type Receipt } from '@/domain';
import {
  analyze,
  confirmBlockers,
  confirmDraft,
  discardReceipt,
  fieldErrorBlockers,
  findDraftDuplicates,
  findDuplicates,
  getImportServices,
  initialReviewState,
  isDirty,
  readForm,
  reviewReducer,
  saveDraft,
  withWarnings,
  type Blocker,
  type NewProductInput,
} from '@/import';
import { buttonDanger, buttonPrimary, buttonSecondary, card, noticeClass } from '@/ui/controls';
import { SOURCE_LABELS, STATUS_LABELS } from '../labels';
import type { ReviewReady } from '../reviewLoader';
import { Dialog } from './Dialog';
import { LineEditor } from './LineEditor';
import { ProductPicker } from './ProductPicker';
import { ReceiptDetails } from './ReceiptDetails';
import { ADD_LINE_DOM_ID, blockerDomId, blockerText } from './text';
import { WarningsPanel, type LineRef } from './WarningsPanel';

type Busy = 'draft' | 'confirm' | 'delete';
type Message = { tone: 'success' | 'warning' | 'error'; text: string };

/** Moves focus to a field, opening the "more details" fold it may be hidden in. */
function focusById(domId: string) {
  const element = document.getElementById(domId);
  const fold = element?.closest('details');
  if (fold) fold.open = true;
  element?.focus();
}

function sameIds(a: readonly Receipt[], b: readonly Receipt[]): boolean {
  return a.length === b.length && a.every((receipt, index) => receipt.id === b[index]?.id);
}

/**
 * The review screen proper: an editable copy of the receipt, re-checked after every edit, that
 * can be saved as a draft, confirmed, or deleted. Nothing is persisted until the user asks.
 */
export function ReviewEditor({ data }: { data: ReviewReady }) {
  const services = getImportServices();
  const navigate = useNavigate();
  const location = useLocation();

  const [state, dispatch] = useReducer(reviewReducer, data, (initial) =>
    initialReviewState(initial.form, initial.initialAcks),
  );
  const [duplicates, setDuplicates] = useState<readonly Receipt[]>(data.duplicates);
  const [products, setProducts] = useState(
    () => new Map<string, Product>(data.products.map((product) => [product.id, product])),
  );
  const [busy, setBusy] = useState<Busy>();
  const [message, setMessage] = useState<Message | undefined>(() => {
    const notice = (location.state as { notice?: string } | null)?.notice;
    return notice ? { tone: 'success', text: notice } : undefined;
  });
  const [attempted, setAttempted] = useState(false);
  const [pickerLine, setPickerLine] = useState<string>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [redirect, setRedirect] = useState<{ to: string; notice: string }>();
  const pendingFocus = useRef<string>(undefined);

  const { form } = state;
  const now = useMemo(() => new Date(data.now), [data.now]);
  const categories = data.categories;
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );

  const read = useMemo(() => readForm(form), [form]);
  const reviewed = useMemo(() => new Set(state.reviewed), [state.reviewed]);
  const analysis = useMemo(
    () => analyze(read.draft, { parser: services.parser, now, duplicates, reviewed }),
    [read.draft, services.parser, now, duplicates, reviewed],
  );
  const blockers = useMemo(
    () => confirmBlockers(form, read, analysis, state.acks),
    [form, read, analysis, state.acks],
  );
  const dirty = useMemo(() => isDirty(state), [state]);

  const lineRefs = useMemo(
    () =>
      new Map<number, LineRef>(
        form.lines.map((line, index) => [line.idx, { id: line.id, number: index + 1 }]),
      ),
    [form.lines],
  );
  const lineNumber = (lineId: string) => form.lines.findIndex((line) => line.id === lineId) + 1;
  const typedLines = useMemo(
    () => new Map(read.draft.lines.map((line) => [line.id, line])),
    [read.draft.lines],
  );

  // The duplicate check follows the store, date, total and number as they are edited.
  const { chain, name: storeName, branchCode, city } = read.draft.store;
  const { purchasedAt, totalBani, documentNo, id: receiptId } = read.draft;
  const fileHash = read.draft.source.fileHash;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const found = await findDuplicates(await services.getDb(), {
          store: { chain, name: storeName, branchCode, city },
          fileHash,
          purchasedAt,
          totalBani,
          documentNo,
          excludeId: receiptId,
        });
        if (!cancelled) setDuplicates((previous) => (sameIds(previous, found) ? previous : found));
      } catch {
        // The check is advisory; saving re-runs it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    services,
    chain,
    storeName,
    branchCode,
    city,
    purchasedAt,
    totalBani,
    documentNo,
    receiptId,
    fileHash,
  ]);

  // Unsaved edits: ask before leaving the screen or the page.
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);
  const blocker = useBlocker(() => dirtyRef.current);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  useEffect(() => {
    if (redirect) {
      void navigate(redirect.to, { replace: true, state: { notice: redirect.notice } });
    }
  }, [redirect, navigate]);

  // Focus requested by an event handler, applied once the new DOM exists.
  useEffect(() => {
    if (pendingFocus.current !== undefined) {
      focusById(pendingFocus.current);
      pendingFocus.current = undefined;
    }
  });

  const searchProducts = useCallback(
    async (query: string) => services.catalog.searchProducts(await services.getDb(), query, 20),
    [services],
  );
  const createProduct = useCallback(
    async (input: NewProductInput) =>
      services.catalog.createProduct(await services.getDb(), input, {
        now: services.now,
        newId: services.newId,
      }),
    [services],
  );

  function chooseProduct(lineId: string, product: Product) {
    setProducts((previous) => new Map(previous).set(product.id, product));
    dispatch({
      type: 'edit-line',
      id: lineId,
      patch: { productId: product.id, categoryId: product.categoryId },
    });
    setPickerLine(undefined);
  }

  function refuse(found: readonly Blocker[]) {
    setAttempted(true);
    setMessage(undefined);
    const first = found[0];
    if (first) focusById(blockerDomId(first));
  }

  async function persist(mode: 'draft' | 'confirm') {
    setMessage(undefined);
    const current = readForm(form);
    const invalid = fieldErrorBlockers(form, current);
    if (invalid.length > 0) return refuse(invalid);

    setBusy(mode);
    try {
      const db = await services.getDb();
      // Another receipt may have been stored since the screen opened.
      const found = await findDraftDuplicates(db, current.draft);
      setDuplicates(found);
      const fresh = analyze(current.draft, {
        parser: services.parser,
        now,
        duplicates: found,
        reviewed,
      });
      if (mode === 'confirm') {
        const missing = confirmBlockers(form, current, fresh, state.acks);
        if (missing.length > 0) return refuse(missing);
      }

      const draft = withWarnings(current.draft, fresh.warnings);
      const wasConfirmed = form.status === 'confirmed';
      let mappingFailed = false;
      const saved =
        mode === 'confirm'
          ? await confirmDraft(services, draft).then((result) => {
              mappingFailed = result.mappingError !== undefined;
              return result.saved;
            })
          : await saveDraft(services, draft, 'draft');

      dirtyRef.current = false;
      dispatch({
        type: 'saved',
        receipt: {
          id: saved.receipt.id,
          storeId: saved.receipt.storeId,
          status: saved.receipt.status,
        },
        warnings: fresh.warnings,
      });
      setAttempted(false);

      if (mode === 'draft') {
        if (data.isNew) {
          setRedirect({ to: `/bonuri/${saved.receipt.id}`, notice: 'Ciorna a fost salvată.' });
        } else {
          setMessage({ tone: 'success', text: 'Ciorna a fost salvată.' });
        }
      } else if (mappingFailed) {
        setMessage({
          tone: 'warning',
          text: 'Bonul a fost confirmat, dar produsele nu au putut fi memorate pentru importurile următoare.',
        });
      } else {
        setRedirect({
          to: '/bonuri',
          notice: wasConfirmed ? 'Modificările au fost salvate.' : 'Bonul a fost confirmat.',
        });
      }
    } catch {
      setMessage({
        tone: 'error',
        text: 'Bonul nu a putut fi salvat. Verifică datele și încearcă din nou.',
      });
    } finally {
      setBusy(undefined);
    }
  }

  async function remove() {
    if (form.id === undefined) return;
    setBusy('delete');
    try {
      await discardReceipt(services, form.id);
      dirtyRef.current = false;
      setConfirmingDelete(false);
      setRedirect({ to: '/bonuri', notice: 'Bonul a fost șters.' });
    } catch {
      setConfirmingDelete(false);
      setMessage({ tone: 'error', text: 'Bonul nu a putut fi șters. Încearcă din nou.' });
    } finally {
      setBusy(undefined);
    }
  }

  const sumsMatch = analysis.differenceBani === 0;
  const pickerLineForm = form.lines.find((line) => line.id === pickerLine);
  const pickerSuggestion = pickerLine ? data.suggestions[pickerLine] : undefined;
  const source = form.source;

  return (
    <div className="space-y-4">
      <section aria-label="Stare" className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            form.status === 'confirmed'
              ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
          }`}
        >
          {STATUS_LABELS[form.status]}
        </span>
        <span className="text-slate-600 dark:text-slate-400">
          {source.kind === 'manual'
            ? 'Bon introdus manual'
            : `Sursă: ${SOURCE_LABELS[source.kind]}${source.fileName ? ` „${source.fileName}”` : ''}`}
        </span>
      </section>

      {message ? (
        <p role="status" className={noticeClass[message.tone === 'error' ? 'error' : message.tone]}>
          {message.text}{' '}
          {message.tone === 'warning' ? (
            <Link to="/bonuri" className="font-medium underline">
              Mergi la bonuri
            </Link>
          ) : null}
        </p>
      ) : null}

      {attempted && blockers.length > 0 ? (
        <section role="alert" aria-labelledby="blockers-title" className={noticeClass.error}>
          <h2 id="blockers-title" className="font-semibold">
            Mai ai de rezolvat
          </h2>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {blockers.map((blocker, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="text-left underline"
                  onClick={() => {
                    focusById(blockerDomId(blocker));
                  }}
                >
                  {blockerText(blocker, lineNumber)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReceiptDetails
        form={form}
        errors={read.errors.receipt}
        showErrors={attempted}
        onChange={(patch) => {
          dispatch({ type: 'edit-receipt', patch });
        }}
      />

      <p
        role="status"
        aria-live="polite"
        className={sumsMatch ? noticeClass.success : noticeClass.warning}
      >
        Suma liniilor: <strong>{formatLei(analysis.sumBani)}</strong> · Total bon:{' '}
        <strong>{formatLei(analysis.totalBani)}</strong>
        {sumsMatch
          ? ' · se potrivesc'
          : ` · diferență ${analysis.differenceBani > 0 ? '+' : '−'}${formatLei(Math.abs(analysis.differenceBani))}`}
      </p>

      <WarningsPanel
        analysis={analysis}
        acks={state.acks}
        purchasedAt={read.draft.purchasedAt}
        duplicates={duplicates}
        lines={lineRefs}
        highlightPending={attempted}
        onAccept={(code, token) => {
          dispatch({ type: 'accept', code, token });
        }}
        onWithdraw={(code) => {
          dispatch({ type: 'withdraw', code });
        }}
        onVerify={(key) => {
          dispatch({ type: 'verify', key });
        }}
        onGoToLine={(lineId) => {
          focusById(`line-${lineId}-rawName`);
        }}
      />

      <section aria-labelledby="lines-title" className="space-y-3">
        <h2 id="lines-title" className="font-semibold">
          Produse ({form.lines.length})
        </h2>
        {form.lines.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Bonul nu are încă nicio linie. Adaugă una.
          </p>
        ) : (
          <ol className="space-y-3" aria-label="Linii">
            {form.lines.map((line, index) => {
              const product = line.productId ? products.get(line.productId) : undefined;
              return (
                <LineEditor
                  key={line.id}
                  line={line}
                  number={index + 1}
                  errors={read.errors.lines[line.id]}
                  showErrors={attempted}
                  typed={typedLines.get(line.id)}
                  warnings={analysis.warnings.filter((warning) => warning.lineIdx === line.idx)}
                  product={product}
                  categoryName={line.categoryId ? categoryNames.get(line.categoryId) : undefined}
                  suggestion={data.suggestions[line.id]}
                  original={data.original}
                  onChange={(patch) => {
                    dispatch({ type: 'edit-line', id: line.id, patch });
                  }}
                  onRemove={() => {
                    dispatch({ type: 'remove-line', id: line.id });
                    pendingFocus.current = ADD_LINE_DOM_ID;
                  }}
                  onPickProduct={() => {
                    setPickerLine(line.id);
                  }}
                  onAcceptCandidate={(candidate) => {
                    chooseProduct(line.id, candidate);
                  }}
                />
              );
            })}
          </ol>
        )}
        <button
          id={ADD_LINE_DOM_ID}
          type="button"
          className={buttonSecondary}
          onClick={() => {
            const id = services.newId();
            dispatch({ type: 'add-line', id });
            pendingFocus.current = `line-${id}-rawName`;
          }}
        >
          Adaugă linie
        </button>
      </section>

      <section aria-label="Acțiuni" className={`${card} flex flex-wrap gap-2`}>
        {form.status === 'draft' ? (
          <button
            type="button"
            className={buttonSecondary}
            disabled={busy !== undefined}
            onClick={() => {
              void persist('draft');
            }}
          >
            Salvează ciorna
          </button>
        ) : null}
        <button
          type="button"
          className={buttonPrimary}
          disabled={busy !== undefined}
          onClick={() => {
            void persist('confirm');
          }}
        >
          {form.status === 'confirmed' ? 'Salvează modificările' : 'Confirmă bonul'}
        </button>
        {form.id !== undefined ? (
          <button
            type="button"
            className={buttonDanger}
            disabled={busy !== undefined}
            onClick={() => {
              setConfirmingDelete(true);
            }}
          >
            Șterge bonul
          </button>
        ) : (
          <Link to="/bonuri" className={buttonSecondary}>
            Renunță
          </Link>
        )}
      </section>

      {pickerLineForm ? (
        <ProductPicker
          line={pickerLineForm}
          number={lineNumber(pickerLineForm.id)}
          candidates={pickerSuggestion?.candidates ?? []}
          categories={categories}
          search={searchProducts}
          create={createProduct}
          onPick={(product) => {
            chooseProduct(pickerLineForm.id, product);
          }}
          onClear={() => {
            dispatch({
              type: 'edit-line',
              id: pickerLineForm.id,
              patch: { productId: undefined },
            });
            setPickerLine(undefined);
          }}
          onClose={() => {
            setPickerLine(undefined);
          }}
        />
      ) : null}

      {confirmingDelete ? (
        <Dialog
          title="Ștergi bonul?"
          onClose={() => {
            setConfirmingDelete(false);
          }}
        >
          <p className="text-sm">
            Bonul și liniile lui vor dispărea din listă. Acțiunea nu poate fi anulată.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              data-autofocus
              className={buttonSecondary}
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              Renunță
            </button>
            <button
              type="button"
              className={buttonDanger}
              disabled={busy === 'delete'}
              onClick={() => {
                void remove();
              }}
            >
              Șterge definitiv
            </button>
          </div>
        </Dialog>
      ) : null}

      {blocker.state === 'blocked' ? (
        <Dialog title="Ai modificări nesalvate" onClose={() => blocker.reset()}>
          <p className="text-sm">Dacă ieși acum, modificările făcute pe acest bon se pierd.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              data-autofocus
              className={buttonSecondary}
              onClick={() => {
                blocker.reset();
              }}
            >
              Rămân pe bon
            </button>
            <button
              type="button"
              className={buttonDanger}
              onClick={() => {
                blocker.proceed();
              }}
            >
              Ies fără să salvez
            </button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
