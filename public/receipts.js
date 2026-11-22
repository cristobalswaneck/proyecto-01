import { api, h, money, mountNav, statusBadge } from "./app.js";
import { renderReceipt } from "./receipt-view.js";

if (await mountNav("receipts")) {
  const $ = (id) => document.getElementById(id);
  const cats = await api("/api/categories");
  cats.forEach((c) => $("category").append(h("option", { value: c }, c)));

  async function openDetail(id) {
    const data = await api(`/api/receipts/${id}`);
    const show = async (d) => { $("detail").replaceChildren(await renderReceipt(d, (n) => { show(n); load(); })); };
    await show(data);
    $("detail").scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `?id=${id}`);
  }

  async function load() {
    const p = new URLSearchParams();
    for (const k of ["status", "category", "month", "q"]) if ($(k).value) p.set(k, $(k).value);
    const rows = await api(`/api/receipts?${p}`);
    $("rows").replaceChildren(...rows.map((r) => h("tr", { class: "clickable", onclick: () => openDetail(r.id) },
      h("td", {}, r.expense_date ?? "—"), h("td", {}, r.vendor ?? "—"), h("td", {}, r.category ?? "—"),
      h("td", { class: "num" }, money(r.total_amount, r.currency)), h("td", {}, statusBadge(r.status)))));
    $("empty").hidden = rows.length > 0;
  }

  for (const k of ["status", "category", "month"]) $(k).addEventListener("change", load);
  let t; $("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
  await load();
  const id = new URLSearchParams(location.search).get("id");
  if (id) openDetail(id).catch(() => {});
}
