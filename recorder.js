(function () {
  "use strict";

  const recordButton = document.getElementById("record-button");
  const recordButtonLabel = document.getElementById("record-button-label");
  const iconMic = document.getElementById("icon-mic");
  const iconStop = document.getElementById("icon-stop");
  const status = document.getElementById("status");
  const fieldSummary = document.getElementById("field-summary");
  const fieldList = document.getElementById("field-list");

  const params = new URLSearchParams(window.location.search);
  const targetTabIdRaw = params.get("targetTabId");
  const targetTabId = targetTabIdRaw ? Number(targetTabIdRaw) : null;

  const STATUS_STATES = [
    "status-idle",
    "status-recording",
    "status-processing",
    "status-success",
    "status-error",
  ];

  let isRecording = false;
  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];

  function setStatus(text, state) {
    status.textContent = text;
    status.classList.remove(...STATUS_STATES);
    if (state) status.classList.add(`status-${state}`);
  }

  function setRecordingUI(recording) {
    recordButton.classList.toggle("is-recording", recording);
    iconMic.style.display = recording ? "none" : "";
    iconStop.style.display = recording ? "" : "none";
    recordButtonLabel.textContent = recording ? "Stop" : "Record";
  }

  // --- Field summary (which fields this page has) -------------------------

  function renderFieldList(fields) {
    fieldList.innerHTML = "";
    fields.forEach((field) => {
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
      fieldList.appendChild(li);
    });
  }

  function renderNoFields(message) {
    fieldSummary.innerHTML = "";
    const p = document.createElement("p");
    p.className = "field-summary-empty";
    p.textContent = message || "No fields found on that page.";
    fieldSummary.appendChild(p);
  }

  function markFilledFields(filledKeys) {
    const filledSet = new Set(filledKeys || []);
    fieldList.querySelectorAll("li").forEach((li) => {
      if (filledSet.has(li.dataset.fieldKey)) {
        li.classList.add("field-filled");
      }
    });
  }

  async function initFieldSummary() {
    if (targetTabId === null) {
      renderNoFields("No target tab specified - open this page from the extension popup.");
      recordButton.disabled = true;
      return;
    }
    try {
      const schemaResponse = await chrome.tabs.sendMessage(targetTabId, {
        type: "GET_SCHEMA",
      });
      const fields = (schemaResponse && schemaResponse.fields) || [];
      if (fields.length === 0) {
        renderNoFields();
        recordButton.disabled = true;
        return;
      }
      renderFieldList(fields);
    } catch (err) {
      renderNoFields();
      recordButton.disabled = true;
    }
  }

  initFieldSummary();

  // --- Recording (mic -> webm) -------------------------------------------

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

  // --- webm/opus -> 16-bit PCM WAV (base64) -------------------------------

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

  // --- Messaging to background --------------------------------------------

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

  // --- UI ------------------------------------------------------------------

  recordButton.addEventListener("click", async () => {
    if (!isRecording) {
      recordButton.disabled = true;
      setStatus("Starting microphone...", "processing");
      try {
        await startRecording();
        isRecording = true;
        setRecordingUI(true);
        setStatus("Recording... click Stop when done", "recording");
      } catch (err) {
        console.error("getUserMedia failed:", err.name, err.message);
        setStatus(`Error: ${err.message}`, "error");
      } finally {
        recordButton.disabled = false;
      }
      return;
    }

    recordButton.disabled = true;
    setStatus("Transcribing...", "processing");
    try {
      const wavBase64 = await stopRecording();
      isRecording = false;
      setRecordingUI(false);

      if (targetTabId === null) {
        throw new Error(
          "No target tab id was provided - open this page via the extension popup."
        );
      }

      const result = await sendToBackground({
        type: "TRANSCRIBE_AND_FILL",
        wavBase64,
        targetTabId,
      });

      if (result.message) {
        setStatus(result.message, "success");
      } else if (result.filled && result.filled.length > 0) {
        setStatus(`Filled: ${result.filled.join(", ")}`, "success");
      } else {
        setStatus("No fields filled", "success");
      }
    } catch (err) {
      isRecording = false;
      setRecordingUI(false);
      setStatus(`Error: ${err.message}`, "error");
    } finally {
      recordButton.disabled = false;
    }
  });

  // --- Hand off back to the original tab once the flow finishes ----------

  const RETURN_TO_ORIGINAL_DELAY_MS = 1500;

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== "FLOW_DONE") return;

    if (message.result && message.result.filled) {
      markFilledFields(message.result.filled);
    }

    setTimeout(() => {
      if (targetTabId !== null) {
        chrome.tabs.update(targetTabId, { active: true });
      }
      window.close();
    }, RETURN_TO_ORIGINAL_DELAY_MS);
  });
})();
