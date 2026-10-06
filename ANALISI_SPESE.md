# SPECIFICA E GUIDA — ANALISI SPESE (OVERVIEW ANNO)

> Documentazione ufficiale della funzione **Analisi Spese** dell'app `finanze/`.

---

## 1. OBIETTIVO E PANORAMICA

La sezione **Analisi Spese** (`tab: "analisi"`) fornisce una suite completa di analisi finanziaria basata sui dati storici e previsionali dell'archivio Google Sheets / database locale.

Il fulcro della sezione è la vista **Overview Anno**, che sintetizza l'intero anno in una matrice a griglia interattiva, seguita dalle righe di chiusura e dal grafico temporale del conto corrente.

---

## 2. STRUTTURA DELLA VISTA "OVERVIEW ANNO"

### A. Matrice Categorie × 12 Mesi
- **Colonna sinistra (Sticky)**: Elenco di tutte le categorie censite, con indicatore cromatico di necessità:
  - Turchese (`#4E9AA6`): Spesa **Necessaria**
  - Indaco (`#8A7DEF`): Spesa **Vita**
  - Indicazione del tipo (*Fissa* o *Variabile*).
- **Intestazione orizzontale**: I 12 mesi dell'anno (`GEN`, `FEB`, `MAR`, `APR`, `MAG`, `GIU`, `LUG`, `AGO`, `SET`, `OTT`, `NOV`, `DIC`), seguiti dalle colonne di riepilogo **TOTALE ANNO** e **MEDIA MESE**.
- **Celle interne**: Totale esatto speso per ciascuna categoria nel rispettivo mese.
  - Celle a zero indicate con trattino discreto (`—`).
  - Celle con importo evidenziate con numeri tabulari monospace.
  - **Interattività (Drill-down)**: Toccando qualsiasi cella con importo si apre il modal di dettaglio che mostra tutti i singoli movimenti che compongono quel totale (data esatta, nota/descrizione, metodo di pagamento carta/conto, stato pagata o da pagare, importo singolo).

### B. Le Tre Righe di Chiusura
Subito sotto l'elenco delle categorie, la tabella presenta tre righe aggregate di chiusura:
1. **▼ USCITE TOTALI DEL MESE**:
   - Somma di tutte le uscite per ciascun mese dell'anno.
   - Totale uscite annuale e media mensile.
   - Evidenziata con colore rosso corallo (`C.neg`).
2. **▲ ENTRATE TOTALI DEL MESE**:
   - Entrate complessive previste e registrate per ciascun mese.
   - Monte entrate annuale e media mensile.
   - Evidenziata con colore verde smeraldo (`C.disp`).
3. **◆ RISPARMI DEL MESE**:
   - Formula: `Risparmio = Entrate del Mese − Uscite del Mese`.
   - Evidenziazione dinamica:
     - Verde (`+X €`) con percentuale del tasso di risparmio se positiva.
     - Rosso (`−X €`) se le uscite superano le entrate.
   - Totale risparmio netto cumulato dell'anno e tasso di risparmio medio annuo.

### C. Grafico Andamento Conto Corrente (Sotto la Tabella)
Posizionato immediatamente sotto la tabella matrice:
- **Traiettoria temporale**: Curva SVG continua dell'evoluzione del saldo conto mese per mese (`projectedCC`).
- **Aree e soglie visive**:
  - Area verde smeraldo per saldi positivi.
  - Area rossa di allerta per saldi negativi (sotto lo zero).
  - Linea tratteggiata ambra per la **soglia di sicurezza** (predefinita a 500 €).
- **Sincronizzazione interattiva**:
  - Toccando un mese nel grafico (o l'intestazione di colonna nella tabella), il mese selezionato viene evidenziato in tutta la schermata.
  - Scheda focus con: Saldo a inizio mese, Entrate, Uscite, Risparmio netto e Saldo finale a fine mese.
  - Indicatori KPI: Saldo iniziale (`ccStart`), Punto più basso dell'anno (`min`), Punto più alto (`max`), Numero di mesi trascorsi sotto soglia.

---

## 3. STRUMENTI DI FILTRO E RICERCA

Nella testata della sezione sono disponibili controlli reattivi immediati:
- **Filtro di Necessità**: `Tutte`, `Necessarie`, `Vita`.
- **Filtro di Tipologia**: `Tutti`, `Fisse`, `Variabili`.
- **Ricerca testuale**: Campo di input per filtrare istantaneamente per nome categoria.
- **Ordinamento**:
  - *Totale ↓* (dalla categoria più costosa alla minore)
  - *Totale ↑* (crescente)
  - *Nome A-Z* (alfabetico)
  - *Necessità* (necessarie prima, poi vita)
- **Selettore Anno**: Pulsanti rapidi per visualizzare e confrontare qualsiasi anno registrato nel database (`data.anni`).

---

## 4. LE ALTRE SOTTO-VISTE DI ANALISI DISPONIBILI

Oltre a "Overview Anno", la barra superiore permette di passare ad altre analisi specializzate:
- **Uscite (Trend)**:
  - Previsione statistica dei mesi futuri con media mobile (`previsione`).
  - Analisi decisionale "Quanto posso tagliare" (regola 50/30/20).
  - Prevedibilità (spese fisse certe vs spese variabili stimate).
  - Ripartizione sui 4 quadranti (`necFisso`, `necVar`, `vitaFisso`, `vitaVar`).
  - Top categorie di spesa.
- **Entrate**:
  - Confronto tra entrate previste e già incassate (`entrateIn`).
  - Gestione scadenze e date di accredito.
  - Risparmio stimato a fine anno.
- **Conto**:
  - Analisi dettagliata della liquidità, buffer di emergenza e runway.
- **Confronto Anni**:
  - Vista comparativa multi-anno su uscite totali, entrate totali, risparmio netto e tasso di risparmio anno per anno.

---

## 5. MOTORE DI CALCOLO: `matriceAnno` (in `ANALISI:CORE`)

La funzione pura JavaScript `matriceAnno(movs, rows, data, annoScelto, opz)` risiede nel blocco protetto `/* ANALISI:CORE:START */` di `Finanze.html`:
- È priva di JSX ed estraibile per test automatici Node.js.
- Coperta da test dedicati in `finanze/smoke_analisi.js` (Test #10: verifica quadratura colonne, totali uscite, entrate, risparmi, saldi conto e saldo iniziale).
