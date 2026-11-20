/*
 * What the user is told before a photo leaves the device: in the Settings section and, word for
 * word, in the confirmation before every reading. Written from the Gemini API terms as read on
 * 2026-11-20 (docs/architecture.md section 16). Terms change, so the text says when it was
 * written and links to them. Romanian, like every string the user reads.
 */
export const AI_TERMS_URL = 'https://ai.google.dev/gemini-api/terms';
export const AI_TERMS_CHECKED = '20.11.2026';

export interface NoticeParagraph {
  title: string;
  text: string;
}

export const AI_SENT: NoticeParagraph = {
  title: 'Ce se trimite',
  text: 'Poza bonului, micșorată și refăcută ca JPEG (așa dispar datele ascunse din fișier: locația, ora, aparatul), împreună cu cheia ta API, într-un antet. Ajunge la Google, la generativelanguage.googleapis.com. Nu se trimite nimic altceva din aplicație.',
};

export const AI_PERSONAL_DATA: NoticeParagraph = {
  title: 'Date personale',
  text: 'Pe poza unui bon pot apărea date personale: numărul cardului sau al cardului de fidelitate, numele sau adresa ta. Ele fac parte din poză și pleacă odată cu ea.',
};

export const AI_FREE_TIER: NoticeParagraph = {
  title: 'Nivelul gratuit',
  text: 'Cu o cheie de pe nivelul gratuit (fără facturare activată), termenii Gemini API permit Google să folosească poza și răspunsul ca să-și îmbunătățească produsele, iar oameni din echipa Google le pot citi; ei cer să nu trimiți date sensibile sau personale. Cu facturare activată, datele nu sunt folosite în acest scop.',
};

export const AI_EUROPE: NoticeParagraph = {
  title: 'Spațiul Economic European, Elveția, Regatul Unit',
  text: 'Aceiași termeni spun că acolo se aplică regulile serviciilor plătite chiar și cotei gratuite (fără folosire pentru îmbunătățirea produselor), dar și că aplicațiile puse la dispoziția utilizatorilor de acolo pot folosi doar servicii plătite. Citește termenii înainte să te bazezi pe asta.',
};

/** Only in Settings: the terms describe the API as a developer's tool, so the key is the user's own matter. */
export const AI_RESPONSIBILITY: NoticeParagraph = {
  title: 'Cheia și termenii sunt ai tăi',
  text: 'Termenii Google descriu Gemini API ca pe un instrument pentru dezvoltatori, în scop profesional, nu pentru uz de consum. Folosești propria cheie și răspunzi de respectarea termenilor. Citirea cu AI este opțională: bonurile se pot importa și fără ea.',
};

/** The paragraphs of the confirmation before a reading. */
export const AI_CONFIRMATION: readonly NoticeParagraph[] = [
  AI_SENT,
  AI_PERSONAL_DATA,
  AI_FREE_TIER,
  AI_EUROPE,
];

export const AI_NOTICE_FOOTER = `Text scris după termenii din ${AI_TERMS_CHECKED}; ei se pot schimba.`;
