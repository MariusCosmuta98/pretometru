import { countLocalData, getLastExportAt } from '@/admin';
import type { PretometruDB } from '@/storage';
import { Failure } from '@/ui/states';
import { useDb, useLiveQuery } from '@/ui/live';
import { ExportPanel, type DeviceSummary } from './ExportPanel';
import { ImportPanel } from './ImportPanel';
import { useExporter } from './useExporter';

async function loadDeviceSummary(db: PretometruDB): Promise<DeviceSummary> {
  return { counts: await countLocalData(db), lastExportAt: await getLastExportAt(db) };
}

function Panels({ db }: { db: PretometruDB }) {
  const device = useLiveQuery(db, loadDeviceSummary);
  const exporter = useExporter(db);

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Datele tale sunt doar pe acest dispozitiv. Ca să nu le pierzi (browserul le poate șterge sau
        poți schimba telefonul), exportă din când în când o copie într-un fișier și păstreaz-o
        într-un loc sigur.
      </p>
      <ExportPanel device={device} exporter={exporter} />
      <ImportPanel db={db} device={device} exporter={exporter} />
    </div>
  );
}

/** The "Copie de siguranță" card of the Settings screen: export to a file, import from one. */
export default function BackupSection() {
  const database = useDb();

  if (database.status === 'loading') {
    return <p className="text-sm text-slate-500">Se încarcă…</p>;
  }
  if (database.status === 'error') {
    return (
      <Failure>
        Copia de siguranță nu este disponibilă: baza de date de pe acest dispozitiv nu poate fi
        deschisă.
      </Failure>
    );
  }
  return <Panels db={database.value} />;
}
