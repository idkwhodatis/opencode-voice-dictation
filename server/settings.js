"use strict";
const form = document.querySelector("#settings");
const fields = document.querySelector("#fields");
const status = document.querySelector("#status");
const keyStatus = document.querySelector("#key-status");
let previous = null;
// Delivery is chosen per recording, not through the legacy autoSubmit setting.
const names = ["model", "language", "whisperPrompt", "temperature"];
function values() {
  return Object.fromEntries(names.map((name) => {
    const input = form.elements.namedItem(name);
    return [name, name === "temperature" ? Number(input.value) : input.value];
  }));
}
async function api(init) {
  const response = await fetch("/voice/config", {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-OCVD-Request": "1" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("Check your Caddy routing and sign-in: the server did not return JSON.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Settings request failed.");
  return data;
}
function show(data) {
  for (const name of names) form.elements.namedItem(name).value = data.settings[name];
  previous = data.settings;
  keyStatus.textContent = data.apiKeyConfigured ? "✓ Server API key is configured." : "API key is missing or unreadable. Check GROQ_API_KEY_FILE on the server.";
  keyStatus.dataset.error = String(!data.apiKeyConfigured);
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  // Only send edited fields; don't overwrite unrelated settings changed on another device.
  const patch = Object.fromEntries(Object.entries(values()).filter(([name, value]) => value !== previous?.[name]));
  fields.disabled = true;
  status.textContent = "Saving…";
  try { show(await api({ method: "PATCH", body: JSON.stringify(patch) })); status.textContent = "Settings saved."; }
  catch (error) { status.textContent = error.message || "Could not save settings."; }
  finally { fields.disabled = false; }
});
api().then((data) => { show(data); fields.disabled = false; }).catch((error) => { status.textContent = error.message || "Could not load settings. Reload to retry."; });
