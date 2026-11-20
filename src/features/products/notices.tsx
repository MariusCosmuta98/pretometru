import { Component, type ReactNode } from 'react';
import { muted } from './styles';

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className={muted}>
      Se încarcă {what}…
    </p>
  );
}

/** A failed load (usually IndexedDB being unavailable): the shell and navigation keep working. */
export function Failure({ children }: { children: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </div>
  );
}

/**
 * Keeps a chart that cannot load (a chunk that was never cached, a canvas error) from replacing
 * the whole product page with the route's error screen: the tables below it stay usable.
 */
export class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('The price chart failed to load', error);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="status" className={muted}>
        Graficul nu a putut fi încărcat. Comparația și istoricul rămân disponibile.
      </p>
    );
  }
}
