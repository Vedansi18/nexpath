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
    if (event.type === "select") {
      console.log("[nexpath harness] select:", event.optionId, event.body);
    } else {
      console.log("[nexpath harness] event:", event.type);
    }
  }
  const controller = mountNexpathPanel(root, { onEvent: logEvent });
  controller.show(payload);
  console.log("[nexpath harness] panel mounted + shown. fixture:", fixtureName);
  console.log("[nexpath harness] payload:", payload);
  window["nexpathController"] = controller;
  document.getElementById("nexpath-harness-busy-on")?.addEventListener("click", () => {
    controller.setBusy(true);
    console.log("[nexpath harness] setBusy(true)");
  });
  document.getElementById("nexpath-harness-busy-off")?.addEventListener("click", () => {
    controller.setBusy(false);
    console.log("[nexpath harness] setBusy(false)");
  });
  document.getElementById("nexpath-harness-hide")?.addEventListener("click", () => {
    controller.hide();
    console.log("[nexpath harness] hide()");
  });
}
bootstrap().catch((err) => {
  console.error("[nexpath harness] bootstrap failed:", err);
});
