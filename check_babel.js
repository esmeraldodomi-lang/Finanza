// Verifica sintattica dei blocchi <script> inline di Finanze.html.
// L'app NON usa Babel: è JavaScript semplice (React.createElement, niente JSX),
// quindi il controllo è quello del motore, senza dipendenze da installare.
// Uso: node finanze/check_babel.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, 'Finanze.html');
const html = fs.readFileSync(file, 'utf8');

// Solo gli script inline: quelli con src= sono le librerie dal CDN.
const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
let m, n = 0, ok = true;
while ((m = re.exec(html))) {
  const code = m[1];
  if (!code.trim()) continue;
  n++;
  try {
    new vm.Script(code, { filename: `Finanze.html#script${n}` });
    console.log(`blocco #${n}: OK (${code.length} char)`);
  } catch (e) {
    ok = false;
    console.error(`blocco #${n}: ERRORE ${e.message}`);
  }
}
if (n === 0) { console.error('Nessun blocco <script> inline trovato'); process.exit(2); }

/* GUARDIA DI COMPATIBILITÀ — l'app gira su un iPhone.
   node --check usa il V8 di oggi e accetta tutto; Safari no. Una sintassi
   troppo recente non fa fallire la riga: fa fallire l'INTERO blocco <script>,
   quindi React non si monta e resta a schermo lo splash "Carico i dati…".
   È già successo due volte, con cause diverse. Qui si taglia alla radice.
   Le occorrenze dentro commenti e stringhe non contano: si scorre il codice
   sapendo dove ci si trova. */
function codiceSenzaCommenti(src) {
  let out = '', i = 0, stato = 'code', quote = '';
  const precedenteUtile = () => { for (let k = out.length - 1; k >= 0; k--) { const c = out[k]; if (!/\s/.test(c)) return c; } return ''; };
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (stato === 'code') {
      if (c === '/' && d === '*') { stato = 'blocco'; i += 2; out += ' '; continue; }
      if (c === '/' && d === '/') { stato = 'linea'; i += 2; out += ' '; continue; }
      if (c === '"' || c === "'" || c === '`') { stato = 'stringa'; quote = c; i++; out += ' '; continue; }
      if (c === '/' && '(,=:[!&|?{};+-*%~^'.includes(precedenteUtile())) { stato = 'regex'; i++; out += ' '; continue; }
      out += c; i++; continue;
    }
    if (stato === 'blocco') { if (c === '*' && d === '/') { stato = 'code'; i += 2; } else i++; continue; }
    if (stato === 'linea') { if (c === '\n') { stato = 'code'; out += '\n'; } i++; continue; }
    if (stato === 'stringa') { if (c === '\\') { i += 2; continue; } if (c === quote) stato = 'code'; if (c === '\n' && quote !== '`') stato = 'code'; i++; continue; }
    if (stato === 'regex') { if (c === '\\') { i += 2; continue; } if (c === '[') { stato = 'classe'; i++; continue; } if (c === '/' || c === '\n') stato = 'code'; i++; continue; }
    if (stato === 'classe') { if (c === '\\') { i += 2; continue; } if (c === ']') stato = 'regex'; i++; continue; }
  }
  return out;
}
const VIETATI = [
  ['??', /\?\?/, 'coalescenza nulla (ES2020) — su iOS < 13.4 è errore di sintassi. Usa `primo(a, b)`.'],
  ['?.', /[\w)\]]\?\./, 'optional chaining (ES2020) — su iOS < 13.4 è errore di sintassi. Usa `a && a.b`.'],
  ['||= &&= ??=', /(\|\||&&|\?\?)=/, 'assegnamenti logici (ES2021) — non supportati da Safari vecchi.'],
  ['catch {}', /catch\s*\{/, 'catch senza binding (ES2019) — scrivi `catch (e)`.'],
  ['1_000', /\b\d+_\d/, 'separatori numerici (ES2021) — non supportati da Safari vecchi.'],
  ['.at()', /\.at\(/, 'Array.prototype.at (ES2022) — assente su iOS < 15.4.'],
  ['replaceAll', /\.replaceAll\(/, 'String.replaceAll (ES2021) — assente su iOS < 13.4.']
];
{
  const pulito = codiceSenzaCommenti(html);
  VIETATI.forEach(([nome, rx, perche]) => {
    const m = pulito.match(rx);
    if (m) {
      ok = false;
      const riga = pulito.slice(0, m.index).split('\n').length;
      console.error(`sintassi troppo recente: ${nome} a riga ~${riga} — ${perche}`);
    }
  });
  if (ok) console.log('compatibilità Safari: nessuna sintassi post-ES2018 nel codice');
}

// Guardie che non devono sparire con una modifica distratta: sono ciò che
// impedisce all'app di restare per sempre su "Carico i dati dal foglio…".
const guardie = [
  ['finFatal', /window\.finFatal\s*=/],
  ['guardia React assente', /typeof React === "undefined"/],
  ['timeout massimo del boot', /BOOT_MAX_MS/],
  ['scadenza sulle promesse', /conScadenza/],
  ['IndexedDB onblocked', /onblocked/],
  ['rete non in attesa della cache', /google\.script\.run\.withSuccessHandler\(ok\)/],
];
guardie.forEach(([nome, rx]) => {
  if (!rx.test(html)) { ok = false; console.error(`guardia mancante: ${nome}`); }
  else console.log(`guardia "${nome}": presente`);
});

process.exit(ok ? 0 : 1);
