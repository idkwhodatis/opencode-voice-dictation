import { createPaths } from "./paths";
import { installVoiceWorker } from "./registration";
const paths = createPaths(document.currentScript?.dataset.basePath ?? "/");
void installVoiceWorker(paths).catch((error) => console.warn("Voice worker could not start.", error));
const form = document.querySelector("#settings");
const fields = document.querySelector("#fields");
const status = document.querySelector("#status");
const providerForm = document.querySelector("#provider-settings");
const providerFields = document.querySelector("#provider-fields");
const providerInput = document.querySelector("#provider");
const endpointInput = document.querySelector("#endpoint");
const endpointFields = document.querySelector("#endpoint-fields");
const keyStatus = document.querySelector("#key-status");
const providerStatus = document.querySelector("#provider-status");
const targetWarning = document.querySelector("#target-warning");
const httpWarning = document.querySelector("#http-warning");
const keyEditor = document.querySelector("#key-editor");
const keyInput = document.querySelector("#api-key");
const editKey = document.querySelector("#edit-key");
const removeKey = document.querySelector("#remove-key");
const retryProvider = document.querySelector("#retry-provider");
const groqEndpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
let previous = null;
let savedProvider = null;
let providerBusy = false;
let settingsBusy = false;
// Delivery is chosen per recording, not through the legacy autoSubmit setting.
const numericNames = new Set([
  "temperature", "maxAudioMB", "maxRecordingSeconds", "timeoutSeconds", "maxConcurrent", "requestsPerMinute",
]);
const names = ["model", "language", "whisperPrompt", ...numericNames];
function values() {
  return Object.fromEntries(names.map((name) => {
    const input = form.elements.namedItem(name);
    return [name, numericNames.has(name) ? Number(input.value) : input.value];
  }));
}
async function api(path, init) {
  const response = await fetch(paths.voice(path), {
    ...init, credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "X-OCVD-Request": "1" },
    signal: AbortSignal.timeout(10000),
  });
  // Never show provider/server errors: they could contain a submitted secret.
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Settings request failed.");
  }
  return response.json();
}
function show(data) {
  for (const name of names) form.elements.namedItem(name).value = data.settings[name];
  previous = data.settings;
}
function clearKey() {
  keyInput.value = "";
  keyInput.setCustomValidity("");
  keyEditor.hidden = true;
  editKey.setAttribute("aria-expanded", "false");
}
function openKey() {
  keyEditor.hidden = false;
  editKey.setAttribute("aria-expanded", "true");
  keyInput.focus();
}
function target() {
  return {
    provider: providerInput.value,
    endpoint: providerInput.value === "groq" ? groqEndpoint : endpointInput.value.trim(),
  };
}
function normalizedEndpoint(endpoint) {
  try { return new URL(endpoint).href; } catch { return endpoint; }
}
function targetChanged() {
  const next = target();
  return !savedProvider || next.provider !== savedProvider.provider
    || normalizedEndpoint(next.endpoint) !== normalizedEndpoint(savedProvider.endpoint);
}
function updateProviderControls() {
  const custom = providerInput.value === "custom";
  endpointFields.hidden = !custom;
  endpointInput.disabled = !custom;
  endpointInput.required = custom;
  httpWarning.hidden = !custom || !/^http:/i.test(endpointInput.value.trim());
  endpointInput.setAttribute("aria-describedby", `endpoint-help custom-warning${httpWarning.hidden ? "" : " http-warning"}`);
  const changed = targetChanged();
  targetWarning.hidden = !changed;
  removeKey.disabled = !savedProvider || savedProvider.source === "none" || changed;
  editKey.textContent = changed || !savedProvider?.apiKeyConfigured ? "Add key" : "Change key";
}
function showProvider(data) {
  if (!data || !["groq", "custom"].includes(data.provider) || typeof data.endpoint !== "string"
    || typeof data.apiKeyConfigured !== "boolean" || !["encrypted", "legacy", "none"].includes(data.source)) {
    throw new Error("Invalid provider settings.");
  }
  // Keep only non-secret metadata; a key is never read back or filled in.
  savedProvider = {
    provider: data.provider, endpoint: data.endpoint,
    apiKeyConfigured: data.apiKeyConfigured, source: data.source, error: Boolean(data.error),
  };
  providerInput.value = data.provider;
  endpointInput.value = data.provider === "custom" ? data.endpoint : "";
  clearKey();
  if (data.error) keyStatus.textContent = "The server could not read this key. Restore the server encryption key or remove this credential before adding a new key.";
  else if (data.apiKeyConfigured && data.source === "legacy") keyStatus.textContent = "A legacy server-file key is configured. Enter it again to save an encrypted copy.";
  else if (data.apiKeyConfigured) keyStatus.textContent = "✓ Server API key is configured and encrypted.";
  else keyStatus.textContent = "No API key is configured. Add a key to enable transcription.";
  keyStatus.dataset.error = String(!data.apiKeyConfigured || Boolean(data.error));
  updateProviderControls();
}
function cancelProvider() {
  if (!savedProvider || providerBusy) return;
  showProvider(savedProvider);
  providerStatus.textContent = "Changes cancelled.";
}
async function loadProvider() {
  if (providerBusy) return;
  providerBusy = true;
  providerFields.disabled = true;
  retryProvider.hidden = true;
  providerStatus.textContent = "";
  try {
    showProvider(await api("provider"));
    providerFields.disabled = false;
  } catch {
    clearKey();
    keyStatus.textContent = "Provider configuration is unavailable.";
    keyStatus.dataset.error = "true";
    providerStatus.textContent = "Could not load provider settings. Check your connection and sign-in, then retry.";
    retryProvider.hidden = false;
  } finally { providerBusy = false; }
}
async function saveProvider(payload, message) {
  if (providerBusy) return;
  providerBusy = true;
  providerFields.disabled = true;
  providerStatus.textContent = "Saving…";
  try {
    showProvider(await api("provider", { method: "PUT", body: JSON.stringify(payload) }));
    providerStatus.textContent = message;
  } catch {
    // Keep the entered key for an intentional retry; never echo an error or payload.
    providerStatus.textContent = "Could not save provider settings. Check the endpoint, key, connection, and sign-in, then retry.";
  } finally {
    providerBusy = false;
    providerFields.disabled = false;
  }
}
providerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (providerBusy || !savedProvider) return;
  const payload = target();
  const key = keyInput.value.trim();
  if (targetChanged() && !key) {
    openKey();
    keyInput.setCustomValidity("Enter a new API key for this provider and endpoint.");
    keyInput.reportValidity();
    providerStatus.textContent = "Enter a new API key before saving a different provider or endpoint.";
    return;
  }
  if (key) payload.apiKey = key;
  saveProvider(payload, "Provider settings saved.");
});
for (const input of [providerInput, endpointInput]) input.addEventListener("input", () => {
  // A key typed for one target must not follow a later destination change.
  clearKey();
  providerStatus.textContent = "";
  updateProviderControls();
});
keyInput.addEventListener("input", () => keyInput.setCustomValidity(""));
editKey.addEventListener("click", openKey);
document.querySelector("#cancel-key").addEventListener("click", () => { clearKey(); editKey.focus(); });
keyEditor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") { event.preventDefault(); clearKey(); editKey.focus(); }
});
document.querySelector("#cancel-provider").addEventListener("click", cancelProvider);
removeKey.addEventListener("click", () => {
  if (!savedProvider || providerBusy || targetChanged()) return;
  clearKey();
  saveProvider({ provider: savedProvider.provider, endpoint: savedProvider.endpoint, apiKey: null }, "API key removed.");
});
retryProvider.addEventListener("click", loadProvider);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (settingsBusy || !previous || !form.reportValidity()) return;
  // Only send edited fields; don't overwrite unrelated settings changed on another device.
  const patch = Object.fromEntries(Object.entries(values()).filter(([name, value]) => value !== previous?.[name]));
  settingsBusy = true;
  fields.disabled = true;
  status.textContent = "Saving…";
  try { show(await api("config", { method: "PATCH", body: JSON.stringify(patch) })); status.textContent = "Settings saved."; }
  catch { status.textContent = "Could not save settings. Check your connection and sign-in, then retry."; }
  finally { settingsBusy = false; fields.disabled = false; }
});
async function loadSettings() {
  fields.disabled = true;
  try { show(await api("config")); fields.disabled = false; }
  catch { status.textContent = "Could not load settings. Check your connection and sign-in, then reload."; }
}
// Cover navigating away, closing the tab, and back/forward-cache restoration.
window.addEventListener("pagehide", clearKey);
window.addEventListener("beforeunload", clearKey);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) { clearKey(); loadProvider(); loadSettings(); }
});
loadSettings();
loadProvider();
