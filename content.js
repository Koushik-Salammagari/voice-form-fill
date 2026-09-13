(function () {
  "use strict";

  const SKIP_INPUT_TYPES = new Set([
    "hidden",
    "submit",
    "button",
    "reset",
    "image",
    "file",
  ]);

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    if (el.offsetParent === null) {
      // offsetParent is null for display:none and for position:fixed elements,
      // so double check with computed style before ruling it out.
      const style = window.getComputedStyle(el);
      if (style.position !== "fixed") return false;
      if (style.display === "none" || style.visibility === "hidden") {
        return false;
      }
    }
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isFillable(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (SKIP_INPUT_TYPES.has(type)) return false;
    } else if (tag !== "textarea" && tag !== "select") {
      return false;
    }
    if (el.disabled || el.readOnly) return false;
    if (!isVisible(el)) return false;
    return true;
  }

  function textOf(el) {
    return el ? el.textContent.replace(/\s+/g, " ").trim() : "";
  }

  function labelFromFor(el) {
    if (!el.id) return "";
    const escaped = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id;
    const label = document.querySelector(`label[for="${escaped}"]`);
    return textOf(label);
  }

  function labelFromWrapping(el) {
    const label = el.closest("label");
    if (!label) return "";
    // Exclude the field's own value/text if it happens to be inside the label.
    const clone = label.cloneNode(true);
    clone.querySelectorAll("input, textarea, select").forEach((n) => n.remove());
    return textOf(clone);
  }

  function labelFromAriaLabel(el) {
    return (el.getAttribute("aria-label") || "").trim();
  }

  function labelFromAriaLabelledBy(el) {
    const ids = (el.getAttribute("aria-labelledby") || "").trim();
    if (!ids) return "";
    const parts = ids
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean);
    return parts.join(" ").trim();
  }

  function labelFromPlaceholder(el) {
    return (el.getAttribute("placeholder") || "").trim();
  }

  function labelFromNearbyText(el) {
    // Look at the previous sibling (often a <label>, <span>, or text node
    // used as a visual caption for the field).
    let sibling = el.previousElementSibling;
    if (sibling && !/^(input|textarea|select)$/i.test(sibling.tagName)) {
      const text = textOf(sibling);
      if (text) return text;
    }

    // Look for leading text nodes directly inside the parent, before the field.
    const parent = el.parentElement;
    if (parent) {
      for (const node of parent.childNodes) {
        if (node === el) break;
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.replace(/\s+/g, " ").trim();
          if (text) return text;
        }
      }
      // Fall back to a preceding element in the parent's parent (e.g. a
      // <div class="field-row"><span>Label</span><input></div> sibling row).
      const grandparent = parent.parentElement;
      const parentPrev = parent.previousElementSibling;
      if (grandparent && parentPrev) {
        const text = textOf(parentPrev);
        if (text) return text;
      }
    }

    return "";
  }

  function labelFromNameOrId(el) {
    return el.getAttribute("name") || el.id || "";
  }

  function getLabel(el) {
    const strategies = [
      labelFromFor,
      labelFromWrapping,
      labelFromAriaLabel,
      labelFromAriaLabelledBy,
      labelFromPlaceholder,
      labelFromNearbyText,
      labelFromNameOrId,
    ];
    for (const strategy of strategies) {
      const label = strategy(el);
      if (label) return label;
    }
    return "unnamed field";
  }

  function slugify(text) {
    return (
      text
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "field"
    );
  }

  function uniqueKey(base, usedKeys) {
    let key = base;
    let counter = 2;
    while (usedKeys.has(key)) {
      key = `${base}_${counter}`;
      counter += 1;
    }
    usedKeys.add(key);
    return key;
  }

  function detectFields() {
    const candidates = document.querySelectorAll("input, textarea, select");
    const usedKeys = new Set();
    const results = [];

    candidates.forEach((el) => {
      if (!isFillable(el)) return;

      const label = getLabel(el);
      const key = uniqueKey(slugify(label), usedKeys);
      const type =
        el.tagName.toLowerCase() === "input"
          ? (el.getAttribute("type") || "text").toLowerCase()
          : el.tagName.toLowerCase();

      el.dataset.fieldKey = key;

      results.push({ key, label, type });
    });

    return results;
  }

  let fields = detectFields();
  console.log(
    `[Form Field Detector] Found ${fields.length} fillable field(s):`,
    fields
  );

  // --- Filling ---------------------------------------------------------

  function nativeValueSetter(el) {
    const tag = el.tagName;
    const proto =
      tag === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : tag === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
    return Object.getOwnPropertyDescriptor(proto, "value").set;
  }

  function nativeCheckedSetter() {
    return Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "checked"
    ).set;
  }

  function setFieldValue(el, value) {
    const tag = el.tagName.toLowerCase();
    const type =
      tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag;

    if (type === "checkbox" || type === "radio") {
      nativeCheckedSetter().call(el, Boolean(value));
    } else {
      nativeValueSetter(el).call(el, value);
    }

    // Plain HTML listeners react to these events directly. React (and
    // similar libraries) attach their onChange handler at the "input" event
    // too, but only fire it if the underlying value actually changed from
    // React's perspective - which requires going through the native setter
    // above instead of `el.value = x` (React patches the value setter on
    // the element instance, so a direct assignment gets swallowed).
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function highlightField(el) {
    const originalOutline = el.style.outline;
    const originalOutlineOffset = el.style.outlineOffset;
    el.style.outline = "2px solid #22c55e";
    el.style.outlineOffset = "1px";
    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.outlineOffset = originalOutlineOffset;
    }, 1500);
  }

  function fillFields(values) {
    const filled = [];
    const missing = [];

    Object.keys(values).forEach((key) => {
      const value = values[key];
      if (value === "" || value === null || value === undefined) {
        // Nothing was dictated for this field - leave it untouched instead
        // of overwriting/clearing whatever it currently holds.
        return;
      }

      const escaped = window.CSS && CSS.escape ? CSS.escape(key) : key;
      const el = document.querySelector(`[data-field-key="${escaped}"]`);
      if (!el) {
        missing.push(key);
        return;
      }
      setFieldValue(el, value);
      highlightField(el);
      filled.push(key);
    });

    console.log("[Form Field Detector] fillFields filled:", filled);
    if (missing.length) {
      console.warn("[Form Field Detector] fillFields missing keys:", missing);
    }

    return { filled, missing };
  }

  // --- Messaging (background <-> content script) --------------------------

  let panelFieldListEl = null;
  let panelFieldSummaryEl = null;
  let panelRecordButton = null;

  function markPanelFieldsFilled(filledKeys) {
    if (!panelFieldListEl) return;
    const filledSet = new Set(filledKeys || []);
    panelFieldListEl.querySelectorAll("li").forEach((li) => {
      if (filledSet.has(li.dataset.fieldKey)) {
        li.classList.add("field-filled");
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "GET_SCHEMA") {
      sendResponse({ fields });
      return;
    }

    if (message.type === "FILL_FIELDS") {
      const result = fillFields(message.values || {});
      markPanelFieldsFilled(result.filled);
      sendResponse(result);
      return;
    }
  });

  // --- Recording (mic -> webm) ---------------------------------------------

  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];

  async function startRecording() {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.addEventListener("dataavailable", (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    });
    mediaRecorder.start();
  }

  function stopRecording() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder || mediaRecorder.state !== "recording") {
        reject(new Error("Not recording"));
        return;
      }

      mediaRecorder.addEventListener(
        "stop",
        async () => {
          try {
            const blob = new Blob(chunks, { type: "audio/webm" });
            chunks = [];
            mediaStream.getTracks().forEach((track) => track.stop());
            mediaStream = null;
            const wavBase64 = await blobToWavBase64(blob);
            resolve(wavBase64);
          } catch (err) {
            reject(err);
          }
        },
        { once: true }
      );

      mediaRecorder.stop();
    });
  }

  // --- webm/opus -> 16-bit PCM WAV (base64) --------------------------------

  async function blobToWavBase64(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let wavBuffer;
    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      wavBuffer = encodeWav(audioBuffer);
    } finally {
      await audioCtx.close();
    }
    return arrayBufferToBase64(wavBuffer);
  }

  // Encodes an AudioBuffer as a 16-bit PCM mono WAV file (ArrayBuffer).
  function encodeWav(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const numFrames = audioBuffer.length;

    let samples;
    if (audioBuffer.numberOfChannels === 1) {
      samples = audioBuffer.getChannelData(0);
    } else {
      // Downmix all channels to mono by averaging them.
      samples = new Float32Array(numFrames);
      const channelData = [];
      for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
        channelData.push(audioBuffer.getChannelData(c));
      }
      for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        for (let c = 0; c < channelData.length; c++) sum += channelData[c][i];
        samples[i] = sum / channelData.length;
      }
    }

    const bytesPerSample = 2; // 16-bit
    const numChannels = 1;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // PCM fmt chunk size
    view.setUint16(20, 1, true); // audio format: 1 = PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true); // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample
    writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }

    return buffer;
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  // --- Messaging to background ---------------------------------------------

  function sendToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response && response.ok === false) {
          reject(new Error(response.error || "Unknown error"));
          return;
        }
        resolve(response);
      });
    });
  }

  // --- Floating panel UI ---------------------------------------------------

  const PANEL_STYLES = `
    :host {
      all: initial;
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 2147483647;
    }
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        Helvetica, Arial, sans-serif;
    }
    .panel {
      width: 260px;
      background: #ffffff;
      border: 1px solid #e0e3e8;
      border-radius: 12px;
      box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12), 0 2px 6px rgba(16, 24, 40, 0.08);
      padding: 14px;
      color: #16181d;
    }
    .panel-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #676d78;
      margin: 0 0 10px;
    }
    .field-summary {
      background: #f5f6f8;
      border: 1px solid #e0e3e8;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 12px;
      max-height: 120px;
      overflow-y: auto;
    }
    .field-summary h2 {
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #676d78;
      margin: 0 0 8px;
    }
    .field-summary-empty {
      margin: 0;
      font-size: 12.5px;
      color: #676d78;
    }
    #vff-field-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    #vff-field-list li {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      background: #ffffff;
      border: 1px solid #e0e3e8;
      font-size: 11.5px;
      color: #16181d;
    }
    #vff-field-list li .check {
      width: 11px;
      height: 11px;
      flex-shrink: 0;
      color: #15803d;
      display: none;
    }
    #vff-field-list li.field-filled {
      border-color: #b7ecc8;
      background: #eafbf0;
      color: #15803d;
    }
    #vff-field-list li.field-filled .check {
      display: inline-flex;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .record-button {
      position: relative;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      background: #2554e8;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s ease;
    }
    .record-button .icon {
      width: 20px;
      height: 20px;
    }
    .record-button:hover:not(:disabled) {
      background: #1c40b8;
    }
    .record-button:disabled {
      background: #e0e3e8;
      color: #9aa1ac;
      cursor: not-allowed;
    }
    .record-button.is-recording {
      background: #d92d20;
    }
    .record-button.is-recording::before {
      content: "";
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #d92d20;
      animation: vff-pulse-ring 1.6s ease-out infinite;
    }
    @keyframes vff-pulse-ring {
      0% {
        transform: scale(0.9);
        opacity: 0.7;
      }
      100% {
        transform: scale(1.4);
        opacity: 0;
      }
    }
    #vff-status {
      flex: 1;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 10px;
      border-radius: 6px;
      color: #676d78;
      min-height: 16px;
    }
    #vff-status.status-recording {
      color: #d92d20;
      background: #fdeeed;
    }
    #vff-status.status-processing {
      color: #2554e8;
      background: #eaf0fe;
    }
    #vff-status.status-success {
      color: #15803d;
      background: #eafbf0;
    }
    #vff-status.status-error {
      color: #b91c1c;
      background: #fdecec;
    }
  `;

  const PANEL_HTML = `
    <div class="panel">
      <p class="panel-title">Voice Fill</p>
      <div class="field-summary" id="vff-field-summary">
        <h2>This form has</h2>
        <ul id="vff-field-list"></ul>
      </div>
      <div class="controls">
        <button id="vff-record-button" class="record-button" title="Start recording" aria-label="Start recording">
          <svg id="vff-icon-mic" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"></path>
            <path d="M19 11a7 7 0 0 1-14 0"></path>
            <line x1="12" y1="18" x2="12" y2="22"></line>
            <line x1="8" y1="22" x2="16" y2="22"></line>
          </svg>
          <svg id="vff-icon-stop" class="icon" viewBox="0 0 24 24" fill="currentColor" style="display: none">
            <rect x="6" y="6" width="12" height="12" rx="2"></rect>
          </svg>
        </button>
        <div id="vff-status">Ready</div>
      </div>
    </div>
  `;

  const STATUS_STATES = [
    "status-recording",
    "status-processing",
    "status-success",
    "status-error",
  ];

  function setPanelStatus(el, text, state) {
    el.textContent = text;
    el.classList.remove(...STATUS_STATES);
    if (state) el.classList.add(`status-${state}`);
  }

  function setPanelRecordingUI(button, iconMic, iconStop, recording) {
    button.classList.toggle("is-recording", recording);
    iconMic.style.display = recording ? "none" : "";
    iconStop.style.display = recording ? "" : "none";
    const label = recording ? "Stop recording" : "Start recording";
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function renderPanelFieldList(fieldListEl, fieldsToRender) {
    fieldListEl.innerHTML = "";
    fieldsToRender.forEach((field) => {
      const li = document.createElement("li");
      li.dataset.fieldKey = field.key;

      const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      check.setAttribute("class", "check");
      check.setAttribute("viewBox", "0 0 24 24");
      check.setAttribute("fill", "none");
      check.setAttribute("stroke", "currentColor");
      check.setAttribute("stroke-width", "2.5");
      check.setAttribute("stroke-linecap", "round");
      check.setAttribute("stroke-linejoin", "round");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M5 12l5 5L19 7");
      check.appendChild(path);

      const label = document.createElement("span");
      label.textContent = field.label;

      li.appendChild(check);
      li.appendChild(label);
      fieldListEl.appendChild(li);
    });
  }

  // Re-renders the field-summary box (chips vs. "no fields" message) and
  // enables/disables the record button to match. Called on initial panel
  // creation and again from the detection-retry loop once fields show up.
  function updatePanelFieldUI(currentFields) {
    if (!panelFieldSummaryEl) return;

    if (currentFields.length === 0) {
      panelFieldSummaryEl.innerHTML =
        '<p class="field-summary-empty">No fields found on this page.</p>';
      panelFieldListEl = null;
      if (panelRecordButton) panelRecordButton.disabled = true;
    } else {
      panelFieldSummaryEl.innerHTML =
        '<h2>This form has</h2><ul id="vff-field-list"></ul>';
      const listEl = panelFieldSummaryEl.querySelector("#vff-field-list");
      renderPanelFieldList(listEl, currentFields);
      panelFieldListEl = listEl;
      if (panelRecordButton) panelRecordButton.disabled = false;
    }
  }

  const FIELD_DETECTION_MAX_ATTEMPTS = 4;
  const FIELD_DETECTION_RETRY_DELAY_MS = 500;

  // Google Forms (and similar JS-rendered forms) sometimes haven't painted
  // their inputs into the DOM yet by the time this content script's first
  // detectFields() pass runs. Retry a few times so the panel fills in
  // shortly after, instead of getting stuck on "No fields found".
  function scheduleFieldDetectionRetries() {
    let attempt = 1;

    const attemptDetection = () => {
      if (fields.length > 0 || attempt >= FIELD_DETECTION_MAX_ATTEMPTS) return;
      attempt += 1;

      setTimeout(() => {
        fields = detectFields();
        console.log(
          `[Form Field Detector] Retry ${attempt - 1}: found ${fields.length} fillable field(s):`,
          fields
        );
        updatePanelFieldUI(fields);
        attemptDetection();
      }, FIELD_DETECTION_RETRY_DELAY_MS);
    };

    attemptDetection();
  }

  function injectPanel() {
    const hostEl = document.createElement("div");
    hostEl.id = "voice-form-fill-panel-host";
    const shadow = hostEl.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${PANEL_STYLES}</style>${PANEL_HTML}`;
    document.documentElement.appendChild(hostEl);

    const recordButton = shadow.getElementById("vff-record-button");
    const iconMic = shadow.getElementById("vff-icon-mic");
    const iconStop = shadow.getElementById("vff-icon-stop");
    const statusEl = shadow.getElementById("vff-status");
    const fieldSummaryEl = shadow.getElementById("vff-field-summary");

    panelFieldSummaryEl = fieldSummaryEl;
    panelRecordButton = recordButton;
    updatePanelFieldUI(fields);

    let isRecording = false;

    recordButton.addEventListener("click", async () => {
      if (!isRecording) {
        recordButton.disabled = true;
        setPanelStatus(statusEl, "Starting microphone...", "processing");
        try {
          await startRecording();
          isRecording = true;
          setPanelRecordingUI(recordButton, iconMic, iconStop, true);
          setPanelStatus(statusEl, "Recording... click to stop", "recording");
        } catch (err) {
          console.error("[Voice Form Fill] getUserMedia failed:", err.name, err.message);
          setPanelStatus(statusEl, `Error: ${err.message}`, "error");
        } finally {
          recordButton.disabled = false;
        }
        return;
      }

      recordButton.disabled = true;
      setPanelStatus(statusEl, "Transcribing...", "processing");
      try {
        const wavBase64 = await stopRecording();
        isRecording = false;
        setPanelRecordingUI(recordButton, iconMic, iconStop, false);

        const result = await sendToBackground({
          type: "TRANSCRIBE_AND_FILL",
          wavBase64,
        });

        if (result.message) {
          setPanelStatus(statusEl, result.message, "success");
        } else if (result.filled && result.filled.length > 0) {
          setPanelStatus(statusEl, `Filled: ${result.filled.join(", ")}`, "success");
        } else {
          setPanelStatus(statusEl, "No fields filled", "success");
        }
      } catch (err) {
        isRecording = false;
        setPanelRecordingUI(recordButton, iconMic, iconStop, false);
        setPanelStatus(statusEl, `Error: ${err.message}`, "error");
      } finally {
        recordButton.disabled = false;
      }
    });
  }

  injectPanel();
  if (fields.length === 0) {
    scheduleFieldDetectionRetries();
  }
})();
