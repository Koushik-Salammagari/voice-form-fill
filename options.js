(function () {
  "use strict";

  const apiKeyInput = document.getElementById("api-key");
  const saveButton = document.getElementById("save-button");
  const status = document.getElementById("status");

  chrome.storage.local.get("apiKey", ({ apiKey }) => {
    if (apiKey) apiKeyInput.value = apiKey;
  });

  saveButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    chrome.storage.local.set({ apiKey }, () => {
      status.textContent = apiKey ? "Saved." : "Cleared.";
      setTimeout(() => {
        status.textContent = "";
      }, 2000);
    });
  });
})();
