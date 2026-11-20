import { isRouteErrorResponse, useRouteError } from 'react-router';

export function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : undefined;

  return (
    <section
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <h2 className="font-semibold">A apărut o eroare</h2>
      <p className="mt-1 text-sm">Reîncarcă pagina sau alege altă secțiune din meniu.</p>
      {detail ? <p className="mt-2 font-mono text-xs break-words opacity-80">{detail}</p> : null}
      <button
        type="button"
        onClick={() => {
          window.location.reload();
        }}
        className="mt-3 rounded-lg bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800"
      >
        Reîncarcă
      </button>
    </section>
  );
}
