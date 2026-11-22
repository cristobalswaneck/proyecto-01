import { api } from "./app.js";
document.getElementById("f").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = document.getElementById("err");
  err.textContent = "";
  try {
    await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: document.getElementById("p").value }) });
    location.href = "/";
  } catch (e) { err.textContent = e.message; }
});
