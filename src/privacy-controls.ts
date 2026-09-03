import { isRelayOnlyPreferred, setRelayOnlyPreferred } from "./privacy-preference";
import "./privacy-controls.css";

const mountPrivacyControl = () => {
  const shell = document.querySelector<HTMLElement>(".shell");
  if (!shell || document.querySelector("#relay-only-toggle")) return;

  const initialPreference = isRelayOnlyPreferred();
  const section = document.createElement("section");
  section.className = "privacy-control";
  section.innerHTML = `
    <div class="privacy-control-card">
      <label for="relay-only-toggle">
        <input id="relay-only-toggle" type="checkbox" ${initialPreference ? "checked" : ""} aria-describedby="relay-only-help relay-only-status" />
        <span>
          <strong>Relay-only privacy mode</strong>
          <small id="relay-only-help">Require TURN relay routing so peers do not connect directly. Applying a change restarts this temporary session.</small>
        </span>
      </label>
      <div class="privacy-control-actions" hidden>
        <button id="relay-only-apply" type="button">Apply & restart</button>
        <button id="relay-only-cancel" class="secondary" type="button">Cancel</button>
      </div>
      <p id="relay-only-status" class="privacy-control-status" role="status" aria-live="polite"></p>
    </div>
  `;

  const connection = shell.querySelector(".connection");
  shell.insertBefore(section, connection ?? null);

  const toggle = section.querySelector<HTMLInputElement>("#relay-only-toggle");
  const actions = section.querySelector<HTMLElement>(".privacy-control-actions");
  const apply = section.querySelector<HTMLButtonElement>("#relay-only-apply");
  const cancel = section.querySelector<HTMLButtonElement>("#relay-only-cancel");
  const status = section.querySelector<HTMLElement>("#relay-only-status");
  if (!toggle || !actions || !apply || !cancel || !status) return;

  const renderPendingState = () => {
    const changed = toggle.checked !== initialPreference;
    actions.hidden = !changed;
    status.textContent = changed
      ? `${toggle.checked ? "Relay-only mode will be enabled" : "Direct connections will be allowed"} after you apply and restart.`
      : "";
  };

  toggle.addEventListener("change", renderPendingState);

  cancel.addEventListener("click", () => {
    toggle.checked = initialPreference;
    renderPendingState();
    toggle.focus();
  });

  apply.addEventListener("click", () => {
    if (toggle.checked === initialPreference) return;
    setRelayOnlyPreferred(toggle.checked);
    apply.disabled = true;
    cancel.disabled = true;
    status.textContent = "Privacy preference saved. Restarting this temporary session…";
    window.location.reload();
  });
};

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => requestAnimationFrame(mountPrivacyControl), { once: true });
} else {
  requestAnimationFrame(mountPrivacyControl);
}
