import { displayDeviceName, loadDeviceName, MAX_DEVICE_NAME_LENGTH, saveDeviceName } from "./device-name";
import "./device-controls.css";

const mountDeviceControls = () => {
  const header = document.querySelector(".shell > header");
  if (!header || document.querySelector("#device-name-form")) return;

  const form = document.createElement("form");
  form.id = "device-name-form";
  form.className = "device-name-form";
  form.innerHTML = `
    <div class="device-name-copy">
      <span class="device-name-label">This browser</span>
      <strong id="device-name-display"></strong>
    </div>
    <button class="device-name-edit secondary compact" type="button" aria-expanded="false" aria-controls="device-name-editor">Rename</button>
    <div class="device-name-editor" id="device-name-editor" hidden>
      <label for="device-name-input">Device name</label>
      <div class="device-name-fields">
        <input id="device-name-input" name="device-name" type="text" maxlength="${MAX_DEVICE_NAME_LENGTH}" autocomplete="off" spellcheck="false" aria-describedby="device-name-help" />
        <button type="submit" class="compact">Save</button>
      </div>
      <small id="device-name-help">Stored only in this browser. Leave blank to use an automatic device label.</small>
    </div>
    <span id="device-name-status" class="sr-only" role="status" aria-live="polite"></span>
  `;
  header.append(form);

  const display = form.querySelector<HTMLElement>("#device-name-display");
  const editButton = form.querySelector<HTMLButtonElement>(".device-name-edit");
  const editor = form.querySelector<HTMLElement>("#device-name-editor");
  const input = form.querySelector<HTMLInputElement>("#device-name-input");
  const status = form.querySelector<HTMLElement>("#device-name-status");

  const render = () => {
    if (display) display.textContent = displayDeviceName();
  };

  render();

  editButton?.addEventListener("click", () => {
    if (!editor || !input) return;
    const opening = editor.hidden;
    editor.hidden = !opening;
    editButton.setAttribute("aria-expanded", String(opening));
    editButton.textContent = opening ? "Close" : "Rename";
    if (opening) {
      input.value = loadDeviceName();
      input.focus();
      input.select();
    }
  });

  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!input || !editor || !editButton) return;
    const saved = saveDeviceName(input.value);
    render();
    editor.hidden = true;
    editButton.setAttribute("aria-expanded", "false");
    editButton.textContent = "Rename";
    editButton.focus();
    if (status) status.textContent = saved ? `Device name saved as ${saved}.` : "Custom device name cleared.";
  });
};

mountDeviceControls();
