import { MONTHS } from "./config.js";
import {
  esc, fmtTime, fmtDateFull, dayLabel, dkey, cancelDeadline, splitCancellable,
  getMergedIntervals, getTotalHours, getMonthMatrix
} from "./utils.js";

// Uno slot si può selezionare se è futuro, aperto e non ancora tuo
export function isBookable(s, now) {
  return new Date(s.inizio) > now && s.capienza > 0 && !s.mio_stato;
}

export function pillFor(s, now, ins) {
  const past = new Date(s.inizio) <= now;
  const mine = s.mio_stato === "confermato";
  const wl = s.mio_stato === "lista_attesa";
  const free = s.capienza - s.confermati;

  if (past) return `<i class="pill">${mine ? "Concluso" : "Chiuso"}</i>`;
  if (s.capienza === 0) return `<i class="pill">Chiuso</i>`;
  if (mine) return `<i class="pill on">✓ Confermato</i>`;
  if (wl) return `<i class="pill wlp">In coda, pos. ${s.mia_posizione}</i>`;
  if (ins) return `<i class="pill free">Prenotabile</i>`;
  if (free <= 0) return `<i class="pill">Completo</i>`;
  return `<i class="pill free">${free} ${free === 1 ? "posto libero" : "posti liberi"}</i>`;
}

// o: { ins, selMode, selected }
export function slotCard(s, now, o = {}) {
  const past = new Date(s.inizio) <= now;
  const mine = s.mio_stato === "confermato";
  const wl = s.mio_stato === "lista_attesa";
  const isChiuso = s.capienza === 0;
  const full = !o.ins && s.capienza - s.confermati <= 0;
  const can = !!o.selMode && isBookable(s, now);
  const cls = (mine ? "mine" : wl ? "wl" : isChiuso ? "past" : full ? "full" : "")
    + (past ? " past" : "")
    + (can ? " selable" : "")
    + (can && o.selected ? " picked" : "")
    + (o.selMode && !can ? " dim" : "");
  const pct = s.capienza ? Math.min(100, Math.round(s.confermati / s.capienza * 100)) : 0;

  return `
    <button class="slot ${cls}" data-act="slot" data-id="${s.slot_id}"${can ? ` aria-pressed="${!!o.selected}"` : ""}>
      <span class="t num">${fmtTime(s.inizio)}<small>fino alle ${fmtTime(s.fine)}</small></span>
      <span class="r">${pillFor(s, now, o.ins)}<span class="bar"><b style="width:${pct}%"></b></span></span>
      ${can ? `<span class="chk" aria-hidden="true">${o.selected ? "✓" : ""}</span>` : ""}
    </button>`;
}

// Barra fissa in basso durante la selezione multipla
export function selectionBar(items) {
  if (!items.length) {
    return `
      <div class="selbar">
        <div class="selbar-info"><b>Selezione multipla</b><small>Tocca il primo e l’ultimo slot del blocco</small></div>
        <button class="btn ghost sm" data-act="sel-exit">Fine</button>
      </div>`;
  }
  const days = new Set(items.map(s => dkey(s.inizio))).size;
  const detail = days === 1 ? getMergedIntervals(items) : `${days} giorni`;
  return `
    <div class="selbar">
      <div class="selbar-info"><b class="num">${items.length} slot · ${getTotalHours(items)} h</b><small class="num">${detail}</small></div>
      <button class="btn ghost sm" data-act="sel-clear">Svuota</button>
      <button class="btn sm" data-act="sel-confirm">Prenota</button>
    </div>`;
}

// o: { bulk, cal }
export function dayCard(dk, slotsInDay, isOpen, o = {}) {
  const intervals = getMergedIntervals(slotsInDay);
  const hours = getTotalHours(slotsInDay);

  const slotsHtml = slotsInDay.map(s => {
    const pill = s.mio_stato === "lista_attesa"
      ? `<i class="pill wlp">In coda, pos. ${s.mia_posizione}</i>`
      : `<i class="pill on">✓ Confermato</i>`;
    return `
      <button class="slot ${s.mio_stato === "lista_attesa" ? "wl" : "mine"}" data-act="slot" data-id="${s.slot_id}">
        <span class="t num">${fmtTime(s.inizio)}<small>fino alle ${fmtTime(s.fine)}</small></span>
        <span class="r"><span class="dt">${fmtDateFull(s.inizio)}</span>${pill}</span>
      </button>`;
  }).join("");

  return `
    <div class="day-card ${isOpen ? "open" : ""}">
      <button class="day-card-hdr" data-act="toggle-day" data-date="${dk}">
        <div class="d-title">
          <span class="d-date">${dayLabel(dk)}</span>
          <span class="d-ranges">${intervals}</span>
        </div>
        <div class="d-meta">
          <span class="d-badge num">${hours} h</span>
          <svg class="d-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>
      ${isOpen ? `
        <div class="day-card-body">
          ${slotsHtml}
          ${o.cal ? `<button class="btn-line" data-act="cal-day" data-date="${dk}">Aggiungi al calendario</button>` : ""}
          ${o.bulk ? `<button class="btn-bulk" data-act="prompt-bulk" data-date="${dk}">Annulla intera giornata (${slotsInDay.length} slot)</button>` : ""}
        </div>` : ""}
    </div>`;
}

export function calendarSheetContent(calYear, calMonth, activeDateKey, grouped, todayKey) {
  const WEEKDAYS = ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"];
  const days = getMonthMatrix(calYear, calMonth);
  const monthName = `${MONTHS[calMonth]} ${calYear}`;

  while (days.length < 42) days.push(null);

  const cellsHtml = days.map(cell => {
    if (!cell) return `<span class="cal-blank" aria-hidden="true"></span>`;

    const dk = cell.dkey;
    const isToday = dk === todayKey;
    const slots = grouped[dk] || [];

    if (slots.length === 0) {
      return `
        <button class="cal-cell${isToday ? " today" : ""}" disabled>
          <span class="num">${cell.dayNum}</span>
        </button>`;
    }

    const isSelected = dk === activeDateKey;
    const conf = slots.some(s => s.mio_stato === "confermato");
    const wl = slots.some(s => s.mio_stato === "lista_attesa");
    const avail = slots.some(s => s.capienza - s.confermati > 0 && s.capienza > 0);

    return `
      <button class="cal-cell has-slots${isToday ? " today" : ""}"
              data-act="select-cal-day"
              data-date="${dk}"
              aria-pressed="${isSelected}">
        <span class="num">${cell.dayNum}</span>
        <span class="cal-cell-dots">
          ${conf ? '<span class="cal-dot c"></span>' : ""}
          ${wl ? '<span class="cal-dot w"></span>' : ""}
          ${!conf && !wl && avail ? '<span class="cal-dot avail"></span>' : ""}
        </span>
      </button>`;
  }).join("");

  return `
    <div class="cal">
      <div class="cal-sheet-header">
        <span class="cal-sheet-title">${monthName}</span>
        <div class="cal-nav-btns">
          <button class="cal-nav-btn" data-act="cal-prev" aria-label="Mese precedente">‹</button>
          <button class="cal-nav-btn" data-act="cal-next" aria-label="Mese successivo">›</button>
        </div>
      </div>
      <div class="cal-grid">
        <div class="cal-weekdays">
          ${WEEKDAYS.map(w => `<span>${w}</span>`).join("")}
        </div>
        <div class="cal-cells">
          ${cellsHtml}
        </div>
      </div>
      <div class="cal-legend">
        <span><i class="legend-dot c"></i> Prenotato</span>
        <span><i class="legend-dot w"></i> In attesa</span>
        <span><i class="legend-dot avail"></i> Libero</span>
      </div>
    </div>
    <div class="lnks">
      <button class="btn ghost" data-act="close">Chiudi</button>
    </div>`;
}

// ctx: { sheet, allMy, slots, ov, busy, errorMsg, now, calData, animate, selItems }
export function sheetModal(ctx) {
  const { sheet, allMy, slots, ov, busy, errorMsg, now, calData, animate, selItems } = ctx;
  const ins = ov.driver.fase === "inserimento";
  const ore = ov.regole.cancellazione_ore;
  const dis = busy ? "disabled" : "";
  const err = errorMsg ? `<div class="err-box">${errorMsg}</div>` : "";
  let content = "";

  if (sheet.type === "calendar") {
    content = calendarSheetContent(calData.year, calData.month, calData.activeDate, calData.grouped, calData.today);

  } else if (sheet.type === "bulk-book") {
    // Conferma della prenotazione di più slot
    const byDay = {};
    selItems.forEach(s => (byDay[dkey(s.inizio)] = byDay[dkey(s.inizio)] || []).push(s));
    const rows = Object.keys(byDay).sort().map(dk => `
      <div class="sumrow"><span>${dayLabel(dk)}</span><b class="num">${getMergedIntervals(byDay[dk])}</b></div>`).join("");
    const waiting = ins ? 0 : selItems.filter(s => s.capienza - s.confermati <= 0).length;

    content = `
      <h3>Conferma la prenotazione</h3>
      <div class="kv">
        <span>${selItems.length} slot</span>
        <b class="num">${getTotalHours(selItems)} ore</b>
      </div>
      <div class="sumlist">${rows}</div>
      ${err}
      ${waiting ? `<p>${waiting === 1 ? "1 slot è completo" : waiting + " slot sono completi"}: entrerai in lista d’attesa e subentri se qualcuno annulla.</p>` : ""}
      <div class="lnks">
        <button class="btn" data-act="confirm-book-bulk" ${dis}>${busy ? "Prenotazione in corso…" : `Prenota ${selItems.length} slot`}</button>
        <button class="btn ghost" data-act="close">Indietro</button>
      </div>`;

  } else if (sheet.type === "result") {
    // Esito di un'operazione su più slot, con elenco di ciò che non è riuscito
    const failed = (sheet.failed || []).map(f => `
      <div class="sumrow err"><span>${esc(f.label)}</span><b>${esc(f.msg)}</b></div>`).join("");
    content = `
      <h3>${esc(sheet.title)}</h3>
      <p>${esc(sheet.summary)}</p>
      <div class="sumlist">${failed}</div>
      <div class="lnks"><button class="btn ghost" data-act="close">Chiudi</button></div>`;

  } else if (sheet.type === "bulk") {
    // Annullamento di un'intera giornata
    const dk = sheet.date;
    const mine = allMy.filter(s => dkey(s.inizio) === dk && new Date(s.inizio) > now
      && (s.mio_stato === "confermato" || s.mio_stato === "lista_attesa"));
    const { ok, blocked } = splitCancellable(mine, now, ore);

    content = `
      <h3>Annulla l’intera giornata</h3>
      <div class="kv">
        <span>${dayLabel(dk)}</span>
        <b>${ok.length} slot (${getTotalHours(ok)} ore)</b>
      </div>
      ${err}
      ${blocked.length ? `<p>${blocked.length === 1 ? "1 slot non si può più annullare" : blocked.length + " slot non si possono più annullare"}: mancano meno di ${ore} ore all’inizio e restano prenotati.</p>` : ""}
      ${ok.length ? "<p>Sei sicuro di voler liberare questi slot?</p>" : ""}
      <div class="lnks">
        ${ok.length ? `<button class="btn danger" data-act="confirm-bulk" data-date="${dk}" ${dis}>${busy ? "Annullamento in corso…" : `Conferma e annulla ${ok.length}`}</button>` : ""}
        <button class="btn ghost" data-act="close">Indietro</button>
      </div>`;

  } else {
    // Singolo slot
    let sl = slots.find(x => x.slot_id === sheet.id) || allMy.find(x => x.slot_id === sheet.id);
    if (!sl) return "";

    const isPast = new Date(sl.inizio) <= now;
    const kv = `
      <div class="kv">
        <span>${fmtDateFull(sl.inizio)}, ${esc(ov.driver.citta_nome)}</span>
        <b class="num">${fmtTime(sl.inizio)} – ${fmtTime(sl.fine)}</b>
      </div>`;

    if (isPast) {
      content = `<h3>Slot trascorso</h3>${kv}${err}<p>Questo slot è terminato.</p><div class="lnks"><button class="btn ghost" data-act="close">Chiudi</button></div>`;

    } else if (sl.mio_stato === "confermato") {
      const dl = cancelDeadline(sl.inizio, ore);
      const canCancel = dl > now;
      const note = canCancel
        ? `<p>Puoi annullare fino a <b>${fmtDateFull(dl)}, ${fmtTime(dl)}</b>.</p>`
        : `<p>Il termine per annullare è scaduto: servivano almeno ${ore} ore prima dell’inizio. Per un imprevisto contatta il team Otoqi.</p>`;
      content = `
        <h3>Prenotazione confermata</h3>${kv}${err}${note}
        <div class="lnks">
          ${canCancel ? `<button class="btn danger" data-act="cancel" data-id="${sl.slot_id}" ${dis}>${busy ? "Un attimo…" : "Annulla singolo slot"}</button>` : ""}
          <button class="btn ghost" data-act="cal-slot" data-id="${sl.slot_id}">Aggiungi al calendario</button>
          <button class="btn ghost" data-act="close">Indietro</button>
        </div>`;

    } else if (sl.mio_stato === "lista_attesa") {
      content = `
        <h3>Sei in lista d’attesa</h3>${kv}${err}
        <p>Posizione attuale: <b>${sl.mia_posizione}</b>. Se un driver annulla, subentri in automatico.</p>
        <div class="lnks">
          <button class="btn danger" data-act="cancel" data-id="${sl.slot_id}" ${dis}>${busy ? "Un attimo…" : "Esci dalla coda"}</button>
          <button class="btn ghost" data-act="close">Indietro</button>
        </div>`;

    } else if (sl.capienza === 0) {
      content = `<h3>Slot chiuso</h3>${kv}${err}<p>Questo slot è momentaneamente chiuso alle prenotazioni.</p><div class="lnks"><button class="btn ghost" data-act="close">Chiudi</button></div>`;

    } else {
      const full = !ins && sl.capienza <= sl.confermati;
      content = `
        <h3>${full ? "Slot completo" : "Conferma lo slot"}</h3>${kv}${err}
        ${full ? "<p>Se qualcuno annulla, subentri in automatico.</p>" : ""}
        <div class="lnks">
          <button class="btn" data-act="book" data-id="${sl.slot_id}" ${dis}>${busy ? "Un attimo…" : full ? "Entra in lista d’attesa" : "Prenota ora"}</button>
          <button class="btn ghost" data-act="close">Annulla</button>
        </div>`;
    }
  }

  return `
    <div class="ov" data-act="backdrop">
      <div class="sheet${animate ? " enter" : ""}">
        <div class="grab"></div>
        ${content}
      </div>
    </div>`;
}

export function errorMessage(title, text, retry) {
  return `
    <div class="msg">
      <h3>${title}</h3>
      <p>${text}</p>
      ${retry ? '<button class="btn" data-act="retry">Riprova</button>' : ""}
    </div>`;
}