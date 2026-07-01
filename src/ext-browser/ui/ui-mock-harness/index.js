// src/ext-browser/ui/ui-mock-harness/index.ts
async function loadFixture(name) {
  const res = await fetch(`./fixtures/${name}.json`);
  if (!res.ok) throw new Error(`Failed to load fixture: ${name}`);
  return res.json();
}
async function bootstrap() {
  const uiModule = await import("../../../ext-browser/ui/ui.js");
  const { mountNexpathPanel } = uiModule;
  const params = new URLSearchParams(window.location.search);
  const fixtureName = params.get("fixture") ?? "stage-transition-prd";
  const payload = await loadFixture(fixtureName);
  const root = document.getElementById("nexpath-harness-root");
  if (!root) throw new Error("Missing #nexpath-harness-root element in HTML");
  const eventLog = document.getElementById("nexpath-harness-log");
  function logEvent(event) {
    const entry = document.createElement("pre");
    entry.textContent = JSON.stringify(event, null, 2);
    eventLog?.prepend(entry);
    if (event.type === "option_selected") {
      console.log("[nexpath harness] option_selected:", event.selectedText);
    } else {
      console.log("[nexpath harness] event:", event.type);
    }
  }
  const controller = mountNexpathPanel(root, payload, logEvent);
  console.log("[nexpath harness] panel mounted. fixture:", fixtureName);
  console.log("[nexpath harness] payload:", payload);
  window["nexpathUnmount"] = () => {
    controller.unmount();
    console.log("[nexpath harness] panel unmounted");
  };
}
bootstrap().catch((err) => {
  console.error("[nexpath harness] bootstrap failed:", err);
});
