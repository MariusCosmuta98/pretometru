import { noticeClass } from '@/ui/controls';
import { ConnectedPanel } from './ConnectedPanel';
import { ConnectForm } from './ConnectForm';
import { useSyncView } from './useSync';

/** The "Sincronizare GitHub" card of the Settings screen: set-up while unconnected, status and actions after. */
export default function SyncSection() {
  const view = useSyncView();

  if (view.status === 'loading') {
    return <p className="text-sm text-slate-500">Se încarcă…</p>;
  }
  if (view.status === 'error') {
    return (
      <p role="alert" className={noticeClass.error}>
        Sincronizarea nu este disponibilă: baza de date de pe acest dispozitiv nu poate fi deschisă.
      </p>
    );
  }

  const { connection } = view.value;
  return connection ? (
    <ConnectedPanel view={{ ...view.value, connection }} />
  ) : (
    <ConnectForm mode="connect" />
  );
}
