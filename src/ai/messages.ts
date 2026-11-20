import { isAiError, type AiErrorCode } from './errors';

/** Romanian, for the people who use the app; the codes themselves are for the code. */
const MESSAGES: Record<AiErrorCode, string> = {
  NOT_ENABLED: 'Citirea cu AI este oprită. Pornește-o din Setări, la „Gemini (opțional)”.',
  NO_KEY: 'Nu ai salvat o cheie API Gemini. Adaug-o din Setări, la „Gemini (opțional)”.',
  INVALID_KEY:
    'Ce ai scris nu arată ca o cheie API: are spații sau caractere neobișnuite, sau este prea scurtă. Copiaz-o din nou din Google AI Studio.',
  INVALID_MODEL:
    'Numele modelului nu este valid. Folosește litere mici, cifre, puncte și cratime (de exemplu gemini-3.5-flash-lite).',
  IMAGE_UNREADABLE:
    'Poza nu a putut fi pregătită pentru trimitere (formatul nu poate fi citit de acest browser sau poza este stricată). Nu am trimis nimic.',
  OFFLINE:
    'Nu ești conectat la internet. Citirea cu AI are nevoie de conexiune; nu am trimis nimic.',
  NETWORK: 'Nu am putut ajunge la Google. Verifică internetul și încearcă din nou.',
  TIMEOUT:
    'Gemini nu a răspuns la timp. Încearcă din nou; dacă se repetă, încearcă altă poză sau alt model.',
  BAD_KEY:
    'Google nu acceptă cheia API: este greșită, ștearsă sau expirată. Creează una nouă în Google AI Studio și salveaz-o în Setări.',
  FORBIDDEN:
    'Cheia nu are voie să folosească Gemini API (restricții ale cheii, API dezactivat sau un proiect care cere verificare). Verifică cheia în Google AI Studio.',
  MODEL_NOT_FOUND:
    'Modelul ales nu există sau nu mai este disponibil. Schimbă-l în Setări, la „Gemini (opțional)”, în „Setări avansate”.',
  MODEL_UNSUPPORTED:
    'Modelul ales nu poate citi poze și produce text. Alege un model Gemini (de exemplu gemini-3.5-flash-lite).',
  REGION:
    'Google nu a acceptat cererea: nivelul gratuit nu este disponibil pentru acest cont sau proiect (țară neacceptată, verificare sau facturare cerută). Vezi detaliile în Google AI Studio.',
  QUOTA:
    'Ai folosit toată cota zilnică gratuită pentru acest model. Se reîmprospătează la miezul nopții, ora Pacificului (dimineața, ora României); poți încerca între timp alt model.',
  RATE_LIMITED:
    'Prea multe cereri într-un timp scurt (limita pe minut a cotei gratuite). Așteaptă puțin și încearcă din nou.',
  SERVER:
    'Serviciul Gemini are probleme sau este suprasolicitat. Încearcă din nou peste câteva minute.',
  REJECTED:
    'Google a refuzat cererea. Încearcă din nou sau alege altă poză; dacă se repetă, alege alt model.',
  BLOCKED:
    'Gemini a refuzat să citească poza (conținut oprit de filtrele Google). Încearcă o poză mai clară sau completează bonul de mână.',
  TRUNCATED:
    'Răspunsul Gemini a fost tăiat înainte să se termine (bon foarte lung). Încearcă o poză doar cu o parte din bon sau alt model.',
  EMPTY_ANSWER: 'Gemini nu a întors niciun răspuns. Încearcă din nou.',
  MALFORMED:
    'Răspunsul Gemini nu a putut fi înțeles. Nu am schimbat nimic pe bon. Încearcă din nou sau corectează bonul de mână.',
  NO_LINES:
    'Gemini nu a găsit nicio linie de produs în poză. Verifică dacă poza arată bonul întreg și este clară.',
  CANCELLED: 'Citirea a fost oprită.',
  UNEXPECTED: 'A apărut o eroare neașteptată la citirea cu AI. Nu am schimbat nimic pe bon.',
};

const SENSITIVE_DATA =
  'Gemini a oprit citirea pentru că poza pare să conțină date personale sensibile (de exemplu numere de card). Decupează poza ca să arate doar produsele și totalul și încearcă din nou.';

function waitText(seconds: number): string {
  return seconds <= 90 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

/** The message of a failure: its Romanian text, with the one detail that helps (how long to wait). */
export function describeAiError(error: unknown): string {
  if (!isAiError(error)) return MESSAGES.UNEXPECTED;
  if (error.code === 'BLOCKED' && error.detail === 'SPII') return SENSITIVE_DATA;
  const message = MESSAGES[error.code];
  if ((error.code === 'RATE_LIMITED' || error.code === 'QUOTA') && error.retryAfterSeconds) {
    return `${message} Google cere o pauză de cel puțin ${waitText(error.retryAfterSeconds)}.`;
  }
  return message;
}
