import { useCallback, useState } from 'react';
import { prepareExport, recordExport, type PreparedExport } from '@/admin';
import type { PretometruDB } from '@/storage';
import { downloadTextFile } from './download';

export interface Exporter {
  busy: boolean;
  /** The last file that was handed to the browser. */
  done: PreparedExport | undefined;
  failed: boolean;
  run: () => Promise<void>;
}

/**
 * Builds the backup, offers it as a download and remembers the date. Shared by the export panel and
 * by the import panel (which offers a copy of what is on the device before it is replaced).
 */
export function useExporter(db: PretometruDB): Exporter {
  const [state, setState] = useState<Omit<Exporter, 'run'>>({
    busy: false,
    done: undefined,
    failed: false,
  });

  const run = useCallback(async () => {
    setState({ busy: true, done: undefined, failed: false });
    try {
      const prepared = await prepareExport(db);
      downloadTextFile(prepared.fileName, prepared.text);
      await recordExport(db, prepared.exportedAt);
      setState({ busy: false, done: prepared, failed: false });
    } catch (error) {
      console.warn('The backup could not be exported', error);
      setState({ busy: false, done: undefined, failed: true });
    }
  }, [db]);

  return { ...state, run };
}
