(function () {
  "use strict";

  const recordButton = document.getElementById("record-button");
  const status = document.getElementById("status");
  const optionsLink = document.getElementById("options-link");

  const STATUS_STATES = ["status-processing", "status-success", "status-error"];

  function setStatus(text, state) {
    status.textContent = text;
    status.classList.remove(...STATUS_STATES);
    if (state) status.classList.add(`status-${state}`);
  }

  function getActiveTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs[0]) {
          reject(new Error(chrome.runtime.lastError?.message || "No active tab"));
          return;
        }
        resolve(tabs[0]);
      });
    });
  }

  // Recording happens in a real extension tab (recorder.html), not here -
  // Chrome auto-dismisses the mic permission prompt in popups and offscreen
  // documents, but a normal tab works reliably. We just remember which tab
  // to fill afterward and hand off to it.
  recordButton.addEventListener("click", async () => {
    recordButton.disabled = true;
    setStatus("Opening recorder tab...", "processing");
    try {
      const tab = await getActiveTab();
      const recorderUrl =
        chrome.runtime.getURL("recorder.html") + `?targetTabId=${tab.id}`;
      await chrome.tabs.create({ url: recorderUrl });
      setStatus(
        "Recorder opened in a new tab. Speak there, then click Stop.",
        "success"
      );
    } catch (err) {
      setStatus(`Error: ${err.message}`, "error");
    } finally {
      recordButton.disabled = false;
    }
  });

  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
