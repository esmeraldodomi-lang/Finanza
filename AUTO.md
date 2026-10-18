# SPECIFICA E GUIDA — MODULO AUTO

> Manutenzione, scadenze e costi della BMW 118d (F20, 12/2013, automatico) dentro l'app Finanza.
> Tab **Auto** nella barra in basso, con quattro viste: Cruscotto · Storico · Piano · Costi.

---

## 1. PRINCIPIO: I SOLDI RESTANO IN USCITE

Il modulo **non tiene importi suoi**. Legge le righe `MACCHINA` e `GASOLIO` del foglio USCITE (tutti gli anni, non solo da `START_YEAR`) e le classifica dalla nota:

| Classe | Riconosciuta da (nella nota) |
|---|---|
| Gasolio | categoria `GASOLIO` |
| Bollo | `BOLLO` |
| Assicurazione | `ASSICUR`, `ASS`, `RCA` |
| Revisione | `REVISION` |
| Manutenzione | `TAGLIAN`, `CATENA`, `CINGHIA`, `OLIO`, `GOMM`, `PNEUM`, `FRENI`, `BATTER`, `FILTR`, `[AUTO-…]`… |
| Pedaggi | `AUTOSTRAD`, `PEDAGG`, `TELEPASS` |
| Lavaggio | `LAVAGG` |
| Altro | tutto il resto |

I fogli `AUTO_*` tengono solo quello che USCITE non sa. Si creano **da soli** alla prima apertura del tab, con i dati di partenza (ottobre 2026); se esistono già non vengono toccati.

| Foglio | Colonne | Contenuto |
|---|---|---|
| `AUTO_INTERVENTI` | ID · DATA · KM · TIPO · VOCI · OFFICINA · COSTO · STRAORDINARIO · PAGAMENTO · NOTE | Storico. `VOCI` = `Olio motore=300; Catena distribuzione=2100`. `STRAORDINARIO` = parte una tantum, esclusa dal costo ordinario. |
| `AUTO_KM` | DATA · KM · FONTE | Letture del contachilometri (MANUALE, INTERVENTO, CBS) |
| `AUTO_SCADENZE` | CHIAVE · ETICHETTA · SCADENZA · IMPORTO · RIPETI_MESI · PREAVVISO_GG · NOTE | `RCA`, `BOLLO`, `REVISIONE` + quelle aggiunte a mano |
| `AUTO_PIANO` | VOCE · FONTE · INTERVALLO_KM · INTERVALLO_MESI · ULTIMO_KM · ULTIMA_DATA · KM_SCAD · DATA_SCAD · NOTE | Voci del computer di bordo (CBS) e voci con intervallo proprio |

**Legame intervento ↔ USCITE.** Quando un intervento si paga dall'app (unica o a rate) le righe in USCITE portano `[AUTO-0007]` nella nota. Per gli interventi registrati prima del modulo il legame si ricava: righe della stessa classe da 30 giorni prima a 150 giorni dopo l'intervento.

---

## 2. REGOLE DI CALCOLO

| Cosa | Regola |
|---|---|
| **Revisione** | Ogni 24 mesi **dal mese in cui è stata fatta**, entro l'ultimo giorno del mese. Ultima: 12/2025 → prossima **entro 31/12/2027**. Salvando un intervento `REVISIONE` la scadenza si sposta da sola. |
| **Bollo** | Entro il 31/12 di ogni anno (`BOLLO`, ripeti 12 mesi). |
| **RCA** | 21/11/2026, preavviso 45 giorni (nessun tacito rinnovo: serve tempo per i preventivi). |
| **Catene a bordo** | Gomme estive tutto l'anno → catene obbligatorie dal 15/11 al 15/04 dove c'è ordinanza. |
| **Piano (CBS)** | "Tra X km" dal computer di bordo → `KM_SCAD = km attuali + X`; "entro MM/AAAA" → ultimo giorno del mese. Senza valori CBS: ultimo + intervallo. Vince la prima tra km e data. |
| **Km/mese** | Solo con letture che coprono almeno 60 giorni: con meno, il numero sarebbe inventato. |
| **Costo ordinario** | Totale anno − parte straordinaria degli interventi − bolli arretrati (`BOLLO 2024` pagato nel 2026). |
| **Sanzioni bollo** | Per ogni bollo arretrato: pagato − bollo normale (importo della scadenza `BOLLO`). |
| **Stato** | scaduto (< 0 gg) · urgente (≤ 7) · presto (≤ preavviso) · ok. Il pallino sul tab conta le voci non "ok". |

---

## 3. CONTROLLI DI COERENZA ("Correggi con un tocco")

La vista **Costi** confronta quello che il modulo sa con USCITE. Ogni incoerenza propone un'azione, mostra **esattamente** cosa scriverà e la scrive solo dopo la conferma. Prima di toccare una riga esistente il server ricontrolla categoria e importo: se la riga è cambiata si ferma.

| Controllo | Esempio reale (ottobre 2026) | Azione |
|---|---|---|
| Costo intervento ≠ righe che lo pagano | Tagliando: fattura 2.400 €, rate 2.300 € | crea i 100 € mancanti dopo l'ultima rata |
| Revisioni fuori ciclo | previste 12/2028, 12/2030… | sposta a 12/2027, 12/2029… |
| Scadenza senza riga in USCITE | (RCA, bollo, revisione entro 15 mesi) | crea la riga |
| Prossimo tagliando non previsto | 09/2027 assente | crea 300 € (costo ordinario dell'ultimo) |
| DATA ≠ ANNO/MESE | 10/12/2026 segnata 01/2027 | allinea ANNO/MESE alla data (o "Ignora") |
| Riga futura già PAGATA | bollo 12/2047 | rimette DA PAGARE |

"Ignora" vale su quel dispositivo (si ricorda nella cache locale).

---

## 4. PROMEMORIA: EMAIL + GOOGLE CALENDAR

`autoControlloScadenze()` gira **ogni mattina alle 7**:
- **Email** all'indirizzo del proprietario dello script quando una scadenza entra nel preavviso, a 7 giorni, a 1 giorno, il giorno stesso e se scade. Una sola email per soglia, più voci nello stesso giorno = una sola email. Per le voci a km: a 1.000 e a 300 km.
- **Google Calendar** (calendario principale): un evento per scadenza, tutto il giorno, con popup 7 giorni prima e il giorno prima alle 9. Se la data cambia (RCA rinnovata) l'evento **si sposta**, non se ne crea un altro.
- Il pulsante **Controlla ora** manda subito il riepilogo di tutto quello che scade entro 60 giorni, senza consumare le soglie vere.

### Attivare i promemoria (una volta sola)

1. Copia `FINANZE.gs` e `Finanze.html` nel progetto Apps Script.
2. **Impostazioni progetto** → spunta *«Mostra il file manifest appsscript.json»*. Se `appsscript.json` ha `oauthScopes`, **aggiungi** (non sostituire):
   ```json
   "https://www.googleapis.com/auth/script.send_mail",
   "https://www.googleapis.com/auth/calendar",
   "https://www.googleapis.com/auth/script.scriptapp",
   "https://www.googleapis.com/auth/userinfo.email"
   ```
   Se `oauthScopes` non c'è, Apps Script li ricava da solo dal codice.
3. Nell'editor esegui **`installaTriggerAuto`** → *Rivedi autorizzazioni* → account → *Avanzate* → *Vai a … (non sicuro)* → **Consenti**. Crea il controllo delle 7 e lancia subito il primo (eventi Calendar compresi).
4. **Distribuisci → Gestisci distribuzioni → Modifica → Nuova versione**: la web app usa gli scope della versione pubblicata.

Per mandare le email a un altro indirizzo: proprietà dello script `AUTO_EMAIL`.

Se manca un permesso, il controllo lo dice (nel cruscotto, riquadro Promemoria) invece di fallire in silenzio.

---

## 5. FUNZIONI DEL BACKEND

| Funzione | Cosa fa |
|---|---|
| `getDatiAuto(opz)` | Payload del modulo (cache 5 min, `forza` la salta) |
| `autoSalvaIntervento(p)` | Intervento nuovo o modificato; se nuovo e pagato scrive le righe in USCITE (rifiuta rate che non sommano al costo); aggiorna km, piano e revisione |
| `autoEliminaIntervento({id})` | Toglie l'intervento dallo storico (le righe USCITE restano) |
| `autoSalvaKm({data, km})` | Nuova lettura (i km non possono scendere) |
| `autoSalvaScadenza(p)` | Crea/modifica; `rinnova: true` sposta di `RIPETI_MESI` |
| `autoSalvaPiano({km, righe})` | Valori CBS (`traKm`, `entro`) o voce del piano |
| `autoCorreggi(azione)` | Applica una correzione proposta (`crea`, `date`, `stato`) |
| `autoControlloScadenze(opz)` | Email + Calendar (trigger giornaliero) |
| `installaTriggerAuto()` | Crea il trigger e lancia il primo controllo |

---

## 6. COLLAUDO

```bash
node smoke_auto.js
```
Motore con le righe vere di USCITE, backend con un finto Sheets/Gmail/Calendar e la pagina in jsdom (serve `jsdom`, `react@18`, `react-dom@18`; senza, quella parte viene saltata e lo dice). Verifica anche che un `FINANZE.gs` vecchio, senza `getDatiAuto`, **non** faccia cadere l'app.
