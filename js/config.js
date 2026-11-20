export const SUPABASE_URL = "https://rjcpppvrwbfsthwednrs.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_H2PFnwDT3SRdqNGp2non1w_afvlggrL";

export const TZ = "Europe/Rome";
export const REFRESH_MS = 90000; // aggiornamento automatico quando l'app è aperta

export const NAMES = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];
export const MONTHS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
export const FASCE = [["Notte", 0, 6], ["Mattina", 6, 12], ["Pomeriggio", 12, 18], ["Sera", 18, 24]];

// Messaggi per gli esiti restituiti dal database
export const ERRORI = {
  fuori_finestra: "Impossibile annullare: tempo limite superato.",
  slot_iniziato: "Questo slot è già iniziato.",
  gia_prenotato: "Hai già prenotato questo slot.",
  slot_chiuso: "Questo slot è momentaneamente chiuso alle prenotazioni.",
  slot_non_disponibile: "Questo slot non è più disponibile.",
  nessuna_prenotazione: "Non risulta nessuna prenotazione per questo slot.",
  fuori_orario_inserimento: "Come driver in inserimento puoi prenotare solo gli slot della fascia diurna.",
  troppi_slot: "Hai selezionato troppi slot in una volta.",
  errore_rete: "Connessione assente. Riprova.",
  non_autenticato: "Sessione scaduta: esci e rientra."
};