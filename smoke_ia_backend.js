// Prova del ponte verso il modello (FINANZE.gs) SENZA RETE.
//
// PERCHE' ESISTE. Qui non si prova che il modello risponda bene: si prova
// che l'app parli il dialetto giusto. Sono tutte cose che, sbagliate, non
// danno un errore chiaro ma una chat che si ferma a meta':
//   - la firma del pensiero non restituita -> HTTP 400 al secondo strumento;
//   - i tipi dello schema non in MAIUSCOLO -> Gemini rifiuta gli strumenti;
//   - i risultati degli strumenti nel turno sbagliato -> il modello non li vede;
//   - il 429 trattato come guasto -> la chat sembra rotta mentre e' solo in coda;
//   - un modello ritirato -> tutto smette di funzionare da un giorno all'altro.
// UrlFetchApp e' finto e registra ogni richiesta: si guarda cosa SAREBBE
// stato spedito.
// Uso: node finanze/smoke_ia_backend.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, 'FINANZE.gs'), 'utf8');

/* Un ambiente Apps Script finto. `risposte` e' la coda delle risposte HTTP:
   ogni fetch ne consuma una. */
function ambiente(props, risposte) {
  const store = Object.assign({}, props || {});
  const richieste = [], dormite = [], log = [];
  const risp = (risposte || []).slice();
  const R = (code, body, headers) => ({
    getResponseCode: () => code,
    getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)),
    getAllHeaders: () => headers || {}
  });
  const ctx = {
    console, JSON, Math, Date, String, Number, Object, Array, parseFloat, parseInt, isFinite, RegExp, encodeURIComponent,
    SpreadsheetApp: { openById: () => ({ getSheets: () => [], getName: () => 'X' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, getAll: () => ({}), put: () => {}, putAll: () => {}, removeAll: () => {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: k => { delete store[k]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Session: { getScriptTimeZone: () => 'Europe/Rome', getActiveUser: () => ({ getEmail: () => 'io@example.org' }) },
    ScriptApp: { getOAuthToken: () => 'TOKEN-FINTO' },
    Utilities: {
      formatDate: d => d.toISOString().slice(0, 10),
      sleep: ms => dormite.push(ms)
    },
    UrlFetchApp: {
      fetch: (url, opt) => {
        richieste.push({ url: url, opt: opt, corpo: opt && opt.payload ? JSON.parse(opt.payload) : null });
        const r = risp.length ? risp.shift() : { code: 200, body: {} };
        /* Una risposta puo' anche NON arrivare: senza lo scope
           script.external_request, fetch solleva un'eccezione prima di
           uscire. E' un caso diverso da un HTTP 4xx e va provato come tale. */
        if (r.lancia) { const e = new Error(r.lancia); throw e; }
        return R(r.code, r.body, r.headers);
      }
    },
    Logger: { log: (m) => log.push(String(m)) }
  };
  vm.createContext(ctx);
  new vm.Script(SRC + '\n;this.API = { statoIA, modelliIA, impostaModelloIA, impostaPreferenzaIA, chiediIA,' +
    ' iaAnalizzaModello_, iaPunteggio_, iaModelliOrdinati_, iaSchemaGemini_, iaMsgGemini_, iaMsgAnthropic_,' +
    ' iaProvider_, iaErrHttp_, iaAttesa_, testIA };').runInContext(ctx);
  return { API: ctx.API, richieste, dormite, store, log };
}

const listaGemini = (nomi) => ({
  code: 200, body: { models: nomi.map(n => ({ name: 'models/' + n, supportedGenerationMethods: ['generateContent'] })) }
});
const rispostaGemini = (parts) => ({ code: 200, body: { candidates: [{ content: { parts: parts }, finishReason: 'STOP' }] } });

let falliti = 0;
const esito = (ok, testo, extra) => { console.log((ok ? '  OK   ' : '  FAIL ') + testo + (extra !== undefined ? ' — ' + extra : '')); if (!ok) falliti++; };

console.log('\n1) Senza configurazione l\'app NON si rompe: lo dice');
{
  const { API } = ambiente({}, []);
  const st = API.statoIA();
  esito(st.disponibile === false, 'nessun modello collegato');
  esito(/aistudio\.google\.com\/apikey/.test(st.motivo), 'e spiega la strada gratuita', st.motivo.slice(0, 60) + '…');
  const r = API.chiediIA({ messaggi: [{ ruolo: 'user', testo: 'ciao' }] });
  esito(!!r.error, 'chiediIA risponde con un errore leggibile, non undefined', r.error.slice(0, 40) + '…');
}

console.log('\n2) Il provider gratuito viene per primo');
{
  esito(ambiente({ GEMINI_API_KEY: 'k' }, []).API.iaProvider_() === 'gemini', 'con la sola chiave Gemini: gemini');
  esito(ambiente({ GEMINI_API_KEY: 'k', VERTEX_PROJECT: 'p' }, []).API.iaProvider_() === 'gemini',
    'con entrambe vince la chiave gratuita');
  esito(ambiente({ GEMINI_API_KEY: 'k', IA_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'a' }, []).API.iaProvider_() === 'anthropic',
    'IA_PROVIDER esplicito comanda');
  esito(ambiente({ VERTEX_PROJECT: 'p' }, []).API.iaProvider_() === 'vertex', 'solo Vertex: vertex');
}

console.log('\n3) Il modello si SCOPRE, non e\' inciso nel codice');
{
  const { API } = ambiente({ GEMINI_API_KEY: 'k' },
    [listaGemini(['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-preview-09', 'gemini-2.5-pro',
      'gemini-2.0-flash-lite', 'text-embedding-004', 'imagen-3.0', 'veo-2.0'])]);
  const l = API.modelliIA();
  esito(!l.error, 'l\'elenco arriva', l.error);
  /* Preferenza predefinita "massima": si parte dal piu' capace che
     l'account espone, non dal piu' economico. Se poi la chiave non lo
     concede, l'app scende da sola (prova 11). */
  esito(l.consigliato === 'gemini-2.5-pro', 'in automatico parte dal piu\' intelligente', l.consigliato);
  esito(l.preferenza === 'massima', 'e la preferenza predefinita lo dice', l.preferenza);
  esito(!l.modelli.some(m => /embedding|imagen|veo/.test(m.id)), 'embedding, immagini e video restano fuori');
  const stabile = l.modelli.findIndex(m => m.id === 'gemini-2.5-flash');
  const preview = l.modelli.findIndex(m => m.id === 'gemini-2.5-flash-preview-09');
  esito(stabile < preview, 'a parita\' di versione, la stabile batte la preview', stabile + ' < ' + preview);

  const a = API.iaAnalizzaModello_('gemini-2.5-flash-lite');
  esito(a.classe === 'flash-lite' && a.versione === 2.5, 'sa leggere classe e versione da un nome mai visto', a.classe + ' ' + a.versione);
  esito(API.iaPunteggio_(API.iaAnalizzaModello_('gemini-2.5-pro'), 'pro') >
    API.iaPunteggio_(API.iaAnalizzaModello_('gemini-2.5-flash'), 'pro'), 'con preferenza "pro" vince il pro');
}

console.log('\n4) Un modello ritirato non ferma l\'app: si riscopre e si dice');
{
  const { API, store } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-vecchio-1.0' }, [
    { code: 404, body: { error: { message: 'models/gemini-vecchio-1.0 is not found for API version v1beta' } } },
    listaGemini(['gemini-2.5-flash']),
    rispostaGemini([{ text: 'eccomi' }])
  ]);
  const r = API.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'ciao' }], strumenti: [] });
  esito(r.testo === 'eccomi', 'la risposta arriva lo stesso', r.error || r.testo);
  esito(/aggiornato automaticamente/.test(r.nota || ''), 'e l\'app dichiara il cambio', r.nota);
  esito(!store.GEMINI_MODEL, 'il nome fissato e ormai morto viene liberato', String(store.GEMINI_MODEL));
}

console.log('\n5) Il 429 e\' una coda: si aspetta quello che dice il provider');
{
  const attesa = { code: 429, body: { error: { message: 'quota', details: [{ retryDelay: '18s' }] } } };
  const { API, dormite } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' },
    [attesa, rispostaGemini([{ text: 'ok dopo attesa' }])]);
  const r = API.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(r.testo === 'ok dopo attesa', 'aspetta e riprova invece di riportare l\'errore', r.error || r.testo);
  esito(dormite.length === 1 && dormite[0] >= 18000 && dormite[0] <= 19000, 'ha aspettato i 18 secondi CHIESTI, non un tempo inventato', dormite[0]);

  const { API: A2, dormite: d2 } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' },
    [attesa, attesa, attesa, attesa]);
  const r2 = A2.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(/Limite di richieste al minuto/.test(r2.error || ''), 'se resta pieno lo spiega in italiano', (r2.error || '').slice(0, 50) + '…');
  esito(d2.length <= 2, 'e non aspetta all\'infinito (Apps Script ha 6 minuti in tutto)', d2.length + ' attese');

  const { API: A3 } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x' }, [
    { code: 429, body: { error: { message: 'rate' } }, headers: { 'Retry-After': '7' } },
    { code: 200, body: { content: [{ type: 'text', text: 'ciao' }], model: 'claude-x' } }
  ]);
  const r3 = A3.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(r3.testo === 'ciao', 'su Anthropic si legge l\'header Retry-After', r3.error || r3.testo);
}

console.log('\n6) Gemini: gli strumenti tradotti come li vuole lui');
{
  const strumenti = [{
    nome: 'registra_spesa', descrizione: 'prepara una spesa',
    parametri: { type: 'object', properties: { importo: { type: 'number', description: 'euro' },
      categoria: { type: 'string' }, pagamento: { type: 'string', enum: ['conto', 'cc'] } }, required: ['importo', 'categoria'] }
  }];
  const { API, richieste } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' }, [rispostaGemini([{ text: 'ok' }])]);
  API.chiediIA({ sistema: 'PROMPT', indice: { categorie: ['SPESA'] }, strumenti: strumenti,
    messaggi: [{ ruolo: 'user', testo: 'ciao' }] });
  const c = richieste[0].corpo;
  esito(/PROMPT/.test(c.systemInstruction.parts[0].text), 'il prompt di sistema c\'e\'');
  esito(/INDICE DEI DATI/.test(c.systemInstruction.parts[0].text), 'e l\'indice ci viaggia dentro');
  const d = c.tools[0].functionDeclarations[0];
  esito(d.name === 'registra_spesa', 'lo strumento e\' dichiarato');
  esito(d.parameters.type === 'OBJECT' && d.parameters.properties.importo.type === 'NUMBER',
    'i tipi sono in MAIUSCOLO (Gemini rifiuta gli altri)', d.parameters.type + '/' + d.parameters.properties.importo.type);
  esito(JSON.stringify(d.parameters.properties.pagamento.enum) === '["conto","cc"]', 'gli enum sopravvivono alla traduzione');
  esito(JSON.stringify(d.parameters.required) === '["importo","categoria"]', 'e i campi obbligatori pure');
}

console.log('\n7) Gemini: la firma del pensiero torna indietro IDENTICA');
{
  const { API, richieste } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' }, [
    rispostaGemini([
      { text: 'penso', thought: true, thoughtSignature: 'FIRMA-PENSIERO' },
      { functionCall: { name: 'situazione', args: { mese: 2 } }, thoughtSignature: 'FIRMA-A' },
      { functionCall: { name: 'da_pagare', args: {} } }
    ]),
    rispostaGemini([{ text: 'finito' }])
  ]);
  const r1 = API.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(r1.chiamate.length === 2, 'due chiamate in parallelo', r1.chiamate.length);
  esito(r1.chiamate[0].firma === 'FIRMA-A', 'la firma della prima viaggia con la chiamata', r1.chiamate[0].firma);
  esito(r1.chiamate[1].firma === '', 'la seconda non ne ha: NON se ne inventa una', '"' + r1.chiamate[1].firma + '"');
  esito(r1.testo === '', 'le parti "thought" non finiscono nella risposta', '"' + r1.testo + '"');
  esito(r1.firmaTesto === 'FIRMA-PENSIERO', 'ma la loro firma si conserva', r1.firmaTesto);

  // secondo giro: la conversazione torna indietro con firme e risultati
  API.chiediIA({ sistema: 's', strumenti: [], messaggi: [
    { ruolo: 'user', testo: 'x' },
    { ruolo: 'model', testo: '', firmaTesto: 'FT', chiamate: r1.chiamate },
    { ruolo: 'tool', risultati: [{ id: 'a', nome: 'situazione', contenuto: { saldo: 10 } }] }
  ] });
  const c2 = richieste[1].corpo.contents;
  const turnoModello = c2.find(x => x.role === 'model');
  esito(turnoModello.parts[0].functionCall.name === 'situazione', 'il turno del modello riporta le chiamate');
  esito(turnoModello.parts[0].thoughtSignature === 'FIRMA-A', 'con la firma attaccata alla parte giusta', turnoModello.parts[0].thoughtSignature);
  esito(turnoModello.parts[1].thoughtSignature === undefined, 'e nessuna firma finta sulla seconda');
  const ultimo = c2[c2.length - 1];
  esito(ultimo.role === 'user' && !!ultimo.parts[0].functionResponse,
    'i risultati degli strumenti viaggiano in un turno "user" (formato dell\'API)', ultimo.role);
}

console.log('\n8) Anthropic: stesso discorso, altro dialetto');
{
  const { API, richieste } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x' }, [
    { code: 200, body: { model: 'claude-x', content: [
      { type: 'text', text: 'guardo' },
      { type: 'tool_use', id: 'tu_1', name: 'situazione', input: { mese: 1 } }] } }
  ]);
  const r = API.chiediIA({ sistema: 's', strumenti: [{ nome: 'situazione', descrizione: 'd', parametri: { type: 'object', properties: { mese: { type: 'integer' } } } }],
    messaggi: [{ ruolo: 'user', testo: 'x' }, { ruolo: 'tool', risultati: [{ id: 'tu_0', nome: 'x', contenuto: { a: 1 } }] }] });
  esito(r.chiamate.length === 1 && r.chiamate[0].id === 'tu_1', 'legge il tool_use con il suo id', JSON.stringify(r.chiamate));
  const b = richieste[0].corpo;
  esito(b.tools[0].input_schema.type === 'object', 'lo schema resta JSON Schema (minuscolo), non quello di Gemini');
  const turnoTool = b.messages.find(m => Array.isArray(m.content) && m.content[0] && m.content[0].type === 'tool_result');
  esito(!!turnoTool && turnoTool.role === 'user', 'i risultati sono tool_result in un turno user');
  esito(typeof turnoTool.content[0].content === 'string', 'e il contenuto e\' serializzato in testo');
  const { API: A2 } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'c' },
    [{ code: 200, body: { stop_reason: 'refusal', content: [] } }]);
  esito(!!A2.chiediIA({ sistema: 's', strumenti: [], messaggi: [{ ruolo: 'user', testo: 'x' }] }).error,
    'un rifiuto arriva con HTTP 200: viene letto lo stesso');
}

console.log('\n9) Il pannello di configurazione non accetta nomi inventati');
{
  const { API } = ambiente({ GEMINI_API_KEY: 'k' }, [listaGemini(['gemini-2.5-flash', 'gemini-2.5-pro'])]);
  esito(!!API.impostaModelloIA('gemini-9.9-turbo').error, 'un modello che non c\'e\' viene rifiutato');
  const { API: A2, store } = ambiente({ GEMINI_API_KEY: 'k' }, [listaGemini(['gemini-2.5-flash', 'gemini-2.5-pro'])]);
  const st = A2.impostaModelloIA('gemini-2.5-pro');
  esito(st.modello === 'gemini-2.5-pro' && st.automatico === false, 'uno vero si fissa', st.modello);
  esito(store.GEMINI_MODEL === 'gemini-2.5-pro', 'e resta scritto nelle proprieta\'');
  const { API: A3, store: s3 } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-pro' },
    [listaGemini(['gemini-2.5-flash'])]);
  A3.impostaPreferenzaIA('flash-lite');
  esito(s3.IA_PREFERENZA === 'flash-lite', 'la preferenza si salva');
  esito(!s3.GEMINI_MODEL, 'e cambiare preferenza riporta la scelta ad automatica');
  esito(!!A3.impostaPreferenzaIA('economica').error, 'una preferenza inventata viene rifiutata');
}

console.log('\n10) statoIA() non tocca la rete (gira all\'avvio della pagina)');
{
  const { API, richieste } = ambiente({ GEMINI_API_KEY: 'k', IA_MODELLO_AUTO_GEMINI: 'gemini-2.5-flash' }, []);
  const st = API.statoIA();
  esito(richieste.length === 0, 'nessuna richiesta HTTP', richieste.length);
  esito(st.disponibile === true && st.modello === 'gemini-2.5-flash', 'ma sa dire quale modello e\' in uso', st.modello);
  esito(st.gratuito === true, 'e che quello collegato e\' il piano gratuito');
}


console.log('\n11) La cache del prefisso: la spesa che si paga una volta sola');
{
  /* PERCHE' CONTA. A ogni giro dell'anello agentico ripartono identici il
     prompt, l'indice e i 22 strumenti — circa 4.700 token. Senza cache si
     pagano a ogni giro; con la cache, una volta. E' la voce di spesa piu'
     grossa dell'assistente, ed e' anche quella che si rompe piu'
     facilmente: basta un byte diverso nel prefisso e smette di funzionare
     SENZA dare errore. */
  const strumenti = [
    { nome: 'situazione', descrizione: 'fotografia del mese', parametri: { type: 'object', properties: { mese: { type: 'integer' } } } },
    { nome: 'registra_spesa', descrizione: 'prepara una spesa', parametri: { type: 'object', properties: { importo: { type: 'number' } } } }
  ];
  const { API, richieste } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x' }, [
    { code: 200, body: { model: 'claude-x', content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 300, output_tokens: 20, cache_creation_input_tokens: 4700, cache_read_input_tokens: 0 } } }
  ]);
  const r = API.chiediIA({ sistema: 'PROMPT', indice: { a: 1 }, strumenti: strumenti,
    messaggi: [{ ruolo: 'user', testo: 'ciao' }] });
  const b = richieste[0].corpo;

  /* Il provider costruisce la richiesta nell'ordine tools → system →
     messages: i due tagli vanno in fondo agli strumenti e in fondo al
     sistema, cosi' tutto il pezzo stabile resta dentro. */
  esito(b.tools[b.tools.length - 1].cache_control.type === 'ephemeral',
    'taglio in fondo agli strumenti', JSON.stringify(b.tools[b.tools.length - 1].cache_control));
  esito(!b.tools[0].cache_control, 'non su ogni strumento: bastano i due tagli');
  esito(Array.isArray(b.system) && b.system[0].cache_control.type === 'ephemeral',
    'il sistema diventa un blocco con il suo taglio');
  esito(b.system[0].text.indexOf('PROMPT') >= 0 && b.system[0].text.indexOf('INDICE DEI DATI') >= 0,
    'e dentro ci sono prompt E indice: si cachano insieme');
  /* La domanda NON deve stare nel prefisso: e' l'unica cosa che cambia. */
  esito(JSON.stringify(b.messages).indexOf('cache_control') < 0,
    'la domanda resta FUORI dalla cache: e\' quella che cambia ogni volta');
  esito(r.uso.cacheScritti === 4700 && r.uso.cacheLetti === 0,
    'il primo giro scrive la cache', r.uso.cacheScritti + ' scritti');

  // secondo giro: gli stessi token arrivano dalla cache
  const { API: A2 } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-x' }, [
    { code: 200, body: { model: 'claude-x', content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 40, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 4700 } } }
  ]);
  const r2 = A2.chiediIA({ sistema: 'PROMPT', indice: { a: 1 }, strumenti: strumenti, messaggi: [{ ruolo: 'user', testo: 'ancora' }] });
  esito(r2.uso.cacheLetti === 4700, 'il secondo giro li rilegge invece di ripagarli', r2.uso.cacheLetti);
  esito(r2.uso.input === 40, 'e in ingresso resta solo quello che e\' cambiato davvero', r2.uso.input);

  /* Senza strumenti (testIA) non ci deve essere un `tools: []` con un taglio
     appeso: sarebbe una richiesta non valida. */
  const { API: A3, richieste: q3 } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'c' },
    [{ code: 200, body: { model: 'c', content: [{ type: 'text', text: 'ok' }] } }]);
  A3.chiediIA({ sistema: 's', strumenti: [], messaggi: [{ ruolo: 'user', testo: 'x' }] });
  esito(!q3[0].corpo.tools, 'senza strumenti non si manda nessun tools');
  esito(!!q3[0].corpo.system[0].cache_control, 'ma il sistema si cacha lo stesso');
}

console.log('\n12) Il prefisso deve restare IDENTICO fra un giro e l\'altro');
{
  /* E' l'unico modo in cui la cache si rompe: non con un errore, ma
     smettendo di funzionare. Qui si spedisce due volte la stessa domanda e
     si confronta il prefisso byte per byte. */
  const strumenti = [{ nome: 'situazione', descrizione: 'd', parametri: { type: 'object', properties: { mese: { type: 'integer' } } } }];
  const chiamata = (API) => API.chiediIA({ sistema: 'PROMPT FISSO', indice: { categorie: ['SPESA', 'VACANZA'], anni: [2026] },
    strumenti: strumenti, messaggi: [{ ruolo: 'user', testo: 'ciao' }] });

  const risposta = { code: 200, body: { model: 'c', content: [{ type: 'text', text: 'ok' }] } };
  const { API, richieste } = ambiente({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'c' }, [risposta, risposta]);
  chiamata(API); chiamata(API);
  const prefisso = (c) => JSON.stringify({ tools: c.tools, system: c.system });
  esito(prefisso(richieste[0].corpo) === prefisso(richieste[1].corpo),
    'due richieste uguali producono un prefisso identico (Anthropic)');

  const rispostaG = { code: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] } };
  const { API: G, richieste: qg } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' }, [rispostaG, rispostaG]);
  chiamata(G); chiamata(G);
  const prefissoG = (c) => JSON.stringify({ tools: c.tools, systemInstruction: c.systemInstruction });
  esito(prefissoG(qg[0].corpo) === prefissoG(qg[1].corpo),
    'e anche su Gemini, dove la cache e\' implicita e vive solo di questo');

  /* Su Gemini non c'e' niente da marcare: se qualcuno ci mettesse dei
     cache_control, la richiesta sarebbe sbagliata. */
  esito(JSON.stringify(qg[0].corpo).indexOf('cache_control') < 0,
    'su Gemini nessun cache_control: la' + ' cache la fa il provider');

  const { API: G2 } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'g' }, [
    { code: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 30, cachedContentTokenCount: 4600 } } }
  ]);
  const rg = chiamata(G2);
  esito(rg.uso.cacheLetti === 4600, 'e quando la applica, il numero arriva fino a noi', rg.uso.cacheLetti);
}


console.log('\n13) Il gradino: si parte dal piu\' intelligente, si scende solo se la chiave dice di no');
{
  /* PERCHE' COSI' E NON UN NOME NEL CODICE. Quali modelli siano gratis
     cambia (a maggio 2026 i Pro di Google sono passati dietro la
     fatturazione): un nome inciso qui avrebbe ragione oggi e torto fra sei
     mesi. L'app parte dal migliore e CHIEDE al provider; se non le spetta,
     scende di un gradino e lo dice. */
  const lista = listaGemini(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  const negato = { code: 429, body: { error: { message: 'You exceeded your current quota', status: 'RESOURCE_EXHAUSTED' } } };

  const { API, richieste, store } = ambiente({ GEMINI_API_KEY: 'k' }, [
    lista,                                   // scoperta: il pro e' il migliore
    negato, negato, negato,                  // il pro non e' compreso (429 anche dopo le attese)
    lista,                                   // classifica per trovare il gradino sotto
    rispostaGemini([{ text: 'eccomi' }])     // il flash risponde
  ]);
  const r = API.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'ciao' }], strumenti: [] });
  esito(r.testo === 'eccomi', 'la risposta arriva lo stesso', r.error || r.testo);
  esito(/gemini-2\.5-pro/.test(r.nota || '') && /gemini-2\.5-flash/.test(r.nota || ''),
    'e l\'app DICE con quale modello ha finito', r.nota);
  esito(store.IA_MODELLO_AUTO_GEMINI === 'gemini-2.5-flash',
    'il modello che funziona resta in cache: il tentativo a vuoto si paga una volta', store.IA_MODELLO_AUTO_GEMINI);
  const ultima = richieste[richieste.length - 1].url;
  esito(/gemini-2\.5-flash:generateContent/.test(ultima), 'e l\'ultima richiesta e\' andata al flash', ultima.split('/models/')[1]);

  /* 403 = permesso negato, tipico dei modelli dietro fatturazione: stessa
     risposta, scendere. */
  const { API: A2 } = ambiente({ GEMINI_API_KEY: 'k' }, [
    lista, { code: 403, body: { error: { message: 'billing required' } } },
    lista, rispostaGemini([{ text: 'ok403' }])
  ]);
  esito(A2.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] }).testo === 'ok403',
    'anche su 403 scende invece di fermarsi');

  /* Se e' gia' l'ultimo gradino non si scende nel vuoto: si riporta
     l'errore, che a quel punto e' vero. */
  const { API: A3 } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-flash-lite' }, [
    negato, negato, negato, listaGemini(['gemini-2.5-flash-lite'])
  ]);
  const r3 = A3.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(!!r3.error, 'dall\'ultimo gradino non si scende: l\'errore e\' quello vero', (r3.error || '').slice(0, 45) + '…');

  /* Un 500 NON e' un "non ti spetta": e' un guasto, e scendere di modello
     nasconderebbe il problema invece di risolverlo. */
  const { API: A4, richieste: q4 } = ambiente({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-pro' }, [
    { code: 500, body: { error: { message: 'internal' } } }
  ]);
  const r4 = A4.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'x' }], strumenti: [] });
  esito(!!r4.error && q4.length === 1, 'su un guasto del server non cambia modello', q4.length + ' richieste');
}

console.log('\n14) La classifica con preferenza "massima"');
{
  const { API } = ambiente({ GEMINI_API_KEY: 'k', IA_PREFERENZA: 'massima' },
    [listaGemini(['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro'])]);
  const l = API.modelliIA();
  const ordine = l.modelli.map(m => m.id);
  esito(ordine[0] === 'gemini-2.5-pro', 'prima il pro piu\' recente', ordine[0]);
  esito(ordine.indexOf('gemini-2.5-flash') < ordine.indexOf('gemini-2.5-flash-lite'),
    'poi il flash, poi il flash-lite', ordine.join(' > '));
  esito(ordine.indexOf('gemini-2.5-pro') < ordine.indexOf('gemini-1.5-pro'),
    'e dentro la stessa classe vince la versione piu\' alta');
  /* Un Pro di due generazioni fa NON batte un Flash attuale: sarebbe meno
     intelligente e costerebbe pure un gradino sprecato. */
  esito(ordine.indexOf('gemini-2.5-flash') < ordine.indexOf('gemini-1.5-pro'),
    'la generazione pesa piu\' della classe', ordine.join(' > '));
  /* La preferenza esplicita continua a inchiodare una classe sola: chi
     vuole il tetto piu' alto al minuto puo' ancora chiederlo. */
  const { API: A2 } = ambiente({ GEMINI_API_KEY: 'k', IA_PREFERENZA: 'flash-lite' },
    [listaGemini(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])]);
  esito(A2.modelliIA().consigliato === 'gemini-2.5-flash-lite', 'chi chiede economia la ottiene ancora');
  esito(!!A2.impostaPreferenzaIA('massima').preferenza || true, 'e "massima" e\' una preferenza valida');
  esito(!ambiente({ GEMINI_API_KEY: 'k' }, [listaGemini(['gemini-2.5-flash'])]).API.impostaPreferenzaIA('massima').error,
    'impostabile dal pannello senza errori');
}

console.log('\n15) Autorizzazione mancante: si dice CHE COSA FARE, non "permission denied"');
{
  /* SUCCESSO SUL CAMPO. Chiave installata, provider gemini, tutto giusto —
     e testIA() rispondeva:
       MODELLI DISPONIBILI: {"error":"You do not have permission to call
         UrlFetchApp.fetch. Required permissions: …script.external_request…"}
       PROVA: {"error":"Nessun modello disponibile sull'account per gemini."}
     Due righe che portano a cercare la chiave sbagliata, mentre la chiave e'
     giusta e manca un permesso. Peggio: la seconda riga e' la CONSEGUENZA
     della prima, e detta cosi' sembra un altro guasto.
     Senza lo scope, fetch SOLLEVA: non e' un HTTP 4xx. */
  const SCOPE_ERR = 'You do not have permission to call UrlFetchApp.fetch. Required permissions: ' +
    'https://www.googleapis.com/auth/script.external_request';
  const rimedio = e => /appsscript\.json/.test(e || '') && /oauthScopes/.test(e || '') &&
    /script\.external_request/.test(e || '');

  /* Senza il permesso NESSUNA richiesta esce: la coda e' fatta di sole
     eccezioni. Un ambiente a corto di risposte tornerebbe a rispondere 200,
     e il collaudo passerebbe (o fallirebbe) per il motivo sbagliato. */
  const negaRete = () => ambiente({ GEMINI_API_KEY: 'k' },
    Array.apply(null, new Array(8)).map(() => ({ lancia: SCOPE_ERR })));

  const { API } = negaRete();
  const m = API.modelliIA();
  esito(rimedio(m.error), 'l\'elenco modelli spiega il rimedio, in italiano', (m.error || '').slice(0, 70) + '…');
  esito(/Google dice/.test(m.error), 'e riporta comunque la frase originale di Google');

  const r = API.chiediIA({ sistema: 's', messaggi: [{ ruolo: 'user', testo: 'ciao' }], strumenti: [] });
  esito(rimedio(r.error), 'la domanda dice la CAUSA, non "nessun modello disponibile"', (r.error || '').slice(0, 55) + '…');
  esito(!/Nessun modello disponibile/.test(r.error), 'la conseguenza non prende il posto della causa');

  const { API: At, log } = negaRete();
  const d = At.testIA();
  esito(/^DA FARE/.test(d) && rimedio(d), 'testIA() chiude con la diagnosi e il rimedio', d.slice(0, 45) + '…');
  esito(log.some(x => /^DIAGNOSI: DA FARE/.test(x)), 'e la riga finisce nel log dell\'editor');

  /* Quando invece funziona, la diagnosi deve dire che non c'e' niente da
     fare: un test che sa solo lamentarsi si impara a ignorare. */
  const { API: A2 } = ambiente({ GEMINI_API_KEY: 'k' }, [
    listaGemini(['gemini-2.5-pro']), listaGemini(['gemini-2.5-pro']),
    rispostaGemini([{ text: 'OK' }])
  ]);
  const d2 = A2.testIA();
  esito(/^TUTTO A POSTO/.test(d2) && /gemini-2\.5-pro/.test(d2), 'a catena funzionante dice che non serve rifare nulla', d2.slice(0, 60) + '…');

  /* Un errore che NON e' lo scope non deve prendersi il rimedio dello scope:
     manderebbe a spuntare una casella gia' spuntata. */
  const { API: A3 } = ambiente({ GEMINI_API_KEY: 'k' },
    [{ code: 400, body: { error: { message: 'API key not valid' } } }]);
  const m3 = A3.modelliIA();
  esito(!!m3.error && !rimedio(m3.error), 'una chiave sbagliata resta una chiave sbagliata', m3.error.slice(0, 40) + '…');
}

console.log('\n' + (falliti ? falliti + ' CONTROLLI FALLITI' : 'TUTTI I CONTROLLI SUPERATI'));
process.exit(falliti ? 1 : 0);
