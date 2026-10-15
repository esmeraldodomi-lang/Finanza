# GESTIONE FINANZIARIA PERSONALE

> Applicazione per la gestione finanziaria, bilancio familiare, analisi spese, monitoraggio bollette e assistente contabile.
> Distribuita come Single Page Application standalone su Google Apps Script (GAS) ed eseguibile nel runtime locale su porta 3000.

---

## 1. STRUTTURA DEL PROGETTO

```text
Finanza/  (radice della repo)
├── Finanze.html             # Client frontend (React 18 senza JSX, React.createElement)
├── FINANZE.gs               # Backend Google Apps Script (lettura fogli, salvataggio spese)
├── IA_FINANZE.md            # Documentazione del motore assistente IA locale e cloud
├── ANALISI_SPESE.md         # Documentazione della funzione "Analisi Spese" (Overview Anno)
├── package.json             # Configurazione runtime per gli script di collaudo Node
├── check_babel.js           # Verifica compatibilità sintattica iOS / Safari
├── smoke_analisi.js         # Test unitari sul motore di calcolo (ANALISI:CORE)
├── smoke_server.js          # Collaudo di buildFinanze_() e ponte Google Sheets
├── smoke_colonne.js         # Verifica intestazioni colonne e tolleranza dati reali
├── smoke_bollette.js        # Test parser bollette luce e gas
├── smoke_ia.js              # Test motore IA locale e regole di parsing
├── smoke_ia_backend.js      # Test chiamate API modelli cloud (Gemini / Claude / Vertex)
└── fixture_bollette.json    # Dati di test per le bollette
```

---

## 2. MODULI DELL'APPLICAZIONE

1. **Panoramica (`home`)**: Cruscotto mensile, saldo attuale, spese del mese ordinate per gruppo (Vita, Necessarie Variabili, Necessarie Fisse, Carta), saldo a fine mese proiettato.
2. **Analisi Spese (`analisi`)**:
   - **Overview Anno**: Matrice Categorie × 12 Mesi, riga Uscite Totali del mese, riga Entrate Totali del mese, riga Risparmi del mese, e grafico temporale dell'andamento del Conto Corrente.
   - **Trend Uscite**: Analisi decisionale (50/30/20), prevedibilità e 4 quadranti.
   - **Entrate & Risparmio**: Confronto incassato vs previsto e tasso di risparmio.
   - **Conto Corrente**: Analisi della liquidità e punto più basso/alto.
   - **Confronto Anni**: Comparazione storica tra tutti gli anni registrati.
3. **Aggiungi (`add`)**: Registrazione singola spesa o piano rate ricorrenti.
4. **Chiedi (`ia`)**: Assistente IA contabile (funziona sia con motore locale a costo zero, sia con modelli Gemini/Claude).
5. **Bollette (`bollette`)**: Analisi consumi e costi Luce, Gas e Riscaldamento, con caricamento e analisi PDF.
6. **Movimenti (`list`)**: Registro storico di tutte le transazioni con filtri multi-anno, ordinamento e ricerca.
7. **Impostazioni (`impostazioni`)**: Configurazione della classificazione categorie (Necessaria / Vita).

---

## 3. COME ESEGUIRE I COLLAUDI

Tutti i test girano in Node.js senza dipendenze esterne:

```bash
# 1. Controllo compatibilità sintassi Safari/iOS (nessuna sintassi post-ES2018)
node check_babel.js

# 2. Test del motore delle analisi (ANALISI:CORE inclusa matriceAnno)
node smoke_analisi.js

# 3. Test colonne e tolleranza dati da foglio
node smoke_colonne.js

# 4. Test del parser bollette
node smoke_bollette.js

# 5. Test del backend e generazione payload
node smoke_server.js

# 6. Test assistente IA (motore locale e backend)
node smoke_ia.js
node smoke_ia_backend.js
```

---

## 4. COME TESTARE L'APP NEL BROWSER

1. Avviare il server di sviluppo:
   ```bash
   npm start
   ```
2. Aprire l'applicazione nel browser al percorso dedicato:
   ```text
   http://localhost:3000/finanze
   ```
   oppure dall'URL deployato su Google Apps Script (`.../exec`).
