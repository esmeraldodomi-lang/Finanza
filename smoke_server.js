// Collaudo di buildFinanze_() DA CAPO A FONDO, con un finto Google Sheets.
//
// Perché esiste: c'erano già i controlli sulle colonne, sul motore delle
// analisi e sull'interfaccia, ma NESSUNO faceva girare buildFinanze_ per
// intero. Così una sostituzione di nomi non andata a segno è passata muta
// fino al telefono, dove è diventata
//     "FINANZE: Cannot read properties of undefined (reading '0')".
// Un payload che si costruisce è la cosa più semplice da verificare e la
// più costosa da sbagliare: qui gira a ogni modifica.
//
// Le righe sono sintetiche ma lo SCHEMA è quello vero (intestazioni copiate
// dal foglio) e riproducono le stranezze trovate nei dati reali.
// Uso: node finanze/smoke_server.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---- finto foglio di calcolo ---- */
function Foglio(nome, righe) {
  const R = righe.map(r => r.slice());
  const nCol = Math.max.apply(null, R.map(r => r.length));
  R.forEach(r => { while (r.length < nCol) r.push(''); });
  const scritture = [];
  return {
    _scritture: scritture,
    getName: () => nome,
    getLastRow: () => R.length,
    getLastColumn: () => nCol,
    getDataRange: () => ({ getValues: () => R.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const o = []; for (let i = 0; i < (nr || 1); i++) { const rr = R[r - 1 + i] || []; o.push(rr.slice(c - 1, c - 1 + (nc || 1))); } return o; },
      getFormulas: () => { const o = []; for (let i = 0; i < (nr || 1); i++) o.push(new Array(nc || 1).fill('')); return o; },
      setValues: v => { scritture.push({ r, c, v }); for (let i = 0; i < v.length; i++) { while (R.length < r - 1 + i + 1) R.push(new Array(nCol).fill('')); for (let j = 0; j < v[i].length; j++) R[r - 1 + i][c - 1 + j] = v[i][j]; } },
      setValue: v => { scritture.push({ r, c, v }); if (R[r - 1]) R[r - 1][c - 1] = v; },
      setFormula: () => {}, clearContent: () => {}, copyTo: () => {}
    }),
    deleteRow: () => {}
  };
}

const H_USCITE = ['DATA PAGAMENTO', 'ANNO', 'MESE PAGAMENTO', 'NOME MESE', 'SPESA', 'CATEGORIA', 'NOTE', 'CC', 'TIPO', 'DA PAGARE'];
const H_ENTRATE = ['DATA', 'ANNO', 'N. MESE', 'MESE', 'STIPENDIO LORDO', 'STIPENDIO NETTO', 'ENTRATE EXTRA 1', 'ENTRATE EXTRA 2', 'ENTRATE CLA PER BOLLETTE', 'CASHBACK ', 'NOTE', 'TOTALE ENTRATE', 'DA INCASSARE'];

/* Righe costruite per riprodurre le stranezze dei dati veri:
   - anno scritto come TESTO
   - CC con 'si' minuscolo e con 'NO'
   - stato vuoto
   - una categoria fuori dal seme (PRELIEVO)
   - una categoria mista fissa/variabile (CASA)  */
const USCITE = [H_USCITE,
  ['2026-01-15', 2026, 1, 'GENNAIO', 1000, 'MUTUO CASA', '', '', 'FISSA', 'PAGATA'],
  ['2026-01-20', '2026', 1, 'GENNAIO', 200, 'SPESA', 'anno come testo', '', 'VARIABILE', 'DA PAGARE'],
  ['2026-01-22', 2026, 1, 'GENNAIO', 50, 'SVAGO', 'carta minuscola', 'si', 'VARIABILE', 'DA PAGARE'],
  ['2026-01-25', 2026, 1, 'GENNAIO', 80, 'MANGIARE FUORI', 'cc = NO', 'NO', 'VARIABILE', ''],
  ['2026-02-10', 2026, 2, 'FEBBRAIO', 1000, 'MUTUO CASA', '', '', 'FISSA', 'DA PAGARE'],
  ['2026-02-12', 2026, 2, 'FEBBRAIO', 120, 'CASA', 'stessa cat, fissa', '', 'FISSA', 'DA PAGARE'],
  ['2026-02-14', 2026, 2, 'FEBBRAIO', 60, 'CASA', 'stessa cat, variabile', '', 'VARIABILE', 'DA PAGARE'],
  ['2026-03-01', 2026, 3, 'MARZO', 40, 'PRELIEVO', 'fuori dal seme', '', 'VARIABILE', 'DA PAGARE'],
  ['2025-12-01', 2025, 12, 'DICEMBRE', 999, 'SPESA', 'anno prima di START_YEAR', '', 'VARIABILE', 'PAGATA']
];
const entrateCon = mk => [H_ENTRATE,
  [mk(2026, 0, 10), 2026, 1, 'GENNAIO', 2600, 2000, 0, 0, 0, 0, '', 2000, 'INCASSATA'],
  [mk(2026, 1, 10), 2026, 2, 'FEBBRAIO', 2600, 2000, 0, 0, 0, 0, '', 2000, ''],
  [mk(2026, 2, 10), 2026, 3, 'MARZO', 2600, 2000, 0, 0, 0, 0, '', 2000, '']
];

function ambiente(fogli) {
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => ({ getSheets: () => fogli, getName: () => 'GESTIONE_FINANZIARIA' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), put: () => {}, putAll: () => {}, removeAll: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {} }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Rome' },
    Utilities: { formatDate: d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) },
    Logger: { log: () => {} }
  };
  vm.createContext(ctx);
  new vm.Script(fs.readFileSync(path.join(__dirname, 'FINANZE.gs'), 'utf8') +
    '\n;this.API = { buildFinanze_, getDatiFinanze, buildEntrate_, salvaSpesa, salvaRicorrente };').runInContext(ctx);
  /* Le date devono nascere NEL contesto: un Date creato fuori non supera
     `instanceof Date` (realm diverso) e il ramo delle date di iso_ verrebbe
     saltato in silenzio, facendo passare il test senza averlo provato. */
  ctx.API.__data = (y, m, d) => vm.runInContext('new Date(' + y + ',' + m + ',' + d + ')', ctx);
  return ctx.API;
}

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : '')); if (!ok) falliti++; };
const vicino = (a, b) => a != null && Math.abs(a - b) < 0.005;

console.log('\n1) Il payload si costruisce (era questo a rompersi)');
const fogli = [Foglio('USCITE', USCITE), Foglio('ENTRATE', [H_ENTRATE])];
const API = ambiente(fogli);
fogli[1] = Foglio('ENTRATE', entrateCon(API.__data));   // date create nel realm giusto
let p;
try { p = API.buildFinanze_(); } catch (e) { p = { error: 'ECCEZIONE: ' + e.message }; }
esito(!p.error, 'buildFinanze_ non lancia e non torna errore', p.error);
if (p.error) { console.log('\n1 CONTROLLI FALLITI'); process.exit(1); }

esito(p.v === 6, 'versione payload 6', String(p.v));
esito(Array.isArray(p.anni) && p.anni.length > 0, 'ci sono anni', JSON.stringify(p.anni));
esito(p.anni.indexOf(2025) < 0, "l'anno prima di START_YEAR resta fuori");

console.log('\n2) Ogni anno ha TUTTI i campi che la pagina legge');
{
  /* Il guasto era proprio questo: un campo rinominato di là e non di qua.
     Qui si controlla che la forma sia completa, non solo che esista. */
  const attesi = ['entrate', 'entrateIn', 'giorniEnt', 'necFisso', 'necVar', 'vitaFisso', 'vitaVar'];
  const b = p.base[2026];
  attesi.forEach(k => esito(Array.isArray(b[k]) && b[k].length === 12, k + ' è un array di 12', b[k] ? String(b[k].length) : 'assente'));
  const vecchi = ['fisse', 'cvar', 'nvar', 'dvar'];
  esito(vecchi.every(k => b[k] === undefined), 'i campi del vecchio modello non ci sono più',
    vecchi.filter(k => b[k] !== undefined).join(', ') || 'nessuno');
}

console.log('\n3) I due assi mandano ogni spesa nel secchio giusto');
{
  const b = p.base[2026];
  // gennaio: mutuo 1000 (nec+fissa), spesa 200 (nec+var), svago 50 + mangiare 80 (vita+var)
  esito(vicino(b.necFisso[0], 1000), 'gennaio necessarie fisse = 1000 (mutuo)', b.necFisso[0]);
  esito(vicino(b.necVar[0], 200), 'gennaio necessarie variabili = 200 (spesa, anno come testo)', b.necVar[0]);
  esito(vicino(b.vitaVar[0], 130), 'gennaio vita variabili = 130 (svago + mangiare fuori)', b.vitaVar[0]);
  esito(vicino(b.vitaFisso[0], 0), 'gennaio vita fisse = 0', b.vitaFisso[0]);
  // febbraio: CASA compare sia fissa sia variabile -> il TIPO si legge dalla RIGA
  esito(vicino(b.necFisso[1], 1120), 'febbraio necessarie fisse = 1000 + 120 (CASA fissa)', b.necFisso[1]);
  esito(vicino(b.necVar[1], 60), 'febbraio necessarie variabili = 60 (CASA variabile)', b.necVar[1]);
}

console.log('\n4) Le stranezze dei dati veri non fanno danni');
{
  const mov = p.movimenti;
  const perNota = n => mov.filter(r => r[6] === n)[0];
  esito(perNota('anno come testo') && perNota('anno come testo')[0] === 2026, "l'anno scritto come testo diventa 2026");
  esito(perNota('carta minuscola') && perNota('carta minuscola')[4] === 1, "il 'si' minuscolo vale carta");
  esito(perNota('cc = NO') && perNota('cc = NO')[4] === 0, "il 'NO' non vale carta");
  esito(perNota('cc = NO') && perNota('cc = NO')[8] === 0, 'lo stato vuoto vale "da pagare"');
  esito(mov.filter(r => r[0] === 2025).length === 0, 'le righe fuori periodo non entrano nel payload');
}

console.log('\n5) Entrate: previste e incassate restano separate');
{
  const b = p.base[2026];
  esito(vicino(b.entrate[0], 2000) && vicino(b.entrate[1], 2000), 'gennaio e febbraio previsti 2000');
  esito(vicino(b.entrateIn[0], 2000), 'gennaio è spuntato: incassato 2000', b.entrateIn[0]);
  esito(vicino(b.entrateIn[1], 0), 'febbraio NON è spuntato: incassato 0', b.entrateIn[1]);
  esito(b.giorniEnt[0] === 10, 'il giorno di accredito si legge dalla colonna DATA', String(b.giorniEnt[0]));
}

console.log('\n6) Le categorie non classificabili vengono dichiarate');
{
  esito(p.daDecidere.indexOf('PRELIEVO') >= 0, 'PRELIEVO è fra le "da decidere"', JSON.stringify(p.daDecidere));
  esito(p.cats['PRELIEVO'] === 'vita', 'nel frattempo vale VITA', p.cats['PRELIEVO']);
  esito(p.warn.some(w => /PRELIEVO/.test(w)), 'e finisce anche negli avvisi');
  esito(p.cats['MUTUO CASA'] === 'necessaria', 'il mutuo è necessario');
  esito(p.cats['SVAGO'] === 'vita', 'lo svago è vita');
  esito(p.catBase['CASA'] && p.catBase['CASA'].misto === 1, 'CASA è segnalata come mista (fissa e variabile)');
}

console.log('\n7) Saldo progressivo: è la riga che si era rotta');
{
  esito(typeof p.ccStart[2026] === 'number', 'ccStart calcolato per il 2026', String(p.ccStart[2026]));
  esito(isFinite(p.ccStart[2026]), 'ed è un numero finito, non NaN');
}

console.log('\n8) Il ponte non lancia mai: torna sempre un oggetto');
{
  const vuoto = ambiente([Foglio('ALTRO', [['x']])]);
  const r = vuoto.getDatiFinanze();
  esito(r && typeof r === 'object', 'senza il foglio USCITE torna comunque un oggetto');
  esito(!!r.error, 'e dichiara l\'errore', r.error);
  esito(/USCITE/.test(r.error), 'dicendo quale foglio manca');
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
