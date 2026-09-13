(function () {
  "use strict";

  const DICTATION_ENDPOINT = "https://dictation.assemblyai.com/transcribe";

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "TRANSCRIBE_AND_FILL") {
      const tabId = sender && sender.tab && sender.tab.id;
      handleTranscribeAndFill(message.wavBase64, tabId)
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // async response
    }
  });

  async function handleTranscribeAndFill(wavBase64, tabId) {
    if (!wavBase64) {
      throw new Error("No recorded audio was provided");
    }
    if (!tabId) {
      throw new Error("Could not determine which tab to fill");
    }

    const schemaResponse = await chrome.tabs.sendMessage(tabId, {
      type: "GET_SCHEMA",
    });
    const fields = (schemaResponse && schemaResponse.fields) || [];

    if (fields.length === 0) {
      return { ok: true, filled: [], message: "No fields found" };
    }

    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error(
        "No AssemblyAI API key set. Open the extension's Settings and paste your key."
      );
    }

    const fieldKeys = fields.map((f) => f.key);
    const llmInstruction = buildLlmInstruction(fieldKeys);

    const values = await transcribeAndExtract(wavBase64, llmInstruction, apiKey);

    const fillResponse = await chrome.tabs.sendMessage(tabId, {
      type: "FILL_FIELDS",
      values,
    });

    return { ok: true, filled: (fillResponse && fillResponse.filled) || [] };
  }

  function buildLlmInstruction(fieldKeys) {
    return (
      "You are filling out a web form from dictated speech. " +
      "Return ONLY a minified JSON object with exactly these keys: " +
      JSON.stringify(fieldKeys) +
      ". Map what the speaker said onto the matching field. " +
      "If a field is not mentioned anywhere in the speech, use an empty string " +
      'as its value. Do not include any keys other than the ones listed, and do ' +
      "not include any explanation, markdown, or text other than the JSON object " +
      "itself."
    );
  }

  async function transcribeAndExtract(wavBase64, llmInstruction, apiKey) {
    const audioBlob = base64ToBlob(wavBase64, "audio/wav");
    const configBlob = new Blob(
      [JSON.stringify({ llm_instruction: llmInstruction })],
      { type: "application/json" }
    );

    const formData = new FormData();
    formData.append("audio", audioBlob, "clip.wav");
    formData.append("config", configBlob);

    // Do not set Content-Type manually - fetch derives the correct
    // multipart boundary from the FormData body on its own, and overriding
    // it here would break the request.
    const response = await fetch(DICTATION_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: apiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Dictation API error (${response.status}): ${text || response.statusText}`
      );
    }

    const data = await response.json();
    console.log("Raw llm_response:", data.llm_response);
    const values = parseLlmResponse(data.llm_response);
    console.log("Parsed field values:", values);
    return values;
  }

  function base64ToBlob(base64, mimeType) {
    const byteChars = atob(base64);
    const byteNumbers = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    return new Blob([byteNumbers], { type: mimeType });
  }

  function parseLlmResponse(rawText) {
    if (typeof rawText !== "string") {
      throw new Error("Dictation API response had no llm_response text");
    }
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) {
      throw new Error("Could not find a JSON object in llm_response");
    }
    const jsonSlice = rawText.slice(start, end + 1);
    try {
      return JSON.parse(jsonSlice);
    } catch (err) {
      throw new Error("Failed to parse JSON from llm_response: " + err.message);
    }
  }

  async function getApiKey() {
    const { apiKey } = await chrome.storage.local.get("apiKey");
    return apiKey;
  }
})();
