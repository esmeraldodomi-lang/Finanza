/*******************************************************************
 * GESTIONE FINANZIARIA — ENDPOINT GOOGLE SHEETS (Apps Script)
 * Bollette · Riscaldamento · Entrate · Uscite · Auto
 *
 * REGOLA DI DIAGNOSI (perché questo file è cambiato):
 * l'app restava ferma su "Carico i dati dal foglio…". Un caricamento che
 * non riesce deve DIRLO, sempre: qui ogni funzione ponte torna un errore
 * leggibile (mai `undefined`), ogni foglio scelto viaggia nel payload
 * (`diag.fogli`) e ogni colonna attesa che manca viene elencata per nome.
 * Un foglio riconosciuto male produce una sezione vuota SENZA errori: è
 * esattamente così che i dati "spariscono" senza lasciare traccia.
 *******************************************************************/

var CONFIG = {
  // ID del Google Sheet "GESTIONE_FINANZIARIA" (dalla URL del foglio).
  SHEET_ID: '1nV6gH6Grp9JN7vsrvKH_oyjrCo4SH_6Z_QssFOiScKg',
  CC_START: 379,
  // Primo anno considerato dal cruscotto: le righe precedenti restano nel
  // foglio ma non entrano nel payload.
  START_YEAR: 2026,
  // Giorno in cui si da' per accreditata un'entrata di cui il foglio non
  // porta la data. E' un'ASSUNZIONE, e come tale viene dichiarata in pagina.
  GIORNO_ACCREDITO: 10,
};

/* ---- CLASSIFICAZIONE DELLE SPESE: DUE DOMANDE, NON QUATTRO ETICHETTE ----

   Prima c'erano quattro fasce su un asse solo (Fissa / Prevista /
   Necessaria / Discrezionale) e "Fissa" era la copia esatta della colonna
   TIPO: la stessa informazione detta due volte. Peggio: il controllo su
   FISSA veniva per primo e cortocircuitava tutto, quindi il mutuo e Netflix
   finivano nella stessa casella.

   Adesso gli assi sono due, indipendenti, e rispondono a due domande
   diverse:

     1. L'IMPORTO E' SEMPRE UGUALE?   -> FISSA / VARIABILE
        E' la colonna TIPO del foglio, che c'era gia'. Serve alla previsione:
        su una fissa la stima e' certa, su una variabile e' una media.
        Si legge RIGA PER RIGA, perche' sul foglio esistono categorie miste
        (CASA: 75 righe variabili e 21 fisse) e la riga dice il vero.

     2. POSSO FARNE A MENO?           -> NECESSARIA / VITA
        Serve alle decisioni: e' la riga che si guarda quando si deve
        tagliare. Si decide per CATEGORIA, ed e' modificabile dall'app.

   "Prevista" non e' piu' un'etichetta: e' la combinazione ricorrente +
   variabile ("so che arriva, non so quanto"), e l'app la ricava da sola.
*/
var NEC_NECESSARIA = 'necessaria', NEC_VITA = 'vita';

/* Seme di partenza, costruito sulle 31 categorie che stanno davvero nel
   foglio. Tutto modificabile dalla pagina Impostazioni. */
var NEC_SEED = {
  // impegni firmati e obblighi
  'MUTUO CASA': NEC_NECESSARIA, 'FINANZIAMENTO RISTRUTTURAZIONE': NEC_NECESSARIA,
  'RATA CUCINA': NEC_NECESSARIA, 'RATA APARECCHIO': NEC_NECESSARIA,
  'TASSE E COMMISSIONI': NEC_NECESSARIA, 'COMMERCIALISTA': NEC_NECESSARIA,
  'MULTE': NEC_NECESSARIA,
  // casa e servizi
  'BOLLETTA LUCE': NEC_NECESSARIA, 'BOLLETTA GAS': NEC_NECESSARIA,
  'BOLLETTA ACQUA': NEC_NECESSARIA, 'TELEFONO': NEC_NECESSARIA,
  'INTERNET': NEC_NECESSARIA, 'CASA': NEC_NECESSARIA,
  // vivere e muoversi
  'SPESA': NEC_NECESSARIA, 'GASOLIO': NEC_NECESSARIA, 'MACCHINA': NEC_NECESSARIA,
  'FARMACIA/SALUTE': NEC_NECESSARIA,
  // vita
  'MANGIARE FUORI': NEC_VITA, 'SVAGO': NEC_VITA, 'SHOPPING': NEC_VITA,
  'VACANZA': NEC_VITA, 'SNOWBOARD': NEC_VITA, 'SPORT': NEC_VITA,
  'CHILL': NEC_VITA, 'COMPLEANNO': NEC_VITA, 'PARRUCCHIERE': NEC_VITA,
  'AMAZON PRIME': NEC_VITA, 'YOUTUBE PREMIUM': NEC_VITA, 'NEBULA': NEC_VITA
};
/* Fuori dal seme restano PRELIEVO e ALTRO, che per loro natura non si
   possono classificare senza sapere cosa c'e' dentro. Prendono VITA come
   valore di partenza ma vengono ELENCATI come "da decidere": un valore
   messo per comodita' deve vedersi, non nascondersi. */
function necessita_(catUp) { return NEC_SEED[catUp] || NEC_VITA; }
function necNotaSeme_(catUp) { return NEC_SEED.hasOwnProperty(catUp); }

/* ---------------- router ---------------- */
function doGet(e) {
  // Il file HTML nel progetto Apps Script deve chiamarsi ESATTAMENTE "Finanze".
  return HtmlService.createHtmlOutputFromFile('Finanze')
    .setTitle('Gestione Finanziaria')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ---- errore leggibile: mai un `undefined` al posto del messaggio ---- */
function err_(e, dove) {
  var msg = (e && e.message) ? e.message : String(e || 'errore sconosciuto');
  return { error: (dove ? dove + ': ' : '') + msg, stack: (e && e.stack) ? String(e.stack).slice(0, 900) : '' };
}

/* ---- CACHE DI LETTURA ----
   Leggere i fogli costa secondi, non millisecondi: ogni apertura rifaceva
   tutto da zero. Il payload finisce in CacheService (a pezzi, perche' il
   limite e' 100 KB per chiave) e viene buttato via a OGNI scrittura, cosi'
   la cache non puo' mostrare un dato vecchio dopo una modifica fatta
   dall'app. Per una modifica fatta a mano sul foglio c'e' `forza`. */
/* 6 ore (il massimo di CacheService). Con 5 minuti quasi ogni apertura
   trovava la cache scaduta e rileggeva tutto: ~10 secondi di attesa. Ora
   la cache non invecchia male perche' viene buttata a OGNI modifica: quelle
   fatte dall'app (cacheClear_) e quelle fatte a mano sul foglio (trigger
   onChange -> foglioModificato), e scaldaCache la ricostruisce in
   background ogni 5 minuti se manca. */
var CACHE_TTL = 21600;
var CACHE_PEZZO = 40000;  // caratteri per chiave (sotto i 100 KB anche con accenti)
var CACHE_MAX_PEZZI = 24;

function cacheK_(n) { return 'FIN4_' + n; }
function cacheGet_(n) {
  try {
    var c = CacheService.getScriptCache(), testa = c.get(cacheK_(n));
    if (!testa) return null;
    var meta = JSON.parse(testa);
    if (!meta || !meta.pezzi) return null;
    var chiavi = [];
    for (var i = 0; i < meta.pezzi; i++) chiavi.push(cacheK_(n) + '_' + i);
    var trovati = c.getAll(chiavi), s = '';
    for (var j = 0; j < meta.pezzi; j++) {
      var p = trovati[cacheK_(n) + '_' + j];
      if (p == null) return null; // un pezzo scaduto = cache inutilizzabile
      s += p;
    }
    var o = JSON.parse(s);
    o.daCache = true; o.cacheTs = meta.ts;
    return o;
  } catch (e) { return null; }
}
function cachePut_(n, obj) {
  try {
    if (!obj || obj.error) return;
    var s = JSON.stringify(obj), pezzi = Math.ceil(s.length / CACHE_PEZZO);
    if (pezzi > CACHE_MAX_PEZZI) return; // troppo grande: si rilegge ogni volta
    var m = {};
    for (var i = 0; i < pezzi; i++) m[cacheK_(n) + '_' + i] = s.substring(i * CACHE_PEZZO, (i + 1) * CACHE_PEZZO);
    var c = CacheService.getScriptCache();
    c.putAll(m, CACHE_TTL);
    c.put(cacheK_(n), JSON.stringify({ pezzi: pezzi, ts: new Date().toISOString() }), CACHE_TTL);
  } catch (e) {}
}
/* GENERAZIONE DELLA CACHE. Un ricalcolo che legge il foglio PRIMA di una
   modifica e scrive in cache DOPO la cancellazione rimetterebbe in cache un
   dato vecchio, e con 6 ore di vita lo terrebbe a lungo. Ogni cancellazione
   alza la generazione; un ricalcolo scrive in cache solo se la generazione
   e' la stessa di quando ha iniziato. */
function cacheGen_() { try { return PropertiesService.getScriptProperties().getProperty('CACHE_GEN') || '0'; } catch (e) { return '0'; } }
function cacheClear_() {
  try { PropertiesService.getScriptProperties().setProperty('CACHE_GEN', String(new Date().getTime()) + Math.random().toString(36).slice(2, 6)); } catch (e) {}
  try {
    var nomi = ['finanze', 'bollette', 'risc', 'entrate', 'auto'], tutte = [];
    for (var k = 0; k < nomi.length; k++) {
      tutte.push(cacheK_(nomi[k]));
      for (var i = 0; i < CACHE_MAX_PEZZI; i++) tutte.push(cacheK_(nomi[k]) + '_' + i);
    }
    CacheService.getScriptCache().removeAll(tutte);
  } catch (e) {}
}
function svuotaCache() { cacheClear_(); return { ok: true }; }

function conCache_(nome, forza, fn, dove) {
  try {
    if (!forza) { var c = cacheGet_(nome); if (c) return c; }
    var t0 = new Date().getTime(), gen = cacheGen_();
    var out = fn();
    if (!out) return err_('payload vuoto', dove);
    if (!out.error) { out.msTot = new Date().getTime() - t0; if (cacheGen_() === gen) cachePut_(nome, out); }
    return out;
  } catch (e) { return err_(e, dove); }
}

/* ---- CACHE SEMPRE CALDA ----
   scaldaCache gira ogni 5 minuti (trigger): se il payload principale o
   quello dell'Auto non e' in cache, lo ricostruisce. Cosi' l'app trova
   quasi sempre la cache pronta e risponde in 1-2 secondi invece di 10.
   foglioModificato (trigger onChange del foglio) butta la cache quando il
   foglio si modifica a mano: il dato vecchio non resta in giro. */
var CACHE_CALDE = [['finanze', 'buildFinanze_'], ['auto', 'buildAuto_']];
function scaldaCache() {
  var fatte = [];
  CACHE_CALDE.forEach(function (c) {
    var testa = null;
    try { testa = CacheService.getScriptCache().get(cacheK_(c[0])); } catch (e) {}
    if (testa) return;
    var fn = c[1] === 'buildFinanze_' ? buildFinanze_ : buildAuto_;
    var out = conCache_(c[0], true, fn, 'scaldaCache ' + c[0]);
    fatte.push(c[0] + (out && out.error ? ' ERRORE ' + out.error : ' ok'));
  });
  return { ok: true, ricostruite: fatte };
}
function foglioModificato(e) { cacheClear_(); }
/* Crea (una volta) i due trigger della cache. Rieseguirlo non li duplica. */
function installaTriggerCache() {
  try {
    var tr = ScriptApp.getProjectTriggers();
    for (var i = 0; i < tr.length; i++) {
      var h = tr[i].getHandlerFunction();
      if (h === 'scaldaCache' || h === 'foglioModificato') ScriptApp.deleteTrigger(tr[i]);
    }
    ScriptApp.newTrigger('scaldaCache').timeBased().everyMinutes(5).create();
    ScriptApp.newTrigger('foglioModificato').forSpreadsheet(CONFIG.SHEET_ID).onChange().create();
    PropertiesService.getScriptProperties().setProperty('CACHE_TRIGGER', new Date().toISOString());
    return { ok: true, scalda: scaldaCache() };
  } catch (e) {
    return err_(e, 'installaTriggerCache');
  }
}

/* --- funzioni "ponte" chiamabili dall'app React ---
   Tornano SEMPRE un oggetto: o i dati, o { error: "…" }. Mai undefined,
   altrimenti il client riceve `null` e non sa distinguere un guasto da
   un foglio vuoto. `opz.forza` salta la cache (pulsante Aggiorna). */
function getDatiFinanze(opz) { return conCache_('finanze', opz && opz.forza, buildFinanze_, 'FINANZE'); }
function getDatiBollette(opz) { return conCache_('bollette', opz && opz.forza, buildBollette_, 'BOLLETTE'); }
function getDatiRiscaldamento(opz) { return conCache_('risc', opz && opz.forza, buildRiscaldamento_, 'RISCALDAMENTO'); }
function getDatiEntrate(opz) { return conCache_('entrate', opz && opz.forza, buildEntrate_, 'ENTRATE'); }

/* Diagnosi rapida del ponte browser↔Apps Script: se questa risponde e
   getDatiFinanze() no, il problema è nella lettura dei fogli, non nella rete. */
function ping() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var nomi = ss.getSheets().map(function (s) { return s.getName(); });
    return { ok: true, ts: new Date().toISOString(), file: ss.getName(), fogli: nomi };
  } catch (e) { return err_(e, 'PING'); }
}

/* Da lanciare dall'editor Apps Script quando l'app non carica: scrive nel
   log quale foglio è stato scelto per ogni sezione e quante righe ha letto. */
function diag() {
  var p = getDatiFinanze();
  Logger.log(JSON.stringify(p.error ? p : { anni: p.anni, righe: p.righe, diag: p.diag, warn: p.warn }, null, 2));
  return p;
}

/* ---------------- Helpers Generali ---------------- */
function up_(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
function clean_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n || 60); }
function num_(v) { var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; }
function r2_(v) { return Math.round(num_(v) * 100) / 100; }
function iso_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v == null ? '' : v).trim(); if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function colIdx_(headers, parts) {
  for (var i = 0; i < headers.length; i++) {
    var h = up_(headers[i]); if (!h) continue;
    var ok = true;
    for (var j = 0; j < parts.length; j++) if (h.indexOf(parts[j]) < 0) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/* Il nome del foglio è una condizione DEBOLE e il primo che passa vince:
   un foglio di appoggio chiamato "USCITE_BACKUP" verrebbe preso al posto di
   quello vero e la sezione risulterebbe vuota senza un errore. Quindi il
   nome deve passare i test E la riga 1 deve contenere le colonne che quel
   foglio deve avere. Legge solo l'intestazione, non tutto il foglio. */
function sheetFor_(ss, tests, mustHave) {
  var shs = ss.getSheets(), ripiego = null;
  for (var i = 0; i < shs.length; i++) {
    var n = up_(shs[i].getName()), ok = true;
    for (var j = 0; j < tests.length; j++) if (!tests[j](n)) { ok = false; break; }
    if (!ok) continue;
    if (!ripiego) ripiego = shs[i];
    if (!mustHave || !mustHave.length) return shs[i];
    var lc = shs[i].getLastColumn(); if (!lc) continue;
    var H = shs[i].getRange(1, 1, 1, lc).getValues()[0], tutte = true;
    for (var k = 0; k < mustHave.length; k++) if (colIdx_(H, mustHave[k]) < 0) { tutte = false; break; }
    if (tutte) return shs[i];
  }
  return ripiego; // ultima risorsa: solo il nome. Dichiarato in diag.fogli.
}
/* test di nome, uno per sezione: un solo punto da correggere se un foglio
   viene rinominato */
function tUscite_() { return [function (n) { return n.indexOf('USCITE') >= 0 && n.indexOf('PIVOT') < 0; }]; }
function tEntrate_() { return [function (n) { return n.indexOf('ENTRAT') >= 0 && n.indexOf('PIVOT') < 0 && n.indexOf('DAS') < 0; }]; }
function tBollette_() { return [function (n) { return n.indexOf('BOLLETT') >= 0; }]; }
function tRisc_() { return [function (n) { return n.indexOf('RISCALD') >= 0; }]; }
function tDashM_() { return [function (n) { return n.indexOf('DASHBOARD') >= 0 && n.indexOf('MENSIL') >= 0; }]; }
function tDashA_() { return [function (n) { return n.indexOf('ANNU') >= 0 && n.indexOf('DAS') >= 0; }]; }

var MH_USCITE = [['ANNO'], ['MESE PAGAMENTO'], ['SPESA'], ['CATEGORIA'], ['TIPO']];
var MH_ENTRATE = [['ANNO']];
var MH_BOLLETTE = [['FORNITORE'], ['MESE PAGAMENTO']];
var MH_RISC = [['STANZA'], ['MESE'], ['ORE']];

function uscSheet_(ss) { return sheetFor_(ss, tUscite_(), MH_USCITE); }
function entSheet_(ss) { return sheetFor_(ss, tEntrate_(), MH_ENTRATE); }
function bolSheet_(ss) { return sheetFor_(ss, tBollette_(), MH_BOLLETTE); }
function riscSheet_(ss) { return sheetFor_(ss, tRisc_(), MH_RISC); }

/* elenca per NOME le colonne attese che mancano: un errore che dice "manca
   MESE PAGAMENTO" si risolve, "header non riconosciuto" no */
function mancanti_(H, attese) {
  var out = [];
  for (var k in attese) if (attese.hasOwnProperty(k) && colIdx_(H, attese[k]) < 0) out.push(k);
  return out;
}

function inArr_(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
function statoCol_(H) { var i = colIdx_(H, ['PAGAR']); if (i < 0) i = colIdx_(H, ['STATO']); return i; }
var PAID_V = 'PAGATA', UNPAID_V = 'DA PAGARE';
/* Se la colonna di stato non c'è viene creata in coda: l'intestazione è
   "DA PAGARE" — contiene "PAGAR", quindi statoCol_ la ritrova. */
function ensureStatoCol_(sh, H) {
  var i = statoCol_(H);
  if (i < 0) { H.push(UNPAID_V); sh.getRange(1, 1, 1, H.length).setValues([H]); i = H.length - 1; }
  return i;
}
/* ---- STATO DELL'ENTRATA ----
   Lo stipendio non entra il 1° del mese: entra verso il 10. Quindi
   un'entrata si spunta a mano quando e' arrivata, esattamente come una
   spesa si spunta quando e' pagata. Attenzione alla differenza che conta:
   lo spunto vale SOLO per il saldo di adesso; le proiezioni sul futuro
   danno l'entrata per certa comunque, perche' quello stipendio arrivera'. */
var INCASSATA_V = 'INCASSATA', DA_INCASSARE_V = 'DA INCASSARE';
function statoEntCol_(H) { var i = colIdx_(H, ['INCASS']); if (i < 0) i = colIdx_(H, ['STATO']); return i; }
function ensureStatoEntCol_(sh, H) {
  var i = statoEntCol_(H);
  if (i < 0) { H.push(DA_INCASSARE_V); sh.getRange(1, 1, 1, H.length).setValues([H]); i = H.length - 1; }
  return i;
}
/* Giorno di accredito: si legge dalla colonna DATA che il foglio ENTRATE ha
   gia'. Dove manca vale il predefinito, che e' un'assunzione DICHIARATA in
   pagina, non un dato. */
function giornoAccredito_(v) {
  var s = iso_(v);
  if (s) { var g = parseInt(s.slice(8, 10), 10); if (g >= 1 && g <= 31) return g; }
  return null;
}

/* ---- TIPOLOGIA DELLE SPESE, MODIFICABILE DALL'APP ----
   La classificazione di partenza sta negli elenchi qui sopra, scritti nel
   codice. Le correzioni fatte dalla pagina Impostazioni vivono a parte, in
   una proprieta' dello script: cosi' il foglio non viene toccato e il
   valore originale resta leggibile accanto a quello modificato. */
var PROP_CAT = 'APP_CATEGORIE';
function leggiCatCfg_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(PROP_CAT);
    if (!raw) return {};
    var o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
var NEC_VALIDE = { necessaria: 1, vita: 1 };
function salvaCategorie(payload) {
  try {
    var m = payload && payload.categorie;
    if (!m || typeof m !== 'object') return { error: 'Nessuna categoria da salvare.' };
    var pulito = {}, n = 0;
    for (var k in m) {
      if (!m.hasOwnProperty(k)) continue;
      var cat = up_(k); if (!cat) continue;
      /* Si salva SOLO la necessita'. Il tipo (fissa/variabile) sta gia'
         sulla riga del foglio, dove e' piu' preciso: esistono categorie
         miste, e un valore per categoria le appiattirebbe. */
      var v = m[k] || {}, out = {};
      if (v.nec && NEC_VALIDE[v.nec]) out.nec = v.nec;
      if (out.nec) { pulito[cat] = out; n++; }
    }
    PropertiesService.getScriptProperties().setProperty(PROP_CAT, JSON.stringify(pulito));
    cacheClear_();
    return { ok: true, n: n };
  } catch (e) { return err_(e, 'salvaCategorie'); }
}

function z12_() { return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }
function dedup_() {
  var map = {}, list = [];
  return {
    idx: function (v) { var k = clean_(v, 40); if (!k) return -1; if (!(k in map)) { map[k] = list.length; list.push(k); } return map[k]; },
    list: list,
  };
}

/* ---------------- Lettura Dati Home (Dashboard) ---------------- */
function leggiDashboardMensile_(ss, diag) {
  var dash = {};
  var shD = sheetFor_(ss, tDashM_(), [['ANNO'], ['MESE']]);
  diag.fogli.dashMensile = shD ? shD.getName() : null;
  if (!shD) { diag.mancanti.push('DASHBOARD MENSILE'); return dash; }
  var D = shD.getDataRange().getValues(), HD = D[0];
  var dAnno = colIdx_(HD, ['ANNO']), dMese = colIdx_(HD, ['MESE']);
  var dFis = colIdx_(HD, ['USCITE FISSE']), dVar = colIdx_(HD, ['USCITE VARIABIL']);
  var dEnt = colIdx_(HD, ['ENTRATE']), dRis = colIdx_(HD, ['RISPARMI']), dCc = colIdx_(HD, ['CONTO CORRENTE']);
  if (dAnno < 0 || dMese < 0) { diag.mancanti.push('DASHBOARD MENSILE: ANNO/MESE'); return dash; }
  for (var i = 1; i < D.length; i++) {
    var a = Math.round(num_(D[i][dAnno])), mn = Math.round(num_(D[i][dMese]));
    if (!a || mn < 1 || mn > 12) continue;
    if (!dash[a]) dash[a] = {};
    dash[a][mn] = { ent: r2_(D[i][dEnt]), cc: r2_(D[i][dCc]), ris: r2_(D[i][dRis]), fis: r2_(D[i][dFis]), vr: r2_(D[i][dVar]) };
  }
  diag.righe.dashMensile = D.length - 1;
  return dash;
}

function leggiEntrate_(ss, startYear, diag) {
  /* Due serie, non una: `tot` sono le entrate PREVISTE (quelle su cui si
     proietta il futuro) e `inc` sono quelle gia' INCASSATE (quelle che
     compongono il saldo di adesso). Confonderle vuol dire o un saldo
     gonfiato di uno stipendio per i primi dieci giorni del mese, o una
     proiezione che si dimentica che lo stipendio arrivera'. */
  var out = { tot: {}, inc: {}, giorni: {} };
  var shE = entSheet_(ss);
  diag.fogli.entrate = shE ? shE.getName() : null;
  if (!shE) { diag.mancanti.push('ENTRATE'); return out; }
  var E = shE.getDataRange().getValues(), HE = E[0];
  var eAnno = colIdx_(HE, ['ANNO']);
  var eNum = colIdx_(HE, ['N. MESE']); if (eNum < 0) eNum = colIdx_(HE, ['N.MESE']);
  var eNome = meseColExact_(HE);
  var eTot = colIdx_(HE, ['TOTALE ENTRATE']);
  var eData = colIdx_(HE, ['DATA']);
  var eStato = statoEntCol_(HE);
  if (eAnno < 0 || (eNum < 0 && eNome < 0)) { diag.mancanti.push('ENTRATE: ANNO e/o mese (N. MESE oppure MESE)'); return out; }
  if (eTot < 0) diag.mancanti.push('ENTRATE: TOTALE ENTRATE');
  var letti = 0;
  for (var ei = 1; ei < E.length; ei++) {
    var ey = Math.round(num_(E[ei][eAnno]));
    var em = eNum >= 0 ? Math.round(num_(E[ei][eNum])) : 0;
    if ((em < 1 || em > 12) && eNome >= 0) { var mi = meseIdx_(E[ei][eNome]); em = mi >= 0 ? mi + 1 : 0; }
    if (!ey || em < 1 || em > 12 || ey < startYear) continue;
    if (!out.tot[ey]) { out.tot[ey] = z12_(); out.inc[ey] = z12_(); out.giorni[ey] = z12_(); }
    var v = eTot >= 0 ? r2_(E[ei][eTot]) : 0;
    out.tot[ey][em - 1] = v;
    var st = eStato >= 0 ? up_(E[ei][eStato]) : '';
    if (st.indexOf('INCASSAT') >= 0) out.inc[ey][em - 1] = v;
    var g = eData >= 0 ? giornoAccredito_(E[ei][eData]) : null;
    out.giorni[ey][em - 1] = g || 0;
    letti++;
  }
  diag.righe.entrate = letti;
  if (eStato < 0) diag.mancanti.push('ENTRATE: colonna di stato assente — nessuna entrata risulta incassata finche\' non la crei spuntandone una');
  return out;
}

function leggiDashboardAnnuale_(ss, diag) {
  var annuale = {};
  var shA = sheetFor_(ss, tDashA_(), [['ANNO']]);
  diag.fogli.dashAnnuale = shA ? shA.getName() : null;
  if (!shA) return annuale;
  var A = shA.getDataRange().getValues(), HA = A[0];
  var aAnno = colIdx_(HA, ['ANNO']), aRis = colIdx_(HA, ['RISPARMI']);
  var aPct = colIdx_(HA, ['%RISPARMI']), aPat = colIdx_(HA, ['PATRIMONIO']);
  if (aAnno < 0) return annuale;
  for (var ia = 1; ia < A.length; ia++) {
    var ya = Math.round(num_(A[ia][aAnno])); if (!ya) continue;
    annuale[ya] = {
      risparmi: aRis >= 0 ? r2_(A[ia][aRis]) : 0,
      pct: aPct >= 0 ? num_(A[ia][aPct]) : 0,
      patrimonio: aPat >= 0 ? r2_(A[ia][aPat]) : 0,
    };
  }
  return annuale;
}

/* ---------------- MAIN: Payload Finanze ---------------- */
function buildFinanze_() {
  var diag = { fogli: {}, righe: {}, mancanti: [], ms: {} };
  var tApri = new Date().getTime();
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  diag.ms.apertura = new Date().getTime() - tApri;
  var shU = uscSheet_(ss);
  diag.fogli.uscite = shU ? shU.getName() : null;
  if (!shU) {
    return {
      error: 'Foglio USCITE non trovato. Fogli presenti: ' +
        ss.getSheets().map(function (s) { return s.getName(); }).join(' · '),
      diag: diag
    };
  }

  var START_YEAR = num_(CONFIG.START_YEAR) || 2026;

  var t1 = new Date().getTime();
  var dash = leggiDashboardMensile_(ss, diag);
  diag.ms.dashMensile = new Date().getTime() - t1;
  t1 = new Date().getTime();
  var entSrc = leggiEntrate_(ss, START_YEAR, diag);
  var ent = entSrc.tot;
  diag.ms.entrate = new Date().getTime() - t1;
  t1 = new Date().getTime();
  var annuale = leggiDashboardAnnuale_(ss, diag);
  diag.ms.dashAnnuale = new Date().getTime() - t1;
  t1 = new Date().getTime();

  var base = {};
  function ensureYear_(y) { if (y >= START_YEAR && !base[y]) base[y] = { entrate: z12_(), entrateIn: z12_(), giorniEnt: z12_(), necFisso: z12_(), necVar: z12_(), vitaFisso: z12_(), vitaVar: z12_() }; }
  for (var ey2 in ent) ensureYear_(+ey2);

  var U = shU.getDataRange().getValues(), HU = U[0];
  diag.ms.uscite = new Date().getTime() - t1;
  var uAnno = colIdx_(HU, ['ANNO']), uMese = colIdx_(HU, ['MESE PAGAMENTO']);
  var uSp = colIdx_(HU, ['SPESA']), uCat = colIdx_(HU, ['CATEGORIA']);
  var uNote = colIdx_(HU, ['NOTE']), uCc = colIdx_(HU, ['CC']), uTipo = colIdx_(HU, ['TIPO']);
  var uData = colIdx_(HU, ['DATA PAGAMENTO']);
  var uStato = statoCol_(HU);

  var mancaU = mancanti_(HU, { 'ANNO': ['ANNO'], 'MESE PAGAMENTO': ['MESE PAGAMENTO'], 'SPESA': ['SPESA'], 'CATEGORIA': ['CATEGORIA'], 'TIPO': ['TIPO'] });
  if (mancaU.length) {
    return {
      error: 'Nel foglio "' + shU.getName() + '" mancano le colonne: ' + mancaU.join(', ') +
        '. Intestazione letta: ' + HU.filter(String).join(' · '),
      diag: diag
    };
  }

  var catCfg = leggiCatCfg_();
  var catsMap = {}, catTipoCount = {}, catDict = dedup_(), movimenti = [], daDecidere = {};
  var scartate = 0;

  for (var r = 1; r < U.length; r++) {
    var an = Math.round(num_(U[r][uAnno])), me = Math.round(num_(U[r][uMese]));
    if (!an || me < 1 || me > 12) continue;
    var sp = r2_(U[r][uSp]);
    var catUp = up_(U[r][uCat]); if (!catUp) continue;
    var tipoUp = up_(U[r][uTipo]) === 'FISSA' ? 'FISSA' : 'VARIABILE';
    var ovr = catCfg[catUp] || {};
    var nec = ovr.nec || necessita_(catUp);

    if (!catsMap[catUp]) catsMap[catUp] = nec;
    if (!necNotaSeme_(catUp) && !ovr.nec) daDecidere[catUp] = 1;
    if (!catTipoCount[catUp]) catTipoCount[catUp] = { FISSA: 0, VARIABILE: 0 };
    catTipoCount[catUp][tipoUp]++;



    ensureYear_(an);
    if (base[an]) {
      /* Due assi -> quattro secchi. Il tipo si prende dalla RIGA, non dalla
         categoria: sul foglio esistono categorie miste e la riga dice il vero. */
      if (nec === NEC_NECESSARIA) {
        if (tipoUp === 'FISSA') base[an].necFisso[me - 1] += sp; else base[an].necVar[me - 1] += sp;
      } else {
        if (tipoUp === 'FISSA') base[an].vitaFisso[me - 1] += sp; else base[an].vitaVar[me - 1] += sp;
      }

      var st = uStato >= 0 ? up_(U[r][uStato]) : '';
      var paid = st.indexOf('PAGAT') >= 0 ? 1 : 0;
      var ccFlag = up_(U[r][uCc]) === 'SI' ? 1 : 0;
      movimenti.push([an, me - 1, catDict.idx(catUp), sp, ccFlag,
        tipoUp === 'FISSA' ? 1 : 0, clean_(uNote >= 0 ? U[r][uNote] : '', 120), r + 1, paid,
        uData >= 0 ? iso_(U[r][uData]) : '']);
    } else {
      scartate++; // riga valida ma anteriore a START_YEAR
    }
  }
  diag.righe.uscite = U.length - 1;
  diag.righe.usciteFuoriPeriodo = scartate;

  var catTipo = {}, catBase = {};
  for (var ct in catTipoCount) {
    var dalFoglio = catTipoCount[ct].FISSA >= catTipoCount[ct].VARIABILE ? 'FISSA' : 'VARIABILE';
    var misto = catTipoCount[ct].FISSA > 0 && catTipoCount[ct].VARIABILE > 0;
    catBase[ct] = { tipo: dalFoglio, misto: misto ? 1 : 0, nec: necessita_(ct), nelSeme: necNotaSeme_(ct) ? 1 : 0 };
    catTipo[ct] = dalFoglio;
  }
  for (var yk in base) {
    var b = base[yk];
    for (var q = 0; q < 12; q++) { b.necFisso[q] = r2_(b.necFisso[q]); b.necVar[q] = r2_(b.necVar[q]); b.vitaFisso[q] = r2_(b.vitaFisso[q]); b.vitaVar[q] = r2_(b.vitaVar[q]); }
  }

  for (var yb in base) {
    if (ent[yb]) base[yb].entrate = ent[yb];
    if (entSrc.inc[yb]) base[yb].entrateIn = entSrc.inc[yb];
    if (entSrc.giorni[yb]) base[yb].giorniEnt = entSrc.giorni[yb];
  }
  var anni = [];
  for (var ky in base) anni.push(+ky);
  anni.sort(function (x, y) { return x - y; });
  if (!anni.length) {
    return {
      error: 'Nessun anno con dati da ' + START_YEAR + '. Lette ' + (U.length - 1) + ' righe da "' +
        shU.getName() + '"' + (scartate ? ', tutte con anno precedente a ' + START_YEAR : '') +
        '. Se l\'anno giusto è un altro, cambia CONFIG.START_YEAR.',
      diag: diag
    };
  }

  /* `dashRef` non c'e' piu': veniva calcolato e spedito a ogni caricamento e
     l'app non lo leggeva da nessuna parte. Era peso morto sul payload. */
  var y0 = anni[0];
  var running = (dash[y0] && dash[y0][1]) ? r2_(dash[y0][1].cc - dash[y0][1].ris) : num_(CONFIG.CC_START);
  var ccStart = {};
  for (var si = 0; si < anni.length; si++) {
    var y = anni[si]; ccStart[y] = r2_(running);
    var bb = base[y];
    for (var mm2 = 0; mm2 < 12; mm2++) running += bb.entrate[mm2] - (bb.necFisso[mm2] + bb.necVar[mm2] + bb.vitaFisso[mm2] + bb.vitaVar[mm2]);
  }

  var warn = [];
  for (var i2 = 0; i2 < diag.mancanti.length; i2++) warn.push('Sezione non letta → ' + diag.mancanti[i2]);
  for (var dd in daDecidere) warn.push('Categoria senza necessità decisa (vale VITA finché non la scegli): ' + dd);
  for (var yy2 = 0; yy2 < anni.length; yy2++) {
    var Y = anni[yy2]; if (!dash[Y]) continue;
    for (var M = 1; M <= 12; M++) {
      var dr = dash[Y][M]; if (!dr) continue;
      /* La dashboard del foglio ragiona su USCITE FISSE / USCITE VARIABILI,
         cioe' sull'asse del TIPO. Ora il confronto e' fra le stesse cose:
         prima "FISSE" comprendeva tutto cio' che aveva TIPO=FISSA (giusto
         per caso), mentre "VARIABILI" sommava tre fasce che l'asse del tipo
         non conosceva. */
      var fisseCalc = r2_(base[Y].necFisso[M - 1] + base[Y].vitaFisso[M - 1]);
      var varCalc = r2_(base[Y].necVar[M - 1] + base[Y].vitaVar[M - 1]);
      if (Math.abs(fisseCalc - dr.fis) > 0.01)
        warn.push('FISSE ' + Y + '-' + M + ': calc ' + fisseCalc + ' vs dash ' + dr.fis);
      if (Math.abs(varCalc - dr.vr) > 0.01)
        warn.push('VARIABILI ' + Y + '-' + M + ': calc ' + varCalc + ' vs dash ' + dr.vr);
    }
  }

  return {
    v: 6, fonte: 'Google Sheets (live)', ts: new Date().toISOString(),
    anni: anni, base: base, ccStart: ccStart,
    cats: catsMap, catTipo: catTipo, catDict: catDict.list, movimenti: movimenti,
    catCfg: catCfg, catBase: catBase, daDecidere: Object.keys(daDecidere),
    annuale: annuale,
    righe: { movimenti: movimenti.length, anni: anni.length },
    giornoAccredito: num_(CONFIG.GIORNO_ACCREDITO) || 10,
    diag: diag,
    warn: warn,
  };
}

/* ---------------- Funzioni Scrittura USCITE ---------------- */
function salvaSpesa(payload) {
  var lock = LockService.getScriptLock();
  try {
    if (!payload || !payload.cat || !(num_(payload.amount) > 0)) return { error: 'Spesa senza categoria o importo.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cStato = ensureStatoCol_(sh, H);

    var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
    var cNome = colIdx_(H, ['NOME MESE']), cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']);
    var cNote = colIdx_(H, ['NOTE']), cCc = colIdx_(H, ['CC']), cTipo = colIdx_(H, ['TIPO']);
    if (cAnno < 0 || cMese < 0 || cSp < 0 || cCat < 0) return { error: 'Header USCITE privo di colonne chiave.' };

    var MESI_LONG = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
    var y = Math.round(num_(payload.y)), m0 = Math.round(num_(payload.m));
    if (m0 < 0 || m0 > 11) m0 = 0;
    var tz = Session.getScriptTimeZone(), now = new Date();
    var dataStr = iso_(payload.date) || Utilities.formatDate(now, tz, 'yyyy-MM-dd');
    var tipoOut = up_(payload.tipo) === 'FISSA' ? 'FISSA' : 'VARIABILE';

    var row = [];
    for (var c = 0; c < H.length; c++) row.push('');
    if (cData >= 0) row[cData] = dataStr;
    row[cAnno] = y;
    row[cMese] = m0 + 1;
    if (cNome >= 0) row[cNome] = MESI_LONG[m0];
    row[cSp] = r2_(payload.amount);
    row[cCat] = up_(payload.cat);
    if (cNote >= 0) row[cNote] = clean_(payload.note, 200);
    if (cCc >= 0) row[cCc] = payload.pay === 'cc' ? 'SI' : '';
    if (cTipo >= 0) row[cTipo] = tipoOut;
    if (cStato >= 0) row[cStato] = payload.pay === 'cc' ? UNPAID_V : PAID_V;

    var rowNum = sh.getLastRow() + 1;
    sh.getRange(rowNum, 1, 1, H.length).setValues([row]);
    var id = 'S' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
    cacheClear_();
    return { ok: true, id: id, row: rowNum, foglio: sh.getName() };
  } catch (e) {
    return err_(e, 'salvaSpesa');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

/* ---- SPESE RICORRENTI ----
   Una rata che si ripete: stesso importo, stesso giorno, da un mese a un
   altro. Le righe vengono scritte TUTTE IN UNA VOLTA (`setValues` su un
   blocco), non una per rata: dodici rate erano dodici andate e ritorni al
   foglio e diversi secondi di attesa.
   Con la carta di credito la rata compare nel mese SUCCESSIVO, con addebito
   il 15: e' la stessa regola che l'app applica gia' alla spesa singola. */
function salvaRicorrente(p) {
  var lock = LockService.getScriptLock();
  try {
    if (!p || !p.cat || !(num_(p.amount) > 0)) return { error: 'Spesa senza categoria o importo.' };
    var y1 = Math.round(num_(p.daAnno)), m1 = Math.round(num_(p.daMese));
    var y2 = Math.round(num_(p.aAnno)), m2 = Math.round(num_(p.aMese));
    if (!y1 || !y2 || m1 < 0 || m1 > 11 || m2 < 0 || m2 > 11) return { error: 'Periodo non valido.' };
    var da = y1 * 12 + m1, a = y2 * 12 + m2;
    if (a < da) return { error: 'Il mese finale viene prima di quello iniziale.' };
    var n = a - da + 1;
    if (n > 120) return { error: 'Periodo troppo lungo: massimo 120 rate.' };

    lock.waitLock(20000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cStato = ensureStatoCol_(sh, H);
    var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
    var cNome = colIdx_(H, ['NOME MESE']), cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']);
    var cNote = colIdx_(H, ['NOTE']), cCc = colIdx_(H, ['CC']), cTipo = colIdx_(H, ['TIPO']);
    if (cAnno < 0 || cMese < 0 || cSp < 0 || cCat < 0) return { error: 'Header USCITE privo di colonne chiave.' };

    var MESI_L = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
    var conCarta = p.pay === 'cc';
    var giorno = Math.round(num_(p.giorno)) || 1;
    if (giorno < 1) giorno = 1; if (giorno > 28) giorno = 28; // 28: esiste in ogni mese
    var tipoOut = up_(p.tipo) === 'FISSA' ? 'FISSA' : 'VARIABILE';
    var nota = clean_(p.note, 200);

    var blocco = [];
    for (var k = 0; k < n; k++) {
      var tot = da + k, yy = Math.floor(tot / 12), mm = tot % 12;
      var gg = giorno;
      if (conCarta) { tot = tot + 1; yy = Math.floor(tot / 12); mm = tot % 12; gg = 15; }
      var row = [];
      for (var c = 0; c < H.length; c++) row.push('');
      if (cData >= 0) row[cData] = yy + '-' + ('0' + (mm + 1)).slice(-2) + '-' + ('0' + gg).slice(-2);
      row[cAnno] = yy;
      row[cMese] = mm + 1;
      if (cNome >= 0) row[cNome] = MESI_L[mm];
      row[cSp] = r2_(p.amount);
      row[cCat] = up_(p.cat);
      if (cNote >= 0) row[cNote] = nota;
      if (cCc >= 0) row[cCc] = conCarta ? 'SI' : '';
      if (cTipo >= 0) row[cTipo] = tipoOut;
      if (cStato >= 0) row[cStato] = UNPAID_V; // una rata futura non e' pagata
      blocco.push(row);
    }
    var primaRiga = sh.getLastRow() + 1;
    sh.getRange(primaRiga, 1, blocco.length, H.length).setValues(blocco);
    cacheClear_();
    return { ok: true, righe: blocco.length, daRiga: primaRiga };
  } catch (e) {
    return err_(e, 'salvaRicorrente');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function setStato(payload) {
  var lock = LockService.getScriptLock();
  try {
    var rowNum = Math.round(num_(payload && payload.row));
    if (!rowNum || rowNum < 2) return { error: 'Riga non valida.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    if (rowNum > sh.getLastRow()) return { error: 'Riga oltre i dati: ricarica.' };

    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cStato = ensureStatoCol_(sh, H);
    var cCat = colIdx_(H, ['CATEGORIA']), cSp = colIdx_(H, ['SPESA']);

    var rv = sh.getRange(rowNum, 1, 1, H.length).getValues()[0];
    if (payload.cat != null && cCat >= 0 && up_(rv[cCat]) !== up_(payload.cat)) return { error: 'Riga cambiata (categoria): ricarica i dati.' };
    if (payload.amount != null && cSp >= 0 && Math.abs(r2_(rv[cSp]) - r2_(payload.amount)) > 0.005) return { error: 'Riga cambiata (importo): ricarica i dati.' };

    sh.getRange(rowNum, cStato + 1).setValue(payload.paid ? PAID_V : UNPAID_V);
    cacheClear_();
    return { ok: true, row: rowNum, paid: payload.paid ? 1 : 0 };
  } catch (e) {
    return err_(e, 'setStato');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function setStatiBulk(payload) {
  var lock = LockService.getScriptLock();
  try {
    var items = payload && payload.items;
    if (!items || !items.length) return { error: 'Nessuna riga da aggiornare.' };
    lock.waitLock(15000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    var lastRow = sh.getLastRow();
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cStato = ensureStatoCol_(sh, H);
    var cCat = colIdx_(H, ['CATEGORIA']), cSp = colIdx_(H, ['SPESA']);
    var val = payload.paid ? PAID_V : UNPAID_V;
    var scritte = 0, saltate = [];

    /* Prima: due andate e ritorni al foglio PER OGNI riga (una per leggerla,
       una per scriverla). Su venti bollette erano quaranta chiamate e diversi
       secondi. Ora si legge tutto una volta, si valida in memoria e si
       riscrive la sola colonna di stato in un colpo. */
    if (lastRow < 2) return { ok: true, scritte: 0, saltate: [] };
    var tutte = sh.getRange(2, 1, lastRow - 1, H.length).getValues();
    var colonna = sh.getRange(2, cStato + 1, lastRow - 1, 1).getValues();

    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {}, rn = Math.round(num_(it.row));
      if (!rn || rn < 2 || rn > lastRow) { saltate.push({ row: rn, motivo: 'riga fuori range' }); continue; }
      var rv = tutte[rn - 2];
      if (it.cat != null && cCat >= 0 && up_(rv[cCat]) !== up_(it.cat)) { saltate.push({ row: rn, motivo: 'categoria' }); continue; }
      if (it.amount != null && cSp >= 0 && Math.abs(r2_(rv[cSp]) - r2_(it.amount)) > 0.005) { saltate.push({ row: rn, motivo: 'importo' }); continue; }
      colonna[rn - 2][0] = val;
      scritte++;
    }
    if (scritte) sh.getRange(2, cStato + 1, lastRow - 1, 1).setValues(colonna);
    cacheClear_();
    return { ok: true, scritte: scritte, saltate: saltate };
  } catch (e) {
    return err_(e, 'setStatiBulk');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function modificaSpesa(payload) {
  var lock = LockService.getScriptLock();
  try {
    var rowNum = Math.round(num_(payload && payload.row));
    if (!rowNum || rowNum < 2) return { error: 'Riga non valida.' };
    if (!payload.cat || !(num_(payload.amount) > 0)) return { error: 'Categoria o importo mancante.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    if (rowNum > sh.getLastRow()) return { error: 'Riga oltre i dati: ricarica.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];

    var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
    var cNome = colIdx_(H, ['NOME MESE']), cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']);
    var cNote = colIdx_(H, ['NOTE']), cCc = colIdx_(H, ['CC']), cTipo = colIdx_(H, ['TIPO']);

    var rv = sh.getRange(rowNum, 1, 1, H.length).getValues()[0];
    if (payload.oldCat != null && cCat >= 0 && up_(rv[cCat]) !== up_(payload.oldCat)) return { error: 'Riga cambiata (categoria): ricarica i dati.' };
    if (payload.oldAmount != null && cSp >= 0 && Math.abs(r2_(rv[cSp]) - r2_(payload.oldAmount)) > 0.005) return { error: 'Riga cambiata (importo): ricarica i dati.' };

    var MESI_LONG = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
    var dataStr = iso_(payload.date);
    var mm = dataStr ? (parseInt(String(dataStr).slice(5, 7), 10) - 1) : (Math.round(num_(rv[cMese])) - 1);
    var yy = dataStr ? parseInt(String(dataStr).slice(0, 4), 10) : Math.round(num_(rv[cAnno]));
    if (isNaN(mm) || mm < 0 || mm > 11) mm = 0;
    var tipoOut = up_(payload.tipo) === 'FISSA' ? 'FISSA' : 'VARIABILE';

    if (cData >= 0 && dataStr) rv[cData] = dataStr;
    if (cAnno >= 0) rv[cAnno] = yy;
    if (cMese >= 0) rv[cMese] = mm + 1;
    if (cNome >= 0) rv[cNome] = MESI_LONG[mm];
    if (cSp >= 0) rv[cSp] = r2_(payload.amount);
    if (cCat >= 0) rv[cCat] = up_(payload.cat);
    if (cNote >= 0) rv[cNote] = clean_(payload.note, 200);
    if (cCc >= 0) rv[cCc] = payload.pay === 'cc' ? 'SI' : '';
    if (cTipo >= 0) rv[cTipo] = tipoOut;
    sh.getRange(rowNum, 1, 1, H.length).setValues([rv]);
    cacheClear_();
    return { ok: true, row: rowNum };
  } catch (e) {
    return err_(e, 'modificaSpesa');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function eliminaSpesa(payload) {
  var lock = LockService.getScriptLock();
  try {
    var rowNum = Math.round(num_(payload && payload.row));
    if (!rowNum || rowNum < 2) return { error: 'Riga non valida.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = uscSheet_(ss);
    if (!sh) return { error: 'Foglio USCITE non trovato.' };
    if (rowNum > sh.getLastRow()) return { error: 'Riga oltre i dati: ricarica.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cCat = colIdx_(H, ['CATEGORIA']), cSp = colIdx_(H, ['SPESA']);
    var rv = sh.getRange(rowNum, 1, 1, H.length).getValues()[0];
    if (payload.cat != null && cCat >= 0 && up_(rv[cCat]) !== up_(payload.cat)) return { error: 'Riga cambiata (categoria): ricarica i dati.' };
    if (payload.amount != null && cSp >= 0 && Math.abs(r2_(rv[cSp]) - r2_(payload.amount)) > 0.005) return { error: 'Riga cambiata (importo): ricarica i dati.' };
    sh.deleteRow(rowNum);
    cacheClear_();
    return { ok: true, row: rowNum };
  } catch (e) {
    return err_(e, 'eliminaSpesa');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

/* ================================================================
 * FOGLIO BOLLETTE
 * ================================================================ */
var MESI_UP_ = ['GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO', 'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'];
function meseIdx_(v) { var s = up_(v); if (!s) return -1; for (var i = 0; i < 12; i++) if (s.indexOf(MESI_UP_[i]) >= 0) return i; return -1; }
function numN_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? r2_(v) : null;
  var s = String(v).trim(); if (!s || s.charAt(0) === '#') return null;
  var n = parseFloat(s.replace(',', '.')); return isFinite(n) ? r2_(n) : null;
}
function colA1_(i) { var s = '', k = i + 1; while (k > 0) { var m = (k - 1) % 26; s = String.fromCharCode(65 + m) + s; k = Math.floor((k - 1) / 26); } return s; }
function bolIdx_(H) {
  return {
    forn: colIdx_(H, ['FORNITORE']), annoCons: colIdx_(H, ['ANNO CONSUMO']), annoPag: colIdx_(H, ['ANNO PAGAMENTO']),
    mesePag: colIdx_(H, ['MESE PAGAMENTO']), meseCons: colIdx_(H, ['MESE CONSUM']),
    luceTot: colIdx_(H, ['TOTALE', 'LUCE']), qFissa: colIdx_(H, ['QUOTA FISSA']), qPot: colIdx_(H, ['QUOTA POTENZA']),
    accise: colIdx_(H, ['ACCISE']), rai: colIdx_(H, ['CANONE RAI']), luceMat: colIdx_(H, ['MATERIA PRIMA LUCE']),
    kwh: colIdx_(H, ['CONSUMI KWH']), prezzoKwh: colIdx_(H, ['PREZZO', 'KWH']),
    gasTot: colIdx_(H, ['BOLLETTA GAS']), gasFissi: colIdx_(H, ['FISSI GAS']), gasMat: colIdx_(H, ['MATERIA PRIMA GAS']),
    smc: colIdx_(H, ['CONSUMI', 'SMC']), prezzoSmc: colIdx_(H, ['€', 'SMC']),
    oreRisc: colIdx_(H, ['ORE', 'RISCALD']), costo1h: colIdx_(H, ['1H']), effCald: colIdx_(H, ['EFFICIENZA'])
  };
}

function buildBollette_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = bolSheet_(ss);
  if (!sh) return { error: 'Foglio BOLLETTE non trovato.' };
  var vals = sh.getDataRange().getValues();
  if (!vals.length) return { error: 'Foglio BOLLETTE vuoto (' + sh.getName() + ').' };
  var H = vals[0], I = bolIdx_(H);
  if (I.forn < 0 || I.mesePag < 0) {
    return { error: 'Nel foglio "' + sh.getName() + '" mancano le colonne: ' +
      (I.forn < 0 ? 'FORNITORE ' : '') + (I.mesePag < 0 ? 'MESE PAGAMENTO' : '') };
  }
  var rows = [], forns = {}, anni = {}, anniCons = {};
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var forn = clean_(row[I.forn], 40);
    var luceTot = numN_(row[I.luceTot]), gasTot = numN_(row[I.gasTot]);
    var kwh = numN_(row[I.kwh]), smc = numN_(row[I.smc]);
    if (luceTot == null && gasTot == null && kwh == null && smc == null) continue;
    var g = function (k) { return I[k] >= 0 ? numN_(row[I[k]]) : null; };
    var ap = Math.round(numN_(row[I.annoPag]) || 0) || null;
    var obj = {
      rowNum: r + 1, forn: forn,
      annoCons: Math.round(numN_(row[I.annoCons]) || 0) || null, annoPag: ap,
      mesePag: meseIdx_(row[I.mesePag]), meseCons: meseIdx_(row[I.meseCons]),
      luce: { tot: luceTot, qFissa: g('qFissa'), qPot: g('qPot'), accise: g('accise'), rai: g('rai'), mat: g('luceMat'), kwh: kwh, prezzoKwh: g('prezzoKwh') },
      gas: { tot: gasTot, fissi: g('gasFissi'), mat: g('gasMat'), smc: smc, prezzoSmc: g('prezzoSmc'), oreRisc: g('oreRisc'), costo1h: g('costo1h'), effCald: g('effCald') }
    };
    rows.push(obj);
    if (forn) forns[forn] = 1;
    if (ap) anni[ap] = 1;
    if (obj.annoCons) anniCons[obj.annoCons] = 1;
  }
  return {
    v: 2, fonte: 'Google Sheets (BOLLETTE)', foglio: sh.getName(), rows: rows,
    fornitori: Object.keys(forns).sort(),
    anni: Object.keys(anni).map(Number).sort(function (a, b) { return a - b; }),
    /* Gli anni di CONSUMO sono cosa diversa dagli anni di PAGAMENTO: una
       bolletta di dicembre si paga a gennaio dell'anno dopo. I grafici hanno
       in ascissa il mese di consumo, quindi devono filtrare su questi. */
    anniCons: Object.keys(anniCons).map(Number).sort(function (a, b) { return a - b; }),
    n: rows.length
  };
}

function salvaBolletta(p) {
  var lock = LockService.getScriptLock();
  try {
    if (!p || !p.forn) return { error: 'Fornitore mancante.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = bolSheet_(ss);
    if (!sh) return { error: 'Foglio BOLLETTE non trovato.' };
    var last = sh.getLastRow(), lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0], I = bolIdx_(H);
    if (I.forn < 0) return { error: 'Header BOLLETTE non riconosciuto.' };
    var allVals = sh.getDataRange().getValues();

    var rowNum = Math.round(num_(p.row)), isNew = false;
    var mp = Math.round(num_(p.mesePag)), ac = Math.round(num_(p.annoPag));
    if (!rowNum) {
      for (var r = 1; r < allVals.length; r++) {
        if (up_(allVals[r][I.forn]) === up_(p.forn) &&
          Math.round(numN_(allVals[r][I.annoPag]) || 0) === ac &&
          meseIdx_(allVals[r][I.mesePag]) === mp) { rowNum = r + 1; break; }
      }
      if (!rowNum) { rowNum = last + 1; isNew = true; }
    }
    var n = rowNum, esiste = !isNew && rowNum >= 2 && rowNum <= last;
    var cur = esiste ? sh.getRange(n, 1, 1, lastCol).getValues()[0] : null;
    var frm = esiste ? sh.getRange(n, 1, 1, lastCol).getFormulas()[0] : null;

    /* Si scrive la riga INTERA in una volta sola: prima erano oltre venti
       andate e ritorni al foglio per una bolletta.
       Attenzione alle formule: getValues() restituisce il RISULTATO, quindi
       riscrivendo quello si distruggerebbe la formula della cella (materia
       prima, prezzo al kWh, ore riscaldamento…). Dove la cella e' una
       formula si riscrive la FORMULA. */
    var riga = [];
    for (var c = 0; c < lastCol; c++) riga[c] = esiste ? (frm[c] ? frm[c] : cur[c]) : '';

    function Wtext(ci, val) { if (ci < 0 || val == null || val === '') return; riga[ci] = val; }
    function Wint(ci, val) { if (ci < 0 || val === undefined) return; riga[ci] = Math.round(num_(val)); }
    function Wnum(ci, val) { if (ci < 0 || val === undefined || val === null || val === '') return; riga[ci] = r2_(val); }

    Wtext(I.forn, p.forn);
    if (p.annoCons !== undefined) Wint(I.annoCons, p.annoCons);
    if (p.annoPag !== undefined) Wint(I.annoPag, p.annoPag);
    if (p.mesePag !== undefined && mp >= 0) Wtext(I.mesePag, MESI_UP_[mp]);
    if (p.meseCons !== undefined && Math.round(num_(p.meseCons)) >= 0) Wtext(I.meseCons, MESI_UP_[Math.round(num_(p.meseCons))]);

    var L = p.luce || {}, G = p.gas || {}, ov = p.override || {};
    Wnum(I.luceTot, L.tot); Wnum(I.qFissa, L.qFissa); Wnum(I.qPot, L.qPot); Wnum(I.accise, L.accise); Wnum(I.rai, L.rai); Wnum(I.kwh, L.kwh);
    Wnum(I.gasTot, G.tot); Wnum(I.gasFissi, G.fissi); Wnum(I.smc, G.smc);

    /* Le voci derivate restano formule del foglio: si sovrascrivono solo se
       l'utente ha messo la voce in MANUALE. */
    function Wder(ci, key, val, formula) {
      if (ci < 0) return;
      if (ov[key] && val !== undefined && val !== null && val !== '') riga[ci] = r2_(val);
      else if (isNew && formula) riga[ci] = formula;
    }
    var A = colA1_;
    Wder(I.luceMat, 'luceMat', L.mat, '=' + A(I.luceTot) + n + '-' + A(I.qPot) + n + '-' + A(I.rai) + n + '-' + A(I.accise) + n + '-' + A(I.qFissa) + n);
    Wder(I.prezzoKwh, 'prezzoKwh', L.prezzoKwh, '=' + A(I.luceMat) + n + '/' + A(I.kwh) + n);
    Wder(I.gasMat, 'gasMat', G.mat, '=' + A(I.gasTot) + n + '-' + A(I.gasFissi) + n);
    Wder(I.prezzoSmc, 'prezzoSmc', G.prezzoSmc, '=' + A(I.gasMat) + n + '/' + A(I.smc) + n);
    Wder(I.oreRisc, 'oreRisc', G.oreRisc, '=SUMIFS(RISCALDAMENTO!E:E,RISCALDAMENTO!D:D,' + A(I.meseCons) + n + ',RISCALDAMENTO!B:B,' + A(I.annoCons) + n + ')');
    Wder(I.costo1h, 'costo1h', G.costo1h, '=' + A(I.gasMat) + n + '/' + A(I.oreRisc) + n);
    Wder(I.effCald, 'effCald', G.effCald, '=' + A(I.smc) + n + '/' + A(I.oreRisc) + n);

    sh.getRange(n, 1, 1, lastCol).setValues([riga]);
    cacheClear_();
    return { ok: true, row: rowNum, nuovo: isNew };
  } catch (e) {
    return err_(e, 'salvaBolletta');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function eliminaBolletta(p) {
  var lock = LockService.getScriptLock();
  try {
    var rowNum = Math.round(num_(p && p.row));
    if (!rowNum || rowNum < 2) return { error: 'Riga non valida.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = bolSheet_(ss);
    if (!sh) return { error: 'Foglio BOLLETTE non trovato.' };
    if (rowNum > sh.getLastRow()) return { error: 'Riga oltre i dati: ricarica.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0], I = bolIdx_(H);
    if (p.forn != null && I.forn >= 0 && up_(sh.getRange(rowNum, I.forn + 1).getValue()) !== up_(p.forn))
      return { error: 'Riga cambiata (fornitore): ricarica i dati.' };
    var cols = [I.luceTot, I.qFissa, I.qPot, I.accise, I.rai, I.kwh, I.gasTot, I.gasFissi, I.smc];
    for (var i = 0; i < cols.length; i++) if (cols[i] >= 0) sh.getRange(rowNum, cols[i] + 1).clearContent();
    cacheClear_();
    return { ok: true, row: rowNum };
  } catch (e) {
    return err_(e, 'eliminaBolletta');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

/* ================================================================
 * FOGLIO RISCALDAMENTO
 * ================================================================ */
function riscIdx_(H) {
  return {
    forn: colIdx_(H, ['FORNITORE']), anno: colIdx_(H, ['ANNO']), stanza: colIdx_(H, ['STANZA']),
    mese: colIdx_(H, ['MESE']), ore: colIdx_(H, ['ORE']), bolletta: colIdx_(H, ['BOLLETTA']), smc: colIdx_(H, ['SMC'])
  };
}

function buildRiscaldamento_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = riscSheet_(ss);
  if (!sh) return { error: 'Foglio RISCALDAMENTO non trovato.' };
  var vals = sh.getDataRange().getValues();
  if (!vals.length) return { error: 'Foglio RISCALDAMENTO vuoto (' + sh.getName() + ').' };
  var H = vals[0], I = riscIdx_(H);
  var manca = mancanti_(H, { 'STANZA': ['STANZA'], 'MESE': ['MESE'], 'ORE': ['ORE'] });
  if (manca.length) return { error: 'Nel foglio "' + sh.getName() + '" mancano le colonne: ' + manca.join(', ') };
  var rows = [], stanze = {}, forns = {}, anni = {};
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var stanza = clean_(row[I.stanza], 40), ore = numN_(row[I.ore]);
    var mi = meseIdx_(row[I.mese]), anno = Math.round(numN_(row[I.anno]) || 0) || null;
    if (!stanza && ore == null) continue;
    if (mi < 0 && ore == null) continue;
    var forn = clean_(row[I.forn], 40);
    rows.push({
      rowNum: r + 1, forn: forn, anno: anno, stanza: stanza, mese: mi, ore: ore,
      bolletta: I.bolletta >= 0 ? numN_(row[I.bolletta]) : null, smc: I.smc >= 0 ? numN_(row[I.smc]) : null
    });
    if (stanza) stanze[stanza] = (stanze[stanza] || 0) + 1;
    if (forn) forns[forn] = 1;
    if (anno) anni[anno] = 1;
  }
  var stList = Object.keys(stanze).sort(function (a, b) { return stanze[b] - stanze[a] || a.localeCompare(b); });
  return {
    v: 1, fonte: 'Google Sheets (RISCALDAMENTO)', foglio: sh.getName(), rows: rows, stanze: stList,
    fornitori: Object.keys(forns).sort(),
    anni: Object.keys(anni).map(Number).sort(function (a, b) { return a - b; }), n: rows.length
  };
}

function salvaRiscaldamento(p) {
  var lock = LockService.getScriptLock();
  try {
    if (!p) return { error: 'Payload mancante.' };
    var mi = Math.round(num_(p.mese)), an = Math.round(num_(p.anno));
    if (mi < 0 || mi > 11 || !an) return { error: 'Anno/mese non validi.' };
    var items = p.items || []; if (!items.length) return { error: 'Nessuna stanza da salvare.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = riscSheet_(ss);
    if (!sh) return { error: 'Foglio RISCALDAMENTO non trovato.' };
    var lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0], I = riscIdx_(H);
    if (I.stanza < 0 || I.mese < 0 || I.ore < 0) return { error: 'Header RISCALDAMENTO non riconosciuto.' };
    var vals = sh.getDataRange().getValues();

    // etichetta mese: si riusa quella già scritta nel foglio, se c'è
    var meseLabel = MESI_UP_[mi];
    for (var q = 1; q < vals.length; q++) { if (meseIdx_(vals[q][I.mese]) === mi && String(vals[q][I.mese]).trim()) { meseLabel = vals[q][I.mese]; break; } }
    var scritte = 0;
    for (var k = 0; k < items.length; k++) {
      var it = items[k] || {}; var stanza = clean_(it.stanza, 40); if (!stanza) continue;
      var rowNum = 0;
      for (var r = 1; r < vals.length; r++) {
        if (up_(vals[r][I.stanza]) === up_(stanza) && Math.round(numN_(vals[r][I.anno]) || 0) === an &&
          meseIdx_(vals[r][I.mese]) === mi && (!p.forn || up_(vals[r][I.forn]) === up_(p.forn))) { rowNum = r + 1; break; }
      }
      if (!rowNum) {
        rowNum = sh.getLastRow() + 1;
        if (I.forn >= 0 && p.forn) sh.getRange(rowNum, I.forn + 1).setValue(String(p.forn).toUpperCase());
        if (I.anno >= 0) sh.getRange(rowNum, I.anno + 1).setValue(an);
        if (I.stanza >= 0) sh.getRange(rowNum, I.stanza + 1).setValue(String(stanza).toUpperCase());
        if (I.mese >= 0) sh.getRange(rowNum, I.mese + 1).setValue(meseLabel);
        var nr = []; for (var c = 0; c < H.length; c++) nr.push('');
        if (I.forn >= 0) nr[I.forn] = String(p.forn || '').toUpperCase();
        if (I.anno >= 0) nr[I.anno] = an;
        if (I.stanza >= 0) nr[I.stanza] = String(stanza).toUpperCase();
        if (I.mese >= 0) nr[I.mese] = meseLabel;
        vals.push(nr);
      }
      if (I.ore >= 0 && it.ore !== undefined && it.ore !== null && it.ore !== '') { sh.getRange(rowNum, I.ore + 1).setValue(r2_(it.ore)); scritte++; }
      if (I.bolletta >= 0 && it.bolletta !== undefined && it.bolletta !== null && it.bolletta !== '') sh.getRange(rowNum, I.bolletta + 1).setValue(r2_(it.bolletta));
      if (I.smc >= 0 && it.smc !== undefined && it.smc !== null && it.smc !== '') sh.getRange(rowNum, I.smc + 1).setValue(r2_(it.smc));
    }
    cacheClear_();
    return { ok: true, scritte: scritte };
  } catch (e) {
    return err_(e, 'salvaRiscaldamento');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

/* ================================================================
 * FOGLIO ENTRATE
 * ================================================================ */
function meseColExact_(H) { for (var i = 0; i < H.length; i++) if (up_(H[i]) === 'MESE') return i; return -1; }
function entIdx_(H) {
  var nm = colIdx_(H, ['N. MESE']); if (nm < 0) nm = colIdx_(H, ['N.MESE']);
  var ms = meseColExact_(H); if (ms < 0) ms = colIdx_(H, ['NOME MESE']);
  return {
    data: colIdx_(H, ['DATA']), anno: colIdx_(H, ['ANNO']), nmese: nm, mese: ms,
    lordo: colIdx_(H, ['STIPENDIO LORDO']), netto: colIdx_(H, ['STIPENDIO NETTO']),
    extra1: colIdx_(H, ['EXTRA 1']), extra2: colIdx_(H, ['EXTRA 2']),
    cla: colIdx_(H, ['CLA']), cashback: colIdx_(H, ['CASHBACK']), note: colIdx_(H, ['NOTE']),
    tot: colIdx_(H, ['TOTALE ENTRAT']), stato: statoEntCol_(H)
  };
}

function buildEntrate_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var sh = entSheet_(ss);
  if (!sh) return { error: 'Foglio ENTRATE non trovato.' };
  var vals = sh.getDataRange().getValues();
  if (!vals.length) return { error: 'Foglio ENTRATE vuoto (' + sh.getName() + ').' };
  var H = vals[0], I = entIdx_(H);
  if (I.anno < 0 || (I.mese < 0 && I.nmese < 0)) {
    return { error: 'Nel foglio "' + sh.getName() + '" mancano ANNO e/o il mese (colonna "MESE" oppure "N. MESE"). ' +
      'Intestazione letta: ' + H.filter(String).join(' · ') };
  }
  var rows = [], anni = {};
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r];
    var anno = Math.round(numN_(row[I.anno]) || 0) || null;
    // mese dal nome se c'è, altrimenti dal numero: un solo formato mancante
    // non deve far sparire tutte le righe
    var mi = I.mese >= 0 ? meseIdx_(row[I.mese]) : -1;
    if (mi < 0 && I.nmese >= 0) { var mn = Math.round(num_(row[I.nmese])); if (mn >= 1 && mn <= 12) mi = mn - 1; }
    if (!anno || mi < 0) continue;
    var g = function (k) { return I[k] >= 0 ? numN_(row[I[k]]) : null; };
    rows.push({
      rowNum: r + 1, dateISO: I.data >= 0 ? iso_(row[I.data]) : '', anno: anno,
      nmese: I.nmese >= 0 ? Math.round(numN_(row[I.nmese]) || 0) : (mi + 1), mese: mi,
      lordo: g('lordo'), netto: g('netto'), extra1: g('extra1'), extra2: g('extra2'),
      cla: g('cla'), cashback: g('cashback'), tot: g('tot'),
      incassata: (I.stato >= 0 && up_(row[I.stato]).indexOf('INCASSAT') >= 0) ? 1 : 0,
      giorno: I.data >= 0 ? giornoAccredito_(row[I.data]) : null,
      note: I.note >= 0 ? clean_(row[I.note], 200) : ''
    });
    anni[anno] = 1;
  }
  return {
    v: 2, fonte: 'Google Sheets (ENTRATE)', foglio: sh.getName(), rows: rows,
    haStato: I.stato >= 0,
    giornoAccredito: num_(CONFIG.GIORNO_ACCREDITO) || 10,
    anni: Object.keys(anni).map(Number).sort(function (a, b) { return a - b; }), n: rows.length
  };
}

/* Spunta "incassata" su un'entrata: stesso gesto e stesse cautele di
   setStato() sulle uscite, compreso il controllo che la riga sia ancora
   quella che il client credeva. */
function setStatoEntrata(payload) {
  var lock = LockService.getScriptLock();
  try {
    var rowNum = Math.round(num_(payload && payload.row));
    if (!rowNum || rowNum < 2) return { error: 'Riga non valida.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = entSheet_(ss);
    if (!sh) return { error: 'Foglio ENTRATE non trovato.' };
    if (rowNum > sh.getLastRow()) return { error: 'Riga oltre i dati: ricarica.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cStato = ensureStatoEntCol_(sh, H);
    var I = entIdx_(H);
    var rv = sh.getRange(rowNum, 1, 1, H.length).getValues()[0];
    if (payload.anno != null && I.anno >= 0 && Math.round(num_(rv[I.anno])) !== Math.round(num_(payload.anno)))
      return { error: 'Riga cambiata (anno): ricarica i dati.' };
    sh.getRange(rowNum, cStato + 1).setValue(payload.incassata ? INCASSATA_V : DA_INCASSARE_V);
    cacheClear_();
    return { ok: true, row: rowNum, incassata: payload.incassata ? 1 : 0 };
  } catch (e) {
    return err_(e, 'setStatoEntrata');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

function salvaEntrata(p) {
  var lock = LockService.getScriptLock();
  try {
    if (!p) return { error: 'Payload mancante.' };
    var an = Math.round(num_(p.anno)), mi = Math.round(num_(p.mese));
    if (!an || mi < 0 || mi > 11) return { error: 'Anno/mese non validi.' };
    lock.waitLock(10000);
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sh = entSheet_(ss);
    if (!sh) return { error: 'Foglio ENTRATE non trovato.' };
    var last = sh.getLastRow(), lastCol = sh.getLastColumn();
    var H = sh.getRange(1, 1, 1, lastCol).getValues()[0], I = entIdx_(H);
    if (I.anno < 0 || (I.mese < 0 && I.nmese < 0)) return { error: 'Header ENTRATE non riconosciuto.' };
    var vals = sh.getDataRange().getValues();
    var rowNum = Math.round(num_(p.row)), isNew = false, refRow = 0;
    if (!rowNum) {
      for (var r = 1; r < vals.length; r++) {
        var rm = I.mese >= 0 ? meseIdx_(vals[r][I.mese]) : (Math.round(num_(vals[r][I.nmese])) - 1);
        if (Math.round(numN_(vals[r][I.anno]) || 0) === an && rm === mi) { rowNum = r + 1; break; }
        if (Math.round(numN_(vals[r][I.anno]) || 0)) refRow = r + 1;
      }
      if (!rowNum) { rowNum = last + 1; isNew = true; }
    }
    var cur = (!isNew && rowNum >= 2 && rowNum <= last) ? sh.getRange(rowNum, 1, 1, lastCol).getValues()[0] : null;
    var n = rowNum;
    function Wnum(ci, val) { if (ci < 0 || val === undefined || val === null || val === '') return; sh.getRange(n, ci + 1).setValue(r2_(val)); }
    function Wtext(ci, val) { if (ci < 0 || val == null) return; if (!cur || up_(cur[ci]) !== up_(val)) sh.getRange(n, ci + 1).setValue(val); }

    if (isNew) {
      if (I.data >= 0 && p.dateISO) sh.getRange(n, I.data + 1).setValue(iso_(p.dateISO) || p.dateISO);
      if (I.anno >= 0) sh.getRange(n, I.anno + 1).setValue(an);
      if (I.nmese >= 0) sh.getRange(n, I.nmese + 1).setValue(mi + 1);
      if (I.mese >= 0) sh.getRange(n, I.mese + 1).setValue(MESI_UP_[mi]);
    } else if (I.data >= 0 && p.dateISO) {
      Wtext(I.data, iso_(p.dateISO) || p.dateISO);
    }
    Wnum(I.lordo, p.lordo); Wnum(I.netto, p.netto); Wnum(I.extra1, p.extra1); Wnum(I.extra2, p.extra2);
    Wnum(I.cla, p.cla); Wnum(I.cashback, p.cashback);
    if (I.note >= 0 && p.note !== undefined) sh.getRange(n, I.note + 1).setValue(clean_(p.note, 200));

    /* TOTALE ENTRATE resta una formula del foglio: sulla riga nuova si copia
       da una riga esistente invece di scriverci un numero. */
    if (isNew && I.tot >= 0) {
      if (!refRow) refRow = (last >= 2 ? last : 0);
      if (refRow >= 2) sh.getRange(refRow, I.tot + 1).copyTo(sh.getRange(n, I.tot + 1), { contentsOnly: false });
    }
    cacheClear_();
    return { ok: true, row: rowNum, nuovo: isNew };
  } catch (e) {
    return err_(e, 'salvaEntrata');
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}

/* ================================================================
 * AUTO — manutenzione, scadenze e costi dell'auto (spec: AUTO.md)
 * ================================================================
 * I SOLDI RESTANO IN USCITE. I fogli AUTO_* tengono solo quello che USCITE
 * non sa: km, voci, officina, scadenze, piano. Le righe MACCHINA e GASOLIO
 * si leggono da USCITE e si classificano nel client (AUTO:CORE). Quando un
 * intervento si paga dall'app, le righe in USCITE portano "[AUTO-0007]"
 * nella nota: e' il legame, senza aggiungere colonne al foglio.
 *
 * I fogli AUTO_* si creano da soli alla prima lettura, con i dati di
 * partenza qui sotto: se esistono gia' non vengono toccati.
 *
 * Promemoria: autoControlloScadenze() gira ogni mattina (installaTriggerAuto
 * una volta sola), manda un'email alle soglie e tiene allineati gli eventi
 * su Google Calendar. Servono gli scope script.send_mail, calendar,
 * script.scriptapp e userinfo.email (AUTO.md, "Attivare i promemoria").
 */
var AUTO_FOGLI = {
  interventi: { nome: 'AUTO_INTERVENTI', H: ['ID', 'DATA', 'KM', 'TIPO', 'VOCI', 'OFFICINA', 'COSTO', 'STRAORDINARIO', 'PAGAMENTO', 'NOTE'] },
  km: { nome: 'AUTO_KM', H: ['DATA', 'KM', 'FONTE'] },
  scadenze: { nome: 'AUTO_SCADENZE', H: ['CHIAVE', 'ETICHETTA', 'SCADENZA', 'IMPORTO', 'RIPETI_MESI', 'PREAVVISO_GG', 'NOTE'] },
  piano: { nome: 'AUTO_PIANO', H: ['VOCE', 'FONTE', 'INTERVALLO_KM', 'INTERVALLO_MESI', 'ULTIMO_KM', 'ULTIMA_DATA', 'KM_SCAD', 'DATA_SCAD', 'NOTE'] }
};
var AUTO_VEICOLO = { modello: 'BMW 118d', serie: 'F20', immatricolazione: '2013-12', alimentazione: 'Diesel', cambio: 'Automatico' };
var AUTO_CATEGORIE = ['MACCHINA', 'GASOLIO'];
var AUTO_TIPI_ = ['TAGLIANDO', 'REVISIONE', 'STRAORDINARIO', 'GOMME', 'CARROZZERIA', 'ALTRO'];
/* Dati di partenza: quelli raccolti a ottobre 2026. Le date senza giorno
   certo lo dicono nella nota: un valore messo per comodita' deve vedersi. */
var AUTO_SEED = {
  interventi: [
    ['AUTO-0001', '2024-08-02', 155000, 'GOMME', 'Pneumatici=380', 'Amuro Gomme', 380, 0, 'UNICA', 'Cambio gomme estive (montate tutto l\'anno)'],
    ['AUTO-0002', '2025-12-01', '', 'REVISIONE', 'Revisione=80', '', 80, 0, 'UNICA', 'Fatta a dicembre 2025 (giorno non registrato), pagata a gennaio 2026'],
    ['AUTO-0003', '2026-09-11', 180000, 'TAGLIANDO,STRAORDINARIO', 'Olio motore=300; Catena distribuzione=2100', '', 2400, 2100, 'RATE', 'Fattura 2.400 €, pagata a rate']
  ],
  km: [['2026-10-18', 180100, 'MANUALE']],
  scadenze: [
    ['RCA', 'Assicurazione RCA', '2026-11-21', 450, 12, 45, 'Niente tacito rinnovo: confronta i preventivi'],
    ['BOLLO', 'Bollo', '2026-12-31', 300, 12, 30, 'In ritardo costa: 2023 e 2024 pagati con sanzioni'],
    ['REVISIONE', 'Revisione', '2027-12-31', 80, 24, 60, 'Ogni 24 mesi, entro fine mese']
  ],
  piano: [
    ['Olio motore', 'CBS', '', '', 180000, '2026-09-11', '', '', 'Il tagliando: segue il computer di bordo'],
    ['Liquido freni', 'CBS', '', '', '', '', '', '', ''],
    ['Pastiglie anteriori', 'CBS', '', '', '', '', '', '', ''],
    ['Pastiglie posteriori', 'CBS', '', '', '', '', '', '', ''],
    ['Controllo veicolo', 'CBS', '', '', '', '', '', '', ''],
    ['Catena distribuzione', 'MANUALE', '', '', 180000, '2026-09-11', '', '', 'Rumori a freddo: segnalali al tagliando'],
    ['Olio cambio automatico', 'MANUALE', 100000, '', '', '', '', '', 'BMW: a vita · ZF consiglia 80-120 mila km'],
    ['Pneumatici', 'MANUALE', '', 72, '', '2024-08-02', '', '', 'Estivi tutto l\'anno: oltre 6 anni la gomma indurisce'],
    ['Liquido refrigerante', 'MANUALE', '', 48, '', '', '', '', ''],
    ['Batteria', 'MANUALE', '', '', '', '', '', '', 'AGM: alla sostituzione va registrata in centralina']
  ]
};

/* ---- date ISO e numeri ---- */
function autoD_(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
function autoIso_(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function autoOggi_() { return iso_(new Date()); }
function autoGiorni_(da, a) { var x = autoD_(da), y = autoD_(a); return (x && y) ? Math.round((y - x) / 86400000) : null; }
function autoFineMese_(iso) { var d = autoD_(iso); return d ? autoIso_(new Date(d.getFullYear(), d.getMonth() + 1, 0)) : ''; }
function autoPiuMesi_(iso, n) {
  var d = autoD_(iso); if (!d) return '';
  var fineMese = d.getDate() === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  var t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  var ult = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return autoIso_(new Date(t.getFullYear(), t.getMonth(), fineMese ? ult : Math.min(d.getDate(), ult)));
}
function autoDataIt_(iso) { var d = autoD_(iso); return d ? ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear() : ''; }
/* "€ 1.234,50" come testo, 1234.5 come numero: tutti e due valgono. */
function autoNum_(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? r2_(v) : null;
  var s = String(v).replace(/[€\s]/g, '');
  if (!s || s.charAt(0) === '#') return null;
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s); return isFinite(n) ? r2_(n) : null;
}
function autoInt_(v) { var n = autoNum_(v); return n == null ? null : Math.round(n); }

/* ---- fogli ---- */
function autoFoglio_(ss, k, crea) {
  var def = AUTO_FOGLI[k];
  var sh = ss.getSheetByName(def.nome);
  if (!sh && crea) {
    /* due aperture in contemporanea al primo avvio: la seconda trova il
       foglio appena creato dalla prima invece di fallire */
    try { sh = ss.insertSheet(def.nome); } catch (e) { sh = ss.getSheetByName(def.nome); if (sh) return sh; throw e; }
    var righe = [def.H.slice()];
    (AUTO_SEED[k] || []).forEach(function (r) { var x = r.slice(); while (x.length < def.H.length) x.push(''); righe.push(x); });
    sh.getRange(1, 1, righe.length, def.H.length).setValues(righe);
    try { sh.setFrozenRows(1); } catch (e) {}
  }
  return sh;
}
function autoFogli_(ss) { var o = {}; for (var k in AUTO_FOGLI) o[k] = autoFoglio_(ss, k, true); return o; }
/* Righe come oggetti con le chiavi = intestazioni MAIUSCOLE. */
function autoLeggi_(sh) {
  if (!sh) return [];
  var v = sh.getDataRange().getValues(); if (v.length < 2) return [];
  var H = v[0].map(function (h) { return up_(h); }), out = [];
  for (var r = 1; r < v.length; r++) {
    var o = { _row: r + 1 }, vuota = true;
    for (var c = 0; c < H.length; c++) { if (!H[c]) continue; var x = v[r][c]; if (x !== '' && x != null) vuota = false; o[H[c]] = x; }
    if (!vuota) out.push(o);
  }
  return out;
}
function autoTrovaRiga_(sh, col, valore) {
  var v = sh.getDataRange().getValues(); if (!v.length) return -1;
  var c = v[0].map(function (h) { return up_(h); }).indexOf(col); if (c < 0) return -1;
  for (var r = 1; r < v.length; r++) if (up_(v[r][c]) === up_(valore)) return r + 1;
  return -1;
}
/* Scrive i campi presenti in obj (chiavi = intestazioni) tenendo gli altri
   come sono. rowNum <= 0: riga nuova in fondo. */
function autoScriviRiga_(sh, rowNum, obj) {
  var lc = sh.getLastColumn();
  var H = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return up_(h); });
  var cur = rowNum > 0 ? sh.getRange(rowNum, 1, 1, lc).getValues()[0] : H.map(function () { return ''; });
  for (var c = 0; c < H.length; c++) if (H[c] && obj.hasOwnProperty(H[c]) && obj[H[c]] !== undefined) cur[c] = obj[H[c]] == null ? '' : obj[H[c]];
  var n = rowNum > 0 ? rowNum : sh.getLastRow() + 1;
  sh.getRange(n, 1, 1, lc).setValues([cur]);
  return n;
}
function autoVoci_(s) {
  return String(s || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
    var i = x.lastIndexOf('=');
    return i > 0 ? { nome: clean_(x.slice(0, i), 60), importo: autoNum_(x.slice(i + 1)) } : { nome: clean_(x, 60), importo: null };
  });
}
function autoVociTesto_(voci) {
  return (voci || []).map(function (v) { var n = clean_(v.nome, 60).replace(/[;=]/g, ' '); return v.importo != null && v.importo !== '' ? n + '=' + r2_(v.importo) : n; }).join('; ');
}

/* ---- lettura ---- */
function autoUscite_(ss) {
  var sh = uscSheet_(ss); if (!sh) return [];
  var U = sh.getDataRange().getValues(); if (!U.length) return [];
  var H = U[0];
  var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
  var cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']), cNote = colIdx_(H, ['NOTE']), cCc = colIdx_(H, ['CC']), cSt = statoCol_(H);
  if (cSp < 0 || cCat < 0) return [];
  var out = [];
  for (var r = 1; r < U.length; r++) {
    var cat = up_(U[r][cCat]); if (AUTO_CATEGORIE.indexOf(cat) < 0) continue;
    var imp = autoNum_(U[r][cSp]); if (!(imp > 0)) continue;
    var st = cSt >= 0 ? up_(U[r][cSt]) : '';
    out.push({
      row: r + 1, data: cData >= 0 ? iso_(U[r][cData]) : '',
      anno: cAnno >= 0 ? Math.round(num_(U[r][cAnno])) : 0, mese: cMese >= 0 ? Math.round(num_(U[r][cMese])) - 1 : -1,
      importo: imp, cat: cat, nota: cNote >= 0 ? clean_(U[r][cNote], 200) : '',
      paid: st.indexOf('PAGAT') >= 0 ? 1 : 0, cc: cCc >= 0 && up_(U[r][cCc]) === 'SI' ? 1 : 0
    });
  }
  return out;
}
function autoProp_(nome, dflt) { try { var v = PropertiesService.getScriptProperties().getProperty(nome); return v == null ? dflt : v; } catch (e) { return dflt; } }
function autoPropJson_(nome) { try { return JSON.parse(autoProp_(nome, '') || 'null'); } catch (e) { return null; } }

function autoDati_(ss) {
  var sh = autoFogli_(ss);
  var interventi = autoLeggi_(sh.interventi).map(function (o) {
    return {
      row: o._row, id: up_(o.ID), data: iso_(o.DATA), km: autoInt_(o.KM),
      tipi: String(o.TIPO || '').split(/[,;+]/).map(function (t) { return up_(t); }).filter(function (t) { return AUTO_TIPI_.indexOf(t) >= 0; }),
      voci: autoVoci_(o.VOCI), officina: clean_(o.OFFICINA, 60), costo: autoNum_(o.COSTO) || 0, straord: autoNum_(o.STRAORDINARIO) || 0,
      pagamento: up_(o.PAGAMENTO), note: clean_(o.NOTE, 300)
    };
  }).filter(function (i) { return i.id && i.data; });
  var km = autoLeggi_(sh.km).map(function (o) { return { row: o._row, data: iso_(o.DATA), km: autoInt_(o.KM), fonte: up_(o.FONTE) }; }).filter(function (k) { return k.data && k.km > 0; });
  var scadenze = autoLeggi_(sh.scadenze).map(function (o) {
    return { row: o._row, chiave: up_(o.CHIAVE), etichetta: clean_(o.ETICHETTA, 60) || up_(o.CHIAVE), scadenza: iso_(o.SCADENZA), importo: autoNum_(o.IMPORTO) || 0, ripetiMesi: autoInt_(o.RIPETI_MESI) || 0, preavviso: autoInt_(o.PREAVVISO_GG) || 30, note: clean_(o.NOTE, 200) };
  }).filter(function (s) { return s.chiave; });
  var piano = autoLeggi_(sh.piano).map(function (o) {
    return { row: o._row, voce: clean_(o.VOCE, 60), fonte: up_(o.FONTE) === 'CBS' ? 'CBS' : 'MANUALE', intervalloKm: autoInt_(o.INTERVALLO_KM), intervalloMesi: autoInt_(o.INTERVALLO_MESI), ultimoKm: autoInt_(o.ULTIMO_KM), ultimaData: iso_(o.ULTIMA_DATA), kmScad: autoInt_(o.KM_SCAD), dataScad: iso_(o.DATA_SCAD), note: clean_(o.NOTE, 200) };
  }).filter(function (p) { return p.voce; });
  return { interventi: interventi, km: km, scadenze: scadenze, piano: piano, fogli: sh };
}

function buildAuto_() {
  var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  var d = autoDati_(ss);
  return {
    v: 1, fonte: 'Google Sheets (AUTO_*, USCITE)', oggi: autoOggi_(),
    veicolo: AUTO_VEICOLO, interventi: d.interventi, km: d.km, scadenze: d.scadenze, piano: d.piano,
    uscite: autoUscite_(ss),
    notifiche: { trigger: autoProp_('AUTO_TRIGGER', '') || '', ultimo: autoPropJson_('AUTO_ULTIMO_CONTROLLO') }
  };
}
function getDatiAuto(opz) { return conCache_('auto', opz && opz.forza, buildAuto_, 'AUTO'); }

/* ---- scritture ---- */
function autoConLock_(fn, dove) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    var out = fn(SpreadsheetApp.openById(CONFIG.SHEET_ID));
    if (out && !out.error) cacheClear_();
    return out;
  } catch (e) {
    return err_(e, dove);
  } finally {
    try { lock.releaseLock(); } catch (el) {}
  }
}
function autoNuovoId_(sh) {
  var max = 0;
  autoLeggi_(sh).forEach(function (o) { var m = String(o.ID || '').match(/(\d+)$/); if (m && +m[1] > max) max = +m[1]; });
  return 'AUTO-' + ('000' + (max + 1)).slice(-4);
}
/* I km non tornano indietro: una lettura non puo' essere minore di una
   precedente ne' maggiore di una successiva (letture di AUTO_KM e km degli
   interventi; `escludiId` toglie l'intervento che si sta modificando).
   Torna il motivo, o '' se va bene. Stessa regola del client. */
function autoKmIncoerenti_(sh, data, km, escludiId) {
  if (!data || !(km > 0)) return '';
  var l = [];
  autoLeggi_(sh.km).forEach(function (o) { var k = autoInt_(o.KM), d = iso_(o.DATA); if (d && k > 0) l.push({ data: d, km: k }); });
  autoLeggi_(sh.interventi).forEach(function (o) { var k = autoInt_(o.KM), d = iso_(o.DATA); if (d && k > 0 && up_(o.ID) !== up_(escludiId || '')) l.push({ data: d, km: k }); });
  for (var i = 0; i < l.length; i++) {
    if (l[i].data <= data && l[i].km > km) return 'I km non tornano: il ' + autoDataIt_(l[i].data) + ' erano già ' + l[i].km + ' km.';
    if (l[i].data >= data && l[i].km < km) return 'I km non tornano: il ' + autoDataIt_(l[i].data) + ' erano ' + l[i].km + ' km, questa lettura è troppo alta.';
  }
  return '';
}
function autoAggiungiKm_(sh, data, km, fonte) {
  var gia = autoLeggi_(sh).some(function (o) { return iso_(o.DATA) === data && autoInt_(o.KM) === km; });
  if (!gia) autoScriviRiga_(sh, -1, { DATA: data, KM: km, FONTE: fonte });
}
/* Righe nuove in USCITE, categoria MACCHINA, tutte in un colpo solo. */
function autoScriviUscite_(ss, righe, pay) {
  var sh = uscSheet_(ss);
  if (!sh) throw new Error('Foglio USCITE non trovato.');
  var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var cStato = ensureStatoCol_(sh, H);
  var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
  var cNome = colIdx_(H, ['NOME MESE']), cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']);
  var cNote = colIdx_(H, ['NOTE']), cCc = colIdx_(H, ['CC']), cTipo = colIdx_(H, ['TIPO']);
  if (cAnno < 0 || cMese < 0 || cSp < 0 || cCat < 0) throw new Error('Header USCITE privo di colonne chiave.');
  var oggi = autoOggi_(), conCarta = pay === 'cc', blocco = [];
  righe.forEach(function (x) {
    var d = autoD_(x.data); if (!d) throw new Error('Data non valida: ' + x.data);
    var row = []; for (var c = 0; c < H.length; c++) row.push('');
    if (cData >= 0) row[cData] = x.data;
    row[cAnno] = d.getFullYear(); row[cMese] = d.getMonth() + 1;
    if (cNome >= 0) row[cNome] = MESI_UP_[d.getMonth()];
    row[cSp] = r2_(x.importo); row[cCat] = 'MACCHINA';
    if (cNote >= 0) row[cNote] = clean_(x.nota, 200);
    if (cCc >= 0) row[cCc] = conCarta ? 'SI' : '';
    if (cTipo >= 0) row[cTipo] = x.tipo === 'FISSA' ? 'FISSA' : 'VARIABILE';
    if (cStato >= 0) row[cStato] = !conCarta && x.data <= oggi && !x.daPagare ? PAID_V : UNPAID_V;
    blocco.push(row);
  });
  if (!blocco.length) return 0;
  sh.getRange(sh.getLastRow() + 1, 1, blocco.length, H.length).setValues(blocco);
  return blocco.length;
}
function autoPianoFatto_(sh, voci, data, km) {
  var n = 0, nomi = (voci || []).map(function (v) { return up_(v.nome); });
  autoLeggi_(sh).forEach(function (o) {
    if (nomi.indexOf(up_(o.VOCE)) < 0) return;
    autoScriviRiga_(sh, o._row, { ULTIMO_KM: km > 0 ? km : '', ULTIMA_DATA: data, KM_SCAD: '', DATA_SCAD: '' });
    n++;
  });
  return n;
}
function autoApplicaPiano_(sh, righe, km, data) {
  var n = 0;
  (righe || []).forEach(function (r) {
    var voce = clean_(r.voce, 60); if (!voce) return;
    var row = autoTrovaRiga_(sh, 'VOCE', voce);
    if (r.elimina) { if (row > 0) { sh.deleteRow(row); n++; } return; }
    var o = {};
    if (r.fonte) o.FONTE = up_(r.fonte) === 'CBS' ? 'CBS' : 'MANUALE';
    ['intervalloKm', 'intervalloMesi', 'ultimoKm', 'kmScad'].forEach(function (k) { if (r[k] !== undefined) o[{ intervalloKm: 'INTERVALLO_KM', intervalloMesi: 'INTERVALLO_MESI', ultimoKm: 'ULTIMO_KM', kmScad: 'KM_SCAD' }[k]] = autoInt_(r[k]) > 0 ? autoInt_(r[k]) : ''; });
    if (r.ultimaData !== undefined) o.ULTIMA_DATA = iso_(r.ultimaData);
    if (r.dataScad !== undefined) o.DATA_SCAD = iso_(r.dataScad);
    if (r.note !== undefined) o.NOTE = clean_(r.note, 200);
    // dal computer di bordo: "tra X km" e "entro MM/AAAA"
    if (autoInt_(r.traKm) != null && km > 0) o.KM_SCAD = km + autoInt_(r.traKm);
    if (r.entro) { var m = String(r.entro).match(/^(\d{4})-(\d{2})/); if (m) o.DATA_SCAD = autoFineMese_(m[1] + '-' + m[2] + '-01'); }
    if (row < 0) { o.VOCE = voce; if (!o.FONTE) o.FONTE = 'MANUALE'; }
    autoScriviRiga_(sh, row, o);
    n++;
  });
  return n;
}

function autoSalvaIntervento(p) {
  return autoConLock_(function (ss) {
    if (!p) return { error: 'Intervento vuoto.' };
    var data = iso_(p.data); if (!data) return { error: 'Data mancante o non valida.' };
    var tipi = (p.tipi || []).map(function (t) { return up_(t); }).filter(function (t) { return AUTO_TIPI_.indexOf(t) >= 0; });
    if (!tipi.length) return { error: 'Scegli almeno un tipo di intervento.' };
    var costo = r2_(p.costo); if (costo < 0) return { error: 'Costo non valido.' };
    var straord = Math.min(costo, Math.max(0, r2_(p.straord)));
    var km = autoInt_(p.km) || 0;
    var sh = autoFogli_(ss);
    var nuovo = !p.id, id = nuovo ? autoNuovoId_(sh.interventi) : up_(p.id);
    /* ogni intervento porta i km: sono la meta' dell'informazione (piano,
       media km/mese, scadenze a km). Su un intervento vecchio senza km la
       modifica resta possibile. */
    if (nuovo && !(km > 0)) return { error: 'Mancano i km dell\'intervento (in fattura o sul contachilometri).' };
    var kmErr = autoKmIncoerenti_(sh, data, km, nuovo ? '' : id); if (kmErr) return { error: kmErr };
    var rowNum = nuovo ? -1 : autoTrovaRiga_(sh.interventi, 'ID', id);
    if (!nuovo && rowNum < 0) return { error: 'Intervento ' + id + ' non trovato: ricarica.' };
    var voci = (p.voci || []).filter(function (v) { return v && clean_(v.nome, 60); });
    var u = p.uscite || {}, modo = nuovo ? (['UNICA', 'RATE'].indexOf(up_(u.modo)) >= 0 ? up_(u.modo) : 'NESSUNA') : undefined;
    var righe = [];
    if (nuovo && modo !== 'NESSUNA' && costo > 0) {
      var r0 = (u.rate || []).filter(function (r) { return r && iso_(r.data) && r2_(r.importo) > 0; });
      if (!r0.length) return { error: 'Manca la data di pagamento.' };
      var somma = r2_(r0.reduce(function (s, r) { return s + r2_(r.importo); }, 0));
      if (Math.abs(somma - costo) > 0.01) return { error: 'Le rate sommano ' + somma + ' €, il costo è ' + costo + ' €: non scrivo nulla.' };
      var etich = voci.length ? voci.map(function (v) { return clean_(v.nome, 40); }).join(' + ') : tipi.join(' + ');
      r0.forEach(function (r, k) {
        righe.push({ data: iso_(r.data), importo: r2_(r.importo), tipo: r0.length > 1 ? 'FISSA' : 'VARIABILE',
          nota: etich + (p.officina ? ' · ' + clean_(p.officina, 40) : '') + (r0.length > 1 ? ' · rata ' + (k + 1) + '/' + r0.length : '') + ' [' + id + ']' });
      });
    }
    autoScriviRiga_(sh.interventi, rowNum, {
      ID: id, DATA: data, KM: km > 0 ? km : '', TIPO: tipi.join(','), VOCI: autoVociTesto_(voci), OFFICINA: clean_(p.officina, 60),
      COSTO: costo, STRAORDINARIO: straord, PAGAMENTO: modo, NOTE: clean_(p.note, 300)
    });
    var nUscite = righe.length ? autoScriviUscite_(ss, righe, u.pay) : 0;
    if (km > 0) autoAggiungiKm_(sh.km, data, km, 'INTERVENTO');
    var nPiano = autoPianoFatto_(sh.piano, voci, data, km);
    if (p.cbs && p.cbs.length) autoApplicaPiano_(sh.piano, p.cbs, km, data);
    if (tipi.indexOf('REVISIONE') >= 0) {
      var rr = autoTrovaRiga_(sh.scadenze, 'CHIAVE', 'REVISIONE');
      var prox = autoFineMese_(autoPiuMesi_(data.slice(0, 7) + '-01', 24));
      autoScriviRiga_(sh.scadenze, rr, rr > 0 ? { SCADENZA: prox } : { CHIAVE: 'REVISIONE', ETICHETTA: 'Revisione', SCADENZA: prox, IMPORTO: costo || '', RIPETI_MESI: 24, PREAVVISO_GG: 60 });
    }
    return { ok: true, id: id, nuovo: nuovo, righeUscite: nUscite, vociPiano: nPiano, usciteScritte: nUscite > 0 };
  }, 'autoSalvaIntervento');
}

function autoEliminaIntervento(p) {
  return autoConLock_(function (ss) {
    var sh = autoFogli_(ss), row = autoTrovaRiga_(sh.interventi, 'ID', p && p.id);
    if (row < 0) return { error: 'Intervento non trovato: ricarica.' };
    sh.interventi.deleteRow(row);
    return { ok: true };
  }, 'autoEliminaIntervento');
}

function autoSalvaKm(p) {
  return autoConLock_(function (ss) {
    var data = iso_(p && p.data), km = autoInt_(p && p.km);
    if (!data || !(km > 0)) return { error: 'Data o km non validi.' };
    var sh = autoFogli_(ss);
    var kmErr = autoKmIncoerenti_(sh, data, km); if (kmErr) return { error: kmErr };
    autoAggiungiKm_(sh.km, data, km, 'MANUALE');
    return { ok: true };
  }, 'autoSalvaKm');
}

function autoSalvaScadenza(p) {
  return autoConLock_(function (ss) {
    if (!p) return { error: 'Scadenza vuota.' };
    var sh = autoFogli_(ss).scadenze;
    var chiave = up_(p.chiave) || up_(p.etichetta).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    if (!chiave) return { error: 'Manca il nome della scadenza.' };
    var row = autoTrovaRiga_(sh, 'CHIAVE', chiave);
    if (p.elimina) {
      if (['RCA', 'BOLLO', 'REVISIONE'].indexOf(chiave) >= 0) return { error: 'Questa scadenza non si elimina: cambiane la data.' };
      if (row > 0) sh.deleteRow(row);
      return { ok: true };
    }
    var scad = iso_(p.scadenza); if (!scad) return { error: 'Data di scadenza non valida.' };
    var km = autoInt_(p.km) || 0, dataKm = iso_(p.data) || autoOggi_(), fogli = null;
    if (km > 0) { fogli = autoFogli_(ss); var kmErr = autoKmIncoerenti_(fogli, dataKm, km); if (kmErr) return { error: kmErr }; }
    var ripeti = autoInt_(p.ripetiMesi) || 0;
    if (p.rinnova) { if (!ripeti) return { error: 'Senza "ogni N mesi" non so di quanto spostarla.' }; scad = autoPiuMesi_(scad, ripeti); }
    var o = { CHIAVE: chiave, SCADENZA: scad, IMPORTO: r2_(p.importo) || '', RIPETI_MESI: ripeti || '', PREAVVISO_GG: autoInt_(p.preavviso) || 30 };
    if (p.etichetta) o.ETICHETTA = clean_(p.etichetta, 60);
    if (p.note !== undefined) o.NOTE = clean_(p.note, 200);
    autoScriviRiga_(sh, row, o);
    if (km > 0) autoAggiungiKm_(fogli.km, dataKm, km, 'SCADENZA ' + chiave);
    return { ok: true, scadenza: scad };
  }, 'autoSalvaScadenza');
}

function autoSalvaPiano(p) {
  return autoConLock_(function (ss) {
    var sh = autoFogli_(ss), km = autoInt_(p && p.km) || 0, data = iso_(p && p.data) || autoOggi_();
    if (km > 0) { var kmErr = autoKmIncoerenti_(sh, data, km); if (kmErr) return { error: kmErr }; autoAggiungiKm_(sh.km, data, km, 'CBS'); }
    var n = autoApplicaPiano_(sh.piano, (p && p.righe) || [], km, data);
    return { ok: true, voci: n };
  }, 'autoSalvaPiano');
}

/* Correzioni proposte dall'app (AUTO:CORE autoIncoerenze). Ogni riga
   esistente viene RICONTROLLATA (categoria auto, stesso importo) prima di
   toccarla: se il foglio e' cambiato nel frattempo, ci si ferma. */
function autoCorreggi(a) {
  return autoConLock_(function (ss) {
    if (!a || !a.tipo || !(a.righe && a.righe.length)) return { error: 'Correzione vuota.' };
    if (a.tipo === 'crea') {
      var n = autoScriviUscite_(ss, a.righe.map(function (r) { return { data: iso_(r.data), importo: r2_(r.importo), nota: r.nota, tipo: 'FISSA', daPagare: true }; }), 'conto');
      return { ok: true, righe: n, usciteScritte: true };
    }
    var sh = uscSheet_(ss); if (!sh) return { error: 'Foglio USCITE non trovato.' };
    var H = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    var cData = colIdx_(H, ['DATA PAGAMENTO']), cAnno = colIdx_(H, ['ANNO']), cMese = colIdx_(H, ['MESE PAGAMENTO']);
    var cNome = colIdx_(H, ['NOME MESE']), cSp = colIdx_(H, ['SPESA']), cCat = colIdx_(H, ['CATEGORIA']), cSt = statoCol_(H);
    var last = sh.getLastRow(), nuove = [];
    for (var i = 0; i < a.righe.length; i++) {
      var r = a.righe[i], row = Math.round(num_(r.row));
      if (row < 2 || row > last) return { error: 'Riga ' + row + ' oltre i dati: ricarica.' };
      var rv = sh.getRange(row, 1, 1, H.length).getValues()[0];
      if (AUTO_CATEGORIE.indexOf(up_(rv[cCat])) < 0 || Math.abs(r2_(autoNum_(rv[cSp])) - r2_(r.importo)) > 0.005) return { error: 'La riga ' + row + ' è cambiata: ricarica e riprova.' };
      if (a.tipo === 'date') {
        var d = autoD_(r.data); if (!d) return { error: 'Data non valida: ' + r.data };
        if (cData >= 0) rv[cData] = r.data;
        if (cAnno >= 0) rv[cAnno] = d.getFullYear();
        if (cMese >= 0) rv[cMese] = d.getMonth() + 1;
        if (cNome >= 0) rv[cNome] = MESI_UP_[d.getMonth()];
      } else if (a.tipo === 'stato') {
        if (cSt < 0) return { error: 'Colonna di stato assente.' };
        rv[cSt] = a.paid ? PAID_V : UNPAID_V;
      } else return { error: 'Correzione sconosciuta: ' + a.tipo };
      nuove.push([row, rv]);
    }
    nuove.forEach(function (x) { sh.getRange(x[0], 1, 1, H.length).setValues([x[1]]); });
    return { ok: true, righe: nuove.length, usciteScritte: true };
  }, 'autoCorreggi');
}

/* ---- promemoria: email + Google Calendar ---- */
var AUTO_SOGLIE_GG = [7, 1, 0];
function autoCatene_(oggi) {
  var d = autoD_(oggi), y = d.getFullYear(), m = d.getMonth(), g = d.getDate();
  var inCorso = m > 10 || (m === 10 && g >= 15) || m < 3 || (m === 3 && g <= 15);
  return inCorso ? null : y + '-11-15';
}
/* Le stesse scadenze del client, nella forma che serve alle notifiche:
   scadenze del foglio, catene a bordo, voci del piano con una data o vicine
   in km. */
function autoElencoAvvisi_(d, oggi) {
  var out = [];
  d.scadenze.forEach(function (s) { if (s.scadenza) out.push({ chiave: s.chiave, etichetta: s.etichetta, data: s.scadenza, importo: s.importo, preavviso: s.preavviso || 30, note: s.note }); });
  var cat = autoCatene_(oggi);
  if (cat) out.push({ chiave: 'CATENE', etichetta: 'Catene a bordo (obbligo invernale)', data: cat, preavviso: 14, note: 'Dal 15/11 al 15/04 dove c\'è ordinanza: con le estive servono le catene in auto.' });
  var kmAtt = 0;
  d.km.forEach(function (k) { if (k.km > kmAtt) kmAtt = k.km; });
  d.interventi.forEach(function (i) { if (i.km > kmAtt) kmAtt = i.km; });
  d.piano.forEach(function (p) {
    var ds = p.dataScad || (p.ultimaData && p.intervalloMesi ? autoPiuMesi_(p.ultimaData, p.intervalloMesi) : '');
    if (ds) out.push({ chiave: 'PIANO:' + up_(p.voce), etichetta: p.voce, data: ds, preavviso: 30, note: p.note });
    var ks = p.kmScad || (p.ultimoKm && p.intervalloKm ? p.ultimoKm + p.intervalloKm : 0);
    if (ks && kmAtt) out.push({ chiave: 'KM:' + up_(p.voce), etichetta: p.voce, residuoKm: ks - kmAtt, kmScad: ks, note: p.note });
  });
  out.forEach(function (x) { x.giorni = x.data ? autoGiorni_(oggi, x.data) : null; });
  return out;
}
function autoQuando_(x) {
  if (x.residuoKm != null) return x.residuoKm < 0 ? 'superato di ' + (-x.residuoKm) + ' km' : 'tra ' + x.residuoKm + ' km';
  var g = x.giorni, dt = autoDataIt_(x.data);
  return g < 0 ? 'SCADUTA da ' + (-g) + ' giorni (' + dt + ')' : g === 0 ? 'scade OGGI (' + dt + ')' : g === 1 ? 'scade domani (' + dt + ')' : 'scade tra ' + g + ' giorni (' + dt + ')';
}
/* Soglia raggiunta: la piu' piccola fra preavviso, 7, 1, 0 che e' >= ai
   giorni che mancano; -1 se e' gia' scaduta. Una chiave per soglia, cosi'
   ogni soglia manda UNA email e una sola. */
function autoSoglia_(x) {
  if (x.residuoKm != null) return x.residuoKm < 0 ? -1 : x.residuoKm <= 300 ? 300 : x.residuoKm <= 1000 ? 1000 : null;
  if (x.giorni == null) return null;
  if (x.giorni < 0) return x.giorni >= -30 ? -1 : null;
  var s = [x.preavviso || 30].concat(AUTO_SOGLIE_GG).sort(function (a, b) { return a - b; });
  for (var i = 0; i < s.length; i++) if (x.giorni <= s[i]) return s[i];
  return null;
}
function autoEmail_() {
  var p = autoProp_('AUTO_EMAIL', ''); if (p) return p;
  try { return Session.getEffectiveUser().getEmail(); } catch (e) { return ''; }
}
function autoInviaEmail_(items) {
  var to = autoEmail_(); if (!to) throw new Error('indirizzo email non disponibile (scope userinfo.email o proprietà AUTO_EMAIL)');
  var righe = items.map(function (x) { return '• ' + x.etichetta + ': ' + autoQuando_(x) + (x.importo ? ' · ' + x.importo + ' €' : '') + (x.note ? '\n   ' + x.note : ''); });
  var html = '<div style="font-family:sans-serif;font-size:14px"><p><b>' + AUTO_VEICOLO.modello + '</b> — promemoria dall\'app Finanza</p><ul>' +
    items.map(function (x) { return '<li><b>' + x.etichetta + '</b>: ' + autoQuando_(x) + (x.importo ? ' · ' + x.importo + ' €' : '') + (x.note ? '<br><span style="color:#666">' + x.note + '</span>' : '') + '</li>'; }).join('') + '</ul></div>';
  var subj = 'Auto · ' + (items.length === 1 ? items[0].etichetta + ' ' + autoQuando_(items[0]) : items.length + ' promemoria');
  MailApp.sendEmail({ to: to, subject: subj, body: AUTO_VEICOLO.modello + ' — promemoria dall\'app Finanza\n\n' + righe.join('\n') + '\n', htmlBody: html });
  return { n: items.length };
}
/* Un evento per chiave sul calendario principale, tutto il giorno, con
   popup 7 giorni prima e il giorno prima alle 9. Se la data cambia (bollo
   pagato e rinnovato) l'evento si SPOSTA: niente doppioni da cancellare. */
function autoSincronizzaCalendar_(lista) {
  var props = PropertiesService.getScriptProperties();
  var mappa = {}; try { mappa = JSON.parse(props.getProperty('AUTO_CAL') || '{}') || {}; } catch (e) { mappa = {}; }
  var cal = CalendarApp.getDefaultCalendar(), n = 0, creati = 0, spostati = 0;
  lista.forEach(function (x) {
    if (!x.data || x.giorni == null || x.giorni < 0) return;
    var titolo = 'Auto · ' + x.etichetta;
    var desc = (x.importo ? 'Importo previsto: ' + x.importo + ' €\n' : '') + (x.note ? x.note + '\n' : '') + 'Creato dall\'app Finanza (modulo Auto).';
    var firma = titolo + '|' + desc, rec = mappa[x.chiave], ev = null;
    if (rec && rec.id) { try { ev = cal.getEventById(rec.id); } catch (e) { ev = null; } }
    var d = autoD_(x.data);
    if (!ev) { ev = cal.createAllDayEvent(titolo, d, { description: desc }); creati++; rec = null; }
    else if (rec.data !== x.data) { ev.setAllDayDate(d); spostati++; }
    if (!rec || rec.firma !== firma || rec.data !== x.data) {
      ev.setTitle(titolo); ev.setDescription(desc);
      try { ev.removeAllReminders(); ev.addPopupReminder(9540); ev.addPopupReminder(900); } catch (e) {}
    }
    mappa[x.chiave] = { id: ev.getId(), data: x.data, firma: firma };
    n++;
  });
  props.setProperty('AUTO_CAL', JSON.stringify(mappa));
  return { n: n, creati: creati, spostati: spostati };
}
/* Gira ogni mattina (installaTriggerAuto). Con { prova: true } (pulsante
   "Controlla ora") manda il riepilogo di tutto quello che scade entro 60
   giorni senza consumare le soglie vere. */
function autoControlloScadenze(opz) {
  var prova = !!(opz && opz.prova === true);
  var esito = { ok: true, email: null, calendar: null, errori: [] };
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID), d = autoDati_(ss), oggi = autoOggi_();
    var lista = autoElencoAvvisi_(d, oggi);
    var props = PropertiesService.getScriptProperties();
    var inviati = {}; try { inviati = JSON.parse(props.getProperty('AUTO_AVVISI') || '{}') || {}; } catch (e) { inviati = {}; }
    var daAvvisare = [];
    lista.forEach(function (x) {
      if (prova) { if ((x.giorni != null && x.giorni <= 60 && x.giorni >= -30) || (x.residuoKm != null && x.residuoKm <= 1000)) daAvvisare.push(x); return; }
      var s = autoSoglia_(x); if (s === null) return;
      var k = x.chiave + '|' + (x.data || x.kmScad) + '|' + s;
      if (inviati[k]) return;
      daAvvisare.push(x); inviati[k] = oggi;
    });
    if (daAvvisare.length) { try { esito.email = autoInviaEmail_(daAvvisare); } catch (e) { esito.errori.push('email: ' + (e && e.message ? e.message : e)); } }
    else esito.email = { n: 0 };
    try { esito.calendar = autoSincronizzaCalendar_(lista); } catch (e) { esito.errori.push('calendar: ' + (e && e.message ? e.message : e)); }
    // le soglie piu' vecchie di un anno non servono piu'
    var lim = autoPiuMesi_(oggi, -13);
    for (var k in inviati) if (inviati.hasOwnProperty(k) && inviati[k] < lim) delete inviati[k];
    if (!prova) props.setProperty('AUTO_AVVISI', JSON.stringify(inviati));
    props.setProperty('AUTO_ULTIMO_CONTROLLO', JSON.stringify({ ts: new Date().toISOString(), email: esito.email ? esito.email.n : 0, eventi: esito.calendar ? esito.calendar.n : 0, errori: esito.errori, prova: prova }));
    cacheClear_();
    if (esito.errori.length) esito.error = 'Controllo fatto con errori — ' + esito.errori.join(' · ') + '. Vedi AUTO.md, "Attivare i promemoria".';
    return esito;
  } catch (e) {
    return err_(e, 'autoControlloScadenze');
  }
}
/* Da eseguire UNA volta (dall'editor o dal pulsante dell'app): crea il
   controllo giornaliero alle 7, i trigger della cache (installaTriggerCache)
   e lancia subito il primo controllo. */
function installaTriggerAuto() {
  try {
    var tr = ScriptApp.getProjectTriggers();
    for (var i = 0; i < tr.length; i++) if (tr[i].getHandlerFunction() === 'autoControlloScadenze') ScriptApp.deleteTrigger(tr[i]);
    ScriptApp.newTrigger('autoControlloScadenze').timeBased().everyDays(1).atHour(7).create();
    PropertiesService.getScriptProperties().setProperty('AUTO_TRIGGER', new Date().toISOString());
    var cache = installaTriggerCache();
    if (cache && cache.error) return { error: 'Promemoria attivati, ma i trigger della cache no: ' + cache.error };
    var primo = autoControlloScadenze();
    Logger.log('Trigger creati. Primo controllo: ' + JSON.stringify(primo));
    if (primo && primo.error) return { error: 'Trigger creato, ma il primo controllo ha dato errore: ' + primo.error };
    return { ok: true, primo: primo, email: primo.email, calendar: primo.calendar };
  } catch (e) {
    return err_(e, 'installaTriggerAuto');
  }
}

/* ================================================================
 * IA — PONTE VERSO IL MODELLO
 * ================================================================
 *
 * COSA FA E COSA NON FA. Qui NON si risponde a niente: si traduce una
 * conversazione in forma neutra nel formato del provider, si spedisce e si
 * riporta indietro la risposta normalizzata. Gli STRUMENTI non vengono
 * eseguiti qui: le chiamate tornano al browser, che li esegue sul payload
 * gia' caricato (`finEsegui` in Finanze.html) e rimanda i risultati.
 * Motivo: i dati non devono fare un giro in piu' fuori dal foglio, e i
 * numeri li deve calcolare chi ha gia' le regole in mano.
 *
 * ── SENZA PAGAMENTO ─────────────────────────────────────────────────────
 * La strada gratuita e' 'gemini': una chiave da Google AI Studio
 * (aistudio.google.com/apikey), piano gratuito, nessuna carta. Il tetto e'
 * al MINUTO, non al mese: un giro agentico consuma una richiesta per ogni
 * dato consultato, quindi il 429 e' una coda, non un guasto — si aspetta il
 * tempo che dice il provider e si riprova (iaFetch_).
 * Restano possibili 'vertex' (account Google Cloud) e 'anthropic' (chiave
 * Claude), a chiave propria.
 * SENZA NESSUNA CHIAVE l'app funziona lo stesso: risponde e registra le
 * spese il motore locale (finRispondi / finInterpreta in Finanze.html), che
 * non passa di qui.
 *
 * ── IL MODELLO NON E' MAI FISSO NEL CODICE ──────────────────────────────
 * I nomi dei modelli cambiano e vengono ritirati: inciderne uno vuol dire
 * rompersi da soli. Si scopre l'elenco vero dell'account, si ordina per
 * classe/versione/stabilita' e si mette in cache 12 ore; se durante una
 * domanda il modello risulta sparito si riscopre, si riprova una volta e lo
 * si DICE.
 *
 * Prerequisito una volta sola: eseguire testIA() dall'editor per autorizzare
 * lo scope script.external_request (e cloud-platform, se si usa Vertex).
 */
var IA_CFG = {
  MAX_TOKENS: 8000,
  CACHE_ORE: 12,
  /* SI PARTE DAL PIU' INTELLIGENTE. Non e' un'opinione sul modello: e'
     che la scelta giusta non si puo' sapere da qui. Il piano gratuito di
     Google cambia (a maggio 2026 i Pro sono passati dietro la fatturazione,
     e domani potrebbero tornare), e incidere un nome nel codice vuol dire
     avere ragione oggi e torto fra sei mesi.
     Quindi si CHIEDE: si prova il migliore e, se la chiave non lo concede,
     si scende di un gradino e lo si dice (iaScendi_). */
  PREFERENZA_DEF: 'massima',
  GEMINI_BASE: 'https://generativelanguage.googleapis.com/v1beta',
  VERTEX_LOCATION_DEF: 'europe-west1',
  ANTHROPIC_URL: 'https://api.anthropic.com/v1/messages',
  ANTHROPIC_MODELS_URL: 'https://api.anthropic.com/v1/models?limit=100',
  ANTHROPIC_VERSION: '2023-06-01',
  // Attese su 429: limitate nel singolo passo e nel totale, perche' Apps
  // Script chiude l'esecuzione a 6 minuti.
  RETRY_429: 2,
  RETRY_MS_DEF: 20000,
  RETRY_MS_MAX: 45000,
  RETRY_MS_TOT: 75000,
  // Quanti gradini si puo' scendere in una sola domanda prima di arrendersi.
  GRADINI_MAX: 2
};

function iaProp_(nome, dflt) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(nome);
    return v && String(v).trim() ? String(v).trim() : dflt;
  } catch (e) { return dflt; }
}
function iaSetProp_(nome, valore) {
  try {
    var p = PropertiesService.getScriptProperties();
    if (valore === null || valore === undefined || valore === '') p.deleteProperty(nome);
    else p.setProperty(nome, String(valore));
  } catch (e) {}
}

/* Provider attivo: esplicito con IA_PROVIDER, altrimenti dedotto da cio' che
   e' configurato. L'ordine mette per primo il gratuito: se c'e' una chiave
   Gemini si usa quella. */
function iaProvider_() {
  var p = up_(iaProp_('IA_PROVIDER', ''));
  if (p === 'GEMINI' || p === 'VERTEX' || p === 'ANTHROPIC') return p.toLowerCase();
  if (iaProp_('GEMINI_API_KEY', '')) return 'gemini';
  if (iaProp_('VERTEX_PROJECT', '')) return 'vertex';
  if (iaProp_('ANTHROPIC_API_KEY', '')) return 'anthropic';
  return '';
}
function iaPropModello_(prov) {
  return prov === 'gemini' ? 'GEMINI_MODEL' : prov === 'vertex' ? 'VERTEX_MODEL' : 'ANTHROPIC_MODEL';
}
function iaPreferenza_() { return String(iaProp_('IA_PREFERENZA', IA_CFG.PREFERENZA_DEF)).toLowerCase(); }

/* ---- Scoperta e scelta del modello ---- */

// Non servono a una chat con strumenti: immagini, voce, embedding, video.
var IA_ESCLUDI = /(embed|aqa|imagen|veo|tts|image|audio|live|learnlm|gemma|vision|nano|guard|edit)/i;

/** Scompone il nome di un modello per poterlo ordinare senza conoscerlo prima. */
function iaAnalizzaModello_(id) {
  var s = String(id || '').toLowerCase();
  var mv = s.match(/(?:gemini|claude)[-_]?(?:(opus|sonnet|haiku)[-_])?(\d+)(?:[.\-](\d+))?/);
  var versione = mv ? parseFloat(mv[2] + '.' + (mv[3] || 0)) : 0;
  var classe = /flash[-_]?lite/.test(s) ? 'flash-lite'
    : /flash/.test(s) ? 'flash'
    : /pro/.test(s) ? 'pro'
    : /opus/.test(s) ? 'pro'
    : /sonnet/.test(s) ? 'flash'
    : /haiku/.test(s) ? 'flash-lite'
    : 'altro';
  var preview = /(preview|exp|experimental|\brc\b|beta|thinking)/.test(s);
  var datato = /[-_]\d{6,8}$/.test(s);
  var alias = /latest/.test(s);
  return { id: id, versione: versione, classe: classe, preview: preview, datato: datato,
    stabile: !preview && !datato, alias: alias };
}

/** Punteggio: prima la classe chiesta, poi la versione piu' alta, poi la stabilita'. */
function iaPunteggio_(a, preferenza) {
  var p = 0;
  /* "massima" non e' una classe: e' l'ordine naturale delle classi, dal piu'
     capace al piu' economico. Le altre preferenze inchiodano una classe
     sola; questa le mette in fila. */
  if (preferenza === 'massima') {
    /* Prima la GENERAZIONE, poi la classe. Un Pro di due generazioni fa non
       e' piu' intelligente di un Flash attuale — e sceglierlo costerebbe
       anche un gradino sprecato prima di arrivare a uno che la chiave
       concede. Quindi la versione pesa piu' della classe, e la classe
       decide dentro la stessa generazione. */
    p += a.versione * 900;
    p += (a.classe === 'pro' ? 300 : a.classe === 'flash' ? 200 : a.classe === 'flash-lite' ? 100 : 0);
  } else if (a.classe === preferenza) p += 4000;
  p += a.versione * 100;
  if (a.stabile) p += 50;
  if (a.alias) p += 20;
  if (a.preview) p -= 40;
  if (a.datato) p -= 10;
  p += (a.classe === 'pro' ? 3 : a.classe === 'flash' ? 2 : a.classe === 'flash-lite' ? 1 : 0);
  return p;
}

/** Elenco grezzo dei modelli utilizzabili sull'account, per provider. */
function iaListaModelli_(prov) {
  try {
    if (prov === 'gemini') {
      var key = iaProp_('GEMINI_API_KEY', '');
      if (!key) return { error: 'GEMINI_API_KEY non impostata.' };
      var r = UrlFetchApp.fetch(IA_CFG.GEMINI_BASE + '/models?pageSize=200&key=' + encodeURIComponent(key), { muteHttpExceptions: true });
      if (r.getResponseCode() !== 200) return { error: 'HTTP ' + r.getResponseCode() + ' — ' + iaErr_(r.getContentText()) };
      var j = JSON.parse(r.getContentText()), out = [];
      for (var i = 0; i < (j.models || []).length; i++) {
        var m = j.models[i];
        if ((m.supportedGenerationMethods || []).indexOf('generateContent') < 0) continue;
        out.push(String(m.name).replace('models/', ''));
      }
      return { modelli: out };
    }
    if (prov === 'vertex') {
      var proj = iaProp_('VERTEX_PROJECT', ''), loc = iaProp_('VERTEX_LOCATION', IA_CFG.VERTEX_LOCATION_DEF);
      if (!proj) return { error: 'VERTEX_PROJECT non impostato.' };
      var url = 'https://' + loc + '-aiplatform.googleapis.com/v1/publishers/google/models?pageSize=200';
      var r2 = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
      if (r2.getResponseCode() !== 200) {
        return { error: 'HTTP ' + r2.getResponseCode() + ' — ' + iaErr_(r2.getContentText()),
          nota: 'Se l\'elenco non e\' accessibile, il modello si puo\' indicare a mano nel pannello della pagina IA.' };
      }
      var j2 = JSON.parse(r2.getContentText());
      var lista = j2.publisherModels || j2.models || [], out2 = [];
      for (var k = 0; k < lista.length; k++) {
        var nome = String(lista[k].name || lista[k].versionId || '');
        var id = nome.indexOf('models/') >= 0 ? nome.split('models/')[1] : nome;
        if (id) out2.push(id);
      }
      return { modelli: out2 };
    }
    var k2 = iaProp_('ANTHROPIC_API_KEY', '');
    if (!k2) return { error: 'ANTHROPIC_API_KEY non impostata.' };
    var r3 = UrlFetchApp.fetch(IA_CFG.ANTHROPIC_MODELS_URL, { muteHttpExceptions: true,
      headers: { 'x-api-key': k2, 'anthropic-version': IA_CFG.ANTHROPIC_VERSION } });
    if (r3.getResponseCode() !== 200) return { error: 'HTTP ' + r3.getResponseCode() + ' — ' + iaErr_(r3.getContentText()) };
    var j3 = JSON.parse(r3.getContentText()), out3 = [];
    for (var q = 0; q < (j3.data || []).length; q++) out3.push(j3.data[q].id);
    return { modelli: out3 };
  } catch (e) {
    return { error: iaErrEccezione_(e) };
  }
}

/** Modelli utilizzabili, ordinati dal migliore secondo la preferenza. */
function iaModelliOrdinati_(prov) {
  var l = iaListaModelli_(prov);
  if (l.error) return l;
  var pref = iaPreferenza_(), an = [];
  for (var i = 0; i < l.modelli.length; i++) {
    var id = l.modelli[i];
    if (IA_ESCLUDI.test(id)) continue;
    var a = iaAnalizzaModello_(id);
    if (!a.versione) continue;              // nomi che non sappiamo ordinare: fuori
    a.punteggio = iaPunteggio_(a, pref);
    an.push(a);
  }
  an.sort(function (x, y) { return y.punteggio - x.punteggio; });
  return { modelli: an, preferenza: pref };
}

function iaAnnota_(testo) {
  iaSetProp_('IA_MODELLO_NOTA', testo);
  iaSetProp_('IA_MODELLO_NOTA_TS', new Date().toISOString());
}

/** Sceglie (e mette in cache) il modello automatico. forza = ignora la cache. */
function iaScegliAuto_(prov, forza) {
  var kMod = 'IA_MODELLO_AUTO_' + up_(prov), kTs = kMod + '_TS';
  if (!forza) {
    var cached = iaProp_(kMod, ''), ts = iaProp_(kTs, '');
    if (cached && ts && (new Date() - new Date(ts)) < IA_CFG.CACHE_ORE * 3600 * 1000) return cached;
  }
  var ord = iaModelliOrdinati_(prov);
  if (ord.error || !ord.modelli.length) {
    return iaProp_(kMod, '');   // meglio l'ultimo noto che niente
  }
  var scelto = ord.modelli[0].id;
  iaSetProp_(kMod, scelto);
  iaSetProp_(kTs, new Date().toISOString());
  return scelto;
}

/** Modello da usare adesso: quello fissato, altrimenti quello automatico. */
function iaModelloAttivo_(prov, forza) {
  var fisso = iaProp_(iaPropModello_(prov), '');
  if (fisso && !forza) return fisso;
  return iaScegliAuto_(prov, !!forza);
}

/* Il modello non e' compreso in questa chiave: quota finita per LUI (429
   che resta pieno anche dopo le attese) o permesso negato (403, tipico dei
   modelli dietro fatturazione). Non e' un guasto e non e' una coda: e' un
   "non ti spetta", e la risposta giusta e' scendere di un gradino.
   Si guarda il CODICE HTTP, non il testo: i messaggi cambiano lingua e
   forma a ogni aggiornamento del provider. */
function iaNonConcesso_(r) {
  return !!(r && r.error && (r.codice === 429 || r.codice === 403));
}

/** Il modello subito sotto a quello attuale nella classifica. '' se e' l'ultimo. */
function iaScendi_(prov, attuale) {
  var ord = iaModelliOrdinati_(prov);
  if (ord.error || !ord.modelli.length) return '';
  for (var i = 0; i < ord.modelli.length; i++) {
    if (ord.modelli[i].id === attuale) return i + 1 < ord.modelli.length ? ord.modelli[i + 1].id : '';
  }
  // Non e' in classifica (fissato a mano, o sparito): si riparte dal migliore.
  return ord.modelli[0].id;
}

/** Errori che significano "quel modello non esiste piu' / e' stato rinominato". */
function iaModelloMancante_(err) {
  return /404|not found|not_found|does not exist|is not supported|unsupported|deprecat|retired|invalid model|non trovato/i.test(String(err || ''));
}

/** Stato per l'app: nessuna chiamata di rete (viene invocata all'avvio). */
function statoIA() {
  var prov = iaProvider_();
  var motivo = '';
  if (!prov) motivo = 'Nessun modello collegato: l\'assistente risponde e registra le spese con il motore locale. Per collegarlo, chiave gratuita da aistudio.google.com/apikey in Proprieta\' script alla voce GEMINI_API_KEY.';
  else if (prov === 'gemini' && !iaProp_('GEMINI_API_KEY', '')) motivo = 'IA_PROVIDER=gemini ma GEMINI_API_KEY non impostata.';
  else if (prov === 'vertex' && !iaProp_('VERTEX_PROJECT', '')) motivo = 'IA_PROVIDER=vertex ma VERTEX_PROJECT non impostato.';
  else if (prov === 'anthropic' && !iaProp_('ANTHROPIC_API_KEY', '')) motivo = 'IA_PROVIDER=anthropic ma ANTHROPIC_API_KEY non impostata.';
  var fisso = prov ? iaProp_(iaPropModello_(prov), '') : '';
  var auto = prov ? iaProp_('IA_MODELLO_AUTO_' + up_(prov), '') : '';
  return {
    disponibile: !!prov && !motivo,
    provider: prov,
    modello: fisso || auto || '',
    automatico: !fisso,
    preferenza: iaPreferenza_(),
    nota: iaProp_('IA_MODELLO_NOTA', ''),
    gratuito: prov === 'gemini',
    motivo: motivo
  };
}

/** Elenco modelli per il pannello: ordinati, con quello attivo evidenziato. */
function modelliIA() {
  var prov = iaProvider_();
  if (!prov) return { error: 'Nessun modello collegato.' };
  var ord = iaModelliOrdinati_(prov);
  if (ord.error) return { provider: prov, error: ord.error, nota: ord.nota || '' };
  var st = statoIA();
  return {
    provider: prov, preferenza: ord.preferenza, attivo: st.modello, automatico: st.automatico,
    consigliato: ord.modelli.length ? ord.modelli[0].id : '',
    modelli: ord.modelli.map(function (m) {
      return { id: m.id, classe: m.classe, versione: m.versione, stabile: m.stabile, preview: m.preview };
    })
  };
}

/** Fissa il modello (stringa vuota = torna automatico). Valida contro l'elenco vero. */
function impostaModelloIA(modello) {
  var prov = iaProvider_();
  if (!prov) return { error: 'Nessun modello collegato.' };
  var m = String(modello == null ? '' : modello).trim();
  if (!m) {
    iaSetProp_(iaPropModello_(prov), '');
    iaAnnota_('Scelta del modello riportata ad automatica.');
    iaScegliAuto_(prov, true);
    return statoIA();
  }
  var ord = iaModelliOrdinati_(prov);
  if (!ord.error) {
    var ok = false;
    for (var i = 0; i < ord.modelli.length; i++) if (ord.modelli[i].id === m) { ok = true; break; }
    if (!ok) return { error: 'Il modello "' + m + '" non risulta disponibile sull\'account.' };
  }
  iaSetProp_(iaPropModello_(prov), m);
  iaAnnota_('Modello fissato a "' + m + '".');
  return statoIA();
}

/** Preferenza di classe: 'pro' (qualita'), 'flash' (equilibrio), 'flash-lite' (economia). */
function impostaPreferenzaIA(preferenza) {
  var p = String(preferenza || '').toLowerCase();
  if (['massima', 'pro', 'flash', 'flash-lite'].indexOf(p) < 0) return { error: 'Preferenza non valida.' };
  iaSetProp_('IA_PREFERENZA', p);
  var prov = iaProvider_();
  if (prov) { iaSetProp_(iaPropModello_(prov), ''); iaScegliAuto_(prov, true); }
  iaAnnota_('Preferenza modello: ' + p + ' (scelta tornata automatica).');
  return statoIA();
}

/* ── L'AUTORIZZAZIONE MANCA, NON LA CHIAVE ──────────────────────────────
   UrlFetchApp.fetch senza lo scope script.external_request non fa una
   richiesta che fallisce: SOLLEVA un'eccezione, prima ancora di uscire.
   Il nostro try/catch la trasformava nella riga inglese di Google
   ("You do not have permission to call UrlFetchApp.fetch"), che accanto a
   "GEMINI_API_KEY" letta e provider "gemini" fa pensare a una chiave
   sbagliata o al provider giu'. Non e' ne' l'una ne' l'altro: e' una
   casella da spuntare una volta sola.
   Il caso e' proprio quello in cui il progetto era gia' autorizzato PRIMA
   che il codice uscisse in rete: la schermata di consenso non ricompare da
   sola se il manifest elenca gli scope a mano. */
var IA_SCOPE_RIMEDIO =
  'Manca l\'autorizzazione a uscire in rete (scope script.external_request): la chiave e\' a posto, ' +
  'e\' il progetto che non ha il permesso. Rimedio, una volta sola: Impostazioni progetto → spunta ' +
  '"Mostra il file manifest appsscript.json nell\'editor" → apri appsscript.json → aggiungi ' +
  '"https://www.googleapis.com/auth/script.external_request" all\'elenco "oauthScopes" (creandolo se non c\'e\', ' +
  'insieme a "https://www.googleapis.com/auth/spreadsheets") → salva → esegui di nuovo testIA() e accetta la ' +
  'schermata di consenso (Rivedi autorizzazioni → il tuo account → Avanzate → Vai a … → Consenti).';

function iaScopeMancante_(msg) {
  return /script\.external_request|permission to call UrlFetchApp/i.test(String(msg || ''));
}

/** Eccezione di rete -> messaggio in italiano con il rimedio, quando si sa qual e'. */
function iaErrEccezione_(e) {
  var m = (e && e.message) ? e.message : String(e);
  return iaScopeMancante_(m) ? IA_SCOPE_RIMEDIO + ' (Google dice: ' + m + ')' : m;
}

function iaErr_(txt) {
  try {
    var j = JSON.parse(txt);
    if (j && j.error && j.error.message) return j.error.message;
    if (j && j[0] && j[0].error && j[0].error.message) return j[0].error.message;
  } catch (e) {}
  return String(txt == null ? '' : txt).slice(0, 400);
}

/** Attesa consigliata dal provider su 429: RetryInfo di Google ("17.98s") o header Retry-After. */
function iaAttesa_(res, txt) {
  try {
    var h = res.getAllHeaders ? (res.getAllHeaders() || {}) : {};
    var ra = h['Retry-After'] || h['retry-after'];
    if (ra && !isNaN(Number(ra))) return Math.ceil(Number(ra) * 1000);
  } catch (e) {}
  try {
    var d = ((JSON.parse(txt) || {}).error || {}).details || [];
    for (var i = 0; i < d.length; i++) {
      var s = parseFloat(String(d[i].retryDelay || ''));
      if (s > 0) return Math.ceil(s * 1000);
    }
  } catch (e) {}
  return 0;
}

/* Il 429 e' una coda, non un guasto: sul piano gratuito il tetto e' al minuto
   e un giro agentico consuma una richiesta per ogni dato consultato. Il
   provider dice quanto aspettare, quindi si aspetta QUELLO — mai un'attesa
   inventata: senza indicazione si usa RETRY_MS_DEF. */
function iaFetch_(url, opt) {
  var res = UrlFetchApp.fetch(url, opt), atteso = 0;
  for (var t = 0; t < IA_CFG.RETRY_429 && res.getResponseCode() === 429; t++) {
    var ms = Math.min((iaAttesa_(res, res.getContentText()) || IA_CFG.RETRY_MS_DEF) + 500, IA_CFG.RETRY_MS_MAX);
    if (atteso + ms > IA_CFG.RETRY_MS_TOT) break;
    Utilities.sleep(ms);
    atteso += ms;
    res = UrlFetchApp.fetch(url, opt);
  }
  return res;
}

/** Messaggio leggibile: sul 429 si dice che e' una coda e come toglierla. */
function iaErrHttp_(code, txt) {
  if (code === 429) {
    return 'Limite di richieste al minuto raggiunto: ho aspettato e riprovato, ma e\' ancora pieno. ' +
      'Riprova fra un minuto. E\' il tetto del piano gratuito (una domanda consuma piu\' richieste, ' +
      'una per ogni dato consultato). — ' + iaErr_(txt);
  }
  return 'HTTP ' + code + ' — ' + iaErr_(txt);
}

/* ---- Traduzione della conversazione neutra nei due formati ----
   Forma neutra (dal browser):
     { ruolo:'user',  testo }
     { ruolo:'model', testo, firmaTesto, chiamate:[{id,nome,argomenti,firma}] }
     { ruolo:'tool',  risultati:[{id,nome,contenuto}] }                        */

function iaTestoRisultato_(contenuto) {
  var s;
  try { s = JSON.stringify(contenuto); } catch (e) { s = String(contenuto); }
  return s.length > 40000 ? s.slice(0, 40000) + '…(troncato)' : s;
}

/* --- Anthropic --- */
function iaMsgAnthropic_(messaggi) {
  var out = [];
  for (var i = 0; i < messaggi.length; i++) {
    var m = messaggi[i];
    if (m.ruolo === 'user') { out.push({ role: 'user', content: String(m.testo || '') }); continue; }
    if (m.ruolo === 'model') {
      var c = [];
      if (m.testo) c.push({ type: 'text', text: m.testo });
      for (var k = 0; k < (m.chiamate || []).length; k++) {
        var x = m.chiamate[k];
        c.push({ type: 'tool_use', id: x.id, name: x.nome, input: x.argomenti || {} });
      }
      out.push({ role: 'assistant', content: c.length ? c : [{ type: 'text', text: '...' }] });
      continue;
    }
    var r = [];
    for (var j = 0; j < (m.risultati || []).length; j++) {
      r.push({ type: 'tool_result', tool_use_id: m.risultati[j].id, content: iaTestoRisultato_(m.risultati[j].contenuto) });
    }
    out.push({ role: 'user', content: r });
  }
  return out;
}

function iaChiamaAnthropic_(modello, sistema, messaggi, strumenti) {
  var key = iaProp_('ANTHROPIC_API_KEY', '');
  if (!key) return { error: 'ANTHROPIC_API_KEY non impostata.' };
  var tools = [];
  for (var i = 0; i < (strumenti || []).length; i++) {
    var s = strumenti[i];
    tools.push({ name: s.nome, description: s.descrizione,
      input_schema: s.parametri || { type: 'object', properties: {} } });
  }
  /* CACHE DEL PREFISSO — la voce di spesa piu' grossa, e la piu' inutile.
     A ogni giro dell'anello agentico ripartono identici il prompt di
     sistema, l'indice dei dati e la dichiarazione dei 22 strumenti: da soli
     sono circa 4.700 token, e su una domanda da tre giri si pagano tre
     volte. Marcandoli, si pagano una volta e poi valgono circa un decimo.

     L'ordine in cui il provider costruisce la richiesta e' tools → system →
     messages, quindi il taglio va messo in FONDO agli strumenti e in FONDO
     al sistema: cosi' il pezzo stabile sta tutto prima, e la domanda —
     l'unica cosa che cambia — resta fuori dalla cache.
     Una cache si invalida al primo byte diverso nel prefisso: se un giorno
     qui dentro finisce un'ora o un numero casuale, smette di funzionare
     senza dare errore. Per questo `uso.cacheLetti` viaggia fino a schermo. */
  if (tools.length) tools[tools.length - 1].cache_control = { type: 'ephemeral' };
  var body = {
    model: modello,
    max_tokens: IA_CFG.MAX_TOKENS,
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: iaMsgAnthropic_(messaggi)
  };
  if (tools.length) body.tools = tools;

  var res = iaFetch_(IA_CFG.ANTHROPIC_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': IA_CFG.ANTHROPIC_VERSION },
    payload: JSON.stringify(body)
  });
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code !== 200) return { error: iaErrHttp_(code, txt), codice: code };
  var j = JSON.parse(txt);
  // Un rifiuto arriva con HTTP 200: va letto stop_reason prima del contenuto.
  if (j.stop_reason === 'refusal') return { error: 'Richiesta rifiutata dal modello.' };
  var out = { testo: '', chiamate: [], modello: j.model || modello, provider: 'anthropic' };
  for (var b = 0; b < (j.content || []).length; b++) {
    var blk = j.content[b];
    if (blk.type === 'text') out.testo += blk.text;
    else if (blk.type === 'tool_use') out.chiamate.push({ id: blk.id, nome: blk.name, argomenti: blk.input || {} });
  }
  if (j.usage) out.uso = { input: j.usage.input_tokens, output: j.usage.output_tokens,
    cacheLetti: j.usage.cache_read_input_tokens || 0, cacheScritti: j.usage.cache_creation_input_tokens || 0 };
  return out;
}

/* --- Gemini (chiave gratuita) e Vertex AI (OAuth): stesso corpo, endpoint e auth diversi --- */
function iaTipoGemini_(t) {
  var m = { object: 'OBJECT', string: 'STRING', number: 'NUMBER', integer: 'INTEGER', boolean: 'BOOLEAN', array: 'ARRAY' };
  return m[String(t || 'string').toLowerCase()] || 'STRING';
}
// Lo schema neutro (JSON Schema minimale) diventa lo Schema di Gemini: tipi in
// MAIUSCOLO, niente parole chiave non supportate.
function iaSchemaGemini_(s) {
  if (!s || typeof s !== 'object') return null;
  var o = { type: iaTipoGemini_(s.type) };
  if (s.description) o.description = s.description;
  if (s['enum']) o['enum'] = s['enum'];
  if (s.properties) {
    o.properties = {};
    for (var k in s.properties) o.properties[k] = iaSchemaGemini_(s.properties[k]);
  }
  if (s.items) o.items = iaSchemaGemini_(s.items);
  if (s.required && s.required.length) o.required = s.required;
  return o;
}
function iaMsgGemini_(messaggi) {
  var out = [];
  for (var i = 0; i < messaggi.length; i++) {
    var m = messaggi[i];
    if (m.ruolo === 'user') { out.push({ role: 'user', parts: [{ text: String(m.testo || '') }] }); continue; }
    if (m.ruolo === 'model') {
      var p = [];
      /* La firma del pensiero (thoughtSignature) torna indietro ESATTAMENTE
         come e' arrivata: sulle parti functionCall e' obbligatoria — senza,
         i modelli che ragionano rispondono HTTP 400 e la chat si ferma al
         secondo strumento. E' un blob opaco: non si tocca, non si rigenera. */
      if (m.testo) {
        var tp = { text: m.testo };
        if (m.firmaTesto) tp.thoughtSignature = m.firmaTesto;
        p.push(tp);
      }
      for (var k = 0; k < (m.chiamate || []).length; k++) {
        var fp = { functionCall: { name: m.chiamate[k].nome, args: m.chiamate[k].argomenti || {} } };
        if (m.chiamate[k].firma) fp.thoughtSignature = m.chiamate[k].firma;
        p.push(fp);
      }
      out.push({ role: 'model', parts: p.length ? p : [{ text: '...' }] });
      continue;
    }
    // I functionResponse viaggiano in un turno di ruolo "user" (formato corrente).
    var r = [];
    for (var j = 0; j < (m.risultati || []).length; j++) {
      r.push({ functionResponse: { name: m.risultati[j].nome, response: { name: m.risultati[j].nome, content: m.risultati[j].contenuto } } });
    }
    out.push({ role: 'user', parts: r });
  }
  return out;
}

function iaChiamaGemini_(modello, sistema, messaggi, strumenti, vertex) {
  var url, opt = { method: 'post', contentType: 'application/json', muteHttpExceptions: true };
  if (vertex) {
    var proj = iaProp_('VERTEX_PROJECT', ''), loc = iaProp_('VERTEX_LOCATION', IA_CFG.VERTEX_LOCATION_DEF);
    if (!proj) return { error: 'VERTEX_PROJECT non impostato.' };
    url = 'https://' + loc + '-aiplatform.googleapis.com/v1/projects/' + proj + '/locations/' + loc +
      '/publishers/google/models/' + modello + ':generateContent';
    opt.headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  } else {
    var key = iaProp_('GEMINI_API_KEY', '');
    if (!key) return { error: 'GEMINI_API_KEY non impostata.' };
    url = IA_CFG.GEMINI_BASE + '/models/' + modello + ':generateContent?key=' + encodeURIComponent(key);
  }

  var decl = [];
  for (var i = 0; i < (strumenti || []).length; i++) {
    var s = strumenti[i], d = { name: s.nome, description: s.descrizione };
    var sch = s.parametri ? iaSchemaGemini_(s.parametri) : null;
    if (sch && sch.properties && Object.keys(sch.properties).length) d.parameters = sch;
    decl.push(d);
  }
  /* Qui la cache del prefisso e' IMPLICITA: il provider la applica da solo
     quando l'inizio della richiesta e' identico a quello di poco prima.
     Non c'e' niente da marcare — c'e' una cosa da non rompere: il prefisso
     (istruzione di sistema, indice, dichiarazione degli strumenti) e'
     costruito in modo deterministico e va tenuto cosi'. Un timestamp o una
     chiave di oggetto che cambia ordine la spegne in silenzio, e l'unico
     modo di accorgersene e' guardare `uso.cacheLetti`. */
  var body = {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: iaMsgGemini_(messaggi),
    generationConfig: { maxOutputTokens: IA_CFG.MAX_TOKENS, temperature: 0.2 }
  };
  if (decl.length) body.tools = [{ functionDeclarations: decl }];

  opt.payload = JSON.stringify(body);
  var res = iaFetch_(url, opt);
  var code = res.getResponseCode(), txt = res.getContentText();
  if (code !== 200) return { error: iaErrHttp_(code, txt), codice: code };
  var j = JSON.parse(txt);
  var cand = (j.candidates || [])[0];
  if (!cand) {
    var br = j.promptFeedback && j.promptFeedback.blockReason;
    return { error: br ? 'Richiesta bloccata dai filtri (' + br + ').' : 'Risposta vuota dal modello.' };
  }
  var out = { testo: '', chiamate: [], modello: modello, provider: vertex ? 'vertex' : 'gemini' };
  var parts = (cand.content && cand.content.parts) || [];
  for (var p = 0; p < parts.length; p++) {
    var pt = parts[p];
    if (pt.functionCall) {
      /* Gemini non assegna un id alla chiamata: se ne crea uno stabile per
         l'accoppiamento con il risultato. Nelle chiamate in parallelo il
         modello firma SOLO la prima: la firma si conserva dove c'e' e non si
         copia sulle altre. */
      out.chiamate.push({ id: pt.functionCall.name + '#' + p, nome: pt.functionCall.name,
        argomenti: pt.functionCall.args || {}, firma: pt.thoughtSignature || '' });
      continue;
    }
    // Le parti marcate "thought" sono ragionamento, non risposta: non si
    // mostrano, ma la loro firma va comunque restituita.
    if (pt.text && !pt.thought) out.testo += pt.text;
    if (pt.thoughtSignature && !out.firmaTesto) out.firmaTesto = pt.thoughtSignature;
  }
  if (!out.testo && !out.chiamate.length) {
    out.error = 'Nessun contenuto (finishReason: ' + (cand.finishReason || '?') + ').';
  }
  if (j.usageMetadata) out.uso = { input: j.usageMetadata.promptTokenCount,
    output: j.usageMetadata.candidatesTokenCount,
    cacheLetti: j.usageMetadata.cachedContentTokenCount || 0, cacheScritti: 0 };
  return out;
}

function iaEsegui_(prov, modello, sistema, messaggi, strumenti) {
  if (!modello) return { error: 'Nessun modello disponibile sull\'account per il provider ' + prov + '.' };
  if (prov === 'anthropic') return iaChiamaAnthropic_(modello, sistema, messaggi, strumenti);
  return iaChiamaGemini_(modello, sistema, messaggi, strumenti, prov === 'vertex');
}

/**
 * Ponte verso il modello. payload = { sistema, indice, messaggi, strumenti }.
 * Ritorna { testo, chiamate:[{id,nome,argomenti,firma}], provider, modello, uso }
 * oppure { error }. Gli strumenti NON vengono eseguiti qui.
 * Se il modello in uso e' stato ritirato, si rifa' la scoperta e si riprova una volta.
 */
function chiediIA(payload) {
  try {
    var st = statoIA();
    if (!st.disponibile) return { error: st.motivo || 'Modello IA non collegato.' };
    if (!payload || !payload.messaggi || !payload.messaggi.length) return { error: 'Conversazione vuota.' };

    var sistema = String(payload.sistema || '');
    if (payload.indice) sistema += '\n\nINDICE DEI DATI DELL\'APP (JSON) — dice cosa esiste e con quale nome; i numeri di dettaglio si chiedono con gli strumenti.\n' + JSON.stringify(payload.indice);

    var prov = st.provider;
    var modello = iaModelloAttivo_(prov, false);
    /* Nessun modello in mano: la causa vera sta nella scoperta, non qui.
       Riportare la conseguenza ("Nessun modello disponibile per il provider
       gemini") manda a cercare una chiave sbagliata mentre il problema e' un
       permesso mancante. Si paga una richiesta in piu' solo in un caso che e'
       gia' rotto. */
    if (!modello) {
      var perche = iaListaModelli_(prov);
      if (perche.error) return { error: perche.error, provider: prov };
    }
    var r = iaEsegui_(prov, modello, sistema, payload.messaggi, payload.strumenti);

    /* IL GRADINO. Si parte dal piu' intelligente; se la chiave non lo
       concede si scende, si riprova, e si DICE con quale si e' finito —
       altrimenti uno crede di parlare con il modello grosso e non e' vero.
       Il modello che funziona resta in cache: il tentativo a vuoto si paga
       una volta ogni 12 ore, ed e' anche il modo in cui l'app si accorge da
       sola quando un modello piu' capace diventa disponibile. */
    var gradini = 0;
    while (iaNonConcesso_(r) && gradini < IA_CFG.GRADINI_MAX) {
      var sotto = iaScendi_(prov, modello);
      if (!sotto || sotto === modello) break;
      gradini++;
      var salito = modello;
      modello = sotto;
      iaSetProp_('IA_MODELLO_AUTO_' + up_(prov), modello);
      iaSetProp_('IA_MODELLO_AUTO_' + up_(prov) + '_TS', new Date().toISOString());
      iaAnnota_('"' + salito + '" non e\' compreso in questa chiave: sono sceso a "' + modello + '".');
      r = iaEsegui_(prov, modello, sistema, payload.messaggi, payload.strumenti);
      if (!r.error) r.nota = 'Il modello ' + salito + ' non e\' disponibile su questa chiave: sto usando ' + modello + '.';
    }

    // Auto-riparazione: il modello non c'e' piu' -> si riscopre e si riprova.
    if (r.error && iaModelloMancante_(r.error)) {
      var nuovo = iaModelloAttivo_(prov, true);
      if (nuovo && nuovo !== modello) {
        if (iaProp_(iaPropModello_(prov), '') === modello) iaSetProp_(iaPropModello_(prov), '');
        iaAnnota_('Il modello "' + modello + '" non e\' piu\' disponibile: sono passato a "' + nuovo + '".');
        r = iaEsegui_(prov, nuovo, sistema, payload.messaggi, payload.strumenti);
        if (!r.error) r.nota = 'Modello aggiornato automaticamente: ' + modello + ' → ' + nuovo + '.';
      }
    }
    return r;
  } catch (err) {
    if (iaScopeMancante_(err && err.message)) return { error: iaErrEccezione_(err) };
    return err_(err, 'chiediIA');
  }
}

/**
 * Da eseguire una volta dall'editor: autorizza gli scope e prova tutta la
 * catena. Le tre righe di prima non bastavano: dicevano COSA e' successo, non
 * cosa fare. L'ultima riga e' la diagnosi, in italiano, con il rimedio.
 */
function testIA() {
  var st = statoIA();
  Logger.log('STATO: ' + JSON.stringify(st));
  var mod = modelliIA();
  Logger.log('MODELLI DISPONIBILI: ' + JSON.stringify(mod));
  var prova = chiediIA({
    sistema: 'Sei un assistente di prova. Rispondi in italiano, una parola.',
    indice: { prova: true },
    messaggi: [{ ruolo: 'user', testo: 'Rispondi solo con: OK' }],
    strumenti: []
  });
  Logger.log('PROVA: ' + JSON.stringify(prova));

  var d;
  if (!st.disponibile) d = 'DA FARE: ' + st.motivo;
  else if (iaScopeMancante_(mod.error) || iaScopeMancante_(prova.error)) d = 'DA FARE: ' + IA_SCOPE_RIMEDIO;
  else if (mod.error) d = 'DA FARE: l\'elenco dei modelli non arriva — ' + mod.error;
  else if (prova.error) d = 'DA FARE: l\'elenco dei modelli arriva ma la domanda no — ' + prova.error;
  else d = 'TUTTO A POSTO: provider ' + prova.provider + ', modello ' + prova.modello +
    ', risposta "' + String(prova.testo || '').trim() + '". Non serve rifare nulla.';
  Logger.log('DIAGNOSI: ' + d);
  return d;
}
