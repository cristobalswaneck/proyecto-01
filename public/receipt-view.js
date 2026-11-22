import { api, h, money, number, statusBadge } from "./app.js";

/** Pinta un ticket (cabecera, estado de líneas, avisos, líneas, acciones). `onChange` recibe el ticket actualizado. */
export async function renderReceipt(data, onChange) {
  const categories = await api("/api/categories");
  const { expense: e, items, issues, itemsDiff } = data;
  const flagged = new Set(issues.filter((i) => i.line_no).map((i) => i.line_no));
  const cur = e.currency ?? "EUR";
  const editable = e.status === "pending" || e.status === "review";

  const lineStatus = items.length === 0
    ? h("span", { class: "badge warn" }, "Sin líneas")
    : e.items_reconciled
      ? h("span", { class: "badge good" }, `${items.length} líneas ✅ cuadran`)
      : h("span", { class: "badge warn" }, `${items.length} líneas ⚠️ ${itemsDiff === null ? "incompletas" : `faltan ${number(itemsDiff)}`}`);

  const act = async (path, method = "POST", body) => {
    const next = await api(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    onChange(next);
  };

  const categorySelect = h("select", { disabled: !editable, onchange: (ev) => act(`/api/receipts/${e.id}`, "PATCH", { category: ev.target.value }) },
    e.category === null ? h("option", { value: "" }, "— elegir —") : null,
    categories.map((c) => h("option", { value: c, selected: c === e.category }, c)));

  const head = h("dl", { class: "kv" },
    h("dt", {}, "Comercio"), h("dd", {}, e.vendor ?? "—"),
    h("dt", {}, "Fecha"), h("dd", {}, e.expense_date ?? "—", " ", e.purchase_time ?? "", e.date_ambiguous ? h("span", { class: "badge warn" }, " ambigua") : null),
    h("dt", {}, "Total"), h("dd", {}, h("b", {}, money(e.total_amount, cur))),
    h("dt", {}, "Base / IVA"), h("dd", {}, `${money(e.base_amount, cur)} / ${money(e.vat_amount, cur)}`),
    h("dt", {}, "Categoría"), h("dd", {}, categorySelect),
    h("dt", {}, "Pago"), h("dd", {}, e.payment_method ?? "—"),
    h("dt", {}, "Estado"), h("dd", {}, statusBadge(e.status), " ", lineStatus),
    h("dt", {}, "Confianza"), h("dd", {}, e.confidence === null ? "—" : `${Math.round(e.confidence * 100)} %`));

  const issueList = issues.length
    ? h("ul", { class: "issues" }, issues.map((i) => h("li", { class: i.severity === "block" ? "block" : "" }, i.message)))
    : null;

  const table = items.length ? h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["#", "En el ticket", "Producto", "Cant.", "Precio", "Dto.", "Total"].map((t, i) => h("th", { class: i >= 3 ? "num" : "" }, t)))),
    h("tbody", {}, items.map((it) => h("tr", { class: flagged.has(it.line_no) ? "flag" : "" },
      h("td", {}, it.line_no), h("td", {}, it.raw_description),
      h("td", {}, it.product_normalized ?? "—"),
      h("td", { class: "num" }, `${number(it.quantity, 3)} ${it.unit ?? ""}`),
      h("td", { class: "num" }, money(it.unit_price, cur)), h("td", { class: "num" }, it.discount ? money(it.discount, cur) : ""),
      h("td", { class: "num" }, money(it.line_total, cur))))))) : null;

  const actions = h("div", { class: "actions" },
    h("button", { class: "primary", disabled: !editable, onclick: () => act(`/api/receipts/${e.id}/confirm`) }, "✅ Confirmar"),
    h("button", { class: "danger", disabled: e.status === "rejected", onclick: () => confirm("¿Descartar este ticket?") && act(`/api/receipts/${e.id}/discard`) }, "🗑️ Descartar"));

  const image = e.image_path ? h("a", { href: `/api/receipts/${e.id}/image`, target: "_blank", rel: "noopener" },
    h("img", { src: `/api/receipts/${e.id}/image`, alt: "Imagen original del ticket", loading: "lazy" })) : null;

  return h("div", { class: "card" },
    h("div", { class: `detail ${image ? "with-image" : ""}` }, h("div", {}, head, issueList, actions), image),
    table ? h("h2", {}, "Líneas") : null, table);
}
