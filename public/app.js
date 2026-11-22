// Utilidades compartidas. Todo el texto de los tickets se pinta con textContent (nunca innerHTML).
export async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  if (res.status === 401 && !location.pathname.endsWith("/login.html")) {
    location.href = "/login.html";
    throw new Error("No autenticado");
  }
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw Object.assign(new Error(body?.error ?? `Error ${res.status}`), { status: res.status, body });
  return body;
}

/** Crea un elemento: h("div", {class: "x", onclick: fn}, "texto", otroNodo). */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function money(value, currency = "EUR") {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: currency || "EUR" }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency ?? ""}`;
  }
}

export const number = (v, d = 2) =>
  v === null || v === undefined ? "—" : new Intl.NumberFormat("es-ES", { maximumFractionDigits: d }).format(v);

export const STATUS = {
  pending: ["Pendiente", "warn"], confirmed: ["Confirmado", "good"],
  review: ["Revisar", "bad"], rejected: ["Descartado", "bad"],
};

export const statusBadge = (s) => h("span", { class: `badge ${STATUS[s]?.[1] ?? ""}` }, STATUS[s]?.[0] ?? s);

export async function mountNav(active) {
  const session = await api("/api/session");
  if (session.authRequired && !session.authenticated) {
    location.href = "/login.html";
    return false;
  }
  const link = (href, label, key) => h("a", { href, class: key === active ? "active" : "" }, label);
  const nav = h("header", { class: "nav" },
    h("span", { class: "brand" }, "Gastos"),
    link("/", "Subir", "upload"), link("/receipts.html", "Tickets", "receipts"),
    link("/insights.html", "Análisis", "insights"),
    session.authRequired ? h("button", { onclick: async () => { await api("/api/logout", { method: "POST" }); location.href = "/login.html"; } }, "Salir") : null);
  document.body.prepend(nav);
  return true;
}
