// Prova dell'assistente MONTATO IN PAGINA (jsdom, senza rete).
//
// PERCHE' ESISTE. smoke_ia.js prova il motore; qui si prova la promessa che
// il motore da solo non puo' mantenere: che dalla chat non parta MAI una
// scrittura sul foglio senza che qualcuno prema il pulsante, e che quello
// che il pulsante scrive sia esattamente quello che era in anteprima —
// anche dopo che i campi sono stati modificati a mano.
//
// Il finto `google.script.run` registra ogni chiamata: se una scrittura
// partisse da sola, qui si vedrebbe.
// Uso: node finanze/smoke_ia_pagina.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, 'Finanze.html'), 'utf8');
const blocchi = [];
{
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m; while ((m = re.exec(html))) if (m[1].trim()) blocchi.push(m[1]);
}
if (blocchi.length !== 2) { console.error('Attesi 2 script inline, trovati ' + blocchi.length); process.exit(2); }

/* L'archivio finto vive nell'anno corrente: l'app mostra i dati dell'anno
   selezionato, e con un anno diverso da oggi si fermerebbe su "nessun
   dato" senza che il test stia provando niente. */
const OGGI = new Date();
const Y = OGGI.getFullYear();
const M = OGGI.getMonth();
const z12 = () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const con = a => { const v = z12(); Object.keys(a).forEach(k => { v[+k] = a[k]; }); return v; };
const PAYLOAD = {
  v: 6, anni: [Y],
  base: {
    [Y]: {
      entrate: z12().map(() => 2000), entrateIn: con({ 0: 2000 }), giorniEnt: z12().map(() => 10),
      necFisso: con({ 0: 1000 }), necVar: con({ 0: 200, 1: 240 }), vitaFisso: z12(), vitaVar: con({ 0: 300 })
    }
  },
  ccStart: { [Y]: 1000 },
  cats: { 'MUTUO CASA': 'necessaria', 'SPESA': 'necessaria', 'VACANZA': 'vita' },
  catTipo: { 'MUTUO CASA': 'FISSA', 'SPESA': 'VARIABILE', 'VACANZA': 'VARIABILE' },
  catBase: {
    'MUTUO CASA': { tipo: 'FISSA', misto: 0, nec: 'necessaria', nelSeme: 1 },
    'SPESA': { tipo: 'VARIABILE', misto: 0, nec: 'necessaria', nelSeme: 1 },
    'VACANZA': { tipo: 'VARIABILE', misto: 0, nec: 'vita', nelSeme: 1 }
  },
  catDict: ['MUTUO CASA', 'SPESA', 'VACANZA'],
  movimenti: [
    [Y, 0, 0, 1000, 0, 1, '', 2, 1, Y + '-01-05'],
    [Y, 0, 1, 200, 0, 0, 'settimanale', 3, 1, Y + '-01-12'],
    [Y, 0, 2, 300, 0, 0, 'acconto', 4, 1, Y + '-01-20'],
    // una da pagare: serve a provare "ho pagato ..." (spuntare, non creare)
    [Y, 1, 1, 240, 0, 0, 'settimanale', 5, 0, Y + '-02-09']
  ],
  catCfg: {}, daDecidere: [], annuale: {}, giornoAccredito: 10,
  diag: { fogli: {}, righe: {}, mancanti: [] }, warn: []
};

function reactPerFinestra(w) {
  global.window = w; global.document = w.document; global.navigator = w.navigator;
  global.requestAnimationFrame = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : (cb => setTimeout(cb, 0));
  global.cancelAnimationFrame = w.cancelAnimationFrame ? w.cancelAnimationFrame.bind(w) : clearTimeout;
  global.MessageChannel = w.MessageChannel;
  Object.keys(require.cache).forEach(k => { if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(k)) delete require.cache[k]; });
  return { React: require('react'), ReactDOM: require('react-dom/client') };
}

/* `copione` = le risposte che il finto modello dara', una per giro.
   `chiamate` raccoglie tutto cio' che l'app ha chiesto al backend: e' li'
   dentro che si vede se e' partita una scrittura. */
function avvia({ statoIA, copione, voce, ritardoIA }) {
  const dom = new JSDOM(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/'
  });
  const w = dom.window;
  const libs = reactPerFinestra(w);
  w.React = libs.React; w.ReactDOM = libs.ReactDOM;
  w.indexedDB = { open: () => ({}) };   // senza cache: si prova la strada viva
  /* jsdom non fa layout e non implementa scrollTo: senza questo tappo
     stampa un "Not implemented" a ogni messaggio e sporca il collaudo. */
  w.scrollTo = () => {};

  /* Microfono finto: non riconosce niente, ma espone gli stessi agganci del
     vero (`start`, `stop`, `onresult`, `onerror`, `onend`), cosi' il ciclo
     che si prova e' quello che gira sul telefono. Senza `voce` la finestra
     resta priva del riconoscimento, che e' il browser che non ce l'ha. */
  /* Sintesi vocale finta: registra cosa avrebbe detto e quante volte e'
     stata zittita. Presente SEMPRE, anche senza `voce`: il parlato non
     dipende dal riconoscimento. */
  w.__parlato = { dette: [], stop: 0 };
  w.SpeechSynthesisUtterance = function (testo) { this.text = testo; this.lang = ""; this.rate = 1; };
  w.speechSynthesis = {
    speak: function (u) { if (u && String(u.text).trim()) w.__parlato.dette.push(u.text); if (u && u.onend) setTimeout(u.onend, 1); },
    cancel: function () { w.__parlato.stop++; }
  };

  if (voce === true) {
    w.__voce = { istanze: [] };
    w.webkitSpeechRecognition = function () {
      const self = this;
      this.lang = ""; this.interimResults = false; this.continuous = true; this.maxAlternatives = 0;
      this.onresult = null; this.onerror = null; this.onend = null;
      this.avviato = false; this.fermato = false;
      this.start = function () { self.avviato = true; };
      this.stop = function () { self.fermato = true; if (self.onend) self.onend(); };
      this.abort = function () { self.fermato = true; };
      w.__voce.istanze.push(this);
    };
  }

  const chiamate = [];
  const richiesteIA = [];
  let giro = 0;
  const run = () => {
    let onOk = null, onKo = null;
    const rispondi = (v) => setTimeout(() => onOk && onOk(v), 5);
    const proxy = {
      withSuccessHandler(f) { onOk = f; return proxy; },
      withFailureHandler(f) { onKo = f; return proxy; },
      getDatiFinanze() { chiamate.push({ f: 'getDatiFinanze' }); rispondi(PAYLOAD); },
      getDatiBollette() { rispondi({ rows: [], fornitori: [], anni: [] }); },
      getDatiRiscaldamento() { rispondi({ rows: [], stanze: [], fornitori: [], anni: [] }); },
      getDatiEntrate() { rispondi({ rows: [], anni: [] }); },
      statoIA() { chiamate.push({ f: 'statoIA' }); rispondi(statoIA || { disponibile: false, motivo: 'nessun modello' }); },
      /* `ritardoIA` serve a provare il pulsante FERMA: con la risposta che
         arriva in 5 ms non esiste un istante in cui premerlo. */
      chiediIA(p) {
        chiamate.push({ f: 'chiediIA' }); richiesteIA.push(p);
        const r = (copione || [])[giro++] || { testo: 'fine' };
        setTimeout(() => onOk && onOk(r), ritardoIA || 5);
      },
      salvaSpesa(p) { chiamate.push({ f: 'salvaSpesa', p: p }); rispondi({ ok: true, row: 42 }); },
      salvaRicorrente(p) { chiamate.push({ f: 'salvaRicorrente', p: p }); rispondi({ ok: true, righe: 6, daRiga: 50 }); },
      /* Le quattro azioni su righe esistenti. `setStatiBulk` risponde come
         il server vero, comprese le righe SALTATE: e' il caso in cui il
         foglio e' cambiato da quando l'app l'ha letto. */
      setStatiBulk(p) { chiamate.push({ f: 'setStatiBulk', p: p }); rispondi({ ok: true, scritte: (p.items || []).length, saltate: [] }); },
      modificaSpesa(p) { chiamate.push({ f: 'modificaSpesa', p: p }); rispondi({ ok: true, row: p.row }); },
      eliminaSpesa(p) { chiamate.push({ f: 'eliminaSpesa', p: p }); rispondi({ ok: true, row: p.row }); },
      salvaCategorie(p) { chiamate.push({ f: 'salvaCategorie', p: p }); rispondi({ ok: true, n: 1 }); }
    };
    return proxy;
  };
  w.google = { script: { get run() { return run(); } } };
  blocchi.forEach(code => { try { w.eval(code); } catch (e) { console.error('EVAL: ' + e.message); } });
  return { w, chiamate, richiesteIA };
}

const attendi = ms => new Promise(r => setTimeout(r, ms));
const testo = w => (w.document.getElementById('root').textContent || '').trim();
const bottoni = w => Array.from(w.document.querySelectorAll('button'));
const clic = (w, txt) => { const b = bottoni(w).find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
/* Un input controllato da React non cambia con `.value = ...`: bisogna
   passare dal setter nativo e poi dire a React che e' successo. */
const scrivi = (w, input, valore) => {
  /* Il prototipo giusto: la barra della chat e' una textarea (cresce col
     testo), i campi delle schede restano input. Usare quello sbagliato non
     da' errore — il setter non e' quello controllato da React e il valore
     semplicemente non arriva, facendo cadere il collaudo altrove. */
  const proto = input.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(input, valore);
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
};
/* Il campo della chat si prende dalla STRUTTURA (l'unico input dentro il
   form), non dal testo del segnaposto: agganciarlo a una frase significa che
   il giorno in cui quella frase cambia il test non fallisce dicendo "il
   segnaposto e' diverso" — smette di scrivere e fa cadere mezzo collaudo
   per il motivo sbagliato. E' successo davvero, aggiungendo il microfono. */
const campoChat = w => w.document.querySelector('form textarea, form input');
const invia = async (w, frase) => {
  const c = campoChat(w);
  if (!c) return false;
  scrivi(w, c, frase);
  await attendi(30);
  const form = c.closest('form');
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await attendi(120);
  return true;
};

const micro = w => Array.from(w.document.querySelectorAll('button'))
  .find(b => /Detta|dettatura/.test(b.getAttribute('aria-label') || ''));
const senti = (r, testo, finale) => r.onresult({ resultIndex: 0, results: [{ 0: { transcript: testo }, isFinal: !!finale }] });

let falliti = 0;
const esito = (nome, ok, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + nome + (extra ? ' — ' + extra : '')); if (!ok) falliti++; };

// "da gennaio a giugno" da' sempre 6 rate, in qualunque giorno si esegua il
// test: senza un periodo esplicito il numero dipenderebbe da oggi.
const FRASE = 'ogni mese 20 euro su vacanza con nota albergo da gennaio a giugno';

(async () => {
  console.log('\n1) La scheda dell\'assistente c\'e\' e si apre');
  {
    const { w, chiamate } = avvia({});
    await attendi(150);
    esito('la voce "Chiedi" e\' nella barra', clic(w, 'Chiedi'));
    await attendi(150);
    const t = testo(w);
    esito('mostra l\'invito e gli esempi', /Chiedi ai tuoi conti/.test(t) && /Cosa devo pagare/.test(t));
    esito('senza modello lo dichiara invece di sembrare rotto', /motore locale/i.test(t));
    esito('ha chiesto lo stato del modello solo aprendo la scheda', chiamate.filter(c => c.f === 'statoIA').length === 1);
    esito('nessuna scrittura solo per aver aperto la scheda', !chiamate.some(c => /salva/.test(c.f)));
  }

  console.log('\n2) Senza modello, il motore locale registra lo stesso');
  {
    const { w, chiamate } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    esito('il campo per scrivere c\'e\'', !!campoChat(w));
    await invia(w, FRASE);
    const t = testo(w);
    esito('capisce la frase e prepara la proposta', /Spesa ricorrente da confermare/.test(t));
    esito('sono 6 rate', /6 righe nel foglio USCITE/.test(t), t.match(/\d+ righe nel foglio USCITE/) ? t.match(/\d+ righe nel foglio USCITE/)[0] : '');
    esito('per 120,00 €', /120,00/.test(t));
    esito('con la nota giusta', /albergo/.test(t));
    esito('e la categoria giusta', /VACANZA/.test(t));
    esito('NESSUNA scrittura: la proposta e\' solo una proposta', !chiamate.some(c => /salva/.test(c.f)),
      chiamate.map(c => c.f).join(','));
    esito('nemmeno una chiamata al modello (non e\' configurato)', !chiamate.some(c => c.f === 'chiediIA'));
  }

  console.log('\n3) La conferma e\' a due passi, e scrive UNA volta sola');
  {
    const { w, chiamate } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, FRASE);
    esito('il pulsante dice quante rate scrive', clic(w, 'Scrivi 6 rate'));
    await attendi(80);
    esito('non scrive al primo tocco: chiede conferma', !chiamate.some(c => /salva/.test(c.f)) && /Confermi\?/.test(testo(w)));
    clic(w, 'Sì, scrivi');
    await attendi(120);
    const scritture = chiamate.filter(c => /salva/.test(c.f));
    esito('adesso ha scritto, una volta sola', scritture.length === 1, scritture.map(s => s.f).join(','));
    esito('ha chiamato salvaRicorrente', scritture.length === 1 && scritture[0].f === 'salvaRicorrente');
    const p = scritture.length ? scritture[0].p : {};
    esito('payload: categoria VACANZA', p.cat === 'VACANZA', String(p.cat));
    esito('payload: importo 20', Math.abs(p.amount - 20) < 0.005, String(p.amount));
    esito('payload: nota albergo', p.note === 'albergo', String(p.note));
    esito('payload: da gennaio a giugno', p.daMese === 0 && p.aMese === 5, p.daMese + '→' + p.aMese);
    esito('payload: pagamento da conto', p.pay === 'conto', String(p.pay));
    esito('la scheda diventa una ricevuta', /Scritte 6 righe/.test(testo(w)));
    esito('e ricarica i dati dal foglio', chiamate.filter(c => c.f === 'getDatiFinanze').length >= 2);
  }

  console.log('\n4) Quello che modifichi e\' quello che viene scritto');
  {
    const { w, chiamate } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, FRASE);
    const importo = Array.from(w.document.querySelectorAll('input')).find(i => i.getAttribute('inputmode') === 'decimal');
    esito('il campo importo si puo\' toccare prima di confermare', !!importo);
    scrivi(w, importo, '35,50');
    await attendi(120);
    const t = testo(w);
    esito('l\'anteprima si rifa\' da sola: 6 × 35,50 = 213,00', /213,00/.test(t), (t.match(/2\d\d,\d\d/) || [])[0]);
    esito('la scheda dice che l\'hai modificata', /modificata/.test(t));
    clic(w, 'Scrivi 6 rate'); await attendi(60);
    clic(w, 'Sì, scrivi'); await attendi(120);
    const scr = chiamate.filter(c => /salva/.test(c.f));
    esito('scrive il valore MODIFICATO, non quello proposto', scr.length === 1 && Math.abs(scr[0].p.amount - 35.5) < 0.005,
      scr.length ? String(scr[0].p.amount) : 'nessuna scrittura');
  }

  console.log('\n5) Una domanda resta una domanda');
  {
    const { w, chiamate } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'quanto ho speso a gennaio?');
    const t = testo(w);
    esito('risponde con i numeri veri', /1500,00/.test(t), (t.match(/1500,00/) || [])[0]);
    esito('e dichiara che il numero l\'ha calcolato lui', /CALCOLATO DAI TUOI DATI/.test(t));
    esito('nessuna scheda di conferma per una domanda', !/da confermare/.test(t));
    esito('nessuna scrittura', !chiamate.some(c => /salva/.test(c.f)));
  }

  console.log('\n6) Con il modello collegato: il ciclo agentico');
  {
    /* Primo giro: il modello chiede un dato (con la firma del pensiero).
       Secondo giro: risponde. Gli strumenti li esegue l'app, in locale. */
    const copione = [
      { chiamate: [{ id: 'c1', nome: 'spese_per_categoria', argomenti: { anno: Y, mese: 0 }, firma: 'FIRMA-OPACA-123' }], testo: '', firmaTesto: 'FT-9' },
      { testo: 'A gennaio hai speso **1500,00 €**, soprattutto per il mutuo.' }
    ];
    const { w, chiamate, richiesteIA } = avvia({ statoIA: { disponibile: true, provider: 'gemini', modello: 'gemini-x-flash' }, copione: copione });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    esito('il modello collegato si vede nell\'intestazione', /Gemini · gemini-x-flash/.test(testo(w)));
    await invia(w, 'come sono andato a gennaio?');
    await attendi(250);
    const t = testo(w);
    esito('ha fatto due giri, non di piu\'', richiesteIA.length === 2, String(richiesteIA.length));
    esito('mostra la risposta del modello', /soprattutto per il mutuo/.test(t));
    esito('il grassetto e\' reso, non lasciato in asterischi', !/\*\*/.test(t));
    esito('dice quali dati ha consultato', /spese_per_categoria/.test(t));

    const secondo = richiesteIA[1] || { messaggi: [] };
    const turnoModello = secondo.messaggi.find(m => m.ruolo === 'model');
    const turnoTool = secondo.messaggi.find(m => m.ruolo === 'tool');
    esito('nel secondo giro torna il turno del modello', !!turnoModello);
    /* La firma del pensiero: se non torna IDENTICA, i modelli che ragionano
       rispondono 400 e la chat si ferma al secondo strumento. */
    esito('la firma della chiamata torna indietro identica',
      !!turnoModello && turnoModello.chiamate[0].firma === 'FIRMA-OPACA-123', turnoModello && turnoModello.chiamate[0].firma);
    esito('e anche quella del testo', !!turnoModello && turnoModello.firmaTesto === 'FT-9');
    esito('il risultato dello strumento e\' stato calcolato in locale',
      !!turnoTool && turnoTool.risultati[0].contenuto && Math.abs(turnoTool.risultati[0].contenuto.totale - 1500) < 0.005,
      turnoTool ? JSON.stringify(turnoTool.risultati[0].contenuto.totale) : 'nessun risultato');
    esito('la richiesta porta prompt, indice e 22 strumenti',
      !!secondo.sistema && !!secondo.indice && secondo.strumenti.length === 22);
    esito('nessuna scrittura durante una consultazione', !chiamate.some(c => /salva/.test(c.f)));
  }

  console.log('\n7) Il modello chiede di registrare: la proposta la disegna l\'app');
  {
    const copione = [
      { chiamate: [{ id: 'c1', nome: 'spesa_ricorrente', argomenti: { importo: 20, categoria: 'VACANZA', nota: 'albergo', daAnno: Y, daMese: 0, aAnno: Y, aMese: 5 } }] },
      { testo: 'Pronta: 6 rate da 20 €. Confermala tu.' }
    ];
    const { w, chiamate, richiesteIA } = avvia({ statoIA: { disponibile: true, provider: 'gemini', modello: 'g' }, copione: copione });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'metti 20 euro di vacanza ogni mese da gennaio a giugno, nota albergo');
    await attendi(300);
    const t = testo(w);
    esito('compare la scheda di conferma', /Spesa ricorrente da confermare/.test(t));
    esito('con le 6 righe vere', /6 righe nel foglio USCITE/.test(t));
    esito('e la frase del modello sotto', /Confermala tu/.test(t));
    esito('ANCORA nessuna scrittura', !chiamate.some(c => /salva/.test(c.f)));
    /* Al modello torna la SINTESI, non le 120 righe ne' il payload pronto
       da scrivere: quello resta nel telefono. */
    const tool = (richiesteIA[1] || { messaggi: [] }).messaggi.find(m => m.ruolo === 'tool');
    const prop = tool && tool.risultati[0].contenuto.proposta;
    esito('al modello va la sintesi della proposta', !!prop && prop.righeDaScrivere === 6, prop ? String(prop.righeDaScrivere) : 'assente');
    esito('senza le righe e senza il payload', !!prop && !prop.righe && !prop.payload);
    esito('ma con le assunzioni e gli avvisi', !!prop && Array.isArray(prop.assunzioni) && Array.isArray(prop.avvisi));
    esito('e il modello sa che non ha scritto niente', tool && tool.risultati[0].contenuto.scritta === false);
  }

  console.log('\n8) Se il modello non risponde, si vede (e il resto continua a funzionare)');
  {
    const { w, chiamate } = avvia({ statoIA: { disponibile: true, provider: 'gemini', modello: 'g' },
      copione: [{ error: 'Limite di richieste al minuto raggiunto: riprova fra un minuto.' }] });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'quanto ho speso a gennaio?');
    await attendi(200);
    const t = testo(w);
    esito('l\'errore del modello e\' scritto in chiaro', /Limite di richieste al minuto/.test(t));
    esito('ma il numero calcolato in locale resta a schermo', /1500,00/.test(t));
    esito('nessuna scrittura', !chiamate.some(c => /salva/.test(c.f)));
  }

  console.log('\n9) Il microfono: parli, scrive, e invia da solo');
  {
    const { w, chiamate } = avvia({ voce: true });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    const m = micro(w);
    esito('il pulsante microfono c\'e\'', !!m);
    m.click();
    await attendi(60);
    const r = w.__voce.istanze[0];
    esito('il riconoscimento e\' partito', !!r && r.avviato);
    esito('ascolta in italiano', r.lang === 'it-IT', r.lang);
    esito('mostra il testo mentre parli', r.interimResults === true);
    esito('una frase per volta, poi invia', r.continuous === false);

    // mentre parli: il testo compare nel campo, gia' con i numeri in cifre
    senti(r, 'ogni mese venti', false);
    await attendi(80);
    esito('il campo segue quello che dici', campoChat(w).value === 'ogni mese 20', '"' + campoChat(w).value + '"');
    esito('e ancora non e\' partito niente', !/da confermare/.test(testo(w)));

    // finito di parlare: parte da solo, senza toccare altro
    senti(r, 'ogni mese venti euro su vacanza con nota albergo da gennaio a giugno', true);
    r.onend();
    await attendi(250);
    const t = testo(w);
    esito('la frase e\' finita in chat come l\'hai detta', /ogni mese 20 euro su vacanza con nota albergo/.test(t));
    esito('ed e\' partita da sola: c\'e\' la proposta', /Spesa ricorrente da confermare/.test(t));
    esito('con le 6 rate giuste', /6 righe nel foglio USCITE/.test(t));
    esito('il campo si e\' svuotato', campoChat(w).value === '', '"' + campoChat(w).value + '"');
    /* La ragione per cui l'invio automatico e' sicuro: dettare non scrive
       niente sul foglio, produce una proposta che resta li'. */
    esito('NESSUNA scrittura: la voce arriva alla proposta, non al foglio', !chiamate.some(c => /salva/.test(c.f)),
      chiamate.map(c => c.f).join(','));
  }

  console.log('\n10) Quando il microfono non si puo\' usare, lo dice');
  {
    const { w, chiamate } = avvia({ voce: true });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    micro(w).click(); await attendi(60);
    const r = w.__voce.istanze[0];
    r.onerror({ error: 'not-allowed' });
    r.onend();
    await attendi(150);
    const t = testo(w);
    esito('spiega che il microfono e\' bloccato', /Microfono bloccato/.test(t));
    esito('e indica la via che funziona sempre (tastiera del telefono)', /tastiera del telefono/.test(t));
    esito('non manda niente in chat', !/da confermare/.test(t));
    esito('nessuna scrittura', !chiamate.some(c => /salva/.test(c.f)));

    /* UN "NO" RICEVUTO VALE PER SEMPRE. Riprovare una strada che il browser
       ha gia' chiuso produce lo stesso errore rosso a ogni tocco, e un
       pulsante che sbaglia sempre insegna a non fidarsi dell'app. Da qui in
       poi il pulsante apre il campo e manda alla tastiera. */
    const m2 = micro(w);
    esito('il pulsante diventa la tastiera', m2.textContent === '⌨', m2.textContent);
    esito('e lo dice anche a chi non vede l\'icona', /tastiera/i.test(m2.getAttribute('title') || ''),
      m2.getAttribute('title'));
    const istanzePrima = w.__voce.istanze.length;
    m2.click(); await attendi(80);
    const t2 = testo(w);
    esito('non riprova il microfono della pagina', w.__voce.istanze.length === istanzePrima,
      istanzePrima + ' → ' + w.__voce.istanze.length);
    esito('indica il microfono della TASTIERA', /microfono della TASTIERA/.test(t2));
    esito('e apre il campo, cosi\' la tastiera sale da sola',
      w.document.activeElement === campoChat(w),
      w.document.activeElement && w.document.activeElement.tagName);
    esito('l\'indicazione non e\' vestita da errore', !/Microfono bloccato/.test(t2));
    esito('nessuna scrittura nemmeno adesso', !chiamate.some(c => /salva/.test(c.f)));
  }

  console.log('\n11) Browser senza riconoscimento vocale: nessun pulsante rotto');
  {
    const { w } = avvia({});   // finestra senza webkitSpeechRecognition
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    const m = micro(w);
    esito('il pulsante c\'e\' lo stesso', !!m);
    m.click(); await attendi(120);
    const t = testo(w);
    esito('e dice che qui il riconoscimento non c\'e\'', /non ha il riconoscimento vocale/.test(t));
    esito('proponendo la tastiera', /tastiera del telefono/.test(t));
  }

  console.log('\n12) "Ho pagato la bolletta": spunta la riga, non ne crea un\'altra');
  {
    const { w, chiamate } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'ho pagato la spesa');
    const t = testo(w);
    esito('capisce che e\' una spesa da spuntare', /da spuntare/.test(t), t.slice(0, 0) || undefined);
    esito('mostra la riga toccata', /RIGA TOCCATA|RIGHE TOCCATE/.test(t));
    esito('e non propone nessuna spesa nuova', !/Spesa da confermare/.test(t));
    esito('ancora nessuna scrittura', !chiamate.some(c => /salva|setStati|modifica|elimina/.test(c.f)));

    clic(w, 'Segna pagate'); await attendi(150);
    const scr = chiamate.filter(c => /salva|setStati|modifica|elimina/.test(c.f));
    esito('il pulsante chiama setStatiBulk, una volta sola', scr.length === 1 && scr[0].f === 'setStatiBulk',
      scr.map(x => x.f).join(','));
    esito('con la riga e il lock (categoria + importo)',
      scr.length === 1 && scr[0].p.items[0].row != null && !!scr[0].p.items[0].cat && scr[0].p.items[0].amount > 0,
      scr.length ? JSON.stringify(scr[0].p.items[0]) : '');
    esito('e paid = 1', scr.length === 1 && scr[0].p.paid === 1);
    esito('la scheda diventa una ricevuta', /riga aggiornata|righe aggiornate/.test(testo(w)));
  }

  console.log('\n13) Eliminare: la conferma e\' doppia, e la riga si vede prima');
  {
    const copione = [
      { chiamate: [{ id: 'c1', nome: 'elimina_spesa', argomenti: { categoria: 'VACANZA' } }] },
      { testo: 'Ecco la riga: confermi tu.' }
    ];
    const { w, chiamate } = avvia({ statoIA: { disponibile: true, provider: 'gemini', modello: 'g' }, copione: copione });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'cancella la spesa della vacanza');
    await attendi(300);
    const t = testo(w);
    esito('compare la scheda di eliminazione', /Elimina la spesa — da confermare/.test(t));
    esito('mostra la riga che sparisce', /RIGA CHE SPARISCE/.test(t));
    esito('e avvisa che non c\'e\' un annulla', /non c'e' un annulla/.test(t));
    esito('nessuna scrittura alla comparsa della scheda', !chiamate.some(c => /elimina/.test(c.f)));

    clic(w, 'Elimina la spesa'); await attendi(100);
    esito('il primo tocco NON elimina: chiede conferma', !chiamate.some(c => /elimina/.test(c.f)) && /Non si torna indietro/.test(testo(w)));
    clic(w, 'No, lascia stare'); await attendi(100);
    esito('e si puo\' tornare indietro', !chiamate.some(c => /elimina/.test(c.f)));

    clic(w, 'Elimina la spesa'); await attendi(100);
    clic(w, 'Sì, elimina'); await attendi(150);
    const el = chiamate.filter(c => c.f === 'eliminaSpesa');
    esito('solo alla seconda conferma elimina', el.length === 1, el.length);
    esito('e manda riga + lock', el.length === 1 && el[0].p.row != null && !!el[0].p.cat, el.length ? JSON.stringify(el[0].p) : '');
  }

  console.log('\n14) Riclassificare una categoria: la mappa viaggia intera');
  {
    const copione = [
      { chiamate: [{ id: 'c1', nome: 'imposta_necessita', argomenti: { categoria: 'VACANZA', necessita: 'necessaria' } }] },
      { testo: 'Pronta.' }
    ];
    const { w, chiamate } = avvia({ statoIA: { disponibile: true, provider: 'gemini', modello: 'g' }, copione: copione });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'la vacanza per me e\' necessaria');
    await attendi(300);
    const t = testo(w);
    esito('compare la scheda di riclassificazione', /Riclassifica la categoria/.test(t));
    esito('mostra da cosa a cosa', /vita/.test(t) && /necessaria/.test(t));
    esito('e dice che non tocca nessuna riga', /nessuna riga viene toccata/.test(t));
    clic(w, 'Riclassifica la categoria'); await attendi(150);
    const sc = chiamate.filter(c => c.f === 'salvaCategorie');
    esito('chiama salvaCategorie', sc.length === 1, sc.length);
    esito('con la categoria dentro la mappa', sc.length === 1 && sc[0].p.categorie['VACANZA'].nec === 'necessaria',
      sc.length ? JSON.stringify(sc[0].p.categorie) : '');
  }

  console.log('\n15) La voce risponde a voce, e sta zitta se hai scritto');
  {
    const { w } = avvia({ voce: true });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);

    // domanda SCRITTA: nessuna lettura
    await invia(w, 'quanto ho speso a gennaio?');
    await attendi(150);
    esito('a una domanda scritta non risponde a voce', w.__parlato.dette.length === 0,
      JSON.stringify(w.__parlato.dette));

    // ma il pulsante "ascolta" c'e'
    esito('sotto la risposta c\'e\' il pulsante ascolta', clic(w, '▸ ascolta'));
    await attendi(80);
    esito('e legge la risposta', w.__parlato.dette.length === 1 && /1500/.test(w.__parlato.dette[0]),
      JSON.stringify(w.__parlato.dette[0] || '').slice(0, 60));
    esito('senza markdown nel parlato', !/\*\*|###|`/.test(w.__parlato.dette[0] || ''));

    // domanda A VOCE: legge da sola
    const prima = w.__parlato.dette.length;
    micro(w).click(); await attendi(60);
    const r = w.__voce.istanze[w.__voce.istanze.length - 1];
    senti(r, 'quanto ho speso a gennaio', true);
    r.onend();
    await attendi(250);
    esito('a una domanda fatta a voce risponde a voce', w.__parlato.dette.length > prima,
      w.__parlato.dette.length + ' letture');
  }

  console.log('\n16) Il microfono zittisce il parlato (non si ascolta da solo)');
  {
    const { w } = avvia({ voce: true });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'quanto ho speso a gennaio?');
    clic(w, '▸ ascolta'); await attendi(80);
    const stopPrima = w.__parlato.stop;
    micro(w).click(); await attendi(80);
    esito('toccando il microfono smette di parlare', w.__parlato.stop > stopPrima,
      stopPrima + ' → ' + w.__parlato.stop);
  }

  console.log('\n17) L\'interruttore della voce');
  {
    const { w } = avvia({ voce: true });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    const alto = () => Array.from(w.document.querySelectorAll('button'))
      .find(b => /risposta a voce/.test(b.getAttribute('aria-label') || ''));
    esito('c\'e\' l\'interruttore', !!alto());
    alto().click(); await attendi(80);   // spento
    micro(w).click(); await attendi(60);
    const r = w.__voce.istanze[w.__voce.istanze.length - 1];
    const prima = w.__parlato.dette.length;
    senti(r, 'quanto ho speso a gennaio', true);
    r.onend();
    await attendi(250);
    esito('spento, non parla nemmeno se la domanda e\' a voce', w.__parlato.dette.length === prima,
      w.__parlato.dette.length + ' vs ' + prima);
  }

  /* Quante domande ci sono a schermo, contate dalla STRUTTURA e non dal
     testo: i suggerimenti della schermata vuota contengono frasi molto
     simili alle domande, e cercarle nel testo darebbe il numero sbagliato
     proprio nel caso che interessa (chat vuota). */
  const domande = w => bottoni(w).filter(b => /Modifica questa domanda/.test(b.getAttribute('aria-label') || '')).length;
  const perEtichetta = (w, rx) => bottoni(w).find(b => rx.test(b.getAttribute('aria-label') || ''));

  console.log('\n18) Le conversazioni: "nuova" mette da parte, non cancella');
  {
    const { w } = avvia({});
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'quanto ho speso a gennaio?');
    esito('la domanda e\' in chat', domande(w) === 1, domande(w) + ' domande');

    const hamb = () => perEtichetta(w, /Apri le conversazioni/);
    esito('c\'e\' il pulsante delle conversazioni', !!hamb());
    hamb().click(); await attendi(80);
    esito('il cassetto elenca la conversazione, col titolo della prima domanda',
      /quanto ho speso a gennaio/.test(testo(w)));

    esito('e c\'e\' "Nuova conversazione"', clic(w, 'Nuova conversazione'));
    await attendi(120);
    esito('la chat si svuota', domande(w) === 0, domande(w) + ' domande');

    /* LA PROVA CHE NON HA CANCELLATO: la conversazione di prima si riapre e
       i messaggi ci sono ancora. Con una chat sola, questo era impossibile
       per costruzione. */
    hamb().click(); await attendi(80);
    esito('la conversazione di prima e\' ancora nell\'elenco', /quanto ho speso a gennaio/.test(testo(w)));
    clic(w, 'quanto ho speso a gennaio'); await attendi(120);
    esito('riaprendola, i messaggi sono tornati', domande(w) === 1, domande(w) + ' domande');

    /* Rinomina. */
    hamb().click(); await attendi(80);
    perEtichetta(w, /Rinomina la conversazione/).click(); await attendi(80);
    const campo = w.document.querySelector('input[aria-label="Nuovo nome della conversazione"]');
    esito('la rinomina apre un campo col nome attuale', !!campo && /gennaio/.test(campo.value), campo && campo.value);
    scrivi(w, campo, 'Spese di gennaio'); await attendi(40);
    perEtichetta(w, /Salva il nome/).click(); await attendi(100);
    esito('il nuovo nome resta', /Spese di gennaio/.test(testo(w)));
    esito('e i messaggi non si sono mossi', domande(w) === 1, domande(w) + ' domande');

    /* Elimina: e' l'unica azione che toglie qualcosa, ed e' esplicita. */
    perEtichetta(w, /Elimina la conversazione/).click(); await attendi(120);
    esito('eliminata, sparisce dall\'elenco', !/Spese di gennaio/.test(testo(w)));
    esito('e la chat torna vuota', domande(w) === 0, domande(w) + ' domande');
  }

  console.log('\n19) FERMA: la risposta si interrompe, e l\'app lo dichiara');
  {
    const { w, chiamate } = avvia({
      statoIA: { disponibile: true, provider: 'gemini', modello: 'g-test' },
      copione: [{ chiamate: [{ id: '1', nome: 'spese_periodo', argomenti: {} }] }, { testo: 'ecco la risposta lunga' }],
      ritardoIA: 400
    });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    await invia(w, 'fammi un quadro completo');
    await attendi(60);
    esito('mentre pensa lo dice', /Ci penso|Sto leggendo/.test(testo(w)));
    const stop = perEtichetta(w, /Ferma la risposta/);
    esito('e il pulsante di invio e\' diventato FERMA', !!stop);
    stop.click(); await attendi(80);
    esito('smette subito di aspettare', !/Ci penso|Sto leggendo/.test(testo(w)));
    esito('e lo dice, invece di sembrare finito', /Fermato da te/.test(testo(w)));
    /* La richiesta in volo non si puo' richiamare indietro: quando arriva,
       deve essere ignorata. Se ricomparisse, il pulsante sarebbe una bugia. */
    await attendi(700);
    esito('la risposta arrivata dopo NON ricompare', !/ecco la risposta lunga/.test(testo(w)));
    esito('nessuna scrittura sul foglio', !chiamate.some(c => /salva|elimina|modifica|setStati/.test(c.f)));
    /* E si puo' ripartire: fermare non deve lasciare la chat bloccata. */
    esito('il pulsante torna a essere INVIA', !!perEtichetta(w, /Invia la domanda/));
  }

  console.log('\n20) Copia, rigenera, modifica: cosa si puo\' fare di una risposta');
  {
    const { w, richiesteIA } = avvia({
      statoIA: { disponibile: true, provider: 'gemini', modello: 'g-test' },
      copione: [{ testo: 'la prima risposta' }, { testo: 'la seconda risposta' }]
    });
    await attendi(150); clic(w, 'Chiedi'); await attendi(150);
    try { w.navigator.clipboard = { writeText: t => { w.__copiato = t; return Promise.resolve(); } }; } catch (e) {}
    await invia(w, 'come sto andando?');
    await attendi(200);
    esito('la risposta e\' arrivata', /la prima risposta/.test(testo(w)));

    clic(w, '⧉ copia'); await attendi(120);
    esito('copia porta fuori il testo della risposta', w.__copiato === 'la prima risposta', w.__copiato);
    esito('e lo conferma a schermo', /copiato/.test(testo(w)));

    /* RIGENERA. La domanda si rifa', ma la vecchia risposta NON deve restare
       nella storia mandata al modello: con quella davanti, la seconda
       risposta sarebbe la prima ricopiata, e il pulsante non servirebbe a
       niente. */
    clic(w, '↻ rigenera'); await attendi(300);
    const ultima = richiesteIA[richiesteIA.length - 1];
    const storiaTesti = (ultima.messaggi || []).map(m => String(m.testo || '')).join(' | ');
    esito('la domanda viene rifatta', /come sto andando/.test(storiaTesti));
    esito('senza la vecchia risposta nella storia', !/la prima risposta/.test(storiaTesti), storiaTesti.slice(0, 60));
    esito('e a schermo c\'e\' la risposta nuova', /la seconda risposta/.test(testo(w)));
    esito('non due risposte alla stessa domanda', domande(w) === 1, domande(w) + ' domande');

    /* MODIFICA. La domanda torna nel campo e la coppia sparisce: cosi'
       correggerla e' un rifacimento pulito, non una seconda domanda
       appiccicata sotto la prima. */
    clic(w, '✎ modifica'); await attendi(120);
    esito('la domanda torna nel campo di scrittura', campoChat(w).value === 'come sto andando?', campoChat(w).value);
    esito('e la coppia domanda/risposta e\' stata tolta', domande(w) === 0, domande(w) + ' domande');
  }

  console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
  process.exit(falliti ? 1 : 0);
})();
