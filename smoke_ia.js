// Prova del motore dell'assistente (blocco IA:CORE di Finanze.html).
//
// PERCHE' ESISTE. L'assistente fa due cose di natura diversa: risponde a
// domande e PREPARA SCRITTURE su un foglio vero. La prima, se sbaglia, dice
// un numero storto; la seconda, se sbaglia, lascia fino a 120 righe da
// cancellare a mano. Qui si verificano entrambe, e in particolare le due
// cose che non possono rompersi:
//
//   1. NESSUNO STRUMENTO SCRIVE. Le due azioni tornano una proposta.
//   2. L'ANTEPRIMA E' QUELLO CHE VERRA' SCRITTO. Non si confronta la
//      proposta con un'idea di come dovrebbe essere: si prende il payload
//      della proposta, lo si da' in pasto ai VERI salvaSpesa/salvaRicorrente
//      di FINANZE.gs su un foglio finto, e si confrontano le righe uscite
//      con quelle mostrate. Se le due regole divergono, il test cade.
//
// Il blocco IA:CORE usa le previsioni di ANALISI:CORE: si estraggono
// entrambi e si eseguono insieme in Node.
// Uso: node finanze/smoke_ia.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'Finanze.html'), 'utf8');
const analisi = html.match(/\/\* ANALISI:CORE:START[\s\S]*?\/\* ANALISI:CORE:END \*\//);
const core = html.match(/\/\* ============================================================\n   IA:CORE:START[\s\S]*?\/\* IA:CORE:END \*\//);
if (!analisi) { console.error('Blocco ANALISI:CORE non trovato in Finanze.html'); process.exit(2); }
if (!core) { console.error('Blocco IA:CORE non trovato in Finanze.html'); process.exit(2); }

/* Il blocco deve restare senza React e senza browser: se ci finisce dentro
   un componente, il motore smette di essere provabile qui e il guasto si
   scopre sul telefono. Il controllo guarda il CODICE, non i commenti —
   altrimenti basterebbe nominare React in una spiegazione per farlo
   fallire, e un test che si fa ingannare dalla prosa non e' un test. */
const soloCodice = core[0].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const sporco = [['React', /\bReact\./], ['window', /\bwindow\./], ['document', /\bdocument\./],
  ['google.script', /google\.script/], ['useState', /\buseState\(/]];

const ctx = { console };
vm.createContext(ctx);
new vm.Script(analisi[0] + '\n' + core[0] +
  '\n;this.API = { finNorm, finLev, finSimile, finTrovaCat, finNum, finImporto, finMeseNome, finData,' +
  ' finPeriodo, finModello, finCtx, finMovimenti, finFiltra, finTot, finEuro, finRigheSpesa,' +
  ' finRigheRicorrenti, finProposta, finInterpreta, finRicorrenti, finKB, finStrumenti, finEsegui,' +
  ' finRispondi, finPrompt, finRichiesta, finTurnoUtente, finPropostaSintesi, finNumParola,' +
  ' finVoceTesto, finVoceErrore, finVoceMotivo, finDaLeggere, finTrovaMovimenti, finAzStato, finAzModifica, finAzElimina,' +
  ' finAzNecessita, finMargine, finDoveTagliare, finAnomalie,' +
  ' finChatTitolo, finChatOrdina, finChatScrivi, finChatMsgs, finChatMigra, finSaluto,' +
  ' FIN_MAX_RATE, FIN_GIRI, FIN_VOCE_LINGUA, FIN_MAX_CHAT };').runInContext(ctx);
const A = ctx.API;

/* ---------------- archivio finto, schema vero ---------------- */
const OGGI = '2026-03-15';
const z12 = () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const con = (a) => { const v = z12(); Object.keys(a).forEach(k => { v[+k] = a[k]; }); return v; };

// [anno, mese0, idxCat, importo, cc, fissa, nota, riga, pagata, dataISO]
const MOVS = [
  [2026, 0, 0, 1000, 0, 1, '', 2, 1, '2026-01-05'],
  [2026, 0, 1, 200, 0, 0, 'settimanale', 3, 1, '2026-01-12'],
  [2026, 0, 2, 300, 0, 0, 'acconto grecia', 4, 1, '2026-01-20'],
  [2026, 1, 0, 1000, 0, 1, '', 5, 1, '2026-02-05'],
  [2026, 1, 1, 250, 0, 0, '', 6, 0, '2026-02-11'],
  [2026, 1, 2, 100, 0, 0, 'caparra hotel', 7, 1, '2026-02-18'],
  [2026, 2, 0, 1000, 0, 1, '', 8, 0, '2026-03-05'],
  [2026, 2, 1, 180, 1, 0, 'con carta', 9, 0, '2026-03-10'],
  [2026, 2, 3, 60, 0, 0, 'bimestrale', 10, 0, '2026-03-12'],
  [2027, 0, 2, 900, 0, 0, 'anno dopo', 11, 0, '2027-01-08']
];
const DATA = {
  v: 6, fonte: 'Google Sheets (finto)', anni: [2026],
  base: {
    2026: {
      entrate: z12().map(() => 2000), entrateIn: con({ 0: 2000, 1: 2000 }), giorniEnt: z12().map(() => 10),
      necFisso: con({ 0: 1000, 1: 1000, 2: 1000 }), necVar: con({ 0: 200, 1: 250, 2: 240 }),
      vitaFisso: z12(), vitaVar: con({ 0: 300, 1: 100 })
    }
  },
  ccStart: { 2026: 1000 },
  cats: { 'MUTUO CASA': 'necessaria', 'SPESA': 'necessaria', 'VACANZA': 'vita', 'BOLLETTA LUCE': 'necessaria' },
  catTipo: { 'MUTUO CASA': 'FISSA', 'SPESA': 'VARIABILE', 'VACANZA': 'VARIABILE', 'BOLLETTA LUCE': 'VARIABILE' },
  catBase: {
    'MUTUO CASA': { tipo: 'FISSA', misto: 0, nec: 'necessaria', nelSeme: 1 },
    'SPESA': { tipo: 'VARIABILE', misto: 0, nec: 'necessaria', nelSeme: 1 },
    'VACANZA': { tipo: 'VARIABILE', misto: 0, nec: 'vita', nelSeme: 1 },
    'BOLLETTA LUCE': { tipo: 'VARIABILE', misto: 0, nec: 'necessaria', nelSeme: 1 }
  },
  catDict: ['MUTUO CASA', 'SPESA', 'VACANZA', 'BOLLETTA LUCE'],
  movimenti: MOVS, catCfg: {}, daDecidere: [], annuale: {}, giornoAccredito: 10,
  diag: { fogli: {}, righe: {}, mancanti: [] }, warn: []
};
const CTX = A.finCtx(DATA, { oggi: OGGI, soglia: 500 });

let falliti = 0;
const esito = (ok, testo, extra) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : ''));
  if (!ok) falliti++;
};
const vicino = (a, b) => a != null && Math.abs(a - b) < 0.005;

console.log('\n0) Il blocco resta eseguibile fuori dal browser');
sporco.forEach(([nome, rx]) => esito(!rx.test(soloCodice), 'nessun ' + nome + ' dentro IA:CORE'));

console.log('\n1) Riconoscere le categorie senza inventarle');
{
  const cats = Object.keys(DATA.cats);
  esito(A.finTrovaCat('ho pagato la vacanza', cats, false) === 'VACANZA', 'trova la categoria dentro la frase');
  esito(A.finTrovaCat('bolletta luce di marzo', cats, false) === 'BOLLETTA LUCE', 'la piu\' lunga vince (BOLLETTA LUCE)');
  esito(A.finTrovaCat('vacanaz', cats, true) === 'VACANZA', 'un refuso si perdona dove la categoria e\' nominata');
  /* La trappola: "speso" dista un refuso da "SPESA". Su tutta la frase il
     refuso NON si perdona, altrimenti "quanto ho speso a gennaio"
     risponderebbe il totale della sola categoria SPESA — un numero piu'
     piccolo del vero con l'aria di essere giusto. */
  esito(A.finTrovaCat('quanto ho speso a gennaio', cats, false) === null, '"speso" non diventa la categoria SPESA');
  esito(A.finTrovaCat('non esiste niente', cats, true) === null, 'se non e\' sicura torna null');
}

console.log('\n2) Importi: un numero non e\' automaticamente un importo');
{
  esito(vicino(A.finImporto('ho speso 20 euro'), 20), '20 euro', A.finImporto('ho speso 20 euro'));
  esito(vicino(A.finImporto('€ 20,50 di spesa'), 20.5), 'virgola decimale italiana', A.finImporto('€ 20,50 di spesa'));
  esito(vicino(A.finImporto('rata da 1.200,50'), 1200.5), 'punto = migliaia', A.finImporto('rata da 1.200,50'));
  esito(vicino(A.finImporto('20.50'), 20.5), '20.50 resta venti e mezzo', A.finImporto('20.50'));
  esito(vicino(A.finImporto('il 5 marzo ho speso 20 euro'), 20), 'il giorno del mese non e\' l\'importo', A.finImporto('il 5 marzo ho speso 20 euro'));
  esito(vicino(A.finImporto('50 euro per 6 mesi'), 50), 'il numero di rate non e\' l\'importo', A.finImporto('50 euro per 6 mesi'));
  esito(A.finImporto('quanto ho speso nel 2026') === null, 'un anno non e\' un importo', String(A.finImporto('quanto ho speso nel 2026')));
  esito(A.finImporto('quanto ho speso') === null, 'senza numero non c\'e\' importo');
}

console.log('\n3) Mesi e date');
{
  esito(A.finMeseNome('gennaio') === 0, 'gennaio = 0');
  esito(A.finMeseNome('MAGGIORI') === -1, '"MAGGIORI" non e\' maggio', String(A.finMeseNome('MAGGIORI')));
  esito(A.finData('ho speso oggi', CTX) === OGGI, 'oggi');
  esito(A.finData('ieri', CTX) === '2026-03-14', 'ieri', A.finData('ieri', CTX));
  esito(A.finData('il 5/3/2026', CTX) === '2026-03-05', 'data in cifre', A.finData('il 5/3/2026', CTX));
  esito(A.finData('il 5 marzo', CTX) === '2026-03-05', 'data a parole', A.finData('il 5 marzo', CTX));
  esito(A.finData('20 euro di spesa', CTX) === null, 'nessuna data inventata', String(A.finData('20 euro di spesa', CTX)));
}

console.log('\n4) Periodo della domanda, e se e\' stato detto davvero');
{
  const q = (s) => A.finPeriodo(s, CTX);
  esito(q('questo mese').mese === 2 && q('questo mese').anno === 2026, 'questo mese = marzo 2026');
  esito(q('il mese scorso').mese === 1, 'mese scorso = febbraio', q('il mese scorso').label);
  esito(q('a gennaio').mese === 0 && q('a gennaio').esplicito, 'a gennaio');
  esito(q('nel 2026').anno === 2026 && q('nel 2026').mese === null, 'un anno intero');
  esito(q('ultimi 3 mesi').daAssoluto === 2026 * 12 + 0, 'ultimi 3 mesi parte da gennaio', q('ultimi 3 mesi').label);
  esito(q('quanto ho speso').esplicito === false, 'periodo non detto: lo dichiara invece di far finta');
}

console.log('\n5) La frase di Esmeraldo, parola per parola');
{
  const l = A.finInterpreta('inserisco ogni mese spesa di 20 euro su categorie vacanza con nota albergo', CTX);
  esito(l.azione === 'ricorrente', 'e\' un\'azione ricorrente', String(l.azione));
  esito(vicino(l.importo, 20), 'importo 20', l.importo);
  esito(l.categoria === 'VACANZA', 'categoria VACANZA', l.categoria);
  esito(l.nota === 'albergo', 'nota "albergo" (non "albergo pagato con...")', '"' + l.nota + '"');
  esito(l.ricorrente === true, 'riconosce "ogni mese"');

  /* Trovato dal collaudo in pagina: con il periodo in coda la nota se lo
     portava dentro e finiva scritto cosi' sul foglio. Il periodo va letto
     DUE volte — come periodo — non una volta come periodo e una come
     testo libero. */
  const conPeriodo = A.finInterpreta('ogni mese 20 euro su vacanza con nota albergo da gennaio a giugno', CTX);
  esito(conPeriodo.nota === 'albergo', 'il periodo non finisce dentro la nota', '"' + conPeriodo.nota + '"');
  esito(conPeriodo.da && conPeriodo.da.m === 0, 'ma viene letto come periodo: da gennaio', conPeriodo.da && conPeriodo.da.m);
  esito(conPeriodo.a && conPeriodo.a.m === 5, 'a giugno', conPeriodo.a && conPeriodo.a.m);
  const conGiorno = A.finInterpreta('aggiungi 50 euro di spesa il giorno 5 ogni mese', CTX);
  esito(conGiorno.giorno === 5, 'il giorno del mese si legge', conGiorno.giorno);
}

console.log('\n6) Una domanda resta una domanda');
{
  const d1 = A.finInterpreta('quanto ho speso in vacanza quest\'anno?', CTX);
  esito(d1.azione === null, '"quanto ho speso" non registra niente', String(d1.azione));
  const d2 = A.finInterpreta('quanto spendo di spesa ogni mese?', CTX);
  esito(d2.azione === null, '"ogni mese" dentro una domanda non crea una ricorrente', String(d2.azione));
  const d3 = A.finInterpreta('aggiungi 35 euro di farmacia', CTX);
  esito(d3.azione === 'spesa', 'un comando con importo si', String(d3.azione));
  const d4 = A.finInterpreta('aggiungi una spesa', CTX);
  esito(d4.azione === null, 'un comando senza importo non basta', String(d4.azione));
  const d5 = A.finInterpreta('puoi aggiungere 12 euro di spesa?', CTX);
  esito(d5.azione === 'spesa', 'una richiesta gentile resta un comando', String(d5.azione));
}

console.log('\n7) La proposta dichiara le assunzioni invece di decidere in silenzio');
{
  const p = A.finProposta('ricorrente', { importo: 20, categoria: 'VACANZA', nota: 'albergo' }, CTX);
  esito(p.nRighe === 10, 'da marzo a dicembre = 10 rate', p.nRighe);
  esito(vicino(p.totale, 200), 'totale 200 €', p.totale);
  /* Ogni assunzione porta il CAMPO a cui si riferisce: e' quello che
     permette alla scheda di conferma di tenerla a schermo quando l'utente
     tocca un ALTRO campo. Senza, la scheda ripassa valori tutti espliciti,
     il calcolo non ha piu' niente da assumere e le decisioni prese al posto
     tuo spariscono dallo schermo — che e' il silenzio da evitare. */
  esito(p.assunzioni.every(a => !!a.campo && !!a.testo), 'ogni assunzione dice a quale campo si riferisce',
    p.assunzioni.map(a => a.campo).join(','));
  esito(p.assunzioni.some(a => a.campo === 'a' && /dicembre/i.test(a.testo)), 'la fine assunta e\' scritta',
    p.assunzioni.map(a => a.testo).join(' | '));
  esito(p.assunzioni.some(a => a.campo === 'da' && /Inizio/i.test(a.testo)), 'anche l\'inizio assunto e\' scritto');
  const detta = A.finProposta('ricorrente', { importo: 20, categoria: 'VACANZA', da: { y: 2026, m: 2 }, a: { y: 2026, m: 7 }, giorno: 5, tipo: 'FISSA' }, CTX);
  esito(detta.assunzioni.length === 0, 'se dici tutto, non c\'e\' niente da assumere', detta.assunzioni.length);
  esito(p.righe[0].dataISO === '2026-03-15', 'prima rata il 15 (giorno di oggi)', p.righe[0].dataISO);
  esito(p.righe[9].dataISO === '2026-12-15', 'ultima rata a dicembre', p.righe[9].dataISO);
  esito(p.campi.tipo === 'VARIABILE', 'tipo preso da quello della categoria', p.campi.tipo);

  const nuova = A.finProposta('spesa', { importo: 10, categoria: 'PALESTRA' }, CTX);
  esito(nuova.campi.categoriaNuova === true, 'una categoria mai vista viene dichiarata nuova');
  esito(nuova.assunzioni.some(a => a.campo === 'categoria' && /vita/i.test(a.testo)), 'e si dice che nasce come "vita"',
    nuova.assunzioni.map(a => a.testo).join(' | '));

  const manca = A.finProposta('spesa', { categoria: 'VACANZA' }, CTX);
  esito(manca.mancanti.indexOf('importo') >= 0, 'senza importo lo dice invece di mettere zero');
  esito(manca.nRighe === 0, 'e non produce righe');
}

console.log('\n8) Gli avvisi che si vedono solo guardando lo storico');
{
  const doppia = A.finProposta('spesa', { importo: 1000, categoria: 'MUTUO CASA', data: '2026-03-20' }, CTX);
  esito(doppia.avvisi.some(a => /gia' una uguale|già una uguale/i.test(a)), 'possibile doppione nel mese: segnalato', doppia.avvisi.join(' | '));
  const fuoriScala = A.finProposta('spesa', { importo: 5000, categoria: 'SPESA', data: '2026-03-20' }, CTX);
  esito(fuoriScala.avvisi.some(a => /Insolito/i.test(a)), 'importo fuori scala per la categoria: segnalato', fuoriScala.avvisi.join(' | '));
  const carta = A.finProposta('spesa', { importo: 30, categoria: 'SPESA', data: '2026-03-20', pagamento: 'cc' }, CTX);
  esito(carta.righe[0].dataISO === '2026-04-15', 'con la carta la spesa slitta al mese dopo, il 15', carta.righe[0].dataISO);
  esito(carta.avvisi.some(a => /carta/i.test(a)), 'e lo dice');
  const troppo = A.finProposta('ricorrente', { importo: 10, categoria: 'SPESA', da: { y: 2026, m: 0 }, a: { y: 2040, m: 0 } }, CTX);
  esito(!!troppo.errore, 'oltre ' + A.FIN_MAX_RATE + ' rate si ferma', troppo.errore);
}

console.log('\n9) NESSUNO STRUMENTO SCRIVE');
{
  const prima = JSON.stringify(DATA);
  const r1 = A.finEsegui('registra_spesa', { importo: 20, categoria: 'VACANZA' }, CTX);
  const r2 = A.finEsegui('spesa_ricorrente', { importo: 20, categoria: 'VACANZA', mesi: 3 }, CTX);
  esito(r1.scritta === false && !!r1.proposta, 'registra_spesa torna una proposta, non una scrittura');
  esito(r2.scritta === false && r2.proposta.nRighe === 3, 'spesa_ricorrente idem, con le sue 3 righe', r2.proposta.nRighe);
  esito(JSON.stringify(DATA) === prima, 'l\'archivio non e\' stato toccato da nessuno strumento');
  const nomi = A.finStrumenti().map(s => s.nome);
  esito(nomi.length === 22, '22 strumenti dichiarati', nomi.length);
  ['segna_pagata', 'modifica_spesa', 'elimina_spesa', 'imposta_necessita',
   'quanto_posso_spendere', 'dove_tagliare', 'anomalie'].forEach(n =>
    esito(nomi.indexOf(n) >= 0, 'c\'e\' lo strumento ' + n));
  esito(nomi.indexOf('registra_spesa') >= 0 && nomi.indexOf('spesa_ricorrente') >= 0, 'le due azioni sono fra gli strumenti');
  A.finStrumenti().forEach(s => {
    if (!s.parametri) return;
    const req = s.parametri.required || [];
    req.forEach(k => {
      if (!s.parametri.properties[k]) esito(false, 'strumento ' + s.nome + ': required "' + k + '" senza proprieta\'');
    });
  });
  esito(true, 'ogni campo obbligatorio esiste nello schema');
}

console.log('\n10) L\'anteprima E\' quello che verra\' scritto (contro il vero FINANZE.gs)');
{
  /* Foglio finto identico a quello di smoke_server.js: le scritture si
     accumulano e si rileggono. */
  function Foglio(nome, righe) {
    const R = righe.map(r => r.slice());
    const nCol = Math.max.apply(null, R.map(r => r.length));
    R.forEach(r => { while (r.length < nCol) r.push(''); });
    return {
      getName: () => nome, getLastRow: () => R.length, getLastColumn: () => nCol,
      getDataRange: () => ({ getValues: () => R.map(r => r.slice()) }),
      getRange: (r, c, nr, nc) => ({
        getValues: () => { const o = []; for (let i = 0; i < (nr || 1); i++) { const rr = R[r - 1 + i] || []; o.push(rr.slice(c - 1, c - 1 + (nc || 1))); } return o; },
        setValues: v => { for (let i = 0; i < v.length; i++) { while (R.length < r - 1 + i + 1) R.push(new Array(nCol).fill('')); for (let j = 0; j < v[i].length; j++) R[r - 1 + i][c - 1 + j] = v[i][j]; } },
        setValue: v => { if (R[r - 1]) R[r - 1][c - 1] = v; },
        setFormula: () => {}, clearContent: () => {}, copyTo: () => {}
      }),
      deleteRow: () => {}, _righe: () => R
    };
  }
  const H = ['DATA PAGAMENTO', 'ANNO', 'MESE PAGAMENTO', 'NOME MESE', 'SPESA', 'CATEGORIA', 'NOTE', 'CC', 'TIPO', 'DA PAGARE'];
  const foglio = Foglio('USCITE', [H]);
  const srv = {
    console,
    SpreadsheetApp: { openById: () => ({ getSheets: () => [foglio], getName: () => 'GESTIONE_FINANZIARIA' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), put: () => {}, putAll: () => {}, removeAll: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Rome' },
    Utilities: { formatDate: (d, tz, f) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) },
    Logger: { log: () => {} }
  };
  vm.createContext(srv);
  new vm.Script(fs.readFileSync(path.join(__dirname, 'FINANZE.gs'), 'utf8') +
    '\n;this.API = { salvaSpesa, salvaRicorrente };').runInContext(srv);

  const iC = {};
  H.forEach((h, i) => { iC[h] = i; });
  const letta = (n) => foglio._righe()[n - 1];

  // a) spesa singola
  const ps = A.finProposta('spesa', { importo: 42.5, categoria: 'VACANZA', nota: 'hotel', data: '2026-03-20' }, CTX);
  const rs = srv.API.salvaSpesa(ps.payload);
  esito(!!rs.ok, 'salvaSpesa accetta il payload della proposta', rs.error);
  const riga = letta(rs.row);
  esito(String(riga[iC['DATA PAGAMENTO']]) === ps.righe[0].dataISO, 'stessa data', riga[iC['DATA PAGAMENTO']] + ' vs ' + ps.righe[0].dataISO);
  esito(riga[iC['ANNO']] === ps.righe[0].y && riga[iC['MESE PAGAMENTO']] === ps.righe[0].m + 1, 'stesso anno e mese');
  esito(vicino(riga[iC['SPESA']], ps.totale), 'stesso importo', riga[iC['SPESA']]);
  esito(riga[iC['CATEGORIA']] === 'VACANZA' && riga[iC['NOTE']] === 'hotel', 'categoria e nota');

  // b) ricorrente con la carta: e' il caso in cui le date si spostano
  const pr = A.finProposta('ricorrente', { importo: 20, categoria: 'VACANZA', nota: 'albergo',
    pagamento: 'cc', da: { y: 2026, m: 2 }, a: { y: 2026, m: 7 } }, CTX);
  const primaRiga = foglio.getLastRow() + 1;
  const rr = srv.API.salvaRicorrente(pr.payload);
  esito(!!rr.ok, 'salvaRicorrente accetta il payload della proposta', rr.error);
  esito(rr.righe === pr.nRighe, 'stesso numero di righe: ' + pr.nRighe, rr.righe);
  let uguali = 0;
  for (let k = 0; k < pr.nRighe; k++) {
    const r = letta(primaRiga + k), att = pr.righe[k];
    if (String(r[iC['DATA PAGAMENTO']]) === att.dataISO && r[iC['ANNO']] === att.y &&
        r[iC['MESE PAGAMENTO']] === att.m + 1 && Math.abs(r[iC['SPESA']] - att.importo) < 0.005) uguali++;
  }
  esito(uguali === pr.nRighe, 'ogni riga scritta e\' identica a quella mostrata in anteprima', uguali + '/' + pr.nRighe);
  esito(String(letta(primaRiga)[iC['DATA PAGAMENTO']]) === '2026-04-15', 'con la carta la prima rata e\' ad aprile, il 15', letta(primaRiga)[iC['DATA PAGAMENTO']]);

  // c) il tetto delle rate e' lo stesso di qua e di la'
  const oltre = srv.API.salvaRicorrente({ cat: 'SPESA', amount: 1, giorno: 1, daMese: 0, daAnno: 2026, aMese: 0, aAnno: 2040 });
  esito(!!oltre.error, 'il server rifiuta oltre il tetto, come il motore', oltre.error);
}

console.log('\n11) Le risposte tornano con i dati (e con gli altri strumenti)');
{
  const gen = A.finFiltra(CTX, { anno: 2026, mese: 0 });
  esito(vicino(A.finTot(gen), 1500), 'gennaio 2026 = 1500 €', A.finTot(gen));
  const cat = A.finEsegui('spese_per_categoria', { anno: 2026, mese: 0 }, CTX);
  esito(vicino(cat.totale, 1500), 'lo strumento dice lo stesso totale', cat.totale);
  esito(vicino(cat.categorie.reduce((a, c) => a + c.totale, 0), 1500), 'e le categorie sommano al totale');
  const r = A.finRispondi('quanto ho speso a gennaio?', CTX);
  /* "1500,00" e non "1.500,00": in italiano il punto delle migliaia compare
     da cinque cifre in su (minimumGroupingDigits = 2). E' la stessa
     formattazione del resto dell'app, che usa Intl con la stessa lingua. */
  esito(!!r && /1500,00/.test(r.testo), 'il motore locale risponde lo stesso numero', r && r.testo.split('\n')[0]);
  esito(A.finEuro(12500) === '12.500,00 €', 'sopra le quattro cifre il punto c\'e\'', A.finEuro(12500));

  const sit = A.finEsegui('situazione', { anno: 2026, mese: 2 }, CTX);
  esito(vicino(sit.contoAFineMese, 2910), 'conto previsto a fine marzo = 2910', sit.contoAFineMese);
  esito(vicino(sit.saldoAdesso, 2150), 'saldo di adesso = 2150 (marzo non ancora incassato)', sit.saldoAdesso);
  esito(vicino(sit.daPagare, 1240), 'da pagare a marzo = 1240', sit.daPagare);

  const dp = A.finEsegui('da_pagare', { anno: 2026, mese: 2 }, CTX);
  esito(vicino(dp.totale, 1240), 'da_pagare dice lo stesso numero di situazione', dp.totale);
  esito(vicino(dp.suCarta, 180), 'e sa quanto e\' sulla carta', dp.suCarta);

  const ric = A.finEsegui('spese_ricorrenti', { anno: 2026 }, CTX);
  esito(ric.quante === 1 && ric.voci[0].categoria === 'MUTUO CASA', 'trova il mutuo fra le ricorrenti', JSON.stringify(ric.voci.map(v => v.categoria)));
  esito(vicino(ric.pesoAlMese, 1000), 'pesa 1000 € al mese', ric.pesoAlMese);

  const cf = A.finEsegui('confronta_periodi', { anno1: 2026, mese1: 0, anno2: 2026, mese2: 1 }, CTX);
  esito(vicino(cf.delta, -150), 'febbraio - gennaio = -150', cf.delta);
  const vac = cf.differenzePerCategoria.find(d => d.categoria === 'VACANZA');
  esito(vac && vicino(vac.delta, -200), 'la vacanza e\' scesa di 200', vac && vac.delta);

  const rp = A.finEsegui('ripartizione', { anno: 2026 }, CTX);
  esito(vicino(rp.necessarie.importo + rp.vita.importo, rp.totale), 'necessarie + vita = totale');
  esito(vicino(rp.fisse.importo + rp.variabili.importo, rp.totale), 'fisse + variabili = lo stesso totale');
}

console.log('\n12) Il modello dell\'anno e\' quello della Panoramica');
{
  const mod = A.finModello(DATA, 2026, [], DATA.cats);
  esito(!!mod && mod.rows.length === 12, '12 righe');
  esito(mod.movs.length === 9, 'solo i movimenti del 2026 (il 2027 resta fuori)', mod.movs.length);
  /* Controprova a mano: il saldo di ADESSO usa le entrate INCASSATE, la
     proiezione quelle previste. Se qualcuno le scambia, questi due numeri
     diventano uguali e il conto di inizio mese risulta gonfio. */
  esito(vicino(mod.rows[2].saldoOra, 2150), 'saldo di adesso a marzo', mod.rows[2].saldoOra);
  esito(vicino(mod.rows[2].projectedCC, 2910), 'proiezione a fine marzo', mod.rows[2].projectedCC);
  esito(mod.rows[2].saldoOra !== mod.rows[2].projectedCC, 'i due saldi restano due cose diverse');
  esito(A.finModello(DATA, 2030, [], DATA.cats) === null, 'un anno senza dati torna null, non zeri');
}

console.log('\n13) Quando non sa, lo dice (e non inventa)');
{
  const e1 = A.finEsegui('dettaglio_categoria', { categoria: 'CRIPTOVALUTE' }, CTX);
  esito(!!e1.errore && Array.isArray(e1.valoriDisponibili), 'categoria inesistente: errore + elenco vero', e1.errore);
  esito(e1.valoriDisponibili.indexOf('VACANZA') >= 0, 'l\'elenco e\' quello dell\'archivio');
  const e2 = A.finEsegui('strumento_che_non_esiste', {}, CTX);
  esito(!!e2.errore && e2.valoriDisponibili.length === 22, 'strumento inesistente: errore + strumenti veri');
  const e3 = A.finEsegui('situazione', { anno: 2031 }, CTX);
  esito(!!e3.errore, 'anno senza dati: errore, non un mese di zeri', e3.errore);
  const vuoto = A.finCtx(null, { oggi: OGGI });
  esito(A.finRispondi('quanto ho speso?', vuoto) === null, 'archivio vuoto: il motore locale tace invece di rispondere zero');
  esito(A.finKB(vuoto).archivio === 'non caricato', 'e l\'indice lo dichiara');
}

console.log('\n12-bis) Dettatura: dalla voce a un dato leggibile');
{
  esito(A.FIN_VOCE_LINGUA === 'it-IT', 'si ascolta in italiano');
  // i numeri a parole, anche attaccati
  esito(A.finNumParola('venti') === 20, 'venti', A.finNumParola('venti'));
  esito(A.finNumParola('ventuno') === 21, 'ventuno (forma tronca: vent + uno)', A.finNumParola('ventuno'));
  esito(A.finNumParola('ventidue') === 22, 'ventidue', A.finNumParola('ventidue'));
  esito(A.finNumParola('ventotto') === 28, 'ventotto', A.finNumParola('ventotto'));
  esito(A.finNumParola('centocinquanta') === 150, 'centocinquanta', A.finNumParola('centocinquanta'));
  esito(A.finNumParola('duecento') === 200, 'duecento', A.finNumParola('duecento'));
  esito(A.finNumParola('milleduecento') === 1200, 'milleduecento', A.finNumParola('milleduecento'));
  esito(A.finNumParola('duemila') === 2000, 'duemila', A.finNumParola('duemila'));
  esito(A.finNumParola('sessantacinque') === 65, 'sessantacinque (non 60 + un avanzo)', A.finNumParola('sessantacinque'));
  /* Deve consumare TUTTA la parola: una che comincia per numero ma non lo e'
     non deve diventare un numero con un pezzo buttato via. */
  esito(A.finNumParola('unico') === null, '"unico" non e\' un numero', String(A.finNumParola('unico')));
  esito(A.finNumParola('spesa') === null, '"spesa" nemmeno');

  // la frase intera
  const v = A.finVoceTesto;
  esito(v('venti euro di spesa') === '20 euro di spesa', 'venti euro -> 20 euro', v('venti euro di spesa'));
  esito(v('venti virgola cinquanta euro') === '20,50 euro', 'la virgola dettata diventa decimale', v('venti virgola cinquanta euro'));
  esito(v('20 virgola 50 euro') === '20,50 euro', 'anche quando il browser scrive gia\' le cifre', v('20 virgola 50 euro'));
  esito(v('aggiungi trentacinque euro di farmacia.') === 'aggiungi 35 euro di farmacia',
    'il punto finale della dettatura non resta', v('aggiungi trentacinque euro di farmacia.'));
  /* Le parole ambigue: "una spesa" non e' "1 spesa", ma "sei euro" e' 6. */
  esito(v('aggiungi una spesa') === 'aggiungi una spesa', '"una" resta un articolo', v('aggiungi una spesa'));
  esito(v('sei euro di caffe') === '6 euro di caffe', 'ma "sei euro" e\' un importo', v('sei euro di caffe'));
  esito(v('quanto ho speso a gennaio') === 'quanto ho speso a gennaio', 'una domanda non viene toccata');
  esito(v('') === '', 'stringa vuota');
  /* Il resto della frase non si tocca: quello che compare in chat dev'essere
     quello che hai detto. */
  esito(v('ogni mese venti euro su vacanza con nota albergo') === 'ogni mese 20 euro su vacanza con nota albergo',
    'la frase resta la tua, cambiano solo i numeri', v('ogni mese venti euro su vacanza con nota albergo'));

  // e il giro completo: dettato -> interpretato
  const l = A.finInterpreta(v('ogni mese venti virgola cinquanta euro su vacanza con nota albergo'), CTX);
  esito(l.azione === 'ricorrente' && vicino(l.importo, 20.5) && l.categoria === 'VACANZA' && l.nota === 'albergo',
    'dettando si arriva alla stessa proposta che scrivendo', l.importo + ' ' + l.categoria + ' ' + l.nota);

  // gli errori parlano italiano e dicono la via d'uscita
  esito(/tastiera/.test(A.finVoceErrore('not-allowed')), 'microfono negato: propone il ripiego che funziona sempre');
  esito(A.finVoceErrore('aborted') === '', 'se lo fermi tu, nessun errore');
  esito(/non ho sentito|Non ho sentito/i.test(A.finVoceErrore('no-speech')), 'silenzio: lo dice');
  esito(!!A.finVoceErrore('boh'), 'un codice sconosciuto non resta muto');
}


console.log('\n12-ter) Voce in uscita: quello che si ascolta non e\' quello che si legge');
{
  const L = A.finDaLeggere;
  esito(L('Hai speso **1500,00 €** a gennaio') === 'Hai speso 1500 € a gennaio',
    'via il grassetto, e i centesimi a zero non si pronunciano', '"' + L('Hai speso **1500,00 €** a gennaio') + '"');
  esito(L('Totale `1.234,50` euro') === 'Totale 1.234,50 euro', 'i centesimi VERI restano', '"' + L('Totale `1.234,50` euro') + '"');
  esito(L('### Titolo\nprima riga\nseconda riga') === 'Titolo. prima riga. seconda riga',
    'gli a capo diventano pause, i cancelletti spariscono', '"' + L('### Titolo\nprima riga\nseconda riga') + '"');
  esito(L('- uno\n- due') === 'uno. due', 'gli elenchi si leggono senza trattini', '"' + L('- uno\n- due') + '"');
  esito(L('Fatto.\nAltro') === 'Fatto. Altro', 'e non si accumulano due punti', '"' + L('Fatto.\nAltro') + '"');
  esito(L('') === '' && L(null) === '', 'niente da dire, niente da leggere');

  /* Una risposta lunga si taglia a FRASE INTERA e lo dichiara: meglio una
     frase in meno che una troncata a meta' parola. */
  const lunga = 'Prima frase che spiega la situazione del mese. Seconda frase con il dettaglio delle categorie. Terza frase con il consiglio finale che chiude il discorso in modo compiuto.';
  const tag = L(lunga, 80);
  esito(tag.length < lunga.length, 'la risposta lunga viene tagliata', tag.length + ' caratteri');
  esito(/Il resto è a schermo\.$/.test(tag), 'e lo dice invece di finire a meta\'', '"' + tag.slice(-30) + '"');
  esito(/situazione del mese\./.test(tag), 'il taglio cade a fine frase', '"' + tag + '"');
}

console.log('\n13-bis) Al modello vanno le FRASI, non gli oggetti');
{
  const sint = A.finPropostaSintesi(A.finProposta('ricorrente', { importo: 20, categoria: 'VACANZA' }, CTX));
  esito(sint.assunzioni.every(a => typeof a === 'string'), 'le assunzioni sono testo leggibile', JSON.stringify(sint.assunzioni[0]));
  esito(sint.righeDaScrivere > 0 && !sint.righe && !sint.payload, 'niente righe e niente payload nella sintesi');
  esito(!!sint.dalMese && !!sint.alMese, 'ma il periodo si capisce lo stesso', sint.dalMese + ' → ' + sint.alMese);
}

console.log('\n14) Indice e prompt: cosa vede il modello');
{
  const kb = A.finKB(CTX);
  esito(kb.categorie.length === 4, 'le categorie vere, con necessita\' e tipo', kb.categorie.length);
  esito(kb.anni.join() === '2026', 'gli anni veri');
  esito(kb.mesiConMovimenti['2026'].join() === 'GENNAIO,FEBBRAIO,MARZO', 'i mesi che hanno movimenti', kb.mesiConMovimenti['2026'].join());
  esito(JSON.stringify(kb).length < 4000, 'l\'indice resta piccolo (' + JSON.stringify(kb).length + ' byte): viaggia a ogni giro');
  const p = A.finPrompt(CTX);
  esito(/NESSUNA azione scrive/.test(p), 'il prompt dice al modello che nessuna azione scrive');
  esito(/UNA riga sola/.test(p), 'e che modifica ed eliminazione pretendono una riga sola');
  esito(p.indexOf(OGGI) >= 0, 'il prompt sa che giorno e\'');
  const req = A.finRichiesta([{ ruolo: 'user', testo: 'ciao' }], CTX);
  esito(!!req.sistema && !!req.indice && req.strumenti.length === 22, 'la richiesta porta prompt, indice e strumenti');
  const turno = A.finTurnoUtente('quanto ho speso a gennaio?', CTX);
  esito(/GIA' CALCOLATA/.test(turno.testo) && /1500,00/.test(turno.testo), 'la risposta gia\' calcolata viaggia con la domanda');
  const turno2 = A.finTurnoUtente('e se comprassi una barca?', CTX);
  esito(turno2.testo === 'e se comprassi una barca?', 'se il motore locale non sa, non attacca niente');
}


console.log('\n15) Le altre quattro azioni: toccano righe che esistono gia\'');
{
  const prima = JSON.stringify(DATA);

  /* --- segnare pagata --- */
  const st = A.finAzStato(CTX, { categoria: 'MUTUO CASA', pagata: true });
  esito(!st.errore, 'trova le spese da pagare del mutuo', st.errore);
  esito(st.nRighe === 1 && st.righe[0].riga === 8, 'e' + "'" + ' la sola non pagata (riga 8, marzo)', st.nRighe + ' riga ' + (st.righe[0] || {}).riga);
  esito(st.payload.paid === 1 && st.payload.items[0].row === 8, 'il payload e' + "'" + ' quello di setStatiBulk', JSON.stringify(st.payload.items));
  /* Il lock: categoria e importo viaggiano con la riga, cosi' il server
     rifiuta se nel frattempo quella riga e' cambiata. */
  esito(st.payload.items[0].cat === 'MUTUO CASA' && Math.abs(st.payload.items[0].amount - 1000) < 0.005,
    'con categoria e importo attuali, per il controllo del server');
  const st2 = A.finAzStato(CTX, { categoria: 'VACANZA', anno: 2026, pagata: true });
  esito(!!st2.errore, 'se sono gia' + "'" + ' tutte pagate lo dice invece di scrivere', st2.errore);

  /* --- modificare --- */
  const mo = A.finAzModifica(CTX, { categoria: 'BOLLETTA LUCE', nuovoImporto: 75 });
  esito(!mo.errore, 'trova la bolletta', mo.errore);
  esito(mo.cambi.length === 1 && mo.cambi[0].campo === 'importo', 'un solo campo cambia', JSON.stringify(mo.cambi));
  esito(mo.cambi[0].da === 60 && mo.cambi[0].a === 75, 'da 60 a 75', mo.cambi[0].da + '→' + mo.cambi[0].a);
  esito(mo.payload.oldAmount === 60 && mo.payload.row === 10, 'il payload porta il vecchio importo per il lock', JSON.stringify(mo.payload.oldAmount));
  const mo0 = A.finAzModifica(CTX, { categoria: 'BOLLETTA LUCE' });
  esito(!!mo0.errore, 'senza dire cosa cambiare, non modifica niente', mo0.errore);
  /* La regola che conta: piu' righe corrispondenti = nessuna modifica. */
  const moM = A.finAzModifica(CTX, { categoria: 'MUTUO CASA', nuovoImporto: 999 });
  esito(!!moM.errore && moM.candidati.length === 3, 'tre mutui: si ferma e li elenca', moM.candidati && moM.candidati.length);
  esito(!moM.payload, 'e non produce nessun payload');
  const moU = A.finAzModifica(CTX, { categoria: 'MUTUO CASA', importo: 1000, mese: 0, nuovoImporto: 1010 });
  esito(!moU.errore && moU.payload.row === 2, 'con il mese diventa una sola e si puo' + "'" + ' fare', moU.errore || ('riga ' + moU.payload.row));
  /* Spostare la data puo' cambiare il mese, e il mese e' l'unita' di misura
     di tutta l'app: va detto. */
  const moD = A.finAzModifica(CTX, { categoria: 'BOLLETTA LUCE', nuovaData: '2026-04-02' });
  esito(moD.avvisi.some(x => /Cambia mese/.test(x)), 'cambiare mese viene dichiarato', moD.avvisi.join(' | '));

  /* --- eliminare --- */
  const el = A.finAzElimina(CTX, { categoria: 'BOLLETTA LUCE' });
  esito(!el.errore && el.payload.row === 10, 'individua la riga da eliminare', el.errore || el.payload.row);
  esito(el.avvisi.some(x => /annulla/.test(x)), 'e dice che non c' + "'" + 'e' + "'" + ' un annulla', el.avvisi.join(' | '));
  const elM = A.finAzElimina(CTX, { categoria: 'MUTUO CASA' });
  esito(!!elM.errore && !elM.payload, 'su piu' + "'" + ' righe NON elimina niente', elM.errore);

  /* --- riclassificare una categoria --- */
  const ne = A.finAzNecessita(CTX, { categoria: 'VACANZA', necessita: 'necessaria' });
  esito(!ne.errore, 'accetta il cambio', ne.errore);
  esito(ne.cambi[0].da === 'vita' && ne.cambi[0].a === 'necessaria', 'da vita a necessaria');
  esito(ne.nRighe === 0, 'non tocca nessuna riga del foglio', ne.nRighe);
  esito(!!A.finAzNecessita(CTX, { categoria: 'VACANZA', necessita: 'boh' }).errore, 'una necessita' + "'" + ' inventata viene rifiutata');
  esito(!!A.finAzNecessita(CTX, { categoria: 'VACANZA', necessita: 'vita' }).errore, 'e se e' + "'" + ' gia' + "'" + ' cosi' + "'" + ', lo dice');

  /* LA TRAPPOLA: salvaCategorie riscrive l'INTERA mappa. Mandare solo la
     categoria toccata cancellerebbe in silenzio tutte le altre scelte. */
  const conScelte = A.finCtx(Object.assign({}, DATA, { catCfg: { 'SPESA': { nec: 'vita' }, 'SVAGO': { nec: 'necessaria' } } }), { oggi: OGGI, soglia: 500 });
  const ne2 = A.finAzNecessita(conScelte, { categoria: 'VACANZA', necessita: 'necessaria' });
  esito(Object.keys(ne2.payload.categorie).length === 3, 'la mappa viaggia INTERA: le scelte gia' + "'" + ' fatte non si perdono',
    Object.keys(ne2.payload.categorie).join(','));
  esito(ne2.payload.categorie['SPESA'].nec === 'vita' && ne2.payload.categorie['VACANZA'].nec === 'necessaria',
    'con dentro la modifica');

  esito(JSON.stringify(DATA) === prima, 'e nessuna delle quattro ha toccato l' + "'" + 'archivio');
}

console.log('\n16) Le analisi che rispondono a "e adesso?"');
{
  /* Marzo: conto previsto 2910, soglia 500 -> margine 2410. */
  const mg = A.finMargine(CTX, 2026, 2);
  esito(vicino(mg.contoPrevistoAFineMese, 2910), 'conto previsto a fine marzo', mg.contoPrevistoAFineMese);
  esito(vicino(mg.margineSullaSoglia, 2410), 'margine sulla soglia = 2910 - 500', mg.margineSullaSoglia);
  esito(mg.sottoSoglia === false, 'non e' + "'" + ' sotto soglia');
  esito(mg.giorniRimasti === 16, 'sa quanti giorni restano (oggi e' + "'" + ' il 15 di 31)', mg.giorniRimasti);
  esito(vicino(mg.alGiorno, 2410 / 16), 'e quanto si puo' + "'" + ' spendere al giorno', mg.alGiorno);
  const magro = A.finCtx(DATA, { oggi: OGGI, soglia: 3000 });
  esito(A.finMargine(magro, 2026, 2).sottoSoglia === true, 'con una soglia alta, lo dichiara');

  const dt = A.finDoveTagliare(CTX, 2026);
  esito(dt.voci.length === 1 && dt.voci[0].categoria === 'VACANZA', 'solo le categorie "vita"', JSON.stringify(dt.voci.map(v => v.categoria)));
  esito(vicino(dt.totaleVita, 400), 'totale vita = 300 + 100', dt.totaleVita);
  esito(vicino(dt.voci[0].alMese, 200), 'media sui mesi in cui c' + "'" + 'e' + "'" + ' stata (2), non su 12', dt.voci[0].alMese);
  esito(!dt.voci.some(v => v.categoria === 'MUTUO CASA'), 'il mutuo non compare: non e' + "'" + ' una voce su cui si decide');

  /* Anomalie: SPESA ha 200/250/180 (mediana 200); una da 900 e' fuori scala. */
  const conPicco = JSON.parse(JSON.stringify(DATA));
  conPicco.movimenti.push([2026, 3, 1, 900, 0, 0, 'picco', 20, 0, '2026-04-04']);
  const ctxPicco = A.finCtx(conPicco, { oggi: OGGI, soglia: 500 });
  const an = A.finAnomalie(ctxPicco, 2026, null);
  esito(an.quante === 1 && vicino(an.movimenti[0].importo, 900), 'trova la spesa fuori scala', JSON.stringify(an.movimenti.map(m => m.importo)));
  esito(vicino(an.movimenti[0].medianaCategoria, 200), 'confrontata con la mediana delle ALTRE spese della categoria (200, non 225)', an.movimenti[0].medianaCategoria);
  esito(A.finAnomalie(CTX, 2026, null).quante === 0, 'senza picchi non inventa anomalie');
  esito(/mediana/i.test(an.nota), 'e dichiara il metodo', an.nota.slice(0, 40) + '…');
}

console.log('\n17) Senza chiave: "ho pagato la bolletta" spunta, non duplica');
{
  const l1 = A.finInterpreta('ho pagato la bolletta luce', CTX);
  esito(l1.azione === 'pagata', 'senza importo e' + "'" + ' una spesa da spuntare', String(l1.azione));
  const l2 = A.finInterpreta('ho pagato 60 euro di bolletta luce', CTX);
  esito(l2.azione === 'spesa', 'CON l' + "'" + 'importo e' + "'" + ' una spesa nuova', String(l2.azione));
  const l3 = A.finInterpreta('quanto ho pagato di bollette?', CTX);
  esito(l3.azione === null, 'e una domanda resta una domanda', String(l3.azione));

  const r = A.finRispondi('ho pagato la bolletta luce', CTX);
  esito(!!r && !!r.proposta && r.proposta.tipo === 'stato', 'il motore locale prepara la spunta', r && r.titolo);
  esito(r.proposta.payload.items[0].row === 10, 'sulla riga giusta', r.proposta.payload.items[0].row);
  const r2 = A.finRispondi('ho pagato', CTX);
  esito(!!r2 && !r2.proposta && /Quale spesa/.test(r2.titolo), 'senza categoria chiede quale, non indovina', r2 && r2.titolo);
}

console.log('\n18) Su iPhone si detta con la tastiera: l\'app lo sa prima di provare');
{
  /* Il microfono DELLA PAGINA dentro la cornice di Apps Script non parte, e
     su iOS non c'e' browser che tenga: sono tutti WebKit. Provare per poi
     mostrare un errore rosso insegna solo che l'app e' rotta. */
  const M = A.finVoceMotivo;
  esito(M({ api: true, ios: true, cornice: true }) === 'tastiera', 'iPhone dentro la cornice: si indica la tastiera');
  esito(M({ api: true, ios: true, cornice: false }) === '', 'iPhone SENZA cornice: si prova, li\' funziona');
  esito(M({ api: true, ios: false, cornice: true }) === '', 'fuori da iOS non si indovina: si prova');
  esito(M({ api: false, ios: false, cornice: false }) === 'assente', 'browser senza riconoscimento: lo dice');
  esito(M({ api: true, ios: false, cornice: true, gia: true }) === 'tastiera',
    'ma un "no" gia\' ricevuto vale per sempre: si passa alla tastiera');
  esito(M({ api: false, ios: true, cornice: true }) === 'assente', 'l\'assenza viene prima di tutto');
  esito(M() === 'assente' && M(null) === 'assente', 'senza ambiente non si inventa una strada');
}

console.log('\n19) I numeri a parole valgono anche se NON arrivano dal microfono');
{
  /* La dettatura della tastiera dell'iPhone scrive nel campo come se stessi
     digitando: quel testo entra dall'ingresso del testo scritto, e prima
     "venti euro" non veniva capito mentre "20 euro" si'. */
  const cats = Object.keys(DATA.cats);
  const scritto = A.finInterpreta('aggiungi spesa di venti euro su ' + cats[0], CTX);
  const cifre = A.finInterpreta('aggiungi spesa di 20 euro su ' + cats[0], CTX);
  esito(scritto.importo === 20, '"venti euro" digitato vale 20', scritto.importo);
  esito(scritto.importo === cifre.importo && scritto.categoria === cifre.categoria,
    'e da' + ' esattamente la stessa lettura di "20 euro"', scritto.categoria + ' / ' + cifre.categoria);
  esito(A.finInterpreta('spesa di millecinquecento euro su ' + cats[0], CTX).importo === 1500,
    'anche i numeri lunghi attaccati ("millecinquecento")');
  /* La prudenza di prima non si perde: "sei" e' un verbo molto piu' spesso
     di quanto sia un importo, e diventa 6 solo davanti alla valuta. */
  esito(A.finInterpreta('sei sicuro di quanto ho speso a giugno?', CTX).importo === null,
    '"sei" da solo non diventa un importo');
  esito(A.finInterpreta('spesa di sei euro su ' + cats[0], CTX).importo === 6, '"sei euro" invece si\'');
  /* Idempotenza: la stessa pulizia applicata due volte (microfono in pagina
     + interprete) non deve cambiare il risultato. */
  const dueVolte = A.finInterpreta(A.finVoceTesto('spesa di venti euro su ' + cats[0]), CTX);
  esito(dueVolte.importo === 20, 'applicata due volte da\' lo stesso numero', dueVolte.importo);
  /* E una domanda resta una domanda: la conversione non deve trasformarla
     in un comando. */
  esito(A.finInterpreta('quanto ho speso a giugno?', CTX).domanda === true, 'una domanda resta una domanda');
}

console.log('\n20) Le conversazioni sono un elenco: "nuova" mette da parte, non cancella');
{
  const U = (t, id) => ({ role: 'user', id: id || 1, text: t });
  const B = (t, id) => ({ role: 'bot', id: id || 2, text: t });

  /* Il titolo e' la PRIMA domanda: dice di cosa si parlava e non cambia
     sotto gli occhi mentre la conversazione va avanti. */
  esito(A.finChatTitolo([U('Quanto ho speso a marzo?'), B('320 €'), U('E ad aprile?')]) === 'Quanto ho speso a marzo?',
    'il titolo e\' la prima domanda, non l\'ultima');
  esito(A.finChatTitolo([B('ciao'), U('poi arrivo io')]) === 'poi arrivo io', 'una risposta non fa da titolo');
  esito(A.finChatTitolo([]) === '' && A.finChatTitolo(null) === '', 'senza messaggi non si inventa un titolo');
  const lungo = A.finChatTitolo([U('x'.repeat(120))]);
  esito(lungo.length <= 42 && /…$/.test(lungo), 'un titolo lungo si taglia e lo dichiara', lungo.length + ' caratteri');
  esito(A.finChatTitolo([U('  quanto\n  spendo  ')]) === 'quanto spendo', 'gli a capo non finiscono nel titolo');

  /* Scrivere nella chat ATTIVA, che arriva come parametro. */
  let cs = A.finChatScrivi([], 10, [U('prima domanda')], 1000);
  esito(cs.length === 1 && cs[0].titolo === 'prima domanda', 'la prima scrittura crea la conversazione');
  cs = A.finChatScrivi(cs, 10, [U('prima domanda'), B('eccola')], 1001);
  esito(cs.length === 1 && cs[0].msgs.length === 2, 'la seconda scrive nella STESSA, non in una nuova', cs.length);
  esito(cs[0].titolo === 'prima domanda', 'e il titolo non si riscrive a ogni messaggio');
  cs = A.finChatScrivi(cs, 20, [U('altro argomento')], 1002);
  esito(cs.length === 2 && cs[0].id === 20, 'un id nuovo apre una conversazione nuova, in testa');
  esito(A.finChatMsgs(cs, 10).length === 2, 'e quella di prima e\' ancora li\', intera', A.finChatMsgs(cs, 10).length);
  esito(A.finChatMsgs(cs, 999).length === 0 && A.finChatMsgs(null, 1).length === 0,
    'una conversazione che non c\'e\' torna vuota, non esplode');

  /* Le piu' recenti in testa, e oltre il tetto le piu' vecchie cadono. */
  let molte = [];
  for (let i = 0; i < A.FIN_MAX_CHAT + 5; i++) molte = A.finChatScrivi(molte, i, [U('d' + i)], i);
  esito(molte.length === A.FIN_MAX_CHAT, 'oltre il tetto l\'elenco non cresce', molte.length);
  esito(molte[0].id === A.FIN_MAX_CHAT + 4, 'in testa c\'e\' la piu\' recente', molte[0].id);
  esito(!molte.some(c => c.id === 0), 'e la piu\' vecchia e\' quella che cade');

  /* La cronologia vecchia non si butta. */
  const migrata = A.finChatMigra([U('domanda di ieri'), B('risposta')], 555);
  esito(migrata.length === 1 && migrata[0].msgs.length === 2 && migrata[0].titolo === 'domanda di ieri',
    'la conversazione unica di prima diventa la prima dell\'elenco');
  esito(A.finChatMigra([], 1).length === 0 && A.finChatMigra(null, 1).length === 0,
    'ma senza niente da migrare non si crea una chat vuota');

  /* Il saluto guarda l'ora. */
  esito(A.finSaluto(9) === 'Buongiorno' && A.finSaluto(15) === 'Buon pomeriggio' && A.finSaluto(21) === 'Buonasera',
    'il saluto segue l\'ora del telefono', [9, 15, 21].map(A.finSaluto).join(' · '));
  esito(A.finSaluto(2) === 'Buonanotte', 'e alle due di notte non dice buongiorno');
  esito(A.finSaluto(undefined) === 'Ciao' && A.finSaluto('boh') === 'Ciao', 'senza ora resta un saluto neutro');
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
