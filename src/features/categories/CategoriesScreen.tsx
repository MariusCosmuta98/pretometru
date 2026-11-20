import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { addCategory, listCategories } from '@/admin';
import { buttonPrimary, noticeClass } from '@/ui/controls';
import { useDb, useDbQuery } from '@/ui/live';
import { Failure, Loading } from '@/ui/states';
import { CategoryForm } from './CategoryForm';
import { CategoryItem, type Notice, type Panel, type ScreenContext } from './CategoryItem';
import { addButtonId, listHeadingId } from './ids';
import { COLOR_CHOICES } from './messages';

export function Component() {
  const database = useDb();
  const categories = useDbQuery(listCategories);
  const [panel, setPanel] = useState<Panel>();
  const [notice, setNotice] = useState<Notice>();
  const [focusRequest, setFocusRequest] = useState<{ id: string }>();

  // Focus moves after the render that closed a panel or moved a row, to a button that exists by then.
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  let body;
  if (categories.status === 'error' || database.status === 'error') {
    body = <Failure>Nu am putut deschide categoriile de pe acest dispozitiv.</Failure>;
  } else if (categories.status === 'loading' || database.status !== 'ready') {
    body = <Loading what="categoriile" />;
  } else {
    const db = database.value;
    const rows = categories.value;
    const orderable = rows.filter((row) => !row.system);
    const screen: ScreenContext = {
      db,
      panel,
      setPanel,
      notify: (next, focusId) => {
        setNotice(next);
        if (focusId) setFocusRequest({ id: focusId });
      },
      focus: (id) => {
        setFocusRequest({ id });
      },
    };
    const usedColors = new Set(rows.map((row) => row.category.color));
    const freshColor = COLOR_CHOICES.find((color) => !usedColors.has(color)) ?? COLOR_CHOICES[0];

    body = (
      <>
        {panel?.kind === 'add' ? (
          <CategoryForm
            label="Categorie nouă"
            initial={{ name: '', icon: '📦', color: freshColor }}
            submitLabel="Adaugă categoria"
            onSubmit={async (values) => {
              const added = await addCategory(db, values);
              setPanel(undefined);
              screen.notify(
                { kind: 'success', text: `Categoria „${added.name}” a fost adăugată.` },
                addButtonId,
              );
            }}
            onCancel={() => {
              setPanel(undefined);
              screen.focus(addButtonId);
            }}
          />
        ) : (
          <button
            type="button"
            id={addButtonId}
            className={buttonPrimary}
            onClick={() => {
              setPanel({ kind: 'add' });
            }}
          >
            Adaugă o categorie
          </button>
        )}

        <section aria-labelledby={listHeadingId} className="space-y-2">
          <h2 id={listHeadingId} tabIndex={-1} className="text-base font-semibold outline-none">
            Categoriile tale
          </h2>
          <ul className="space-y-2">
            {rows.map((row) => (
              <CategoryItem
                key={row.category.id}
                screen={screen}
                item={row}
                position={orderable.indexOf(row)}
                orderable={orderable.length}
                targets={orderable.filter((candidate) => candidate !== row)}
              />
            ))}
          </ul>
        </section>
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Link
        to="/setari"
        className="inline-flex min-h-11 items-center text-sm font-medium text-teal-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:text-teal-400"
      >
        ← Setări
      </Link>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Produsele și liniile de pe bonuri sunt grupate pe categorii. Aici le poți adăuga, redenumi,
        colora și ordona. Ordinea de aici este cea în care apar categoriile în aplicație.
      </p>
      <p role="status" className={notice?.kind === 'success' ? noticeClass.success : 'sr-only'}>
        {notice?.kind === 'success' ? notice.text : ''}
      </p>
      {notice?.kind === 'error' ? (
        <p role="alert" className={noticeClass.error}>
          {notice.text}
        </p>
      ) : null}
      {body}
    </div>
  );
}
