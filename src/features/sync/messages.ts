import {
  isSyncError,
  type RemoteSummary,
  type SyncErrorCode,
  type SyncPhase,
  type VerifyStep,
} from '@/sync';
import { formatWhen } from './format';

/** A failed sync step as the screen keeps it: the code, and the details that help to explain it. */
export interface Failure {
  code: SyncErrorCode | 'UNKNOWN';
  /** A file path or GitHub's own words: never a secret. */
  detail?: string;
  /** When a rate limit ends (ISO). */
  retryAt?: string;
}

export function toFailure(error: unknown): Failure {
  if (!isSyncError(error)) return { code: 'UNKNOWN' };
  const retryAt =
    error.retryAt && !Number.isNaN(error.retryAt.getTime())
      ? error.retryAt.toISOString()
      : undefined;
  return {
    code: error.code,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(retryAt ? { retryAt } : {}),
  };
}

export const ERROR_MESSAGES: Record<SyncErrorCode | 'UNKNOWN', string> = {
  NOT_CONFIGURED: 'Sincronizarea nu este configurată pe acest dispozitiv.',
  TOKEN_LOCKED: 'Introdu parola tokenului ca să poți sincroniza.',
  BAD_PASSPHRASE: 'Parola nu este corectă.',
  CRYPTO_UNAVAILABLE:
    'Acest browser nu poate folosi criptarea de care are nevoie sincronizarea. Deschide aplicația prin HTTPS sau într-un browser mai nou.',
  OFFLINE: 'Nu ești conectat la internet. Sincronizarea se poate face când revii online.',
  NETWORK: 'Nu am putut ajunge la GitHub. Verifică internetul și încearcă din nou.',
  INVALID_REPO:
    'Numele depozitului nu este valid. Scrie «pretometru-data» sau «proprietar/depozit».',
  BAD_TOKEN:
    'GitHub nu acceptă tokenul: este greșit, a expirat sau a fost revocat. Creează unul nou și actualizează-l aici.',
  NO_ACCESS:
    'Depozitul nu există sau tokenul nu are acces la el. Verifică numele și că tokenul include acest depozit.',
  NO_PERMISSION:
    'Tokenul nu are voie să scrie în depozit. La permisiuni, pune «Contents» pe «Read and write».',
  REPO_NOT_PRIVATE:
    'Depozitul este public. Datele tale (bonuri, prețuri) nu se sincronizează într-un depozit public: fă-l privat în GitHub (Settings → Danger Zone → Change visibility) sau alege alt depozit.',
  REPO_ARCHIVED: 'Depozitul este arhivat (doar citire). Dezarhivează-l sau alege alt depozit.',
  BRANCH_PROTECTED:
    'Ramura principală a depozitului este protejată și nu primește scrieri directe. Oprește protecția pentru acest depozit.',
  EMPTY_REPOSITORY:
    'Depozitul este gol și nu am putut crea primul fișier. Adaugă din GitHub un fișier README și încearcă din nou.',
  RATE_LIMITED: 'GitHub a limitat temporar cererile. Încearcă din nou puțin mai târziu.',
  SERVER: 'GitHub are probleme acum. Încearcă din nou peste câteva minute.',
  CONFLICT:
    'Alt dispozitiv a sincronizat în același timp, de mai multe ori la rând. Încearcă din nou.',
  REMOTE_INVALID:
    'Un fișier din depozit nu poate fi citit. Nu am modificat nimic. Dacă ai folosit o versiune mai nouă a aplicației pe alt dispozitiv, actualizează aplicația.',
  REMOTE_NEWER:
    'Datele din depozit au fost scrise de o versiune mai nouă a aplicației. Actualizează aplicația și încearcă din nou.',
  REMOTE_TOO_LARGE:
    'Depozitul conține prea multe fișiere ca să fie citit dintr-o dată. Folosește un depozit făcut doar pentru Pretometru.',
  STORAGE:
    'Datele de pe acest dispozitiv nu au putut fi citite sau scrise. Verifică spațiul de stocare și încearcă din nou.',
  CANCELLED: 'Sincronizarea a fost oprită.',
  UNEXPECTED:
    'GitHub a răspuns altfel decât mă așteptam. Încearcă din nou; dacă se repetă, verifică depozitul pe GitHub.',
  UNKNOWN: 'A apărut o eroare neașteptată. Încearcă din nou.',
};

/** The message of a failure, with the one detail that helps: when a rate limit ends. */
export function errorMessage(code: SyncErrorCode | 'UNKNOWN', retryAt?: string): string {
  const base = ERROR_MESSAGES[code];
  if (code === 'RATE_LIMITED' && retryAt) {
    return `GitHub a limitat temporar cererile. Poți încerca din nou după ${formatWhen(retryAt)}.`;
  }
  return base;
}

export const PHASE_LABELS: Record<SyncPhase, string> = {
  checking: 'Se verifică depozitul',
  downloading: 'Se descarcă modificările',
  merging: 'Se îmbină datele',
  uploading: 'Se încarcă modificările',
};

export const STEPS: readonly VerifyStep[] = ['token', 'repository', 'private', 'access', 'remote'];

export const STEP_LABELS: Record<VerifyStep, string> = {
  token: 'Tokenul este valid',
  repository: 'Depozitul există și tokenul are acces la el',
  private: 'Depozitul este privat',
  access: 'Tokenul poate citi și scrie (Contents: Read and write)',
  remote: 'Conținutul depozitului a fost citit',
};

/** What the first sync will do, from what the repository holds. */
export function remoteSummaryText(remote: RemoteSummary): string {
  const intro = remote.initialized ? 'Depozitul era gol: am creat în el un fișier README. ' : '';
  if (remote.state === 'new') {
    return `${intro}Depozitul nu conține încă date Pretometru. Prima sincronizare va încărca în el datele de pe acest dispozitiv.`;
  }
  const when = remote.updatedAt ? `, ultima modificare ${formatWhen(remote.updatedAt)}` : '';
  return `${intro}Depozitul conține deja date Pretometru (${remote.files} ${remote.files === 1 ? 'fișier' : 'fișiere'}${when}). Prima sincronizare le va îmbina cu cele de pe acest dispozitiv: pentru fiecare înregistrare rămâne varianta modificată cel mai recent, iar nimic nu se șterge decât dacă a fost șters explicit.`;
}

/** `1 înregistrare trimisă`, `3 înregistrări trimise`: the participle agrees with the number. */
const recordsWith = (count: number, singular: string, plural: string): string =>
  count === 1 ? `1 înregistrare ${singular}` : `${count} înregistrări ${plural}`;

export function successText(result: {
  pulled: number;
  pushed: number;
  firstSync: boolean;
}): string {
  if (result.pulled === 0 && result.pushed === 0) return 'Totul era deja la zi.';
  const parts = [
    result.pushed > 0 ? recordsWith(result.pushed, 'trimisă', 'trimise') : undefined,
    result.pulled > 0 ? recordsWith(result.pulled, 'primită', 'primite') : undefined,
  ].filter((part) => part !== undefined);
  return `${result.firstSync ? 'Prima sincronizare: ' : ''}${parts.join(', ')}.`;
}
