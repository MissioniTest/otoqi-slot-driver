import { NAMES, MONTHS, TZ } from "./config.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[c]));

export const pad = n => String(n).padStart(2, "0");

// --- Date e orari: sempre fuso di Roma, qualunque sia il fuso del telefono ---
const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

// Scompone una data (Date o stringa ISO) nelle sue parti a Roma
export function rp(input) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(input)).map(x => [x.type, x.value]));
  const y = +p.year, mo = +p.month, d = +p.day;
  return {
    dk: `${p.year}-${p.month}-${p.day}`,
    y, mo, d,
    h: +p.hour,
    mi: +p.minute,
    dow: new Date(y, mo - 1, d).getDay()
  };
}

export const dkey = input => rp(input).dk;

export const fmtTime = iso => {
  const p = rp(iso);
  return `${pad(p.h)}:${pad(p.mi)}`;
};

export const fmtDateFull = iso => {
  const p = rp(iso);
  return `${NAMES[p.dow]} ${p.d} ${MONTHS[p.mo - 1]}`;
};

// Etichetta di un giorno a partire dalla sua chiave AAAA-MM-GG
export const dayLabel = dk => {
  const d = new Date(dk + "T12:00:00");
  return `${NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};

// Ore con la virgola all'italiana (12 -> "12", 12.5 -> "12,5")
export const fmtH = n => String(Math.round((Number(n) || 0) * 10) / 10).replace(".", ",");

// --- Raggruppamenti di slot ---
export function getMergedRanges(slots) {
  if (!slots || !slots.length) return [];
  const sorted = [...slots].sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const ranges = [];
  let start = new Date(sorted[0].inizio);
  let end = new Date(sorted[0].fine);

  for (let i = 1; i < sorted.length; i++) {
    const s = new Date(sorted[i].inizio);
    const e = new Date(sorted[i].fine);
    if (Math.abs(s - end) <= 60000) {
      if (e > end) end = e;
    } else {
      ranges.push({ start, end });
      start = s;
      end = e;
    }
  }
  ranges.push({ start, end });
  return ranges;
}

export function getMergedIntervals(slots) {
  return getMergedRanges(slots).map(r => `${fmtTime(r.start)} – ${fmtTime(r.end)}`).join(" • ");
}

export function getTotalHours(slots) {
  const ms = slots.reduce((acc, s) => acc + (new Date(s.fine) - new Date(s.inizio)), 0);
  const h = Math.round((ms / 3600000) * 10) / 10;
  return h % 1 === 0 ? h : h.toFixed(1).replace(".", ",");
}

// --- Annullamento: termine e divisione tra slot annullabili e non ---
export const cancelDeadline = (iso, ore) => new Date(new Date(iso).getTime() - ore * 3600000);

export function splitCancellable(slots, now, ore) {
  const ok = [];
  const blocked = [];
  slots.forEach(s => {
    if (s.mio_stato === "lista_attesa" || cancelDeadline(s.inizio, ore) > now) ok.push(s);
    else blocked.push(s);
  });
  return { ok, blocked };
}

// --- Calendario del mese (chiavi costruite a mano, senza conversioni di fuso) ---
export function getMonthMatrix(year, month) {
  const startOffset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let i = 0; i < startOffset; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ dayNum: d, dkey: `${year}-${pad(month + 1)}-${pad(d)}` });
  }
  return days;
}

// --- Aggiungi al calendario (file .ics, funziona con Google e Apple Calendar) ---
const icsDate = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const icsText = t => String(t).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");

export function buildIcs(events) {
  const stamp = icsDate(new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Otoqi//Slot//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  events.forEach(e => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@otoqi`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(new Date(e.start))}`,
      `DTEND:${icsDate(new Date(e.end))}`,
      `SUMMARY:${icsText(e.summary)}`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

export function downloadIcs(filename, events) {
  const blob = new Blob([buildIcs(events)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}