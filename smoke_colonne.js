// Collaudo del riconoscimento delle colonne sui FOGLI VERI.
// Le intestazioni qui sotto sono quelle effettive di GESTIONE_FINANZIARIA
// (solo i nomi: nessun importo, nessun dato personale finisce nel repo).
// Verifica che ogni colonna che il server cerca risolva alla posizione
// giusta, e che le stranezze presenti nei dati veri non facciano danni.
// Un foglio riconosciuto male produce una sezione vuota SENZA errori: e'
// esattamente il guasto da cui e' partito tutto questo lavoro.
// Uso: node finanze/smoke_colonne.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const gs = fs.readFileSync(path.join(__dirname, 'FINANZE.gs'), 'utf8');
/* `iso_` usa Utilities/Session di Apps Script: qui si sostituiscono con il
   minimo che serve, altrimenti il ramo delle date non e' collaudabile.
   E le date vanno costruite DENTRO il contesto: un Date creato fuori non
   supera `instanceof Date` (realm diverso) e il ramo verrebbe saltato. */
const ctx = {
  console,
  Utilities: { formatDate: (d, tz, f) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) },
  Session: { getScriptTimeZone: () => 'Europe/Rome' }
};
vm.createContext(ctx);
new vm.Script(gs + `
;this.API = { up_, colIdx_, num_, r2_, iso_, meseIdx_, meseColExact_,
  statoCol_, statoEntCol_, entIdx_, bolIdx_, riscIdx_, necessita_, necNotaSeme_,
  giornoAccredito_, mancanti_, NEC_SEED, CONFIG };`).runInContext(ctx);
const A = ctx.API;

/* Intestazioni reali, riga 1, nell'ordine in cui stanno sul foglio. */
const H_USCITE = ['DATA PAGAMENTO', 'ANNO', 'MESE PAGAMENTO', 'NOME MESE', 'SPESA',
  'CATEGORIA', 'NOTE', 'CC', 'TIPO', 'DA PAGARE'];
const H_ENTRATE = ['DATA', 'ANNO', 'N. MESE', 'MESE', 'STIPENDIO LORDO', 'STIPENDIO NETTO',
  'ENTRATE EXTRA 1', 'ENTRATE EXTRA 2', 'ENTRATE CLA PER BOLLETTE', 'CASHBACK ',
  'NOTE', 'TOTALE ENTRATE', 'DA INCASSARE'];
const H_BOLLETTE = ['FORNITORE', 'ANNO CONSUMO', 'ANNO PAGAMENTO', 'MESE PAGAMENTO', 'MESE CONSUMI ',
  'COSTO TOTALE BOLLETTA LUCE', 'QUOTA FISSA', 'QUOTA POTENZA', 'ACCISE E IVA', 'CANONE RAI',
  'COSTO MATERIA PRIMA LUCE', 'CONSUMI KWH', 'Prezzo al KWh', 'COSTO BOLLETTA GAS',
  'COSTI FISSI GAS', 'COSTO MATERIA PRIMA GAS', 'Consumi smc', '€/ smc',
  'ORE TOT RISCALDAMENTO', 'COSTO 1H DI RISCALDAMENTO', "EFFICIENZA CALDAIA \n(CONSUMO 1 SMC ALL'ORA)"];

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : '')); if (!ok) falliti++; };
const col = (H, parti, atteso, nome) => esito(A.colIdx_(H, parti) === atteso, nome + ' → colonna ' + atteso, String(A.colIdx_(H, parti)));

console.log('\n1) USCITE — ogni colonna cercata dal server');
col(H_USCITE, ['ANNO'], 1, 'ANNO');
col(H_USCITE, ['MESE PAGAMENTO'], 2, 'MESE PAGAMENTO');
col(H_USCITE, ['NOME MESE'], 3, 'NOME MESE');
col(H_USCITE, ['SPESA'], 4, 'SPESA');
col(H_USCITE, ['CATEGORIA'], 5, 'CATEGORIA');
col(H_USCITE, ['NOTE'], 6, 'NOTE');
col(H_USCITE, ['CC'], 7, 'CC');
col(H_USCITE, ['TIPO'], 8, 'TIPO');
col(H_USCITE, ['DATA PAGAMENTO'], 0, 'DATA PAGAMENTO');
esito(A.statoCol_(H_USCITE) === 9, 'colonna di stato (cerca "PAGAR") → 9', String(A.statoCol_(H_USCITE)));
esito(A.mancanti_(H_USCITE, { 'ANNO': ['ANNO'], 'MESE PAGAMENTO': ['MESE PAGAMENTO'], 'SPESA': ['SPESA'], 'CATEGORIA': ['CATEGORIA'], 'TIPO': ['TIPO'] }).length === 0,
  'nessuna colonna obbligatoria manca');

console.log('\n2) La ricerca per pezzo di testo non prende la colonna sbagliata');
// "DATA PAGAMENTO" e "MESE PAGAMENTO" convivono: il primo che passa vince,
// quindi vale la pena verificarlo invece di darlo per scontato
esito(A.colIdx_(H_USCITE, ['MESE PAGAMENTO']) !== 0, '"MESE PAGAMENTO" non finisce su "DATA PAGAMENTO"');
esito(A.statoCol_(H_USCITE) !== 0 && A.statoCol_(H_USCITE) !== 2, '"PAGAR" non prende le colonne "PAGAMENTO"');
esito(A.colIdx_(H_USCITE, ['CC']) === 7, '"CC" non prende ACCISE/CASHBACK e simili');

console.log('\n3) ENTRATE — ogni colonna cercata dal server');
{
  const I = A.entIdx_(H_ENTRATE);
  const att = { data: 0, anno: 1, nmese: 2, mese: 3, lordo: 4, netto: 5, extra1: 6, extra2: 7, cla: 8, cashback: 9, note: 10, tot: 11, stato: 12 };
  Object.keys(att).forEach(k => esito(I[k] === att[k], k + ' → colonna ' + att[k], String(I[k])));
  esito(A.meseColExact_(H_ENTRATE) === 3, 'la colonna MESE è quella esatta, non "N. MESE"', String(A.meseColExact_(H_ENTRATE)));
  esito(I.cashback === 9, 'CASHBACK con lo spazio in coda viene comunque trovato');
}

console.log('\n4) BOLLETTE — le colonne con simboli e a capo');
{
  const I = A.bolIdx_(H_BOLLETTE);
  const att = { forn: 0, annoCons: 1, annoPag: 2, mesePag: 3, meseCons: 4, luceTot: 5, qFissa: 6, qPot: 7, accise: 8, rai: 9, luceMat: 10, kwh: 11, prezzoKwh: 12, gasTot: 13, gasFissi: 14, gasMat: 15, smc: 16, prezzoSmc: 17, oreRisc: 18, costo1h: 19, effCald: 20 };
  Object.keys(att).forEach(k => esito(I[k] === att[k], k + ' → colonna ' + att[k], String(I[k])));
}

console.log('\n5) Le stranezze che stanno DAVVERO nei dati');
// trovate leggendo il foglio: non sono casi di scuola
esito(A.num_('2026') === 2026, "l'anno scritto come testo '2026' vale 2026", String(A.num_('2026')));
esito(A.up_('si') === 'SI', "il 'si' minuscolo della colonna CC diventa SI");
esito(A.up_('NO') !== 'SI', "il 'NO' della colonna CC non diventa carta");
esito(A.up_(null) === '', 'uno stato vuoto non fa esplodere niente');
esito(A.up_('  PAGATA  ').indexOf('PAGAT') >= 0, 'PAGATA con spazi viene riconosciuta');
esito(A.meseIdx_('GENNAIO') === 0 && A.meseIdx_('DICEMBRE') === 11, 'i nomi dei mesi del foglio si leggono');
esito(A.meseIdx_('MESE CONSUMI ') === -1, 'un testo che non è un mese torna -1, non 0');

console.log('\n6) Giorno di accredito dalla colonna DATA');
{
  const dataVera = vm.runInContext('new Date(2026, 0, 10)', ctx);   // stesso realm del codice
  esito(A.giornoAccredito_(dataVera) === 10, 'da una data vera del foglio esce il giorno 10', String(A.giornoAccredito_(dataVera)));
  esito(A.iso_(dataVera) === '2026-01-10', 'la data viene formattata senza slittare di un giorno', A.iso_(dataVera));
}
esito(A.giornoAccredito_('2026-03-10') === 10, 'anche da una data in testo', String(A.giornoAccredito_('2026-03-10')));
esito(A.giornoAccredito_('') === null, 'una data vuota torna null (e vale il predefinito dichiarato)');
esito(A.CONFIG.GIORNO_ACCREDITO === 10, 'il predefinito coincide con quello che il foglio usa davvero');

console.log('\n7) Necessita\': le 31 categorie del foglio sono tutte classificate');
{
  /* Le categorie che stanno davvero nel foglio, con la necessita' attesa.
     Se una cade fuori dal seme prende VITA e viene elencata come "da
     decidere": va bene, ma deve essere una scelta vista, non un caso. */
  const necessarie = ['MUTUO CASA', 'FINANZIAMENTO RISTRUTTURAZIONE', 'RATA CUCINA', 'RATA APARECCHIO',
    'TASSE E COMMISSIONI', 'COMMERCIALISTA', 'MULTE', 'BOLLETTA LUCE', 'BOLLETTA GAS', 'BOLLETTA ACQUA',
    'TELEFONO', 'INTERNET', 'CASA', 'SPESA', 'GASOLIO', 'MACCHINA', 'FARMACIA/SALUTE'];
  const vita = ['MANGIARE FUORI', 'SVAGO', 'SHOPPING', 'VACANZA', 'SNOWBOARD', 'SPORT', 'CHILL',
    'COMPLEANNO', 'PARRUCCHIERE', 'AMAZON PRIME', 'YOUTUBE PREMIUM', 'NEBULA'];
  const sbagliate = necessarie.filter(c => A.necessita_(c) !== 'necessaria');
  esito(sbagliate.length === 0, 'le 17 necessarie sono classificate necessarie', sbagliate.join(', ') || 'nessuna sbagliata');
  const sbagliate2 = vita.filter(c => A.necessita_(c) !== 'vita');
  esito(sbagliate2.length === 0, 'le 12 di vita sono classificate vita', sbagliate2.join(', ') || 'nessuna sbagliata');
  esito(necessarie.length + vita.length === 29, 'coperte 29 categorie su 31', String(necessarie.length + vita.length));

  // PRELIEVO e ALTRO non si possono classificare senza sapere cosa contengono
  esito(!A.necNotaSeme_('PRELIEVO') && !A.necNotaSeme_('ALTRO'), 'PRELIEVO e ALTRO restano fuori dal seme');
  esito(A.necessita_('PRELIEVO') === 'vita', 'fuori dal seme si parte da VITA', A.necessita_('PRELIEVO'));
  esito(!A.necNotaSeme_('CATEGORIA MAI VISTA'), 'una categoria nuova risulta da decidere');

  // il mutuo e Netflix non devono piu' finire nella stessa casella
  esito(A.necessita_('MUTUO CASA') !== A.necessita_('YOUTUBE PREMIUM'),
    'mutuo e abbonamento non condividono piu\' l\'etichetta (prima erano entrambi "Fissa")');
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
