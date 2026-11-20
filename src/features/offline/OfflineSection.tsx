import type { OfflineReadiness } from '@/pwa';
import { EnginesPanel } from './EnginesPanel';
import { useOfflineEnv, useRead } from './hooks';
import { StoragePanel } from './StoragePanel';

const READINESS: Record<OfflineReadiness, string> = {
  ready:
    'Aplicația pornește și funcționează și fără internet: ecranele, bonurile, produsele și listele sunt pe acest dispozitiv.',
  pending:
    'Aplicația se pregătește pentru folosirea fără internet. Închide și redeschide aplicația o dată.',
  unregistered:
    'Folosirea fără internet este disponibilă doar în versiunea publicată a aplicației.',
  unsupported: 'Acest browser nu permite folosirea aplicației fără internet.',
};

export default function OfflineSection() {
  const env = useOfflineEnv();
  const { value: readiness } = useRead(env.readiness);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-medium">Fără internet</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {readiness ? READINESS[readiness] : 'Se verifică…'}
        </p>
      </div>
      <EnginesPanel readiness={readiness} />
      <StoragePanel />
    </div>
  );
}
