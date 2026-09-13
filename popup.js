(function () {
  "use strict";

  const optionsLink = document.getElementById("options-link");

  optionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
