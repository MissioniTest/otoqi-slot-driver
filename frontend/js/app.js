import { NAMES, MONTHS, FASCE, ERRORI, REFRESH_MS } from "./config.js";
import {
  fetchOverview, fetchSlots, fetchStorico, bookSlot, bookSlots, cancelBooking, cancelSlots,
  getSession, login, logout, changePassword
} from "./api.js";
import {
  esc, pad, rp, dkey, fmtTime, fmtDateFull, fmtH, splitCancellable, getMergedRanges, downloadIcs
} from "./utils.js";
import { slotCard, dayCard, sheetModal, selectionBar, isBookable, errorMessage } from "./components.js";

const today0 = rp(new Date());
const STORICO_MS = 15 * 60 * 1000; // lo storico cambia di rado: negli aggiornamenti silenziosi si ricarica al massimo ogni 15 minuti

const S = {
  view: "catalog",
  calYear: today0.y,
  calMonth: today0.mo - 1,
  selectedDate: null,
  mineFilter: "futuri",
  openDays: {},
  day: null,
  overview: null,
  slots: [],
  storico: [],
  storicoAt: 0,
  sheet: null,
  sheetShown: false,
  loading: true,
  errorMsg: null,
  busy: false,
  fresh: false,          // vero subito dopo un login: serve a spiegare un account non attivo
  selMode: false,        // selezione multipla attiva
  sel: new Set(),        // id degli slot selezionati
  anchor: null           // ultimo slot toccato, base per la selezione di un blocco
};

const app = () => document.getElementById("app");
const val = id => document.getElementById(id)?.value || "";
const isIns = () => S.overview?.driver.fase === "inserimento";

function showMsg(title, text, retry) {
  app().innerHTML = errorMessage(title, text, retry);
}

function toast(m) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = m;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

// Testo di errore per un esito del database
function errText(esito) {
  if (esito === "fuori_orario_inserimento" && S.overview?.regole) {
    const r = S.overview.regole;
    return `Come driver in inserimento puoi prenotare solo slot tra le ${pad(r.ins_inizio)}:00 e le ${pad(r.ins_fine)}:00.`;
  }
  return ERRORI[esito] || "Operazione non riuscita, riprova.";
}

// Tutte le prenotazioni del driver (future, in coda e passate) in un'unica lista
function getAllMySlots() {
  const map = new Map();
  (S.slots || []).forEach(s => {
    if (s.mio_stato === "confermato" || s.mio_stato === "lista_attesa") {
      map.set(s.slot_id, { ...s, stato: s.mio_stato, posizione: s.mia_posizione });
    }
  });
  (S.overview?.prossime || []).forEach(p => {
    const ex = map.get(p.slot_id) || {};
    map.set(p.slot_id, { ...ex, ...p, mio_stato: p.stato, mia_posizione: p.posizione });
  });
  (S.storico || []).forEach(p => {
    const ex = map.get(p.slot_id) || {};
    map.set(p.slot_id, { ...ex, ...p, mio_stato: p.stato, mia_posizione: null });
  });
  return Array.from(map.values()).sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
}

const slotById = id => S.slots.find(s => s.slot_id === id);
const slotLabel = id => {
  const s = slotById(id) || getAllMySlots().find(x => x.slot_id === id);
  return s ? `${fmtDateFull(s.inizio)}, ${fmtTime(s.inizio)}–${fmtTime(s.fine)}` : `Slot ${id}`;
};

// --- Schermate di accesso ---
function showLogin(err = "", email = "") {
  app().innerHTML = `
    <div class="wrap">
      <header class="hero"><h1>Otoqi</h1><p>Accedi per prenotare i tuoi slot</p></header>
      <div class="auth">
        ${err ? `<div class="err-box">${esc(err)}</div>` : ""}
        <label>Email<input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="none" value="${esc(email)}"></label>
        <label>Password
          <span class="pwbox">
            <input id="pw" type="password" autocomplete="current-password">
            <button type="button" class="pwtoggle" data-act="toggle-pw" data-target="pw">Mostra</button>
          </span>
        </label>
        <button class="btn" data-act="login">Accedi</button>
        <p class="auth-help">Hai dimenticato la password? Scrivi al team Otoqi: ti verrà assegnata una nuova password temporanea.</p>
      </div>
    </div>`;
}

function showChangePw(err = "") {
  app().innerHTML = `
    <div class="wrap">
      <header class="hero"><h1>Scegli la tua password</h1><p>Prima di iniziare, sostituisci quella temporanea</p></header>
      <div class="auth">
        ${err ? `<div class="err-box">${esc(err)}</div>` : ""}
        <label>Nuova password (minimo 8 caratteri)
          <span class="pwbox">
            <input id="np" type="password" autocomplete="new-password">
            <button type="button" class="pwtoggle" data-act="toggle-pw" data-target="np,np2">Mostra</button>
          </span>
        </label>
        <label>Ripetila<input id="np2" type="password" autocomplete="new-password"></label>
        <button class="btn" data-act="change-pw">Salva e continua</button>
      </div>
    </div>`;
}

// --- Caricamento dati ---
async function loadData(quiet) {
  if (!(await getSession())) return showLogin();
  if (!quiet) {
    S.loading = true;
    render();
  }

  // Durante gli aggiornamenti silenziosi un errore non deve cancellare la schermata
  const fail = (title, text) => {
    if (quiet) return toast("Aggiornamento non riuscito");
    showMsg(title, text, true);
  };

  const ov = await fetchOverview();
  if (ov.esito === "non_autenticato") {
    const msg = S.fresh ? "Questo account non è abilitato come driver. Se pensi sia un errore scrivi al team Otoqi." : "";
    S.fresh = false;
    await logout();
    return showLogin(msg);
  }
  if (ov.esito === "errore_rete") return fail("Connessione assente", "Controlla internet e riprova.");
  if (ov.esito !== "ok") return fail("Servizio non disponibile", "Riprova tra qualche minuto. Se il problema continua scrivi a Otoqi.");
  if (ov.driver.deve_cambiare_password) return showChangePw();

  const needStorico = !quiet || Date.now() - S.storicoAt > STORICO_MS;
  const [sl, st] = await Promise.all([fetchSlots(), needStorico ? fetchStorico() : Promise.resolve(null)]);
  if (sl.esito === "errore_rete") return fail("Connessione assente", "Controlla internet e riprova.");
  if (sl.esito !== "ok") return fail("Impossibile caricare gli slot", "Riprova tra poco.");

  S.fresh = false;
  S.overview = ov;
  S.slots = (sl.slot || []).sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  if (st && st.esito === "ok") {
    S.storico = st.slot || [];
    S.storicoAt = Date.now();
  }
  S.loading = false;

  // Toglie dalla selezione gli slot che nel frattempo non sono più prenotabili
  const now = new Date();
  [...S.sel].forEach(id => {
    const s = slotById(id);
    if (!s || !isBookable(s, now)) S.sel.delete(id);
  });

  if (S.day === null) {
    const keys = [...new Set(S.slots.map(s => dkey(s.inizio)))].sort();
    const i = keys.findIndex(k => k >= dkey(new Date()));
    S.day = i < 0 ? 0 : i;
    if (keys[S.day]) S.selectedDate = keys[S.day];
  }
  render();
}

// Aggiornamento automatico: solo se l'app è visibile e il driver non sta facendo altro
function quietRefresh() {
  if (document.hidden || !S.overview || S.loading || S.busy || S.sheet || S.selMode) return;
  loadData(true);
}

// --- Selezione multipla ---
// Primo tocco: seleziona lo slot. Secondo tocco su un altro slot dello stesso giorno:
// seleziona tutto il blocco tra i due. Toccare uno slot già selezionato lo toglie.
function toggleSelect(id) {
  const now = new Date();
  const sl = slotById(id);
  if (!sl || !isBookable(sl, now)) return false;

  if (S.sel.has(id)) {
    S.sel.delete(id);
    S.anchor = id;
    return true;
  }

  const anchor = S.anchor != null && S.sel.has(S.anchor) ? slotById(S.anchor) : null;
  if (anchor && dkey(anchor.inizio) === dkey(sl.inizio)) {
    const dayList = S.slots.filter(x => dkey(x.inizio) === dkey(sl.inizio));
    const i = dayList.findIndex(x => x.slot_id === anchor.slot_id);
    const j = dayList.findIndex(x => x.slot_id === id);
    dayList.slice(Math.min(i, j), Math.max(i, j) + 1)
      .filter(x => isBookable(x, now))
      .forEach(x => S.sel.add(x.slot_id));
  } else {
    S.sel.add(id);
  }
  S.anchor = id;
  return true;
}

function exitSelection() {
  S.selMode = false;
  S.sel.clear();
  S.anchor = null;
}

// --- Disegno della pagina ---
function render() {
  if (S.loading) {
    app().innerHTML = `<div class="spin"></div>`;
    return;
  }

  const ov = S.overview;
  const now = new Date();
  const today = dkey(now);
  const ins = isIns();
  const prevScroll = document.getElementById("daysStrip")?.scrollLeft;
  const pageScroll = window.scrollY;

  const grouped = {};
  S.slots.forEach(s => {
    const k = dkey(s.inizio);
    (grouped[k] = grouped[k] || []).push(s);
  });

  const dateKeys = Object.keys(grouped).sort();
  const activeDate = S.selectedDate || dateKeys[S.day] || dateKeys[0];
  const currentSlots = grouped[activeDate] || [];

  const daysHtml = dateKeys.map((dk, idx) => {
    const d = new Date(dk + "T12:00:00");
    const ds = grouped[dk];
    const conf = ds.some(s => s.mio_stato === "confermato");
    const wl = ds.some(s => s.mio_stato === "lista_attesa");
    return `
      <button class="day ${dk === today ? "today" : ""}" data-act="day" data-idx="${idx}" aria-pressed="${activeDate === dk}">
        <small>${dk === today ? "Oggi" : NAMES[d.getDay()]}</small>
        <b class="num">${d.getDate()}</b>
        <div class="ind">
          ${conf ? '<span class="dot c"></span>' : ""}
          ${wl ? '<span class="dot w"></span>' : ""}
        </div>
      </button>`;
  }).join("");

  let mainContentHtml = "";

  if (S.view === "catalog") {
    let rowsHtml = "";
    FASCE.forEach(([nome, a, b]) => {
      const gr = currentSlots.filter(s => {
        const h = rp(s.inizio).h;
        return h >= a && h < b;
      });
      if (gr.length) {
        rowsHtml += `<div class="fascia">${nome}</div>` +
          gr.map(s => slotCard(s, now, { ins, selMode: S.selMode, selected: S.sel.has(s.slot_id) })).join("");
      }
    });

    if (!rowsHtml) {
      rowsHtml = `<div class="empty">Nessuno slot aperto per questa data.<br>Controlla gli altri giorni o attendi i nuovi slot.</div>`;
    }

    const dObj = new Date((activeDate || today) + "T12:00:00");
    const activeFormatted = `${NAMES[dObj.getDay()]} ${dObj.getDate()} ${MONTHS[dObj.getMonth()]}`;

    mainContentHtml = `
      <div class="date-selector-bar">
        <button class="date-picker-trigger" data-act="open-cal">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="4" ry="4"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <span class="trigger-text">${activeFormatted}</span>
          <span class="trigger-badge">Mese ▾</span>
        </button>
        <button class="sel-toggle${S.selMode ? " on" : ""}" data-act="sel-toggle" aria-pressed="${S.selMode}">
          ${S.selMode ? "Fine selezione" : "Seleziona più slot"}
        </button>
      </div>

      <div class="days-nav">
        <button class="nav-arrow" data-act="scroll-days" data-dir="-1" aria-label="Giorno precedente">‹</button>
        <div class="days" id="daysStrip">${daysHtml}</div>
        <button class="nav-arrow" data-act="scroll-days" data-dir="1" aria-label="Giorno successivo">›</button>
      </div>

      <div class="list">${rowsHtml}</div>`;
  } else {
    const mySlots = getAllMySlots();
    const futuri = mySlots.filter(s => new Date(s.inizio) > now && s.mio_stato === "confermato");
    const attesa = mySlots.filter(s => new Date(s.inizio) > now && s.mio_stato === "lista_attesa");
    const passati = mySlots.filter(s => new Date(s.inizio) <= now && s.mio_stato === "confermato");

    const activeSet = S.mineFilter === "futuri" ? futuri : S.mineFilter === "attesa" ? attesa : passati;

    const byDay = {};
    activeSet.forEach(s => {
      const k = dkey(s.inizio);
      (byDay[k] = byDay[k] || []).push(s);
    });

    const dayKeys = Object.keys(byDay).sort((a, b) => S.mineFilter === "passati" ? b.localeCompare(a) : a.localeCompare(b));

    let cardsHtml = "";
    if (dayKeys.length === 0) {
      const emptyText = S.mineFilter === "futuri"
        ? "Nessuno slot in programma.<br>Scegli uno slot da “Esplora slot”."
        : S.mineFilter === "attesa"
        ? "Non sei in coda per alcuno slot."
        : "Nessuno slot svolto negli ultimi 60 giorni.";
      cardsHtml = `<div class="empty">${emptyText}</div>`;
    } else {
      cardsHtml = dayKeys.map(dk => {
        const slotsInDay = byDay[dk];
        return dayCard(dk, slotsInDay, !!S.openDays[dk], {
          bulk: S.mineFilter !== "passati" && slotsInDay.length > 1,
          cal: S.mineFilter === "futuri"
        });
      }).join("");
    }

    mainContentHtml = `
      <div class="subtabs">
        <button class="subtab" data-act="subtab" data-val="futuri" aria-selected="${S.mineFilter === "futuri"}">In programma (${futuri.length})</button>
        <button class="subtab" data-act="subtab" data-val="attesa" aria-selected="${S.mineFilter === "attesa"}">In attesa (${attesa.length})</button>
        <button class="subtab" data-act="subtab" data-val="passati" aria-selected="${S.mineFilter === "passati"}">Passati (${passati.length})</button>
      </div>
      <div class="list">${cardsHtml}</div>`;
  }

  // Selezione multipla: slot scelti e barra in basso
  const selItems = [...S.sel].map(slotById).filter(Boolean)
    .sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const showBar = S.selMode && S.view === "catalog";
  if (S.sheet?.type === "bulk-book" && !selItems.length) S.sheet = null;

  const animateSheet = !!S.sheet && !S.sheetShown;
  S.sheetShown = !!S.sheet;

  let sheetHtml = "";
  if (S.sheet) {
    sheetHtml = sheetModal({
      sheet: S.sheet,
      allMy: getAllMySlots(),
      slots: S.slots,
      ov,
      busy: S.busy,
      errorMsg: S.errorMsg,
      now,
      calData: { year: S.calYear, month: S.calMonth, activeDate, grouped, today },
      animate: animateSheet,
      selItems
    });
  }

  const h = rp(now).h;
  const greet = h >= 5 && h < 13 ? "Buongiorno," : h >= 13 && h < 18 ? "Buon pomeriggio," : h >= 18 || h < 2 ? "Buonasera," : "Ciao,";
  const nx = (ov.prossime || []).find(p => p.stato === "confermato" && new Date(p.inizio) > now);

  // Riquadri informativi
  const notes = [];
  if (ins) {
    notes.push(`<div class="note"><b>Sei in inserimento</b><span>Vedi e prenoti gli slot dalle ${pad(ov.regole.ins_inizio)}:00 alle ${pad(ov.regole.ins_fine)}:00.</span></div>`);
  }
  if (ov.prossima_pubblicazione) {
    notes.push(`<div class="note"><b>Nuovi slot in arrivo</b><span class="num">${fmtDateFull(ov.prossima_pubblicazione)}, ${fmtTime(ov.prossima_pubblicazione)}</span></div>`);
  }

  const nWait = Number(ov.in_lista_attesa) || 0;

  document.body.classList.toggle("has-selbar", showBar);
  app().innerHTML = `
    <div class="wrap${showBar ? " selmode" : ""}">
      <header class="hero">
        <button class="logout" data-act="logout">Esci</button>
        <p>${greet}</p>
        <h1>${esc(ov.driver.nome)}</h1>
        <span class="city">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>
          </svg>
          ${esc(ov.driver.citta_nome)}
        </span>
      </header>

      <div class="metrics">
        <div class="mc hours">
          <span>Ore prenotate</span>
          <div class="trio">
            <div><b class="num">${fmtH(ov.settimana_corrente.ore)} h</b><small>Questa settimana</small></div>
            <div><b class="num">${fmtH(ov.settimana_prossima.ore)} h</b><small>Prossima</small></div>
            <div><b class="num">${fmtH(ov.mese.ore)} h</b><small>${MONTHS[rp(now).mo - 1]}</small></div>
          </div>
        </div>
        ${nWait ? `<button class="wl-chip" data-act="goto-attesa">${nWait} ${nWait === 1 ? "richiesta in coda" : "richieste in coda"} ›</button>` : ""}
      </div>

      ${nx ? `<div class="next"><span>Prossimo slot</span><b class="num">${fmtDateFull(nx.inizio)}, ${fmtTime(nx.inizio)}</b></div>` : ""}
      ${notes.join("")}

      <div class="tabs">
        <button class="tab" data-act="tab" data-val="catalog" aria-selected="${S.view === "catalog"}">Esplora slot</button>
        <button class="tab" data-act="tab" data-val="mine" aria-selected="${S.view === "mine"}">Le mie prenotazioni</button>
      </div>

      ${mainContentHtml}
    </div>
    ${showBar ? selectionBar(selItems) : ""}
    ${sheetHtml}`;

  window.scrollTo(0, pageScroll);

  const dv = document.getElementById("daysStrip");
  if (dv) {
    if (prevScroll !== undefined) {
      dv.scrollLeft = prevScroll;
    } else {
      const a = dv.querySelector('[aria-pressed="true"]');
      if (a) dv.scrollLeft = a.offsetLeft - dv.clientWidth / 2 + a.offsetWidth / 2;
    }
  }
}

// Esito di un'operazione su più slot: chiude il foglio se tutto è andato bene, altrimenti mostra cosa non è riuscito
function showBulkOutcome(title, okText, failed) {
  if (!failed.length) {
    S.sheet = null;
    S.errorMsg = null;
    toast(okText);
  } else {
    S.sheet = { type: "result", title, summary: `${okText}. ${failed.length === 1 ? "1 slot non è riuscito" : failed.length + " slot non sono riusciti"}:`, failed };
    S.errorMsg = null;
  }
}

function icsEvent(id, start, end) {
  return { uid: `${id}-${new Date(start).getTime()}`, start, end, summary: `Otoqi · slot ${S.overview.driver.citta_nome}` };
}

// --- Eventi ---
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;

  if (act === "retry") return loadData();

  if (act === "toggle-pw") {
    const ids = t.dataset.target.split(",");
    const show = document.getElementById(ids[0]).type === "password";
    ids.forEach(id => { document.getElementById(id).type = show ? "text" : "password"; });
    t.textContent = show ? "Nascondi" : "Mostra";
    return;
  }

  if (act === "login") {
    const em = val("em");
    const pw = val("pw");
    if (!em.trim() || !pw) return showLogin("Inserisci email e password.", em);
    t.disabled = true;
    t.textContent = "Accesso in corso…";
    const r = await login(em, pw);
    if (r !== "ok") return showLogin(r === "credenziali" ? "Email o password non corretti." : "Connessione assente. Riprova.", em);
    S.loading = true; S.day = null; S.fresh = true;
    return loadData();
  }

  if (act === "change-pw") {
    const a = val("np"), b = val("np2");
    if (a.length < 8) return showChangePw("La password deve avere almeno 8 caratteri.");
    if (a !== b) return showChangePw("Le due password non coincidono.");
    if (/^otoqi(milano|roma|torino)\d*$/i.test(a)) return showChangePw("Scegli una password diversa da quella temporanea.");
    t.disabled = true;
    t.textContent = "Salvataggio…";
    const r = await changePassword(a);
    if (r !== "ok") return showChangePw("Non è stato possibile salvarla: " + r);
    S.loading = true;
    return loadData();
  }

  if (act === "logout") {
    await logout();
    S.overview = null; S.slots = []; S.storico = []; S.storicoAt = 0; S.day = null; S.sheet = null; S.view = "catalog";
    exitSelection();
    document.body.classList.remove("has-selbar");
    return showLogin();
  }

  if (act === "tab") {
    S.view = t.dataset.val;
    S.errorMsg = null;
    exitSelection();
    return render();
  }
  if (act === "subtab") {
    S.mineFilter = t.dataset.val;
    return render();
  }
  if (act === "goto-attesa") {
    S.view = "mine";
    S.mineFilter = "attesa";
    exitSelection();
    return render();
  }

  // Selezione multipla
  if (act === "sel-toggle") {
    if (S.selMode) exitSelection(); else S.selMode = true;
    return render();
  }
  if (act === "sel-exit") {
    exitSelection();
    return render();
  }
  if (act === "sel-clear") {
    S.sel.clear();
    S.anchor = null;
    return render();
  }
  if (act === "sel-confirm") {
    if (!S.sel.size) return;
    S.sheet = { type: "bulk-book" };
    S.errorMsg = null;
    return render();
  }

  if (act === "confirm-book-bulk") {
    if (S.busy || !S.sel.size) return;
    const ids = [...S.sel];
    S.busy = true;
    render();
    const res = await bookSlots(ids);
    S.busy = false;

    if (res.esito !== "ok") {
      S.errorMsg = errText(res.esito);
      return render();
    }

    const failed = [];
    const failedIds = new Set();
    let booked = 0, waiting = 0;
    res.risultati.forEach(r => {
      if (r.esito === "confermato" || r.esito === "gia_prenotato") booked++;
      else if (r.esito === "lista_attesa") waiting++;
      else {
        failed.push({ label: slotLabel(r.slot_id), msg: errText(r.esito) });
        failedIds.add(r.slot_id);
      }
    });

    const okText = `${booked + waiting} ${booked + waiting === 1 ? "slot prenotato" : "slot prenotati"}` +
      (waiting ? ` (${waiting} in lista d’attesa)` : "");
    S.sel = failedIds;
    if (!failedIds.size) { S.selMode = false; S.anchor = null; }
    showBulkOutcome("Prenotazione parziale", okText, failed);
    render();
    return loadData(true);
  }

  if (act === "confirm-bulk") {
    if (S.busy) return;
    const dk = t.dataset.date;
    const now = new Date();
    const mine = getAllMySlots().filter(s => dkey(s.inizio) === dk && new Date(s.inizio) > now
      && (s.mio_stato === "confermato" || s.mio_stato === "lista_attesa"));
    const { ok } = splitCancellable(mine, now, S.overview.regole.cancellazione_ore);
    if (!ok.length) return;

    S.busy = true;
    render();
    const res = await cancelSlots(ok.map(s => s.slot_id));
    S.busy = false;

    if (res.esito !== "ok") {
      S.errorMsg = errText(res.esito);
      return render();
    }

    const failed = res.risultati
      .filter(r => r.esito !== "annullata" && r.esito !== "uscito_da_lista")
      .map(r => ({ label: slotLabel(r.slot_id), msg: errText(r.esito) }));
    const done = res.risultati.length - failed.length;
    showBulkOutcome("Annullamento parziale", `${done} ${done === 1 ? "slot annullato" : "slot annullati"}`, failed);
    render();
    return loadData(true);
  }

  // Calendario del telefono
  if (act === "cal-slot") {
    const sl = getAllMySlots().find(x => x.slot_id === +t.dataset.id);
    if (!sl) return;
    return downloadIcs(`otoqi-slot-${dkey(sl.inizio)}.ics`, [icsEvent(sl.slot_id, sl.inizio, sl.fine)]);
  }
  if (act === "cal-day") {
    const dk = t.dataset.date;
    const mine = getAllMySlots().filter(s => dkey(s.inizio) === dk && s.mio_stato === "confermato");
    const events = getMergedRanges(mine).map((r, i) => icsEvent(`${dk}-${i}`, r.start, r.end));
    if (events.length) downloadIcs(`otoqi-slot-${dk}.ics`, events);
    return;
  }

  if (act === "open-cal") {
    const curDate = new Date((S.selectedDate || dkey(new Date())) + "T12:00:00");
    S.calYear = curDate.getFullYear();
    S.calMonth = curDate.getMonth();
    S.sheet = { type: "calendar" };
    return render();
  }

  if (act === "cal-prev") {
    S.calMonth--;
    if (S.calMonth < 0) { S.calMonth = 11; S.calYear--; }
    return render();
  }
  if (act === "cal-next") {
    S.calMonth++;
    if (S.calMonth > 11) { S.calMonth = 0; S.calYear++; }
    return render();
  }

  if (act === "select-cal-day") {
    const targetDate = t.dataset.date;
    S.selectedDate = targetDate;
    const sortedKeys = [...new Set(S.slots.map(s => dkey(s.inizio)))].sort();
    const idx = sortedKeys.indexOf(targetDate);
    if (idx !== -1) S.day = idx;
    S.sheet = null;
    render();

    setTimeout(() => {
      const dv = document.getElementById("daysStrip");
      const a = dv?.querySelector('[aria-pressed="true"]');
      if (dv && a) dv.scrollLeft = a.offsetLeft - dv.clientWidth / 2 + a.offsetWidth / 2;
    }, 50);
    return;
  }

  if (act === "day") {
    S.day = +t.dataset.idx;
    const sortedKeys = [...new Set(S.slots.map(s => dkey(s.inizio)))].sort();
    S.selectedDate = sortedKeys[S.day];
    S.errorMsg = null;
    return render();
  }

  if (act === "scroll-days") {
    document.getElementById("daysStrip")?.scrollBy({ left: +t.dataset.dir * 160, behavior: "smooth" });
    return;
  }

  if (act === "toggle-day") {
    const dk = t.dataset.date;
    S.openDays[dk] = !S.openDays[dk];
    return render();
  }

  if (act === "slot") {
    if (S.selMode && S.view === "catalog") {
      if (toggleSelect(+t.dataset.id)) render();
      return;
    }
    S.sheet = { id: +t.dataset.id };
    S.errorMsg = null;
    return render();
  }

  if (act === "prompt-bulk") {
    S.sheet = { type: "bulk", date: t.dataset.date };
    S.errorMsg = null;
    return render();
  }

  if (act === "close" || (act === "backdrop" && e.target.dataset.act === "backdrop")) {
    S.sheet = null;
    S.errorMsg = null;
    return render();
  }

  if (act === "book" || act === "cancel") {
    if (S.busy) return;
    S.busy = true;
    render();

    const res = await (act === "book" ? bookSlot(+t.dataset.id) : cancelBooking(+t.dataset.id));
    S.busy = false;

    if (["confermato", "lista_attesa", "annullata", "uscito_da_lista"].includes(res.esito)) {
      S.sheet = null;
      S.errorMsg = null;
      toast(act === "book" ? (res.esito === "lista_attesa" ? "Sei in lista d’attesa" : "Slot prenotato") : "Prenotazione annullata");
      loadData(true);
    } else {
      S.errorMsg = errText(res.esito);
      render();
    }
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.closest(".auth")) document.querySelector(".auth .btn[data-act]")?.click();
});

// Aggiorna quando il driver torna sull'app e a intervalli regolari mentre è aperta
document.addEventListener("visibilitychange", () => { if (!document.hidden) quietRefresh(); });
setInterval(quietRefresh, REFRESH_MS);

loadData();