// Prova del motore delle analisi e delle previsioni.
// Estrae il blocco ANALISI:CORE da Finanze.html e lo esegue in Node.
// Le previsioni producono numeri su cui si prendono decisioni: vanno
// verificate, e soprattutto deve restare vero che un mese non ancora
// arrivato non viene confuso con un mese davvero a zero.
// Uso: node finanze/smoke_analisi.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'Finanze.html'), 'utf8');
const m = html.match(/\/\* ANALISI:CORE:START[\s\S]*?\/\* ANALISI:CORE:END \*\//);
if (!m) { console.error('Blocco ANALISI:CORE non trovato in Finanze.html'); process.exit(2); }

const ctx = { console };
vm.createContext(ctx);
new vm.Script(m[0] + '\n;this.API = { mesiConDati, previsione, totaleConStima, perCategoria, perQuadrante, dettaglioCategorie, letturaConto };').runInContext(ctx);
const { mesiConDati, previsione, totaleConStima, perCategoria, perQuadrante, dettaglioCategorie, letturaConto } = ctx.API;

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : '')); if (!ok) falliti++; };
const vicino = (a, b) => a != null && Math.abs(a - b) < 0.005;

console.log('\n1) Mesi con dati');
{
  esito(JSON.stringify(mesiConDati([100, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])) === '[0,1]', 'riconosce i due mesi pieni');
  esito(mesiConDati(Array(12).fill(0)).length === 0, 'un anno vuoto non ha mesi con dati');
}

console.log('\n2) Previsione: media degli ultimi 3 mesi con dati');
{
  // gennaio 100, febbraio 200, marzo 300 -> media 200 su aprile..dicembre
  const p = previsione([100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3);
  esito(vicino(p.media, 200), 'media = 200', p.media);
  esito(p.stimati.length === 9, 'stima i 9 mesi rimanenti', p.stimati.length);
  esito(vicino(p.serie[5], 200), 'giugno vale la media', p.serie[5]);
  esito(vicino(p.serie[0], 100), 'gennaio resta il valore vero', p.serie[0]);
  esito(/ultimi 3 mesi/.test(p.metodo), 'il metodo e\' dichiarato', p.metodo);
}

console.log('\n3) La finestra usa gli ULTIMI mesi, non tutti');
{
  // 1000 a gennaio poi 100,100,100: la media deve essere 100, non 325
  const p = previsione([1000, 100, 100, 100, 0, 0, 0, 0, 0, 0, 0, 0], 3);
  esito(vicino(p.media, 100), 'il mese vecchio e fuori scala non sporca la media', p.media);
}

console.log('\n4) Un buco in mezzo non diventa una previsione');
{
  // se l'ultimo mese con dati e' marzo, si prevede da aprile in poi;
  // febbraio a zero resta zero perche' e' un fatto, non un mese mancante
  const p = previsione([100, 0, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3);
  esito(p.serie[1] === 0, 'febbraio a zero resta zero', p.serie[1]);
  esito(p.stimati.indexOf(1) < 0, 'febbraio non e\' marcato come stimato');
  esito(p.stimati[0] === 3, 'la previsione parte da aprile', p.stimati[0]);
  esito(vicino(p.media, 200), 'media sui soli mesi pieni (100 e 300)', p.media);
}

console.log('\n5) Anno senza dati: nessuna previsione inventata');
{
  const p = previsione(Array(12).fill(0), 3);
  esito(p.stimati.length === 0, 'non stima niente');
  esito(p.media === 0, 'media zero');
  esito(/nessun mese con dati/.test(p.metodo), 'lo dichiara', p.metodo);
}

console.log('\n6) Totale: reale e stimato restano separati');
{
  const p = previsione([100, 200, 300, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3);
  const t = totaleConStima(p);
  esito(vicino(t.reale, 600), 'reale = 600', t.reale);
  esito(vicino(t.stima, 1800), 'stimato = 9 x 200 = 1800', t.stima);
  esito(vicino(t.tot, 2400), 'totale = 2400', t.tot);
  esito(t.reale + t.stima === t.tot, 'il totale e\' la somma dei due, senza sorprese');
}

console.log('\n7) Categorie e ripartizione sui due assi');
{
  const movs = [
    { cat: 'SPESA', amount: 300 }, { cat: 'SPESA', amount: 200 },
    { cat: 'SVAGO', amount: 100 }, { cat: 'CASA', amount: 400 }
  ];
  const c = perCategoria(movs, 8);
  esito(c[0].cat === 'SPESA' && vicino(c[0].v, 500), 'somma per categoria e ordina', c[0].cat + ' ' + c[0].v);
  esito(vicino(c[0].quota, 0.5), 'quota di SPESA = 50%', c[0].quota);
  esito(perCategoria(movs, 2).length === 2, 'rispetta il limite');
  esito(perCategoria([], 8).length === 0, 'nessun movimento, nessuna categoria');

  /* Due assi: necessaria/vita per le decisioni, fisso/variabile per le
     previsioni. I due totali devono tornare entrambi sullo stesso monte. */
  const r = perQuadrante([
    { necFisso: 100, necVar: 100, vitaFisso: 100, vitaVar: 100 },
    { necFisso: 100, necVar: 0, vitaFisso: 0, vitaVar: 0 }
  ]);
  esito(vicino(r.tot, 500), 'totale 500', r.tot);
  esito(vicino(r.necessarie.v, 300), 'necessarie = 200 fisse + 100 variabili', r.necessarie.v);
  esito(vicino(r.vita.v, 200), 'vita = 100 + 100', r.vita.v);
  esito(vicino(r.necessarie.quota, 0.6), 'quota necessarie = 60%', r.necessarie.quota);
  esito(vicino(r.fisse.v, 300), 'fisse = necessarie fisse + vita fisse', r.fisse.v);
  esito(vicino(r.variabili.v, 200), 'variabili = 100 + 100', r.variabili.v);
  esito(vicino(r.necessarie.v + r.vita.v, r.tot), 'i due assi coprono lo stesso monte (necessita)');
  esito(vicino(r.fisse.v + r.variabili.v, r.tot), 'i due assi coprono lo stesso monte (tipo)');
  esito(r.quadranti.length === 4, 'quattro quadranti');
}

console.log('\n8) Dettaglio per categoria');
{
  // SPESA: 300 a gennaio + 200 a febbraio = 500 in 2 mesi, 2 movimenti
  const movs = [
    { cat: 'SPESA', amount: 300, m: 0, nec: 'necessaria', tipo: 'VARIABILE' },
    { cat: 'SPESA', amount: 200, m: 1, nec: 'necessaria', tipo: 'VARIABILE' },
    { cat: 'SVAGO', amount: 100, m: 0, nec: 'vita', tipo: 'VARIABILE' },
    { cat: 'SVAGO', amount: 100, m: 0, nec: 'vita', tipo: 'VARIABILE' }
  ];
  const d = dettaglioCategorie(movs);
  const spesa = d.find(x => x.cat === 'SPESA'), svago = d.find(x => x.cat === 'SVAGO');
  esito(vicino(spesa.v, 500), 'SPESA totale 500', spesa.v);
  esito(spesa.mesi === 2 && spesa.n === 2, 'SPESA: 2 movimenti in 2 mesi', spesa.n + '/' + spesa.mesi);
  esito(vicino(spesa.mediaMese, 250), 'media sui mesi in cui c\'e\' stata (250), non su 12', spesa.mediaMese);
  esito(vicino(svago.mediaMese, 200), 'SVAGO: due movimenti nello stesso mese contano come un mese', svago.mediaMese);
  esito(vicino(svago.mediaVolta, 100), 'SVAGO: media a volta 100', svago.mediaVolta);
  esito(d[0].cat === 'SPESA', 'ordinato per totale');
  esito(spesa.nec === 'necessaria' && spesa.tipo === 'VARIABILE', 'porta con se\' necessita\' e tipo');
}

console.log('\n9) Lettura del conto');
{
  const rows = [400, 300, -200, 800, 250, 900, 900, 900, 900, 900, 900, 900].map((v, i) => ({ i, projectedCC: v }));
  const l = letturaConto(rows, 500);
  esito(l.min.i === 2 && vicino(l.min.v, -200), 'trova il punto piu\' basso (marzo, -200)', l.min.i + ' ' + l.min.v);
  esito(l.max.i === 5, 'trova il punto piu\' alto', l.max.i);
  esito(l.negativi === 1, 'conta i mesi sotto zero', l.negativi);
  esito(l.sotto === 4, 'conta i mesi sotto soglia 500', l.sotto);
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
