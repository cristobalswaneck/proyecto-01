import { api, h, money, mountNav, number } from "./app.js";

// Paleta categórica: asignación fija por nombre para que un color no cambie entre gráficos.
const PALETTE = ["#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f", "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac", "#1f77b4", "#8c564b", "#17becf"];
const colorOf = (() => { const m = new Map(); return (k) => { if (!m.has(k)) m.set(k, PALETTE[m.size % PALETTE.length]); return m.get(k); }; })();
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

if (await mountNav("insights")) {
  const $ = (id) => document.getElementById(id);
  Chart.defaults.color = css("--muted");
  Chart.defaults.borderColor = css("--line");

  const [ov, monthly, vendors, products] = await Promise.all([
    api("/api/insights/overview"), api("/api/insights/monthly-by-category"),
    api("/api/insights/top-vendors"), api("/api/insights/products")]);

  const stat = (n, label) => h("div", { class: "card stat" }, h("b", {}, n), h("span", {}, label));
  $("stats").append(stat(ov.confirmed, "confirmados"), stat(ov.pending, "pendientes"), stat(ov.review, "a revisar"));
  const notes = [];
  if (ov.excludedNonEur) notes.push(`${ov.excludedNonEur} en otra moneda (no se suman)`);
  if (ov.excludedUnreconciled) notes.push(`${ov.excludedUnreconciled} con líneas que no cuadran (no cuentan para precios)`);
  $("excluded").textContent = notes.length ? `Excluidos del análisis: ${notes.join("; ")}.` : "";

  // Gasto mensual apilado por categoría
  if (monthly.length === 0) $("monthly-empty").hidden = false;
  else {
    const months = [...new Set(monthly.map((r) => r.month))];
    const cats = [...new Set(monthly.map((r) => r.category))];
    new Chart($("monthly"), {
      type: "bar",
      data: { labels: months, datasets: cats.map((c) => ({
        label: c, backgroundColor: colorOf(c),
        data: months.map((m) => monthly.find((r) => r.month === m && r.category === c)?.total ?? 0) })) },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (v) => money(v) } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y)}` } } } },
    });
  }

  $("vendors").replaceChildren(...vendors.map((v) => h("tr", {}, h("td", {}, v.vendor),
    h("td", { class: "num" }, money(v.total)), h("td", { class: "num" }, v.tickets), h("td", { class: "num" }, money(v.avgTicket)))));

  // Evolución del precio unitario por producto
  if (products.length === 0) $("price-empty").hidden = false;
  products.forEach((p) => $("product").append(h("option", { value: p.product }, `${p.product} (${p.purchases})`)));
  let priceChart;
  $("product").addEventListener("change", async (ev) => {
    priceChart?.destroy();
    $("change").textContent = "";
    $("price-box").hidden = !ev.target.value;
    if (!ev.target.value) return;
    const hist = await api(`/api/insights/price-history?product=${encodeURIComponent(ev.target.value)}`);
    const unit = hist.byUnit[0]?.unit ?? "ud"; // un solo gráfico por unidad: kg, l y ud no se mezclan
    const pts = hist.points.filter((p) => p.unit === unit);
    const vs = [...new Set(pts.map((p) => p.vendor))];
    const dates = [...new Set(pts.map((p) => p.date))];
    $("change").textContent = hist.byUnit.map((u) =>
      `Por ${u.unit}: ${number(u.first)} € → ${number(u.last)} € (${u.changePct > 0 ? "+" : ""}${number(u.changePct, 1)} %, ${u.points} compras)`).join(" · ");
    priceChart = new Chart($("price"), {
      type: "line",
      data: { labels: dates, datasets: vs.map((v) => ({ label: v, borderColor: colorOf(v), backgroundColor: colorOf(v), spanGaps: true, tension: 0.2,
        data: dates.map((d) => pts.find((p) => p.date === d && p.vendor === v)?.price ?? null) })) },
      options: { responsive: true, maintainAspectRatio: false,
        scales: { y: { title: { display: true, text: `€ por ${unit}` }, ticks: { callback: (x) => number(x) } } } },
    });
  });
}
