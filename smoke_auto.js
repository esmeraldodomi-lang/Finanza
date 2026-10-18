// Collaudo del modulo AUTO, da capo a fondo.
//
// 1) il motore AUTO:CORE di Finanze.html (classificazione, revisione,
//    scadenze, costi, incoerenze) sulle righe VERE del foglio USCITE
//    (MACCHINA e GASOLIO, ottobre 2026), con oggi = 18/10/2026;
// 2) il backend di FINANZE.gs con un finto Google Sheets, Gmail, Calendar e
//    trigger: creazione dei fogli AUTO_*, scritture in USCITE, correzioni,
//    email alle soglie (una sola volta), eventi Calendar che si spostano;
// 3) la pagina vera in jsdom: il tab Auto si apre, mostra le scadenze e un
//    backend vecchio senza getDatiAuto NON fa cadere l'app.
//
// Uso: node smoke_auto.js   (la parte 3 richiede jsdom, react, react-dom:
//      se mancano viene saltata e lo dice)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : '')); if (!ok) falliti++; };
const vicino = (a, b) => a != null && Math.abs(a - b) < 0.005;
const OGGI = '2026-10-18';

/* ---------------- finto foglio di calcolo ---------------- */
function Foglio(nome, righe) {
  const R = (righe || []).map(r => r.slice());
  const nCol = () => R.reduce((m, r) => Math.max(m, r.length), 0);
  const pad = () => { const n = nCol(); R.forEach(r => { while (r.length < n) r.push(''); }); };
  pad();
  return {
    _R: R,
    getName: () => nome,
    getLastRow: () => R.length,
    getLastColumn: () => nCol(),
    getDataRange: () => ({ getValues: () => R.map(r => r.slice()) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const o = []; for (let i = 0; i < (nr || 1); i++) { const rr = R[r - 1 + i] || []; const x = []; for (let j = 0; j < (nc || 1); j++) x.push(rr[c - 1 + j] === undefined ? '' : rr[c - 1 + j]); o.push(x); } return o; },
      getFormulas: () => { const o = []; for (let i = 0; i < (nr || 1); i++) o.push(new Array(nc || 1).fill('')); return o; },
      setValues: v => { for (let i = 0; i < v.length; i++) { while (R.length < r + i) R.push([]); const rr = R[r - 1 + i]; for (let j = 0; j < v[i].length; j++) { while (rr.length < c - 1 + j) rr.push(''); rr[c - 1 + j] = v[i][j]; } } pad(); },
      setValue: v => { if (R[r - 1]) R[r - 1][c - 1] = v; }
    }),
    deleteRow: n => { R.splice(n - 1, 1); },
    setFrozenRows: () => {}
  };
}
function Cartella(fogli) {
  return {
    getSheets: () => fogli,
    getName: () => 'GESTIONE_FINANZIARIA',
    getSheetByName: n => fogli.filter(f => f.getName() === n)[0] || null,
    insertSheet: n => { if (fogli.some(f => f.getName() === n)) throw new Error('esiste già'); const f = Foglio(n, []); fogli.push(f); return f; }
  };
}

/* ---------------- le righe vere (MACCHINA/GASOLIO) + rumore ---------------- */
const H_USCITE = ['DATA PAGAMENTO', 'ANNO', 'MESE PAGAMENTO', 'NOME MESE', 'SPESA', 'CATEGORIA', 'NOTE', 'CC', 'TIPO', 'DA PAGARE'];
const R_ = (data, imp, cat, nota, stato, anno, mese, cc) => [data, anno || +data.slice(0, 4), mese || +data.slice(5, 7), '', imp, cat, nota, cc || '', 'FISSA', stato || 'PAGATA'];
const USCITE = () => [H_USCITE,
  R_('2025-02-10', 132.74, 'GASOLIO', ''),
  R_('2025-05-10', 413, 'MACCHINA', 'BOLLO 2023'),
  R_('2025-05-10', 9, 'MACCHINA', 'LAVAGGIO'),
  R_('2025-05-10', 25, 'MACCHINA', 'olio '),
  R_('2025-11-10', 127, 'MACCHINA', 'ASSICURAZIONE AUTO'),
  R_('2025-12-10', 315, 'MACCHINA', 'BOLLO'),
  R_('2025-12-10', 127, 'MACCHINA', 'ASSICURAZIONE AUTO'),
  R_('2026-01-10', 80, 'MACCHINA', 'REVISIONE'),
  R_('2026-02-10', 127, 'MACCHINA', 'ass 3 RATA E ULTIMA CC'),
  R_('2026-03-10', 4.9, 'MACCHINA', 'AUTOSTRADA CHIOGGIA'),
  R_('2026-03-23', 120.8, 'MULTE', 'TRASFERTA LAVORO'),
  R_('2026-05-10', 70, 'SPESA', 'Spesa visotto'),
  R_('2026-07-01', 134, 'MACCHINA', "BOLLO 2024 CON SANZIONI, PAGA CON CC 1' rata"),
  R_('2026-07-15', 134, 'MACCHINA', "BOLLO 2024 CON SANZIONI, PAGA CON CC 2' rata"),
  R_('2026-08-12', 134, 'MACCHINA', "BOLLO 2024 CON SANZIONI, PAGA CON CC 3' rata"),
  R_('2026-09-11', 600, 'MACCHINA', 'Tagliando filtri e olio e catena 1 rata totale 2255'),
  R_('2026-09-15', 107, 'GASOLIO', ''),
  R_('2026-09-18', 10, 'MACCHINA', 'Autostrada viaggio genitori Cla'),
  R_('2026-10-28', '€ 600,00', 'MACCHINA', 'Tagliando cambio cinghia catena 2 rata', 'DA PAGARE'),
  R_('2026-11-11', 150, 'MACCHINA', 'ASSICURAZIONE AUTO da pagare a novembre in 3 rate con cc, 1 RATA', 'DA PAGARE'),
  R_('2026-11-28', 600, 'MACCHINA', 'Tagliando cambio cinghia catena 3 rata totale 2250', 'DA PAGARE'),
  R_('2026-12-10', 100, 'MACCHINA', 'bollo IN 3 RATE CON CC DA PAGARE A DICEMBRE , 1 RATA', 'DA PAGARE', 2027, 1),
  R_('2026-12-11', 150, 'MACCHINA', 'ASSICURAZIONE AUTO da pagare a dicembre in 3 rate con cc, 2 RATA', 'DA PAGARE', 2027, 1),
  R_('2026-12-15', 500, 'MACCHINA', 'Tagliando e cambio catena 4 rata totale 2255', 'DA PAGARE'),
  R_('2027-01-10', 100, 'MACCHINA', 'bollo IN 3 RATE CON CC DA PAGARE A GENNAIO, 2 RATA', 'DA PAGARE'),
  R_('2027-01-11', 150, 'MACCHINA', 'ASSICURAZIONE AUTO da pagare a gennaiio in 3 rate con cc, 3 RATA', 'DA PAGARE'),
  R_('2027-02-11', 100, 'MACCHINA', 'bollo IN 3 RATE CON CC DA PAGARE A FEBBRAIO, 3 RATA', 'DA PAGARE'),
  R_('2027-11-10', 450, 'MACCHINA', 'ASSICURAZIONE AUTO', 'DA PAGARE'),
  R_('2027-12-10', 300, 'MACCHINA', 'bollo', 'DA PAGARE'),
  R_('2028-12-10', 80, 'MACCHINA', 'REVISIONE', 'DA PAGARE'),
  R_('2030-12-10', 80, 'MACCHINA', 'REVISIONE', 'DA PAGARE'),
  R_('2047-12-10', 300, 'MACCHINA', 'bollo', 'PAGATA')
];

/* ---------------- ambiente Apps Script finto ---------------- */
function ambiente(fogli, oggiIso) {
  const store = {}, mails = [], eventi = {}, triggers = [];
  let seq = 0;
  const cal = {
    createAllDayEvent: (titolo, d, opt) => { const id = 'ev' + (++seq); eventi[id] = { id, titolo, data: d, desc: opt && opt.description, rem: [] }; return evento(id); },
    getEventById: id => eventi[id] ? evento(id) : null
  };
  function evento(id) {
    const e = eventi[id];
    return { getId: () => id, setAllDayDate: d => { e.data = d; }, setTitle: t => { e.titolo = t; }, setDescription: t => { e.desc = t; }, removeAllReminders: () => { e.rem = []; }, addPopupReminder: m => { e.rem.push(m); } };
  }
  const ctx = {
    console,
    SpreadsheetApp: { openById: () => Cartella(fogli) },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), put: () => {}, putAll: () => {}, removeAll: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => store.hasOwnProperty(k) ? store[k] : null, setProperty: (k, v) => { store[k] = String(v); } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Rome', getEffectiveUser: () => ({ getEmail: () => 'proprietario@example.org' }) },
    Utilities: { formatDate: d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2) },
    Logger: { log: () => {} },
    MailApp: { sendEmail: o => mails.push(o) },
    CalendarApp: { getDefaultCalendar: () => cal },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: fn => { const t = { fn, getHandlerFunction: () => fn }; const ch = { timeBased: () => ch, everyDays: n => { t.ogni = n; return ch; }, atHour: h => { t.ora = h; return ch; }, create: () => { triggers.push(t); return t; } }; return ch; }
    }
  };
  vm.createContext(ctx);
  /* "oggi" fisso dentro il contesto: new Date() senza argomenti = oggiIso */
  ctx.__OGGI = oggiIso;
  vm.runInContext("(function(D){ function F(){ var a = Array.prototype.slice.call(arguments); if (!a.length) { var m = __OGGI.split('-'); return new D(+m[0], +m[1]-1, +m[2], 9, 0, 0); } return new (Function.prototype.bind.apply(D, [null].concat(a)))(); } F.prototype = D.prototype; F.now = function(){ return new F().getTime(); }; F.UTC = D.UTC; F.parse = D.parse; Date = F; })(Date);", ctx);
  new vm.Script(fs.readFileSync(path.join(__dirname, 'FINANZE.gs'), 'utf8') +
    '\n;this.API = { buildAuto_, getDatiAuto, autoSalvaIntervento, autoEliminaIntervento, autoSalvaKm, autoSalvaScadenza, autoSalvaPiano, autoCorreggi, autoControlloScadenze, installaTriggerAuto, autoNum_ };').runInContext(ctx);
  return { API: ctx.API, ctx, store, mails, eventi, triggers, oggi: v => { ctx.__OGGI = v; } };
}

/* ---------------- il motore del client ---------------- */
const html = fs.readFileSync(path.join(__dirname, 'Finanze.html'), 'utf8');
const mCore = html.match(/\/\* AUTO:CORE:START[\s\S]*?\/\* AUTO:CORE:END \*\//);
if (!mCore) { console.error('Blocco AUTO:CORE non trovato in Finanze.html'); process.exit(2); }
const cctx = { console };
vm.createContext(cctx);
new vm.Script(mCore[0] + '\n;this.API = { autoClassifica, autoProssimaRevisione, autoCatene, autoPiuMesi, autoFineMese, autoGiorni, autoScadenze, autoCostiAnno, autoSanzioniBollo, autoIncoerenze, autoRiepilogo, autoCollegate, autoKmMese, autoKmAttuali, autoKmStimati, autoKmIncoerenti, autoPianoVoce, autoEtichetta, autoAnni, autoProssime };').runInContext(cctx);
const K = cctx.API;

console.log('\n1) Classificazione dalle note vere');
{
  const c = (cat, n) => K.autoClassifica(cat, n);
  esito(c('MACCHINA', 'ass 3 RATA E ULTIMA CC') === 'Assicurazione', '"ass 3 RATA" è assicurazione');
  esito(c('MACCHINA', 'ASSICURAZIONE AUTO da pagare a gennaiio in 3 rate con cc, 3 RATA') === 'Assicurazione', 'assicurazione a rate');
  esito(c('MACCHINA', "BOLLO 2024 CON SANZIONI, PAGA CON CC 1' rata") === 'Bollo', 'bollo con sanzioni');
  esito(c('MACCHINA', 'Tagliando cambio cinghia catena 2 rata') === 'Manutenzione', 'rata del tagliando');
  esito(c('MACCHINA', 'REVISIONE') === 'Revisione', 'revisione');
  esito(c('MACCHINA', 'Autostrada viaggio genitori Cla') === 'Pedaggi', 'autostrada');
  esito(c('MACCHINA', 'LAVAGGIO') === 'Lavaggio', 'lavaggio');
  esito(c('GASOLIO', '') === 'Gasolio', 'gasolio dalla categoria');
  esito(c('MACCHINA', 'ikea') === 'Altro', 'il resto è "Altro"');
}

console.log('\n2) Date: revisione, catene, mesi');
{
  esito(K.autoProssimaRevisione('2025-12-01') === '2027-12-31', 'revisione fatta a dicembre 2025 → entro 31/12/2027', K.autoProssimaRevisione('2025-12-01'));
  esito(K.autoProssimaRevisione('2026-01-20') === '2028-01-31', 'fatta a gennaio → entro fine gennaio, due anni dopo');
  esito(K.autoProssimaRevisione('', '2013-12') === '2017-12-31', 'la prima: 4 anni dall\'immatricolazione');
  esito(K.autoPiuMesi('2027-12-31', 24) === '2029-12-31', 'fine mese resta fine mese');
  esito(K.autoPiuMesi('2026-01-31', 1) === '2026-02-28', '31 gennaio + 1 mese = 28 febbraio');
  const c1 = K.autoCatene(OGGI);
  esito(!c1.inCorso && c1.dal === '2026-11-15' && c1.giorni === 28, 'catene: obbligo dal 15/11, fra 28 giorni', JSON.stringify(c1));
  const c2 = K.autoCatene('2027-01-10');
  esito(c2.inCorso && c2.al === '2027-04-15', 'a gennaio l\'obbligo è in corso fino al 15/04');
  esito(K.autoCatene('2026-04-16').inCorso === false, 'il 16 aprile è finito');
}

/* Il payload che il backend costruisce DAVVERO dai fogli finti. */
const amb = ambiente([Foglio('USCITE', USCITE()), Foglio('ENTRATE', [['ANNO']])], OGGI);
let P;
try { P = amb.API.buildAuto_(); } catch (e) { P = { error: 'ECCEZIONE: ' + e.message + '\n' + e.stack }; }

console.log('\n3) buildAuto_ crea i fogli e legge USCITE');
{
  esito(!P.error, 'buildAuto_ non lancia e non torna errore', P.error);
  if (P.error) { console.log('\n' + (falliti) + ' CONTROLLI FALLITI'); process.exit(1); }
  const nomi = amb.ctx.SpreadsheetApp.openById().getSheets().map(f => f.getName());
  ['AUTO_INTERVENTI', 'AUTO_KM', 'AUTO_SCADENZE', 'AUTO_PIANO'].forEach(n => esito(nomi.indexOf(n) >= 0, 'creato il foglio ' + n));
  esito(P.interventi.length === 3, '3 interventi di partenza', P.interventi.length);
  esito(P.scadenze.length === 3 && P.scadenze.filter(s => s.chiave === 'RCA')[0].scadenza === '2026-11-21', 'RCA al 21/11/2026');
  esito(P.scadenze.filter(s => s.chiave === 'REVISIONE')[0].scadenza === '2027-12-31', 'revisione al 31/12/2027');
  esito(P.piano.length === 10, '10 voci nel piano', P.piano.length);
  esito(P.uscite.length === 30, 'USCITE: solo MACCHINA e GASOLIO (30 righe, niente MULTE e SPESA)', P.uscite.length);
  const t = P.interventi.filter(i => i.id === 'AUTO-0003')[0];
  esito(t && t.costo === 2400 && t.straord === 2100 && t.voci.length === 2 && t.voci[1].importo === 2100, 'tagliando 2.400 € con catena 2.100 straordinaria');
  esito(P.uscite.filter(u => u.data === '2026-10-28')[0].importo === 600, '"€ 600,00" scritto come testo vale 600');
  const P2 = amb.API.buildAuto_();
  esito(P2.interventi.length === 3 && amb.ctx.SpreadsheetApp.openById().getSheets().length === 6, 'la seconda lettura non duplica fogli né righe');
}

console.log('\n4) Scadenze di oggi (18/10/2026)');
{
  const s = K.autoScadenze(P, OGGI);
  esito(s[0].chiave === 'CATENE' && s[0].stato === 'presto', 'prima le catene (28 giorni, entro il preavviso)', s.map(x => x.chiave + ':' + x.giorni).join(' '));
  esito(s[1].chiave === 'RCA' && s[1].giorni === 34 && s[1].stato === 'presto', 'poi la RCA, fra 34 giorni, già in preavviso (45)');
  esito(s.filter(x => x.chiave === 'BOLLO')[0].giorni === 74, 'bollo fra 74 giorni');
  esito(s.some(x => x.chiave === 'PIANO:OLIO MOTORE'), 'il tagliando (olio, computer di bordo) è sempre in lista');
  esito(!s.some(x => x.chiave === 'PIANO:PNEUMATICI'), 'le gomme (scadenza 2030) non affollano il cruscotto');
  const r = K.autoRiepilogo(P, OGGI);
  esito(r.badge === 2, 'pallino sulla barra = 2 (catene e RCA, entro il preavviso)', r.badge);
  esito(r.stato === 'ok', 'stato generale: in regola');
  esito(r.kmAtt.km === 180100, 'km attuali 180.100');
  esito(r.kmMese === 947, 'media km/mese dalle letture 08/2024 → 10/2026 (25.100 km in 807 giorni)', r.kmMese);
  esito(K.autoKmMese({ km: [{ data: '2026-09-11', km: 180000 }, { data: '2026-10-18', km: 180100 }] }) === null, 'con 5 settimane di letture la media non si inventa');
  const st = K.autoKmStimati(P, '2025-12-01');
  esito(st > 170700 && st < 170900, 'revisione di dicembre 2025 senza km: stima ≈ 170.800', st);
  esito(K.autoKmStimati(P, '2020-01-01') === null, 'prima della prima lettura nessuna stima');
  esito(/180/.test(K.autoKmIncoerenti(P, '2026-10-01', 150000)), 'km più bassi di una lettura precedente: rifiutati', K.autoKmIncoerenti(P, '2026-10-01', 150000));
  esito(/troppo alta/.test(K.autoKmIncoerenti(P, '2025-01-01', 181000)), 'km più alti di una lettura successiva: rifiutati');
  esito(K.autoKmIncoerenti(P, '2026-10-10', 180050) === '', 'km fra due letture: ok');
  esito(K.autoKmIncoerenti(P, '2024-08-02', 156000, 'AUTO-0001') === '', 'modificando un intervento i suoi km vecchi non contano');
  esito(r.ultimo.id === 'AUTO-0003', 'ultimo intervento = tagliando di settembre');
}

console.log('\n5) Costi');
{
  const c = K.autoCostiAnno(P, 2026);
  esito(vicino(c.per.Manutenzione, 2300), 'manutenzione 2026 = 2.300 (le 4 rate)', c.per.Manutenzione);
  esito(vicino(c.per.Bollo, 502), 'bollo 2026 = 402 arretrato + 100 rata', c.per.Bollo);
  esito(vicino(c.per.Assicurazione, 427), 'assicurazione 2026 = 427', c.per.Assicurazione);
  esito(vicino(c.arretrati, 402), 'arretrati: il bollo 2024 pagato nel 2026');
  esito(vicino(c.straord, 2100), 'straordinario: la catena');
  esito(vicino(c.ordinario, c.tot - 2100 - 402), 'ordinario = totale − catena − bollo arretrato', c.ordinario);
  esito(vicino(c.tot, 3430.9), 'totale 2026 dalla DATA (le 2 righe segnate gennaio 2027 contano a dicembre)', c.tot);
  const sz = K.autoSanzioniBollo(P);
  esito(sz.length === 2 && vicino(sz[0].extra, 113) && vicino(sz[1].extra, 102), 'sanzioni: 2023 +113 €, 2024 +102 €', JSON.stringify(sz));
  esito(JSON.stringify(K.autoAnni(P, OGGI)) === '[2025,2026,2027]', 'anni con costi fino al prossimo (niente 2047)', JSON.stringify(K.autoAnni(P, OGGI)));
}

console.log('\n6) Incoerenze nel foglio');
let INC;
{
  INC = K.autoIncoerenze(P, OGGI);
  const per = p => INC.filter(x => x.id.indexOf(p) === 0)[0];
  const costo = per('costo:AUTO-0003');
  esito(costo && /2\.?400/.test(costo.testo) && /2\.?300/.test(costo.testo), 'tagliando: fattura 2.400, in USCITE 2.300', costo && costo.testo);
  esito(costo && costo.azione.righe[0].importo === 100 && costo.azione.righe[0].data === '2026-12-15', '→ crea i 100 € mancanti accanto all\'ultima rata');
  esito(!per('costo:AUTO-0002'), 'la revisione (80 € pagati a gennaio) torna');
  esito(!per('costo:AUTO-0001'), 'le gomme 2024 precedono USCITE: non si controllano');
  const rev = per('revciclo:');
  esito(rev && rev.azione.righe.length === 2, 'revisioni fuori ciclo: 12/2028 e 12/2030');
  esito(rev && rev.azione.righe[0].data === '2027-12-10' && rev.azione.righe[1].data === '2029-12-10', '→ spostate a 12/2027 e 12/2029', rev && JSON.stringify(rev.azione.righe));
  esito(!per('manca:REVISIONE'), 'la revisione mancante non si propone due volte');
  esito(!per('manca:RCA') && !per('manca:BOLLO'), 'RCA e bollo sono già in USCITE');
  const tg = per('tagliando:');
  esito(tg && tg.azione.righe[0].importo === 300 && tg.azione.righe[0].data === '2027-09-11', 'tagliando 2027 non previsto → stima 300 € a 09/2027', tg && JSON.stringify(tg.azione));
  const am = per('annomese:');
  esito(am && am.azione.righe.length === 2, 'le 2 righe di dicembre segnate gennaio 2027');
  const pf = per('pagatefuture:');
  esito(pf && pf.azione.righe.length === 1, 'il bollo 2047 segnato PAGATA');
}

console.log('\n7) Scritture del backend');
{
  const A = amb.API, usc = () => amb.ctx.SpreadsheetApp.openById().getSheetByName('USCITE')._R;
  const n0 = usc().length;
  let r = A.autoSalvaIntervento({ data: '2026-10-10', km: 180050, tipi: ['ALTRO'], officina: 'Gommista', costo: 300, voci: [{ nome: 'Batteria', importo: 300 }], uscite: { modo: 'RATE', pay: 'conto', rate: [{ data: '2026-10-10', importo: 100 }, { data: '2026-11-10', importo: 100 }, { data: '2026-12-10', importo: 90 }] } });
  esito(r.error && /sommano/.test(r.error) && usc().length === n0, 'rate che non tornano: errore e NIENTE scritto', r.error);
  r = A.autoSalvaIntervento({ data: '2026-10-10', km: 180050, tipi: ['ALTRO'], officina: 'Gommista', costo: 300, voci: [{ nome: 'Batteria', importo: 300 }], uscite: { modo: 'RATE', pay: 'conto', rate: [{ data: '2026-10-10', importo: 100 }, { data: '2026-11-10', importo: 100 }, { data: '2026-12-10', importo: 100 }] } });
  esito(r.ok && r.id === 'AUTO-0004' && r.righeUscite === 3, 'intervento con 3 rate', JSON.stringify(r));
  const nuove = usc().slice(n0);
  esito(nuove.length === 3 && nuove.every(x => x[5] === 'MACCHINA' && /\[AUTO-0004\]/.test(x[6]) && x[8] === 'FISSA'), 'le rate sono MACCHINA, FISSA, con il tag [AUTO-0004]');
  esito(nuove[0][9] === 'PAGATA' && nuove[1][9] === 'DA PAGARE', 'la rata passata è pagata, quelle future no');
  esito(nuove[1][1] === 2026 && nuove[1][2] === 11 && nuove[1][3] === 'NOVEMBRE', 'ANNO/MESE/NOME MESE coerenti con la data');
  const P3 = A.buildAuto_();
  esito(P3.piano.filter(p => p.voce === 'Batteria')[0].ultimaData === '2026-10-10', 'il piano registra la batteria fatta');
  esito(P3.km.some(k => k.km === 180050), 'i km dell\'intervento diventano una lettura');
  const col = K.autoCollegate(P3, P3.interventi.filter(i => i.id === 'AUTO-0004')[0]);
  esito(col.length === 3, 'collegate per tag, non per finestra', col.length);
  r = A.autoSalvaIntervento({ data: '2027-12-05', tipi: ['REVISIONE'], costo: 80, voci: [], uscite: { modo: 'NESSUNA' } });
  const ed = A.autoSalvaIntervento({ id: 'AUTO-0002', data: '2025-12-01', tipi: ['REVISIONE'], costo: 80, voci: [{ nome: 'Revisione', importo: 80 }] });
  esito(ed.ok, 'un intervento vecchio senza km resta modificabile', ed.error);
  esito(r.error && /Mancano i km/.test(r.error), 'intervento nuovo senza km: rifiutato', r.error);
  r = A.autoSalvaIntervento({ data: '2027-12-05', km: 150000, tipi: ['REVISIONE'], costo: 80, voci: [], uscite: { modo: 'NESSUNA' } });
  esito(r.error && /non tornano/.test(r.error), 'intervento con km incoerenti: rifiutato', r.error);
  r = A.autoSalvaIntervento({ data: '2027-12-05', km: 195000, tipi: ['REVISIONE'], costo: 80, voci: [], uscite: { modo: 'NESSUNA' } });
  esito(r.ok && A.buildAuto_().scadenze.filter(s => s.chiave === 'REVISIONE')[0].scadenza === '2029-12-31', 'una revisione salvata sposta la prossima a +24 mesi');
  r = A.autoEliminaIntervento({ id: r.id });
  esito(r.ok, 'intervento eliminato');
  A.autoSalvaScadenza({ chiave: 'REVISIONE', scadenza: '2027-12-31', importo: 80, ripetiMesi: 24, preavviso: 60 });
  r = A.autoSalvaKm({ data: '2026-10-20', km: 100 });
  esito(r.error && /non tornano/.test(r.error), 'i km non tornano indietro', r.error);
  r = A.autoSalvaScadenza({ chiave: 'BOLLO', scadenza: '2026-12-31', importo: 300, ripetiMesi: 12, preavviso: 30, km: 180120, data: '2026-10-19', rinnova: true });
  const Pk = A.buildAuto_();
  esito(r.ok && Pk.km.some(k => k.km === 180120 && /SCADENZA BOLLO/.test(k.fonte)), 'bollo rinnovato: i km di quel giorno restano nelle letture');
  A.autoSalvaScadenza({ chiave: 'BOLLO', scadenza: '2026-12-31', importo: 300, ripetiMesi: 12, preavviso: 30 });
  r = A.autoSalvaScadenza({ chiave: 'BOLLO', scadenza: '2026-12-31', importo: 300, ripetiMesi: 12, preavviso: 30, km: 1000, data: '2026-10-19' });
  esito(r.error && /non tornano/.test(r.error), 'rinnovo con km incoerenti: rifiutato');
  r = A.autoSalvaScadenza({ chiave: 'RCA', scadenza: '2026-11-21', importo: 450, ripetiMesi: 12, preavviso: 45, rinnova: true });
  esito(r.ok && r.scadenza === '2027-11-21', 'RCA rinnovata → 21/11/2027');
  A.autoSalvaScadenza({ chiave: 'RCA', scadenza: '2026-11-21', importo: 450, ripetiMesi: 12, preavviso: 45 });
  r = A.autoSalvaPiano({ km: 180100, data: OGGI, righe: [{ voce: 'Olio motore', traKm: 24000 }, { voce: 'Liquido freni', entro: '2028-09' }] });
  const P4 = A.buildAuto_();
  esito(P4.piano.filter(p => p.voce === 'Olio motore')[0].kmScad === 204100, 'computer di bordo: olio tra 24.000 km → a 204.100');
  esito(P4.piano.filter(p => p.voce === 'Liquido freni')[0].dataScad === '2028-09-30', 'liquido freni entro 09/2028 → 30/09/2028');
}

console.log('\n8) Correzioni con un tocco');
{
  const A = amb.API, usc = () => amb.ctx.SpreadsheetApp.openById().getSheetByName('USCITE')._R;
  const rev = INC.filter(x => x.id.indexOf('revciclo:') === 0)[0];
  const sbagliata = JSON.parse(JSON.stringify(rev.azione)); sbagliata.righe[0].importo = 81;
  let r = A.autoCorreggi(sbagliata);
  esito(r.error && /cambiata/.test(r.error), 'riga cambiata nel frattempo: si ferma', r.error);
  r = A.autoCorreggi(rev.azione);
  esito(r.ok && r.righe === 2, 'revisioni spostate');
  const riga = usc()[rev.azione.righe[0].row - 1];
  esito(riga[0] === '2027-12-10' && riga[1] === 2027 && riga[2] === 12, 'la riga ora è 10/12/2027, anno e mese allineati');
  const costo = INC.filter(x => x.id === 'costo:AUTO-0003')[0];
  const n0 = usc().length;
  r = A.autoCorreggi(costo.azione);
  esito(r.ok && usc().length === n0 + 1 && usc()[n0][4] === 100 && usc()[n0][9] === 'DA PAGARE', 'creati i 100 € mancanti, da pagare');
  const dopo = K.autoIncoerenze(A.buildAuto_(), OGGI);
  esito(!dopo.some(x => x.id.indexOf('revciclo:') === 0) && !dopo.some(x => x.id === 'costo:AUTO-0003'), 'dopo le correzioni quelle incoerenze spariscono', dopo.map(x => x.id).join(' '));
  esito(!dopo.some(x => x.id.indexOf('manca:REVISIONE') === 0), 'e la revisione 12/2027 risulta prevista');
}

console.log('\n9) Promemoria: email alle soglie e Calendar');
{
  const A = amb.API;
  let r = A.autoControlloScadenze();
  esito(r.ok && !r.error, 'il controllo gira', r.error);
  esito(amb.mails.length === 1 && /Assicurazione RCA/.test(amb.mails[0].subject), 'il 18/10 la RCA è dentro i 45 giorni: parte la prima email', amb.mails.map(m => m.subject).join(' | '));
  const ev = Object.keys(amb.eventi).map(k => amb.eventi[k]);
  esito(ev.some(e => /RCA/.test(e.titolo)) && ev.some(e => /Bollo/.test(e.titolo)) && ev.some(e => /Revisione/.test(e.titolo)) && ev.some(e => /Catene/.test(e.titolo)), 'eventi Calendar per RCA, bollo, revisione, catene', ev.map(e => e.titolo).join(' | '));
  esito(ev.every(e => e.rem.indexOf(9540) >= 0 && e.rem.indexOf(900) >= 0), 'promemoria a 7 giorni e il giorno prima alle 9');
  const nEv = ev.length;
  amb.oggi('2026-10-25');
  r = A.autoControlloScadenze();
  esito(amb.mails.length === 1, 'il 25/10 la soglia dei 45 giorni è già stata avvisata: niente doppione', amb.mails.map(m => m.subject).join(' | '));
  esito(amb.mails[0].to === 'proprietario@example.org', 'all\'indirizzo del proprietario dello script');
  A.autoControlloScadenze();
  esito(amb.mails.length === 1, 'stesso giorno, secondo controllo: nessun doppione');
  amb.oggi('2026-11-01');
  A.autoControlloScadenze();
  esito(amb.mails.length === 2 && /Catene/.test(amb.mails[1].subject), 'il 01/11 parte quella delle catene, non di nuovo la RCA', amb.mails.map(m => m.subject).join(' | '));
  amb.oggi('2026-11-14');
  A.autoControlloScadenze();
  esito(amb.mails.length === 3 && /RCA/.test(amb.mails[2].htmlBody) && /Catene/.test(amb.mails[2].htmlBody), 'il 14/11 un\'unica email con RCA (7 gg) e catene (1 gg)', amb.mails[2] && amb.mails[2].subject);
  A.autoSalvaScadenza({ chiave: 'RCA', scadenza: '2026-11-21', importo: 450, ripetiMesi: 12, preavviso: 45, rinnova: true });
  r = A.autoControlloScadenze();
  const evRca = Object.keys(amb.eventi).map(k => amb.eventi[k]).filter(e => /RCA/.test(e.titolo));
  esito(evRca.length === 1 && evRca[0].data.getFullYear() === 2027, 'RCA rinnovata: l\'evento si sposta al 2027, non se ne crea un altro');
  esito(Object.keys(amb.eventi).length === nEv, 'nessun evento in più', Object.keys(amb.eventi).length + ' vs ' + nEv);
  const m0 = amb.mails.length;
  r = A.autoControlloScadenze({ prova: true });
  esito(amb.mails.length === m0 + 1, '"Controlla ora" manda il riepilogo anche a soglie già usate');
  A.autoControlloScadenze();
  esito(amb.mails.length === m0 + 1, 'e non consuma le soglie vere');
  esito(JSON.parse(amb.store.AUTO_ULTIMO_CONTROLLO).eventi > 0, 'l\'esito dell\'ultimo controllo si legge nel payload');
  r = A.installaTriggerAuto();
  esito(r.ok && amb.triggers.length === 1 && amb.triggers[0].fn === 'autoControlloScadenze' && amb.triggers[0].ora === 7, 'trigger giornaliero alle 7');
  A.installaTriggerAuto();
  esito(amb.triggers.length === 1, 'rieseguirlo non duplica il trigger');
  esito(!!A.buildAuto_().notifiche.trigger, 'il payload sa che i promemoria sono attivi');
}

/* ---------------- 10) la pagina vera ---------------- */
(async () => {
  let JSDOM;
  try { JSDOM = require('jsdom').JSDOM; require('react'); require('react-dom/client'); } catch (e) { JSDOM = null; }
  if (!JSDOM) { console.log('\n10) Pagina: SALTATA (manca jsdom/react: npm i jsdom react@18 react-dom@18)'); fine(); return; }
  console.log('\n10) Pagina: il tab Auto in jsdom');
  const blocchi = []; { const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html))) if (m[1].trim()) blocchi.push(m[1]); }
  const PAYLOAD = {
    v: 6, anni: [2026],
    base: { 2026: { entrate: Array(12).fill(2000), entrateIn: Array(12).fill(0), giorniEnt: Array(12).fill(10), necFisso: Array(12).fill(500), necVar: Array(12).fill(200), vitaFisso: Array(12).fill(100), vitaVar: Array(12).fill(50) } },
    ccStart: { 2026: 1000 }, cats: { 'MACCHINA': 'necessaria' }, catTipo: { 'MACCHINA': 'FISSA' }, catDict: ['MACCHINA'],
    movimenti: [[2026, 9, 0, 600, 0, 1, 'rata', 12, 0, '2026-10-28']], annuale: {}, catBase: { 'MACCHINA': { tipo: 'FISSA', misto: 0, nec: 'necessaria', nelSeme: 1 } },
    catCfg: {}, daDecidere: [], diag: { fogli: {}, righe: {}, mancanti: [] }, warn: []
  };
  const AUTO = JSON.parse(JSON.stringify(ambiente([Foglio('USCITE', USCITE())], OGGI).API.buildAuto_()));
  function reactPerFinestra(w) {
    global.window = w; global.document = w.document; global.navigator = w.navigator;
    global.requestAnimationFrame = cb => setTimeout(cb, 0); global.cancelAnimationFrame = clearTimeout; global.MessageChannel = w.MessageChannel;
    Object.keys(require.cache).forEach(k => { if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(k)) delete require.cache[k]; });
    return { React: require('react'), ReactDOM: require('react-dom/client') };
  }
  function avvia(conAuto) {
    const dom = new JSDOM(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/' });
    const w = dom.window, libs = reactPerFinestra(w);
    w.React = libs.React; w.ReactDOM = libs.ReactDOM;
    const run = () => {
      let ok = null; const p = { withSuccessHandler(f) { ok = f; return p; }, withFailureHandler() { return p; },
        getDatiFinanze() { setTimeout(() => ok(PAYLOAD), 0); }, getDatiEntrate() { setTimeout(() => ok({ rows: [], anni: [] }), 0); } };
      if (conAuto) p.getDatiAuto = () => setTimeout(() => ok(AUTO), 0);
      return p;
    };
    w.google = { script: { get run() { return run(); } } };
    blocchi.forEach(code => { try { w.eval(code); } catch (e) { console.log('    eval: ' + e.message); } });
    return w;
  }
  const attendi = ms => new Promise(r => setTimeout(r, ms));
  const testo = w => (w.document.getElementById('root').textContent || '');
  const tabAuto = w => { const b = Array.prototype.slice.call(w.document.querySelectorAll('button')).filter(x => /^Auto\b/.test(x.getAttribute('aria-label') || ''))[0]; if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
  const clicca = (w, rx) => { const b = Array.prototype.slice.call(w.document.querySelectorAll('button')).filter(x => rx.test(x.textContent))[0]; if (b) b.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); return !!b; };
  {
    const w = avvia(true);
    await attendi(150);
    esito(tabAuto(w), 'c\'è il tab Auto nella barra');
    await attendi(120);
    const t = testo(w);
    esito(/BMW 118d/.test(t) && /180\.100/.test(t), 'cruscotto: auto e km', t.slice(0, 80));
    esito(/Assicurazione RCA/.test(t) && /Catene a bordo/.test(t) && /Bollo/.test(t) && /Revisione/.test(t), 'cruscotto: le scadenze');
    esito(/incoerenze nel foglio USCITE/.test(t), 'cruscotto: avviso incoerenze');
    esito(/Promemoria non ancora attivi/.test(t), 'cruscotto: stato dei promemoria');
    clicca(w, /^Storico$/); await attendi(60);
    esito(/Olio motore \+ Catena distribuzione/.test(testo(w)) && /Amuro Gomme/.test(testo(w)), 'storico: tagliando e gomme');
    esito(/155\.000 km/.test(testo(w)), 'storico: gomme 2024 a 155.000 km');
    esito(/km non registrati · stima ≈ 170\.800 km/.test(testo(w)), 'storico: la revisione senza km mostra la stima', (testo(w).match(/km non registrati[^—]*/) || [''])[0]);
    clicca(w, /^Piano$/); await attendi(60);
    esito(/Olio cambio automatico/.test(testo(w)) && /storico mancante/.test(testo(w)), 'piano: voci fuori dal computer di bordo');
    clicca(w, /^Costi$/); await attendi(60);
    esito(/Bolli pagati in ritardo/.test(testo(w)) && /Correggi/.test(testo(w)), 'costi: sanzioni e correzioni');
    clicca(w, /^Correggi…$/); await attendi(60);
    esito(/COSA SCRIVO NEL FOGLIO/.test(testo(w)) && /Crea in USCITE/.test(testo(w)), 'la correzione mostra cosa scrive prima di farlo');
    clicca(w, /^✕$/); await attendi(40);
    clicca(w, /^Cruscotto$/); await attendi(40);
    clicca(w, /^\+ Intervento$/); await attendi(60);
    esito(/Nuovo intervento/.test(testo(w)) && /Registra in USCITE/.test(testo(w)), 'si apre "Nuovo intervento"');
    const tb = Array.prototype.slice.call(w.document.querySelectorAll('button')).filter(x => /Auto/.test(x.getAttribute('aria-label') || ''))[0];
    esito(tb && /2 avvisi/.test(tb.getAttribute('aria-label')), 'pallino sul tab: 2 avvisi', tb && tb.getAttribute('aria-label'));
  }
  {
    const w = avvia(false); // FINANZE.gs vecchio: getDatiAuto non esiste
    await attendi(150);
    esito(w.__FIN_MOUNTED__ === true && /Panoramica/.test(testo(w)), 'backend senza getDatiAuto: l\'app parte lo stesso');
    tabAuto(w); await attendi(80);
    esito(/Impossibile leggere i fogli AUTO|aggiorna FINANZE\.gs/.test(testo(w)), 'e il tab Auto dice cosa manca', testo(w).slice(0, 160));
  }
  fine();
})();

function fine() {
  console.log(falliti ? '\n' + falliti + ' CONTROLLI FALLITI' : '\nTUTTI I CONTROLLI SUPERATI');
  process.exit(falliti ? 1 : 0);
}
