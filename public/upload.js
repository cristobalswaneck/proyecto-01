import { api, h, mountNav } from "./app.js";
import { renderReceipt } from "./receipt-view.js";

if (await mountNav("upload")) {
  const file = document.getElementById("file");
  const drop = document.getElementById("drop");
  const status = document.getElementById("status");
  const result = document.getElementById("result");

  async function show(data) { result.replaceChildren(await renderReceipt(data, show)); }

  async function upload(f) {
    if (!f) return;
    result.replaceChildren();
    status.textContent = "Leyendo el ticket…";
    const body = new FormData();
    body.append("file", f);
    try {
      const res = await api("/api/receipts", { method: "POST", body });
      status.textContent = res.result.probableDuplicates.length ? "Ojo: parece un ticket repetido." : "";
      await show(res.receipt);
    } catch (e) {
      status.textContent = "";
      const dup = e.body?.result?.duplicateOf;
      result.replaceChildren(h("div", { class: "card" }, h("p", { class: "error" }, e.message),
        dup ? h("a", { href: `/receipts.html?id=${dup}` }, "Ver el ticket ya registrado") : null));
    } finally { file.value = ""; }
  }

  file.addEventListener("change", () => upload(file.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files[0]); });

  const { demo } = await api("/api/session");
  if (demo) document.getElementById("banner").append(
    h("p", { class: "muted" }, "Modo demostración: el lector de IA aún no está conectado, así que los datos que verás son de ejemplo y no salen de la imagen."));
}
