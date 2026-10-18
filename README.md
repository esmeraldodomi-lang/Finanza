# GESTIONE FINANZIARIA PERSONALE

> Applicazione per la gestione finanziaria, bilancio familiare, analisi spese, monitoraggio bollette, manutenzione dell'auto e assistente contabile.
> Distribuita come Single Page Application standalone su Google Apps Script (GAS) ed eseguibile nel runtime locale su porta 3000.

---

## 1. STRUTTURA DEL PROGETTO

```text
Finanza/  (radice della repo)
├── Finanze.html             # Client frontend (React 18 senza JSX, React.createElement)
├── FINANZE.gs               # Backend Google Apps Script (lettura fogli, salvataggio spese)
├── IA_FINANZE.md            # Documentazione del motore assistente IA locale e cloud
├── ANALISI_SPESE.md         # Documentazione della funzione "Analisi Spese" (Overview Anno)
├── AUTO.md                  # Modulo Auto: manutenzione, scadenze, costi, promemoria email/Calendar
├── package.json             # Configurazione runtime per gli script di collaudo Node
├── check_babel.js           # Verifica compatibilità sintattica iOS / Safari
├── smoke_analisi.js         # Test unitari sul motore di calcolo (ANALISI:CORE)
├── smoke_auto.js            # Modulo Auto: motore (AUTO:CORE), backend e pagina
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
2. **Analisi Spese (`analisi`)** — nella barra in basso si chiama "Analisi" per far posto al tab Auto:
   - **Overview Anno**: Matrice Categorie × 12 Mesi, riga Uscite Totali del mese, riga Entrate Totali del mese, riga Risparmi del mese, e grafico temporale dell'andamento del Conto Corrente.
   - **Trend Uscite**: Analisi decisionale (50/30/20), prevedibilità e 4 quadranti.
   - **Entrate & Risparmio**: Confronto incassato vs previsto e tasso di risparmio.
   - **Conto Corrente**: Analisi della liquidità e punto più basso/alto.
   - **Confronto Anni**: Comparazione storica tra tutti gli anni registrati.
3. **Aggiungi (`add`)**: Registrazione singola spesa o piano rate ricorrenti.
4. **Chiedi (`ia`)**: Assistente IA contabile (funziona sia con motore locale a costo zero, sia con modelli Gemini/Claude).
5. **Bollette (`bollette`)**: Analisi consumi e costi Luce, Gas e Riscaldamento, con caricamento e analisi PDF.
6. **Auto (`auto`)**: Cruscotto scadenze (RCA, bollo, revisione, catene, tagliando), storico interventi, piano di manutenzione dal computer di bordo, costi da USCITE con controlli di coerenza, promemoria via email e Google Calendar. Vedi `AUTO.md`.
7. **Movimenti (`list`)**: Registro storico di tutte le transazioni con filtri multi-anno, ordinamento e ricerca.
8. **Impostazioni (`impostazioni`)**: Configurazione della classificazione categorie (Necessaria / Vita).

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

# 6. Test modulo Auto (motore, backend, pagina)
node smoke_auto.js

# 7. Test assistente IA (motore locale e backend)
node smoke_ia.js
node smoke_ia_backend.js
```

`smoke_auto.js` (parte pagina), `smoke_boot.js` e `smoke_ia_pagina.js` usano
`jsdom`, `react@18` e `react-dom@18`, che il repo non installa: senza,
`smoke_auto.js` salta la parte pagina e lo dice, gli altri due non partono.
`smoke_boot.js` ha 12 controlli fermi alla vecchia schermata Analisi (falliscono
anche prima del modulo Auto): vanno riallineati.

---

## 4. PUBBLICARE SU GOOGLE APPS SCRIPT

1. Copiare `FINANZE.gs` e `Finanze.html` nel progetto Apps Script (il file HTML
   deve chiamarsi esattamente `Finanze`).
2. Se `appsscript.json` elenca gli scope a mano (`oauthScopes`), devono esserci:
   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/script.external_request",
     "https://www.googleapis.com/auth/script.send_mail",
     "https://www.googleapis.com/auth/calendar",
     "https://www.googleapis.com/auth/script.scriptapp",
     "https://www.googleapis.com/auth/userinfo.email"
   ]
   ```
   I primi due servono a fogli e assistente IA (`IA_FINANZE.md`), gli altri
   quattro ai promemoria del modulo Auto (`AUTO.md`, §4).
3. Una volta sola, dall'editor: eseguire `installaTriggerAuto` e concedere i
   permessi (crea il controllo giornaliero delle scadenze auto).
4. **Distribuisci → Gestisci distribuzioni → Modifica → Nuova versione**: la web
   app usa gli scope della versione pubblicata.

Al primo accesso al tab Auto vengono creati i fogli `AUTO_INTERVENTI`,
`AUTO_KM`, `AUTO_SCADENZE`, `AUTO_PIANO` con i dati di partenza.

---

## 5. COME TESTARE L'APP NEL BROWSER

1. Avviare il server di sviluppo:
   ```bash
   npm start
   ```
2. Aprire l'applicazione nel browser al percorso dedicato:
   ```text
   http://localhost:3000/finanze
   ```
   oppure dall'URL deployato su Google Apps Script (`.../exec`).
