import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// La sessione resta salvata nel browser e si rinnova da sola: il driver fa il login una volta.
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true }
});

async function rpc(fn, params = {}) {
  try {
    const { data, error } = await sb.rpc(fn, params);
    if (error) {
      console.error(fn, error);
      return { esito: /jwt|not authenticated/i.test(error.message) ? "non_autenticato" : "errore" };
    }
    return data;
  } catch (e) {
    return { esito: "errore_rete" };
  }
}

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function login(email, password) {
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (!error) return "ok";
    return /invalid login/i.test(error.message) ? "credenziali" : "errore";
  } catch (e) {
    return "errore";
  }
}

export const logout = () => sb.auth.signOut();

export async function changePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) return error.message;
  await rpc("password_cambiata");
  return "ok";
}

export const fetchOverview = () => rpc("get_overview");
export const fetchSlots = () => rpc("get_slots");
export const fetchStorico = () => rpc("get_storico");
export const bookSlot = (slotId) => rpc("book_slot", { p_slot_id: slotId });
export const bookSlots = (slotIds) => rpc("book_slots", { p_slot_ids: slotIds });
export const cancelBooking = (slotId) => rpc("cancel_booking", { p_slot_id: slotId });
export const cancelSlots = (slotIds) => rpc("cancel_slots", { p_slot_ids: slotIds });