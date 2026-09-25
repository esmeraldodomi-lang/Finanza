// Prova di avvio di Finanze.html in jsdom, senza rete.
// Verifica il comportamento che era rotto: l'app deve arrivare a mostrare i
// dati anche quando IndexedDB non risponde MAI, e non deve poter restare
// per sempre su "Carico i dati dal foglio…".
// Uso: node finanze/smoke_boot.js
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

const PAYLOAD = {
  v: 4, anni: [2026],
  base: { 2026: { entrate: Array(12).fill(2000), entrateIn: Array(12).fill(0), giorniEnt: Array(12).fill(10),
    necFisso: Array(12).fill(500), necVar: Array(12).fill(200), vitaFisso: Array(12).fill(100), vitaVar: Array(12).fill(50) } },
  ccStart: { 2026: 1000 },
  cats: { 'SPESA': 'necessaria', 'BOLLETTA LUCE': 'necessaria' },
  catTipo: { 'SPESA': 'VARIABILE', 'BOLLETTA LUCE': 'VARIABILE' },
  catDict: ['SPESA', 'BOLLETTA LUCE'],
  movimenti: [[2026, 7, 0, 120.5, 0, 0, 'nota', 12, 0, '2026-08-03']],
  annuale: { 2026: { risparmi: 1200, pct: .2, patrimonio: 5000 } },
  catBase: { 'SPESA': { tipo: 'VARIABILE', misto: 0, nec: 'necessaria', nelSeme: 1 }, 'BOLLETTA LUCE': { tipo: 'VARIABILE', misto: 0, nec: 'necessaria', nelSeme: 1 } },
  catCfg: {}, daDecidere: [],
  diag: { fogli: { uscite: 'USCITE', entrate: 'ENTRATE' }, righe: { uscite: 1 }, mancanti: [] },
  warn: []
};

/* Il caso che Esmeraldo ha segnalato: due bollette di consumo 2025 pagate a
   gennaio 2026. Filtrando per anno di PAGAMENTO ma disegnando per mese di
   CONSUMO finivano nelle colonne novembre/dicembre del 2026. */
const BOLLETTE = {
  v: 2, rows: [
    { rowNum: 2, forn: 'PULSEE', annoCons: 2025, annoPag: 2026, mesePag: 0, meseCons: 10,
      luce: { tot: 58.39, qPot: 15.35, kwh: 174, prezzoKwh: 0.247 }, gas: { tot: 166.26, fissi: 13.47, smc: 127.66, prezzoSmc: 1.197 } },
    { rowNum: 3, forn: 'OCTOPUS', annoCons: 2025, annoPag: 2026, mesePag: 0, meseCons: 11,
      luce: { tot: 54.76, qPot: 15.35, kwh: 230, prezzoKwh: 0.171 }, gas: { tot: 206.0, fissi: 13.47, smc: 189, prezzoSmc: 1.019 } },
    { rowNum: 7, forn: 'OCTOPUS', annoCons: 2026, annoPag: 2026, mesePag: 4, meseCons: 3,
      luce: { tot: 56.19, qFissa: 7.92, qPot: 5.93, accise: 4.93, rai: 9, kwh: 178, prezzoKwh: 0.1596 }, gas: { tot: 27.64, fissi: 10.65, smc: 15, prezzoSmc: 1.133 } }
  ],
  fornitori: ['OCTOPUS', 'PULSEE'], anni: [2026], anniCons: [2025, 2026], n: 3
};

let falliti = 0;
const esito = (nome, ok, extra) => {
  console.log((ok ? '  OK   ' : '  FAIL ') + nome + (extra ? ' — ' + extra : ''));
  if (!ok) falliti++;
};

/* react-dom gira nel realm di Node, non in quello della finestra jsdom:
   senza questi globali non trova `window` e createRoot fallisce. La cache
   dei moduli va svuotata a ogni scenario, altrimenti react-dom resta
   agganciato al document della prova precedente. */
function reactPerFinestra(w) {
  global.window = w;
  global.document = w.document;
  global.navigator = w.navigator;
  global.requestAnimationFrame = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : (cb => setTimeout(cb, 0));
  global.cancelAnimationFrame = w.cancelAnimationFrame ? w.cancelAnimationFrame.bind(w) : clearTimeout;
  global.MessageChannel = w.MessageChannel;
  Object.keys(require.cache).forEach(k => { if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(k)) delete require.cache[k]; });
  return { React: require('react'), ReactDOM: require('react-dom/client') };
}

function avvia({ idb, backend, attesaMs = 0, payload }) {
  const dom = new JSDOM(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.org/'
  });
  const w = dom.window;
  const libs = reactPerFinestra(w);
  w.React = libs.React;
  w.ReactDOM = libs.ReactDOM;

  // IndexedDB: "muto" riproduce il caso iPhone/PWA in cui open() non emette
  // né onsuccess né onerror; "assente" riproduce lo storage negato.
  if (idb === 'muto') w.indexedDB = { open: () => ({}) };
  else if (idb === 'assente') { /* nessun indexedDB definito: open() lancia */ }
  else if (idb === 'bloccato') w.indexedDB = { open: () => { const r = {}; setTimeout(() => r.onblocked && r.onblocked(), 5); return r; } };

  if (backend) {
    const run = () => {
      let onOk = null, onKo = null;
      const proxy = {
        withSuccessHandler(f) { onOk = f; return proxy; },
        withFailureHandler(f) { onKo = f; return proxy; },
        getDatiFinanze() {
          if (backend === 'muto') return;                                  // non risponde mai
          if (backend === 'errore') return setTimeout(() => onOk({ error: 'Foglio USCITE non trovato.' }), attesaMs);
          if (backend === 'vuoto') return setTimeout(() => onOk(null), attesaMs);
          if (backend === 'crash') return setTimeout(() => onKo(new Error('boom')), attesaMs);
          setTimeout(() => onOk(payload || PAYLOAD), attesaMs);
        },
        getDatiBollette() { setTimeout(() => onOk(BOLLETTE), attesaMs); },
        getDatiRiscaldamento() { setTimeout(() => onOk({ rows: [], stanze: [], fornitori: [], anni: [] }), attesaMs); },
        getDatiEntrate() { setTimeout(() => onOk({ rows: [], anni: [] }), attesaMs); }
      };
      return proxy;
    };
    w.google = { script: { get run() { return run(); } } };
  }

  blocchi.forEach(code => { try { w.eval(code); } catch (e) { /* la guardia dipinge da sé */ } });
  return w;
}

const testo = w => (w.document.getElementById('root').textContent || '').trim();
const attendi = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n1) Avvio normale (IndexedDB ok, foglio risponde)');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(120);
    const t = testo(w);
    esito('React è montato', w.__FIN_MOUNTED__ === true);
    esito('mostra il cruscotto, non lo splash', /Panoramica/.test(t) && !/Carico i dati dal foglio/.test(t));
    esito('mostra un importo', /€/.test(t));
  }

  console.log('\n2) IndexedDB che NON risponde mai (il guasto segnalato)');
  {
    const w = avvia({ idb: 'muto', backend: 'ok' });
    await attendi(200);
    const t = testo(w);
    esito('la chiamata al foglio parte lo stesso', /Panoramica/.test(t),
      /Carico i dati dal foglio/.test(t) ? 'resta sullo splash' : '');
  }

  console.log('\n3) IndexedDB assente / bloccato da altra scheda');
  for (const modo of ['assente', 'bloccato']) {
    const w = avvia({ idb: modo, backend: 'ok' });
    await attendi(200);
    esito('avvia comunque (' + modo + ')', /Panoramica/.test(testo(w)));
  }

  console.log('\n4) Il foglio risponde con un errore');
  {
    const w = avvia({ backend: 'errore' });
    await attendi(120);
    const t = testo(w);
    esito('mostra la schermata di errore', /Impossibile caricare i dati/.test(t));
    esito('riporta il messaggio del server', /Foglio USCITE non trovato/.test(t));
    esito('offre Riprova', /Riprova/.test(t));
  }

  console.log('\n5) Il foglio risponde vuoto (null) e il ponte fallisce');
  {
    const w = avvia({ backend: 'vuoto' });
    await attendi(120);
    esito('null non blocca: errore dichiarato', /Impossibile caricare i dati/.test(testo(w)));
    const w2 = avvia({ backend: 'crash' });
    await attendi(120);
    esito('withFailureHandler porta a errore', /Impossibile caricare i dati/.test(testo(w2)));
  }

  console.log('\n6) Nessun backend (pagina aperta fuori da Apps Script)');
  {
    const w = avvia({ backend: null });
    await attendi(1900);
    esito('lo dice invece di restare in attesa', /Backend non disponibile/.test(testo(w)));
  }

  console.log('\n7) React assente: la pagina lo dichiara');
  {
    const dom = new JSDOM(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), { runScripts: 'outside-only', url: 'https://example.org/' });
    const w = dom.window;
    blocchi.forEach(code => { try { w.eval(code); } catch (e) {} });
    esito('avvisa che le librerie non sono arrivate', /Librerie non caricate/.test(testo(w)));
  }

  console.log('\n8) Errore di sintassi nello script: la rete di sicurezza lo dipinge');
  {
    const dom = new JSDOM(html.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, ''), { runScripts: 'outside-only', url: 'https://example.org/' });
    const w = dom.window;
    w.eval(blocchi[0]); // solo la rete di sicurezza: il blocco app non viene eseguito
    w.finFatal("L'app non è riuscita a partire", 'Unexpected token )');
    esito('lo splash statico viene sostituito', !/Carico i dati…/.test(testo(w)) && /non è riuscita a partire/.test(testo(w)));
  }

  console.log('\n9) Bollette: sezioni luce e gas separate');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    esito('la scheda Bollette esiste', clic('Bollette'));
    await attendi(150);
    const t = testo(w);
    esito('si apre su LUCE con le sue sezioni', /Luce/.test(t) && /Gas/.test(t) && /Riscaldamento/.test(t));
    esito('mostra il totale luce, non un misto luce+gas', /LUCE · CONSUMI/.test(t));
    esito('offre di allegare il PDF', /Allega bolletta PDF/.test(t));

    console.log('\n10) Il bug segnalato: consumi 2025 dentro l\'anno 2026');
    // di default si apre sull'anno di consumo corrente (2026): le bollette
    // con consumo 2025 NON devono comparire
    const t2026 = testo(w);
    esito('l\'anno mostrato è quello di CONSUMO', /CONSUMI 2026/.test(t2026), t2026.match(/CONSUMI \d+/) ? t2026.match(/CONSUMI \d+/)[0] : '');
    esito('la bolletta di aprile 2026 c\'è', /Aprile/.test(t2026));
    esito('novembre 2025 NON compare nel 2026', !/Novembre/.test(t2026));
    esito('dicembre 2025 NON compare nel 2026', !/Dicembre/.test(t2026));
    esito('i grafici dichiarano l\'asse', /per mese di consumo/.test(t2026));

    // ...e scegliendo il 2025 devono esserci
    esito('esiste il selettore anno consumi', clic('2025'));
    await attendi(120);
    const t2025 = testo(w);
    esito('nel 2025 compaiono novembre e dicembre', /Novembre/.test(t2025) && /Dicembre/.test(t2025));
    esito('e sparisce aprile 2026', !/Aprile/.test(t2025));

    console.log('\n11) La sezione GAS mostra il gas, non la luce');
    esito('si passa a Gas', clic('Gas'));
    await attendi(120);
    const tg = testo(w);
    esito('intestazione GAS', /GAS · CONSUMI/.test(tg));
    esito('unità di misura smc', /smc/.test(tg) && !/€\/kWh/.test(tg));
  }

  console.log('\n12) Entrate: spuntate contano nel saldo, previste nelle previsioni');
  {
    /* Gennaio: 2.000 previsti e GIA' incassati. Febbraio: 2.000 previsti ma
       NON ancora incassati (siamo prima del 10). Uscite 850/mese, tutte da
       pagare. Conto di partenza 1.000.
         saldo di adesso a febbraio = 1.000 +2.000 -850 (gennaio proiettato)
                                      +0 incassati -0 pagati = 2.150
         a fine febbraio             = 2.150 +2.000 -850           = 3.300
       Se il saldo di adesso usasse le entrate PREVISTE direbbe 4.150: cioe'
       uno stipendio che sul conto non c'e' ancora. */
    const P = JSON.parse(JSON.stringify(PAYLOAD));
    P.base[2026] = {
      entrate: [2000, 2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      entrateIn: [2000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      giorniEnt: [10, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      necFisso: [850, 850, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      necVar: Array(12).fill(0), vitaFisso: Array(12).fill(0), vitaVar: Array(12).fill(0)
    };
    P.ccStart = { 2026: 1000 };
    P.movimenti = [];
    const w = avvia({ backend: 'ok', payload: P });
    await attendi(150);
    // porta il mese visualizzato su febbraio (si parte dal mese corrente)
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    let giri = 0;
    while (!/Febbraio \d|Febbraio<|Febbraio/.test(testo(w).split('MESE VISUALIZZATO')[0]) && giri++ < 24) {
      const indietro = bottoni().find(b => (b.textContent || '').trim() === '‹');
      if (!indietro) break;
      indietro.click(); await attendi(30);
    }
    const t = testo(w);
    // il separatore delle migliaia dipende dall'ICU: si confronta senza
    const tn = t.replace(/\./g, '');
    esito('il mese mostrato è febbraio', /Febbraio/.test(t));
    esito('saldo di adesso = 2150 (senza lo stipendio non ancora arrivato)', /2150,00/.test(tn), (t.match(/[\d.]+,\d\d €/g) || []).slice(0, 3).join(' '));
    esito('NON mostra 4150 (stipendio dato per incassato)', !/4150,00/.test(tn));
    esito('a fine mese la previsione include lo stipendio (3300)', /3300,00/.test(tn));
    esito('dichiara quanto deve ancora arrivare', /Non ancora incassate/.test(t));
    esito('e quando è atteso', /attese il 10/.test(t));
  }

  console.log('\n13) Aggiungi spesa: il pulsante Registra resta raggiungibile');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    esito('si apre la scheda Aggiungi', clic('Aggiungi'));
    await attendi(120);
    esito('il pulsante c\'è anche a modulo vuoto', /Scegli categoria e importo/.test(testo(w)),
      'prima era un rettangolo scuro su fondo scuro: sembrava sparito');

    // apre l'elenco categorie: NON deve esserci un velo a tutto schermo
    const campo = Array.from(w.document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('elenco'));
    esito('c\'è il campo categoria', !!campo);
    if (campo) {
      campo.dispatchEvent(new w.Event('focus', { bubbles: true }));
      await attendi(120);
      const veli = Array.from(w.document.querySelectorAll('div')).filter(d => (d.getAttribute('style') || '').includes('position: fixed') && (d.getAttribute('style') || '').includes('inset: 0'));
      esito('nessun velo a tutto schermo sopra la pagina', veli.length === 0, veli.length + ' trovati');
      const tendine = Array.from(w.document.querySelectorAll('div')).filter(d => (d.getAttribute('style') || '').includes('position: absolute'));
      esito('l\'elenco non è sovrapposto (niente position:absolute)', tendine.length === 0, tendine.length + ' trovati');
      esito('con l\'elenco aperto il pulsante è ancora nel DOM', bottoni().some(b => /Scegli categoria|Registra spesa|Manca/.test(b.textContent || '')));
    }
  }

  console.log('\n14) Nuova scheda Analisi, con uscite ed entrate');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    esito('la scheda Analisi esiste', clic('Analisi'));
    await attendi(150);
    const t = testo(w);
    esito('si apre su ANALISI USCITE', /ANALISI USCITE/.test(t));
    esito('ha la previsione per mese', /USCITE PER MESE · CON PREVISIONE/.test(t));
    esito('dichiara il metodo della previsione', /media degli ultimi \d+ mesi con dati|nessun mese con dati/.test(t));
    esito('divide per necessità (quanto posso tagliare)', /QUANTO POSSO TAGLIARE/.test(t));
    esito('divide per tipo (quanto è prevedibile)', /QUANTO È PREVEDIBILE/.test(t));
    esito('mostra i quattro quadranti', /I QUATTRO QUADRANTI/.test(t));
    esito('le vecchie etichette non ci sono più', !/Discrezionale/.test(t) && !/Prevista/.test(t));
    esito('ha le top categorie', /TOP CATEGORIE/.test(t));
    esito('passa alle entrate', clic('Entrate'));
    await attendi(150);
    const t2 = testo(w);
    esito('mostra ANALISI ENTRATE', /ANALISI ENTRATE/.test(t2));
    esito('confronta incassato e previsto', /INCASSATO CONTRO PREVISTO/.test(t2));
    esito('stima il risparmio di fine anno', /RISPARMIO STIMATO A FINE ANNO/.test(t2));
  }

  console.log('\n15) Zoom su iPhone: nessun campo sotto i 16px');
  {
    // iOS ingrandisce la pagina se il campo ha testo sotto i 16px
    const stile = html.match(/input, select, textarea \{ font-size: 16px !important; \}/);
    esito('regola a 16px sui campi', !!stile);
    esito('classe per l\'importo grande', /input\.fin-xl \{ font-size: 30px !important; \}/.test(html));
    esito('doppio tocco senza zoom', /touch-action: manipulation/.test(html));
  }

  console.log('\n16) Panoramica: ordine delle righe e comandi');
  {
    const P = JSON.parse(JSON.stringify(PAYLOAD));
    P.catDict = ['SPESA', 'SVAGO', 'AFFITTO'];
    P.movimenti = [
      // agosto: una per gruppo, inserite in ordine sparso
      [2026, 7, 0, 50, 1, 0, 'carta', 10, 0, ''],        // con carta                 -> in fondo
      [2026, 7, 2, 60, 0, 1, 'fissa', 11, 0, ''],        // AFFITTO necessaria+fissa  -> sopra la carta
      [2026, 7, 0, 70, 0, 0, 'necvar', 12, 0, ''],       // SPESA necessaria+variabile-> sopra le fisse
      [2026, 7, 1, 80, 0, 0, 'vita', 13, 0, '']          // SVAGO vita                -> in cima
    ];
    P.cats = { 'SPESA': 'necessaria', 'SVAGO': 'vita', 'AFFITTO': 'necessaria' };
    const w = avvia({ backend: 'ok', payload: P });
    await attendi(160);
    const t = testo(w);
    const pos = e => t.indexOf(e);
    esito('intestazioni di gruppo presenti', /VITA/.test(t) && /NECESSARIE VARIABILI/.test(t) && /NECESSARIE FISSE/.test(t) && /CON CARTA/.test(t));
    esito('ordine: vita → necessarie variabili → necessarie fisse → carta',
      pos('VITA') < pos('NECESSARIE VARIABILI') && pos('NECESSARIE VARIABILI') < pos('NECESSARIE FISSE') && pos('NECESSARIE FISSE') < pos('CON CARTA'),
      [pos('VITA'), pos('NECESSARIE VARIABILI'), pos('NECESSARIE FISSE'), pos('CON CARTA')].join(' '));
    esito('c\'è il comando per le spese con carta', /Pagate quelle con carta/.test(t));
    esito('il comando "Tutte da pagare" non c\'è più', !/Tutte da pagare/.test(t));
    esito('resta "Tutte pagate"', /Tutte pagate/.test(t));
  }

  console.log('\n17) Punto più basso previsto, in rosso se negativo');
  {
    const P = JSON.parse(JSON.stringify(PAYLOAD));
    // uscite alte a settembre: il conto va sotto zero
    P.base[2026] = {
      entrate: Array(12).fill(1000), entrateIn: Array(12).fill(1000), giorniEnt: Array(12).fill(10),
      necFisso: [500, 500, 500, 500, 500, 500, 500, 500, 9000, 500, 500, 500],
      necVar: Array(12).fill(0), vitaFisso: Array(12).fill(0), vitaVar: Array(12).fill(0)
    };
    P.ccStart = { 2026: 1000 };
    P.movimenti = [];
    const w = avvia({ backend: 'ok', payload: P });
    await attendi(160);
    const t = testo(w);
    esito('mostra il punto più basso previsto', /PUNTO PIÙ BASSO PREVISTO/.test(t));
    esito('indica il mese giusto (settembre)', /Settembre/.test(t));
    const rosso = Array.from(w.document.querySelectorAll('div')).some(d => /rgba\(242,\s*114,\s*109/.test(d.getAttribute('style') || ''));
    esito('la cella è colorata di rosso quando è negativo', rosso);
  }

  console.log('\n18) Analisi: terza sezione Conto corrente');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    clic('Analisi'); await attendi(140);
    esito('c\'è la sezione Conto', clic('Conto'));
    await attendi(140);
    const t = testo(w);
    esito('la traiettoria è al centro', /TRAIETTORIA DEL CONTO/.test(t));
    esito('dice punto più basso e più alto', /Punto più basso/.test(t) && /Punto più alto/.test(t));
    esito('ha il mese per mese', /MESE PER MESE/.test(t));
    clic('Uscite'); await attendi(140);
    esito('le uscite hanno il dettaglio per categoria', /OGNI CATEGORIA, NEL DETTAGLIO/.test(testo(w)));
  }

  console.log('\n19) Aggiungi: spese ricorrenti');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    clic('Aggiungi'); await attendi(130);
    esito('c\'è la modalità Ricorrente', clic('Ricorrente'));
    await attendi(130);
    const t = testo(w);
    esito('chiede il giorno del mese', /OGNI MESE IL GIORNO/.test(t));
    esito('chiede da quando e fino a quando', /DA/.test(t) && /FINO A/.test(t));
    esito('spiega il limite del giorno 28', /febbraio compreso/.test(t));
  }

  console.log('\n20) Impostazioni e testata');
  {
    const w = avvia({ backend: 'ok' });
    await attendi(150);
    const t0 = testo(w);
    esito('la vecchia testata non c\'è più', !/CRUSCOTTO FINANZIARIO/.test(t0) && !/Esmeraldo/.test(t0));
    esito('la testata dice che giorno è', /giorno \d+ di \d+/.test(t0));
    const gear = Array.from(w.document.querySelectorAll('button')).find(b => (b.textContent || '').trim() === '⚙');
    esito('c\'è il comando impostazioni', !!gear);
    if (gear) {
      gear.click(); await attendi(140);
      const t = testo(w);
      esito('si apre la tipologia delle spese', /TIPOLOGIA DELLE SPESE/.test(t));
      esito('elenca le categorie', /SPESA/.test(t) && /BOLLETTA LUCE/.test(t));
      esito('si può salvare', Array.from(w.document.querySelectorAll('button')).some(b => /Salva/.test(b.textContent || '')));
    }
  }

  console.log('\n21) Movimenti: piu\' anni, piu\' filtri, ordinamento');
  {
    const P = JSON.parse(JSON.stringify(PAYLOAD));
    P.anni = [2026, 2027, 2028];
    [2027, 2028].forEach(y => { P.base[y] = JSON.parse(JSON.stringify(P.base[2026])); P.ccStart[y] = 1000; });
    P.catDict = ['SPESA', 'SVAGO'];
    P.cats = { 'SPESA': 'necessaria', 'SVAGO': 'vita' };
    P.movimenti = [
      [2026, 0, 0, 10, 0, 0, '', 2, 0, ''],
      [2027, 1, 1, 20, 0, 0, '', 3, 0, ''],
      [2028, 2, 0, 30, 0, 0, '', 4, 0, '']
    ];
    const w = avvia({ backend: 'ok', payload: P });
    await attendi(160);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    const clic = txt => { const b = bottoni().find(x => (x.textContent || '').includes(txt)); if (b) b.click(); return !!b; };
    clic('Movimenti'); await attendi(150);
    let t = testo(w);
    esito('si può filtrare per anno', /Anno/.test(t));
    esito('parte dall\'anno corrente: 1 voce', /1 voci/.test(t), (t.match(/\d+ voci/) || [])[0]);

    // aggiunge il 2027 ai filtri: due anni insieme
    const b2027 = bottoni().find(x => (x.textContent || '').trim() === '2027');
    esito('c\'è la pastiglia del 2027', !!b2027);
    if (b2027) { b2027.click(); await attendi(130); t = testo(w); }
    esito('due anni selezionati insieme → 2 voci', /2 voci/.test(t), (t.match(/\d+ voci/) || [])[0]);
    esito('lo dichiara nell\'intestazione', /2 anni/.test(t));

    // combina un secondo filtro: solo le Necessarie
    const bNec = bottoni().find(x => (x.textContent || '').trim() === 'Necessaria');
    if (bNec) { bNec.click(); await attendi(130); t = testo(w); }
    esito('anno + necessità insieme restringono ancora', /1 voci/.test(t), (t.match(/\d+ voci/) || [])[0]);
    esito('compare il comando per azzerare i filtri', /Azzera filtri/.test(t));

    // tutti gli anni
    const bTutti = bottoni().find(x => (x.textContent || '').trim() === 'Tutti');
    if (bTutti) { bTutti.click(); await attendi(130); t = testo(w); }
    esito('"Tutti" gli anni non nasconde niente', /tutti gli anni/.test(t));

    esito('si inverte l\'ordinamento', clic('dal più alto'));
    await attendi(120);
    esito('passa al crescente', /dal più basso/.test(testo(w)));
  }

  console.log('\n22) Cambio anno con 22 anni a foglio (mutuo e finanziamenti al 2047)');
  {
    /* Il foglio vero arriva al 2047. Togliendo le pastiglie degli anni dalla
       testata restavano solo le frecce del mese: 252 tocchi per arrivare in
       fondo. L'anno si deve poter scegliere. */
    const P = JSON.parse(JSON.stringify(PAYLOAD));
    P.anni = []; P.base = {};
    for (let y = 2026; y <= 2047; y++) {
      P.anni.push(y);
      P.base[y] = { entrate: Array(12).fill(2000), entrateIn: Array(12).fill(0), giorniEnt: Array(12).fill(10),
        necFisso: Array(12).fill(500), necVar: Array(12).fill(0), vitaFisso: Array(12).fill(0), vitaVar: Array(12).fill(0) };
      P.ccStart[y] = 1000;
    }
    P.movimenti = [];
    const w = avvia({ backend: 'ok', payload: P });
    await attendi(170);
    const bottoni = () => Array.from(w.document.querySelectorAll('button'));
    esito('invita a toccare l\'anno', /TOCCA L'ANNO PER CAMBIARLO/.test(testo(w)));
    const apri = bottoni().find(b => /2026/.test(b.textContent || '') && /▼|▲/.test(b.textContent || ''));
    esito('l\'anno è un comando', !!apri);
    if (apri) {
      apri.click(); await attendi(130);
      const b2047 = bottoni().find(b => (b.textContent || '').trim() === '2047');
      esito('l\'elenco arriva fino al 2047 in un tocco', !!b2047);
      if (b2047) {
        b2047.click(); await attendi(150);
        esito('si salta direttamente al 2047', /2047/.test(testo(w)));
      }
    }
  }

  console.log('\n23) La pagina non deve scorrere di lato');
  {
    esito('il rimbalzo è tolto su entrambi gli assi', /overscroll-behavior:\s*none/.test(html));
    esito('niente scorrimento orizzontale di pagina', /overflow-x:\s*hidden/.test(html));
    esito('il contenuto ha una larghezza massima', /\.app-container\s*\{[^}]*max-width:\s*480px/.test(html));
    const scroller = (html.match(/overflowX: "auto"/g) || []).length;
    const contenuti = (html.match(/overscrollBehaviorX: "contain"/g) || []).length;
    esito('ogni striscia scorrevole trattiene il rimbalzo', scroller === contenuti, scroller + ' scorrevoli, ' + contenuti + ' contenute');
  }

  console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
  process.exit(falliti ? 1 : 0);
})();
