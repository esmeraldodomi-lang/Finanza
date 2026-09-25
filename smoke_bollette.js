// Prova del lettore di bollette PDF contro le bollette VERE.
// Estrae il blocco BOLLETTE:PARSER da Finanze.html e lo esegue in Node: il
// testo dei PDF e' gia' stato tirato fuori una volta e messo in
// finanze/fixture_bollette.json, cosi' il test gira senza pdf.js e senza rete.
// I valori attesi NON sono inventati: sono le righe gia' compilate a mano nel
// foglio BOLLETTE, quindi il test verifica che il lettore ricostruisca
// esattamente cio' che Esmeraldo aveva scritto.
// Uso: node finanze/smoke_bollette.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'Finanze.html'), 'utf8');
const m = html.match(/\/\* BOLLETTE:PARSER:START[\s\S]*?\/\* BOLLETTE:PARSER:END \*\//);
if (!m) { console.error('Blocco BOLLETTE:PARSER non trovato in Finanze.html'); process.exit(2); }

const ctx = {
  MESI_LONG: ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"],
  eur2: n => n == null ? '—' : n.toFixed(2) + ' €',
  console
};
vm.createContext(ctx);
new vm.Script(m[0] + '\n;this.parseBolletta = parseBolletta;').runInContext(ctx);
const parseBolletta = ctx.parseBolletta;

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture_bollette.json'), 'utf8'));

/* Attesi presi dal foglio BOLLETTE (righe gia' compilate a mano) e, per la
   bolletta non ancora inserita, dallo scontrino del PDF. */
const ATTESI = {
  'luce-aprile-2026':  { tipo: 'luce', meseCons: 3, annoCons: 2026, mesePag: 4, campi: { tot: 56.19, kwh: 178, qFissa: 7.92, qPot: 5.93, accise: 4.93, rai: 9 } },
  // maggio porta uno sconto "Altre partite - Bonus Power Up" di -0,19 €
  'luce-maggio-2026':  { tipo: 'luce', meseCons: 4, annoCons: 2026, mesePag: 5, campi: { tot: 61.73, kwh: 206, qFissa: 7.92, qPot: 5.93, accise: 6.08, rai: 9, altre: -0.19 } },
  'luce-giugno-2026':  { tipo: 'luce', meseCons: 5, annoCons: 2026, mesePag: 6, campi: { tot: 82.85, kwh: 295, qFissa: 7.92, qPot: 5.93, accise: 11.70, rai: 9 } },
  'luce-luglio-2026':  { tipo: 'luce', meseCons: 6, annoCons: 2026, mesePag: 7, campi: { tot: 105.90, kwh: 358, qFissa: 7.92, qPot: 5.93, accise: 16.67, rai: 9 } },
  'gas-giugno-2026':   { tipo: 'gas',  meseCons: 5, annoCons: 2026, mesePag: 6, campi: { tot: 21.60, smc: 9, fissi: 10.92 } }
};

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra ? ' — ' + extra : '')); if (!ok) falliti++; };

Object.keys(ATTESI).forEach(nome => {
  const testo = fixture[nome];
  console.log('\n' + nome);
  if (!testo) { esito(false, 'testo mancante nella fixture'); return; }
  const r = parseBolletta(testo);
  if (r.errore) { esito(false, 'parse fallito', r.errore); return; }
  const a = ATTESI[nome];
  esito(r.tipo === a.tipo, 'tipo = ' + a.tipo, r.tipo);
  esito(r.meseCons === a.meseCons, 'mese consumi = ' + ctx.MESI_LONG[a.meseCons], String(r.meseCons));
  esito(r.annoCons === a.annoCons, 'anno consumi = ' + a.annoCons, String(r.annoCons));
  esito(r.mesePag === a.mesePag, 'mese pagamento proposto = ' + ctx.MESI_LONG[a.mesePag], String(r.mesePag));
  esito(r.fornitore === 'OCTOPUS', 'fornitore = OCTOPUS', String(r.fornitore));
  Object.keys(a.campi).forEach(k => {
    const atteso = a.campi[k], letto = r.campi[k];
    esito(letto != null && Math.abs(letto - atteso) < 0.005, `${k} = ${atteso}`, String(letto));
  });
  // lo scontrino deve quadrare: se non quadra, il testo e' stato letto male
  const incoerenze = r.avvisi.filter(x => /non torna/i.test(x));
  esito(incoerenze.length === 0, 'lo scontrino quadra', incoerenze[0]);
  if (r.avvisi.length) console.log('         avvisi: ' + r.avvisi.join(' | '));
});

console.log('\n— casi limite —');
{
  const r = parseBolletta('documento qualunque senza intestazioni');
  esito(!!r.errore, 'un PDF che non e\' una bolletta viene rifiutato', r.errore);
}
{
  const r = parseBolletta('BOLLETTA LUCE BOLLETTA GAS insieme');
  esito(!!r.errore, 'luce+gas nello stesso file viene rifiutato');
}
{
  const r = parseBolletta('BOLLETTA LUCE senza nessun importo');
  esito(!r.errore && r.avvisi.some(a => /non trovate/i.test(a)), 'voci mancanti dichiarate, non messe a zero');
  esito(r.campi.tot == null, 'un importo non letto resta vuoto (mai 0 di comodo)');
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
