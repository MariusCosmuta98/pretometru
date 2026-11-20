import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { listStores } from '@/admin';
import { noticeClass } from '@/ui/controls';
import { useDb, useDbQuery } from '@/ui/live';
import { Failure, Loading } from '@/ui/states';
import { listHeadingId } from './ids';
import { StoreItem, type Notice, type Panel, type ScreenContext } from './StoreItem';

export function Component() {
  const database = useDb();
  const stores = useDbQuery(listStores);
  const [panel, setPanel] = useState<Panel>();
  const [notice, setNotice] = useState<Notice>();
  const [focusRequest, setFocusRequest] = useState<{ id: string }>();

  // Focus moves after the render that closed a panel, to a button (or heading) that exists by then.
  useEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  let body;
  if (stores.status === 'error' || database.status === 'error') {
    body = <Failure>Nu am putut deschide magazinele de pe acest dispozitiv.</Failure>;
  } else if (stores.status === 'loading' || database.status !== 'ready') {
    body = <Loading what="magazinele" />;
  } else {
    const screen: ScreenContext = {
      db: database.value,
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
    const rows = stores.value;

    body = (
      <section aria-labelledby={listHeadingId} className="space-y-2">
        <h2 id={listHeadingId} tabIndex={-1} className="text-base font-semibold outline-none">
          Magazinele tale
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Nu ai încă niciun magazin. Apar singure când adaugi bonuri.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <StoreItem
                key={row.store.id}
                screen={screen}
                item={row}
                others={rows
                  .filter((other) => other !== row)
                  // The same chain first: a duplicate is usually of the same shop.
                  .sort(
                    (a, b) =>
                      Number(b.store.chain === row.store.chain) -
                      Number(a.store.chain === row.store.chain),
                  )}
              />
            ))}
          </ul>
        )}
      </section>
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
        Magazinele apar singure când adaugi bonuri. Le poți redenumi, poți uni două magazine care
        sunt de fapt același (bonurile trec la cel pe care îl păstrezi) și poți șterge un magazin
        fără bonuri.
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
