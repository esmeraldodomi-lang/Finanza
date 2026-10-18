# ASSISTENTE IA — GESTIONE FINANZIARIA

> Scheda **Chiedi** dell'app Finanza. Si chiede, si analizza e **si agisce**
> — a voce o scrivendo, in italiano parlato. L'assistente arriva dove arriva
> l'app: registrare, spuntare, correggere, eliminare, riclassificare.

---

## 1. LA REGOLA CHE NON SI TOCCA

**L'assistente propone, tu confermi, l'app scrive.**

Nessuno strumento dell'IA scrive sul foglio. Tutte e **sei** le azioni
(`registra_spesa`, `spesa_ricorrente`, `segna_pagata`, `modifica_spesa`,
`elimina_spesa`, `imposta_necessita`) producono una **proposta**: le righe
esatte che verrebbero toccate, cosa cambia, le assunzioni fatte al posto tuo e
gli avvisi. Il salvataggio parte **solo** dal pulsante della scheda di
conferma, che è l'unico punto della chat da cui esce una scrittura.

Non è prudenza generica: una ricorrente sono fino a **120 righe vere** nel
foglio, e cancellarle poi è un lavoro. È la stessa cautela che il modulo
"Ricorrente" ha già, e qui vale di più, perché quelle righe le ha proposte una
macchina.

Sopra una riga la conferma è **doppia** (pulsante → «Confermi?»).

---

## 2. DUE LIVELLI, E IL PRIMO È GRATIS PER SEMPRE

| | Motore locale | Modello collegato |
|---|---|---|
| Dove gira | nel telefono | Gemini / Vertex / Claude |
| Costo | zero, nessun limite | piano gratuito Gemini: tetto **al minuto** |
| Capisce | l'italiano di tutti i giorni | qualsiasi frase, e ragiona |
| Serve una chiave | no | sì (gratuita) |
| Può registrare spese | **sì** | sì (stessa proposta) |

**Senza nessuna chiave l'app risponde e registra lo stesso.** Il motore locale
(`finInterpreta` + `finRispondi`) riconosce importo, categoria, nota, data,
periodo e ricorrenza, e copre le domande di tutti i giorni: quanto ho speso,
cosa devo pagare, quanto mi resta, le ricorrenti, la ripartizione, le entrate,
le spese più grandi.

Il modello si aggiunge **sopra**, non al posto: riceve un **indice** di cosa
esiste (~1 KB) e **15 strumenti**; quando gli serve un numero chiama lo
strumento, che gira **nel browser** sui dati già caricati. Non riceve mai il
foglio: riceve la risposta alla domanda che ha fatto.

E la risposta già calcolata in locale viaggia **in coda alla domanda**, marcata
come verificata: così una domanda frequente costa zero strumenti e zero attesa.

---

## 3. LA VOCE — TOCCHI, PARLI, PARTE (E TI RISPONDE)

Il microfono accanto al campo di scrittura: lo tocchi, dici *«aggiungi
trentacinque euro di spesa»*, e appena smetti di parlare la frase **parte da
sola**. Mentre parli il testo compare nel campo, così vedi subito se ti ha
capito.

**L'invio automatico è sicuro per un motivo preciso, non per fiducia**:
dettare non scrive niente sul foglio. Al massimo produce una **proposta**, che
resta lì finché non premi Conferma. Se ha capito male, lo vedi e annulli — la
voce arriva alla proposta, mai al foglio.

### Cosa viene sistemato del dettato
Il riconoscimento consegna una frase, non un dato. Due cose sbagliano quasi
sempre, e sono le due che contano su una spesa:

| Dici | Il browser scrive | Arriva all'interprete |
|---|---|---|
| «venti euro» | `venti euro` | `20 euro` |
| «venti virgola cinquanta» | `20 virgola 50` | `20,50` |
| «trentacinque» | `trentacinque` | `35` |
| «centocinquanta» | `centocinquanta` | `150` |

**Il resto della frase non si tocca**: quello che compare in chat dev'essere
quello che hai detto, altrimenti non si capisce più perché l'app abbia capito
una cosa invece di un'altra.

Due limiti dichiarati:
- **una parola-numero per volta**: «venti tre» resta `20 3`, non diventa 23.
  Nessuno detta così un importo, e sommarli sarebbe inventare;
- **le parole ambigue** (`un`, `una`, `uno`, `sei`) diventano cifre **solo**
  se subito dopo c'è la valuta: *«una spesa»* resta una spesa, *«sei euro»*
  diventa `6 euro`.

### Su iPhone si detta con la tastiera, e l'app lo sa prima di provare
Dentro la cornice di Apps Script il microfono **della pagina** non parte, e su
iOS non c'è browser che tenga: sono tutti WebKit. Quindi su iPhone il pulsante
**non prova nemmeno**: diventa **⌨**, apre il campo di scrittura (così la
tastiera sale da sola) e indica il 🎙 della tastiera, in giallo — è
un'istruzione, non un errore.

Fuori da iOS non si indovina: si prova, e **se il browser dice di no una
volta** (`not-allowed`) da lì in avanti il pulsante passa alla tastiera.
Disabilitarlo per prudenza toglierebbe una funzione a chi ce l'ha; riprovare
all'infinito una strada chiusa insegna solo che l'app è rotta.

La decisione sta in `finVoceMotivo({api, ios, cornice, gia})` — funzione pura,
l'ambiente arriva come dati e si prova in Node.

### La dettatura della tastiera è capita come quella del microfono
`finVoceTesto` (numeri a parole → cifre, *«20 virgola 50»* → `20,50`) ora gira
dentro **`finInterpreta`**, quindi vale per **qualunque** testo: dettato dalla
tastiera, incollato o digitato. Prima *«venti euro»* valeva meno di *«20
euro»* solo perché era entrato da un'altra porta. È idempotente — le cifre
restano cifre — e resta prudente dov'era: `sei` diventa 6 **solo** davanti
alla valuta.

### Quando il microfono non parte
L'app vive **dentro una cornice (iframe) di Google**, e il microfono in una
cornice di un altro sito funziona solo se quella cornice concede il permesso —
cosa che non dipende da questo codice. Perciò il pulsante **non promette**: se
non parte, dice perché (`Microfono bloccato`, `Nessun microfono`, `serve la
rete`, `browser senza riconoscimento vocale`) e indica sempre la via che
**funziona in ogni caso**:

> il tasto microfono della **tastiera del telefono**: detta lì dentro e poi invii.

È la dettatura del sistema operativo, non della pagina: nessun permesso di
cornice, nessuna dipendenza dal browser.

### La risposta a voce
L'assistente legge la risposta **solo quando la domanda è arrivata a voce**.
Se hai scritto stai guardando lo schermo, e sentirsi leggere quello che si sta
già leggendo è fastidioso; per quel caso c'è il pulsante **▸ ascolta** sotto
ogni risposta. L'altoparlante nell'intestazione (🔊/🔇) spegne tutto, e la
scelta si ricorda.

Quello che si legge e quello che si ascolta **non sono la stessa cosa**
(`finDaLeggere`): a voce il markdown è rumore — asterischi e cancelletti
vengono pronunciati o spezzano la frase — gli a capo devono diventare pause
vere, e i centesimi a zero spariscono (*«millecinquecento euro»*, non
*«millecinquecento virgola zero zero euro»*). Una risposta lunga si taglia a
**frase intera** e lo dichiara: meglio una frase in meno che una troncata a
metà parola.

Due dettagli che si vedono solo provandolo sul telefono:
- **toccare il microfono zittisce il parlato** — nessuno vuole che
  l'assistente si ascolti da solo;
- su iPhone il parlato parte solo se il primo `speak` nasce da un tocco:
  quello vero arriva dopo, da una callback, e verrebbe ignorato in silenzio.
  Il motore viene «scaldato» al primo tocco utile.

### Da sapere
- **Dove va l'audio**: il riconoscimento del browser non è locale — Chrome
  manda l'audio ai server di Google. Non passa dall'app né dal foglio, ma non
  è una cosa che succede sul telefono e basta. **La voce in uscita invece sì**:
  `speechSynthesis` è il motore del telefono, gratis, funziona senza rete e
  non manda niente a nessuno.
- **Browser**: Chrome e Safari ce l'hanno (`webkitSpeechRecognition`), Firefox
  no. Dove manca, il pulsante lo dice invece di non fare niente.
- **Mentre ascolta** il bordo diventa rosso e il pulsante pulsa; con «riduci
  movimento» attivo resta solo il colore.

## 4. COLLEGARE IL MODELLO GRATUITO (5 minuti)

1. chiave da **aistudio.google.com/apikey** (piano gratuito, nessuna carta);
2. editor Apps Script → **Impostazioni progetto → Proprietà script** →
   `GEMINI_API_KEY` = la chiave;
3. eseguire una volta **`testIA()`** dall'editor: autorizza lo scope
   `script.external_request` e prova tutta la catena (stato, elenco modelli,
   una domanda). L'ultima riga del log è la **diagnosi**: o
   `TUTTO A POSTO: provider …, modello …` oppure `DA FARE: …` con il rimedio.

Fatto.

### Se il log dice «You do not have permission to call UrlFetchApp.fetch»
**La chiave è giusta, manca il permesso di uscire in rete.** Succede quando il
progetto era già autorizzato *prima* che il codice facesse chiamate HTTP: se il
manifest elenca gli scope a mano, Apps Script non ne aggiunge uno nuovo da solo
e la schermata di consenso non ricompare.

1. **Impostazioni progetto** → spunta *«Mostra il file manifest appsscript.json
   nell'editor»*;
2. apri **`appsscript.json`** e **aggiungi** lo scope all'elenco (non
   sostituire il file: `timeZone`, `runtimeVersion` e l'eventuale sezione
   `webapp` devono restare come sono). Se `oauthScopes` non c'è, si crea:

   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/script.external_request"
   ]
   ```

   `spreadsheets` serve a `SpreadsheetApp.openById`, `script.external_request`
   a `UrlFetchApp.fetch`. Con Vertex si aggiunge anche
   `https://www.googleapis.com/auth/cloud-platform`. Il modulo Auto ne vuole
   altri quattro (email, Calendar, trigger, indirizzo del proprietario):
   l'elenco completo è nel `README.md`, §4;
3. salva ed esegui di nuovo **`testIA()`**: ora compare *Rivedi autorizzazioni*
   → account → **Avanzate** → *Vai a … (non sicuro)* → **Consenti**;
4. se il consenso non compare ancora, revoca l'accesso dell'app da
   **myaccount.google.com/permissions** e riesegui `testIA()`.

Dopo l'autorizzazione **va rifatta la distribuzione** (*Distribuisci → Gestisci
distribuzioni → Modifica → Nuova versione*): la web app gira con gli scope
concessi alla versione pubblicata, non con quelli dell'editor.

Perché l'app lo dice così e non ripete l'inglese di Google: quella frase, letta
accanto a `provider: "gemini"` e a un secondo errore che dice *«nessun modello
disponibile»*, manda a cercare una chiave sbagliata. La chiave è giusta, il
secondo errore è la **conseguenza** del primo, e il rimedio è una casella da
spuntare una volta sola — quindi si scrive il rimedio (`IA_SCOPE_RIMEDIO`), e
la frase originale resta in coda fra parentesi. **Il modello non si sceglie e non si scrive nel codice**, e non è
pigrizia: quali modelli siano gratis cambia — a maggio 2026 i Pro di Google
sono passati dietro la fatturazione, domani potrebbero tornare. Un nome inciso
qui avrebbe ragione oggi e torto fra sei mesi.

### Si parte dal più intelligente, si scende solo se la chiave dice di no
La preferenza predefinita è **Massima**: l'app scopre i modelli che il tuo
account espone davvero e li mette in fila per **generazione prima, classe
poi** — un Pro di due generazioni fa non è più intelligente di un Flash
attuale, e sceglierlo costerebbe anche un gradino sprecato.

Poi **chiede al provider**. Se il modello migliore risponde `429` che resta
pieno anche dopo le attese, o `403` (permesso negato — i modelli dietro
fatturazione), quella non è una coda e non è un guasto: è un *«non ti
spetta»*. L'app **scende di un gradino, riprova, e lo dice**:

> *Il modello gemini-2.5-pro non è disponibile su questa chiave: sto usando
> gemini-2.5-flash.*

Il modello che funziona resta in cache 12 ore, quindi il tentativo a vuoto si
paga una volta al giorno — ed è anche il modo in cui l'app **si accorge da
sola** quando un modello più capace diventa disponibile.

Due cose che il gradino NON fa: non scende su un `500` (quello è un guasto del
server, e cambiare modello nasconderebbe il problema) e non scende oltre
l'ultimo gradino (lì l'errore è vero e va riportato).

Dalla pastiglia in alto nella scheda si cambia preferenza (**Massima /
Qualità / Equilibrio / Economia**) o si fissa un modello a mano.

Alternative, sempre a chiave propria: `VERTEX_PROJECT` (+ `VERTEX_LOCATION`,
scope `cloud-platform`) oppure `ANTHROPIC_API_KEY`. Con più di una configurata
vince quella gratuita, salvo `IA_PROVIDER` esplicito.

### Il 429 non è un guasto
Sul piano gratuito il tetto è **al minuto**, e un giro agentico consuma una
richiesta per ogni dato consultato. Il provider dice quanto aspettare
(`RetryInfo` su Gemini, `Retry-After` su Anthropic): l'app **aspetta quel
tempo** e riprova, al massimo 2 volte e restando sotto i 6 minuti di
esecuzione di Apps Script. Se resta pieno lo dice in italiano.

Per consumare meno: il prompt chiede di chiamare gli strumenti **in parallelo
nello stesso turno** e di non chiamarli affatto quando la risposta già
calcolata basta. Massimo 5 giri per domanda.

### Quanto pesa una domanda (misurato, non stimato)

| Cosa riparte a ogni giro | Caratteri | Token ≈ |
|---|---:|---:|
| Prompt di sistema | 3.300 | 920 |
| Indice dei dati | 2.839 | 790 |
| Dichiarazione dei 22 strumenti | 10.662 | 2.960 |
| **Fisso per giro** | 16.801 | **4.700** |

L'output è piccolo (200–400 token). Una domanda che consulta un dato sono due
giri, una che ne incrocia due sono tre: **il fisso si paga a ogni giro**.

### La cache del prefisso — e come accorgersi che si è rotta
Quei 4.700 token sono **identici** da un giro all'altro. Marcandoli si pagano
una volta e poi valgono circa un decimo: sul pattern d'uso reale taglia
l'80–90% dell'ingresso, che è dove sta quasi tutta la spesa.

- **Anthropic**: due tagli espliciti, in fondo agli **strumenti** e in fondo al
  **sistema**. L'ordine con cui il provider costruisce la richiesta è
  `tools → system → messages`, quindi così tutto il pezzo stabile resta dentro
  la cache e **la domanda — l'unica cosa che cambia — resta fuori**.
- **Gemini / Vertex**: la cache è **implicita**, non c'è niente da marcare.
  C'è una cosa da non rompere: il prefisso è costruito in modo deterministico
  e va tenuto così.

**Una cache non si rompe con un errore: smette di funzionare in silenzio.**
Basta un byte diverso nel prefisso — un'ora, un id casuale, una chiave di
oggetto che cambia ordine — e si continua a pagare tutto senza che niente lo
segnali. Per questo `uso.cacheLetti` e `uso.cacheScritti` viaggiano fino
all'app, e il collaudo confronta il prefisso di due richieste **byte per
byte**.

---

## 5. I 22 STRUMENTI

**Com'è andata** — `situazione` · `spese_per_categoria` ·
`dettaglio_categoria` · `cerca_movimenti` · `confronta_periodi` ·
`previsione_spese` · `andamento_conto` · `ripartizione` · `elenco_categorie` ·
`spese_ricorrenti` · `da_pagare` · `top_spese` · `entrate`

**E adesso?** — `quanto_posso_spendere` (quanto resta prima della soglia di
guardia, e quanto al giorno per i giorni che mancano) · `dove_tagliare` (le
categorie "vita" che pesano di più, con quanto costano al mese) · `anomalie`
(i movimenti fuori scala rispetto alla **mediana delle altre spese** della
loro categoria).

**Azioni — preparano, non scrivono** — `registra_spesa` · `spesa_ricorrente` ·
`segna_pagata` · `modifica_spesa` · `elimina_spesa` · `imposta_necessita`

Uno strumento chiamato con un valore che non esiste risponde **errore + i
valori veri** (`valoriDisponibili`): il modello corregge invece di inventare.

### Le azioni su righe che esistono già
Le ultime quattro sono di natura diversa dalle prime due: non creano un dato
nuovo, **toccano una riga che c'è già**. Da cui tre regole che valgono solo
per loro:

1. **La riga va individuata, non indovinata.** `modifica_spesa` ed
   `elimina_spesa` pretendono **una riga sola**: se la descrizione ne trova
   più d'una, lo strumento si ferma e restituisce l'elenco (`candidati`).
   Scegliere «la prima» vorrebbe dire cambiare un dato a caso.
   `segna_pagata` è l'unica che accetta più righe, perché «segna pagate tutte
   le bollette» è una frase sensata mentre «modifica tutte le bollette» no.
2. **Il foglio può essere cambiato nel frattempo.** Ogni azione porta con sé
   categoria e importo attuali: il server li riconfronta con la riga vera e
   **rifiuta** se non combaciano. È il controllo che `setStato`,
   `modificaSpesa` ed `eliminaSpesa` hanno già; l'archivio nel telefono è
   fermo all'ultima sincronizzazione, e su una scrittura la vecchiaia fa
   danno. Dopo un aggiornamento in blocco la scheda dice quante righe sono
   state **saltate** e perché, invece di arrotondare a «fatto».
3. **`salvaCategorie` riscrive l'intera mappa.** Mandare solo la categoria
   toccata cancellerebbe in silenzio tutte le altre scelte già fatte: la mappa
   si manda **intera**, con dentro la modifica.

### «Ho pagato la bolletta» non è una spesa nuova
La differenza la fa **l'importo**: se lo dici stai registrando qualcosa di
nuovo, se non lo dici stai spuntando qualcosa che esiste già. Senza questa
distinzione, *«ho pagato l'affitto»* creerebbe un secondo affitto. Vale sia
per il motore locale sia per il modello (regola 7 del prompt).

### Cosa NON può fare
Non tocca **entrate**, **bollette** e **riscaldamento**: quei fogli hanno
colonne il cui significato non è ricavabile da qui (quale voce di entrata,
quale lettura del contatore), e inventarlo sarebbe peggio che non farlo. Si
compilano dai moduli dell'app.

---

## 6. LE ASSUNZIONI SI DICHIARANO

Quando manca un dato, la proposta non decide in silenzio: assume e **lo
scrive**, nel blocco «HO ASSUNTO» della scheda.

- periodo non detto → *«Fine: dicembre — nessuna scadenza detta, si ferma a
  fine anno. Cambiala prima di confermare.»*
- giorno non detto → il giorno di oggi;
- categoria mai vista → dichiarata **nuova**, nasce come "vita";
- tipo non detto → quello prevalente della categoria.

Ogni assunzione porta con sé **il campo** a cui si riferisce, e resta a
schermo finché non sei tu a cambiare quel campo. Senza questo, appena la
scheda si ridisegna con valori tutti espliciti il calcolo non avrebbe più
niente da assumere e le decisioni prese al posto tuo **sparirebbero dallo
schermo**: era il difetto trovato guardando la pagina vera.

### Avvisi che si vedono solo guardando lo storico
- **possibile doppione**: ne esiste già una uguale in quel mese;
- **importo insolito**: fuori scala rispetto alla media di quella categoria
  (almeno 3 spese precedenti);
- **carta di credito**: l'addebito slitta al mese successivo, il 15;
- **molte righe**: sopra 24 lo dice esplicitamente.

Nessuno di questi blocca: segnalano.

---

## 7. LA PAGINA — impianto da assistente

Il layout è quello di un assistente vero (è su Gemini che gira); i **colori
restano quelli dell'app**: fondo navy, verde `#37D6A0`, rosso solo per gli
alert. Non è una scelta estetica: è la regola di stile del progetto.

### Le conversazioni sono un elenco, non una sola
Con una chat sola, «Nuova» **cancellava**: l'unico modo di cambiare argomento
era buttare via quello di prima. Ora ☰ apre il cassetto: *Nuova
conversazione*, l'elenco delle ultime **30** (titolo = la prima domanda,
quando, quante domande), rinomina ✎ ed elimina ✕. La conversazione si **mette
da parte e si ritrova**, ed è anche l'unico modo perché la memoria del modello
(gli ultimi turni) resti attaccata all'argomento giusto invece di mescolare la
spesa di ieri con l'analisi di oggi.

**L'id della chat attiva vive in un REF, e il ref è la verità.** Una domanda
produce **più scritture** (la domanda, poi ogni passaggio del ciclo agentico) e
quelle dopo la prima arrivano da callback che hanno in mano lo stato di un
render precedente: rileggendo l'id dallo stato, ogni passaggio si
inventerebbe una conversazione diversa e quella a schermo resterebbe a «ci
penso» per sempre.

La cronologia vecchia (chiave `chat1`, una conversazione sola) **non si
butta**: `finChatMigra` la trasforma nella prima dell'elenco.

### Cosa si può fare di una risposta
- **▸ ascolta** — la voce non parte da sola se hai scritto (§3), ma è a un tocco.
- **⧉ copia** — l'unico modo di portare una risposta fuori dall'app.
  `navigator.clipboard` dentro una cornice può essere negato: c'è il ripiego
  con la textarea nascosta.
- **↻ rigenera** — rifà la domanda **togliendo la vecchia risposta dalla
  storia** mandata al modello. Con quella davanti, la seconda risposta sarebbe
  la prima ricopiata e il pulsante non servirebbe a niente.
- **✎ modifica** (sotto la tua domanda) — la riporta nel campo e toglie la
  coppia domanda/risposta: correggerla è un rifacimento pulito, non una
  seconda domanda appiccicata sotto la prima.

### FERMA
Mentre pensa, il pulsante di invio **diventa ■**: è l'unico posto dove uno lo
cerca e l'unico momento in cui serve. Un giro agentico consulta fino a sei
dati di fila — se hai già visto quello che ti serve, aspettare è tempo buttato
e quota bruciata. La richiesta in volo non si può richiamare indietro: si
**smette di ascoltarla** (e quando arriva viene ignorata, altrimenti il
pulsante sarebbe una bugia), e il messaggio lo **dichiara** invece di sembrare
finito.

### Dettagli che si vedono solo usandola
- **La barra di scrittura è una textarea che cresce** fino a 132 px, poi
  scorre. Invio manda, Maiusc+Invio va a capo.
- **Si scorre in fondo solo se ci sei già**: se sei risalito a rileggere,
  trascinarti giù a ogni passaggio ti strappa via la riga. Quando non ti
  segue compare la freccia **↓**.
- **L'attesa è tre punti che pulsano**, non una rotellina: dice «sto
  scrivendo», che è quello che sta succedendo.
- **Il saluto guarda l'ora del telefono** (`finSaluto`): è l'unica cosa che
  cambia da sola durante il giorno, e un «Buongiorno» alle undici di sera
  farebbe sembrare che l'app non sappia dov'è.
- **Lo spazio sotto i messaggi è misurato, non a occhio**: 84 px, perché in
  Chromium a 390×844 la barra è alta 58 e le azioni sotto l'ultima risposta ne
  chiedono altri 24. Senza, il tocco su «conferma» finiva nel campo di testo.

## 8. COME È FATTO

```
Finanze.html
  ANALISI:CORE   previsioni, categorie, quadranti, lettura del conto
  IA:CORE        interprete italiano, indice, 15 strumenti, proposte,
                 motore locale, prompt      ← senza JSX e senza React
  ChatFin / PropostaCard / AzioneCard / IaConfig / FinTesto / FinTabella
                 interfaccia (componenti top-level fuori da App)
FINANZE.gs
  chiediIA()     ponte neutro verso il provider; NON esegue strumenti;
                 marca la cache del prefisso e riporta i token risparmiati
  statoIA() modelliIA() impostaModelloIA() impostaPreferenzaIA() testIA()
```

**Contratti da non rompere**

- `IA:CORE` resta **senza React e senza browser**: è quello che lo rende
  provabile in Node. Il collaudo lo verifica sul codice (non sui commenti).
- I componenti stanno **fuori da `App`**: dentro, la loro identità cambierebbe
  a ogni render e i campi perderebbero il focus a ogni tasto.
- **Una derivazione sola**: `finModello` calcola le righe del mese per la
  Panoramica *e* per l'assistente. Con due copie, quando divergono non c'è
  modo di sapere quale saldo sia quello giusto.
- **Due schede, due nature.** `PropostaCard` costruisce un dato nuovo: è un
  modulo, ogni campo si può ancora cambiare. `AzioneCard` tocca una riga che
  esiste già: mostra **prima → dopo** e le righe interessate, e non finge di
  essere modificabile. Far sembrare un modulo una riga che si sta per
  cancellare sarebbe la peggiore delle scorciatoie.
- **L'anteprima è quello che verrà scritto**: `finRigheSpesa` /
  `finRigheRicorrenti` sono il calco di `salvaSpesa` / `salvaRicorrente`. Il
  collaudo non li confronta con un'idea: dà il payload della proposta alle
  **vere** funzioni del foglio e confronta le righe uscite con quelle mostrate.
- **La firma del pensiero** (`thoughtSignature`) torna al modello **identica**:
  senza, i modelli che ragionano rispondono HTTP 400 e la chat si ferma al
  secondo strumento. Nelle chiamate in parallelo il modello firma solo la
  prima: la firma si conserva dove c'è e **non si copia** sulle altre.
- La chat si conserva fra le sessioni, **le proposte no**: una proposta è un
  calcolo sui dati di quel momento, e ritrovarla pronta da confermare giorni
  dopo sarebbe un pulsante che scrive numeri vecchi. Ne resta la traccia, che
  lo dice.

---

## 9. TRAPPOLE GIÀ PAGATE (non reintrodurle)

- **"speso" dista un refuso da "SPESA"**: sull'intera frase il refuso **non**
  si perdona, altrimenti *«quanto ho speso a gennaio»* risponderebbe il totale
  della sola categoria SPESA — un numero più piccolo del vero con l'aria di
  essere giusto. Il refuso si perdona solo dove una categoria è **nominata**.
- **"MAGGIORI" contiene "MAGGIO"**: il mese si riconosce a parola intera.
- **Un numero non è un importo**: in *«il 5 marzo ho speso 20 euro per 6
  mesi»* i numeri sono tre. Vince quello attaccato alla valuta; senza valuta
  si scartano anni, giorni e conteggi di rate.
- **Il periodo non è nota**: *«…con nota albergo da gennaio a giugno»* deve
  dare nota `albergo`, non `albergo da gennaio a giugno`.
- **Una domanda resta una domanda**: *«quanto spendo di spesa ogni mese?»*
  contiene "ogni mese" ma non crea nessuna ricorrente. Serve un verbo di
  comando **e** un importo, e la frase non deve iniziare come una domanda.
- **In italiano `1500` non prende il punto delle migliaia** (compare da cinque
  cifre: `12.500`). È CLDR, non un errore di formattazione.
- **Sei voci nella barra in basso**: a 10,5px la fila misurava 322px su uno
  schermo da 320 e "Movimenti" veniva tagliata — e siccome la barra è
  `position:fixed`, il taglio non produce nemmeno uno scorrimento che lo
  denunci. A 9,5px la fila sta in 288px.
- **`salvaCategorie` non aggiorna: riscrive.** Mandare la sola categoria
  toccata avrebbe cancellato tutte le altre classificazioni, in silenzio e
  senza errori.
- **Una spesa fuori scala non deve entrare nel proprio riferimento**: se la
  mediana della categoria comprende anche lei, si alza il riferimento e si
  difende da sola. Su quattro movimenti con un picco da 900 la differenza è
  fra «3,5 volte» e «4,5 volte», e la soglia sta lì in mezzo.
- **Una funzione condivisa va estesa insieme ai casi nuovi**:
  `finPropostaSintesi` conosceva solo le proposte di spesa e andava in
  eccezione sulle azioni nuove — non fallendo lì, ma facendo cadere l'**intero
  giro agentico**, così che la scheda non compariva e basta. L'ha trovata il
  collaudo in pagina, non la lettura del codice.
- **Un collaudo non si aggancia a una frase dell'interfaccia**: il test cercava il campo della chat dal testo del segnaposto. Cambiandolo per il microfono, mezzo collaudo è caduto — e non dicendo «il segnaposto è diverso», ma smettendo di scrivere e fallendo su tutt'altro. Ora il campo si prende dalla struttura (l'unico `input` dentro il `form`).
- **La barra di scrittura può coprire il pulsante**: sotto i messaggi c'è uno
  spazio apposta, e si scorre al fondo del **documento**, non all'ultimo
  elemento.
- **Una chat sola non è un caso particolare di un elenco di chat**: con una
  sola, «Nuova» non poteva che cancellare. E l'id della chat attiva **non si
  rilegge dallo stato** dentro una callback: una domanda produce più
  scritture, e quelle dopo la prima hanno in mano il render di prima —
  ognuna si aprirebbe una conversazione sua, lasciando quella a schermo a «ci
  penso» per sempre.
- **Un pulsante FERMA che non ignora la risposta in volo è una bugia**: la
  richiesta parte comunque e, quando torna, ricomparirebbe la risposta che hai
  chiesto di non aspettare.
- **Rigenerare senza togliere la vecchia risposta dalla storia** restituisce
  la stessa risposta: il modello la vede lì davanti e la ricopia.
- **Un collaudo non conta i messaggi leggendo il testo della pagina**: i
  suggerimenti della schermata vuota contengono frasi quasi identiche alle
  domande, e il conteggio sbaglierebbe proprio nel caso che interessa (chat
  vuota). Si contano i pulsanti «modifica», che esistono solo sotto una
  domanda vera.
- **Il setter nativo deve essere quello del tipo giusto**: la barra della chat
  è diventata una `textarea` e il collaudo scriveva ancora con
  `HTMLInputElement.prototype`. Non dà errore — il valore semplicemente non
  arriva, e il collaudo cade venti righe più in là.
- **Un `catch` che rigira `e.message` trasforma un rimedio in un mistero**:
  senza lo scope `script.external_request`, `UrlFetchApp.fetch` **solleva**
  (non è un HTTP 4xx) e la frase inglese di Google finiva a schermo accanto a
  `provider: "gemini"`, con in coda un secondo errore — *«nessun modello
  disponibile»* — che è solo la **conseguenza** del primo. Tre righe che
  descrivono l'accaduto e non dicono cosa fare. Ora la causa si riconosce, il
  rimedio è scritto in italiano, la conseguenza non prende il posto della
  causa, e `testIA()` chiude con `TUTTO A POSTO` oppure `DA FARE: …`.

---

## 10. VERIFICHE

```bash
node check_babel.js          # sintassi + compatibilità Safari + guardie
node smoke_ia.js             # motore: interprete, strumenti, proposte, azioni,
                                     # elenco conversazioni, e il confronto con i VERI
                                     # salvaSpesa/salvaRicorrente
node smoke_ia_backend.js     # ponte verso i provider e cache del prefisso, senza rete
node smoke_ia_pagina.js      # chat montata in jsdom: niente scrive senza il pulsante,
                                     # le conversazioni non si cancellano, FERMA ferma davvero,
                                     # copia/rigenera/modifica
node smoke_boot.js           # l'app parte ancora
node smoke_analisi.js smoke_server.js smoke_colonne.js smoke_bollette.js
```

Dipendenze dei collaudi in pagina, da installare **in un solo comando**
(installazioni `--no-save` separate si sfrattano a vicenda):

```bash
npm i --no-save --legacy-peer-deps jsdom react@18.2.0 react-dom@18.2.0
```

Le misure di larghezza della barra e le posizioni della pagina IA (§7) sono
state prese in **Chromium a 390×844**: jsdom non fa layout: non ha CSS
applicato né dimensioni, quindi può dire che un pulsante *esiste* ma mai che
è *raggiungibile*. Le due cose misurate lì e non altrove: la fila delle sei
schede sta in 288 px su uno schermo da 320, e la barra di scrittura non copre
le azioni sotto l'ultima risposta (58 + 24 → 84 px di spazio).
