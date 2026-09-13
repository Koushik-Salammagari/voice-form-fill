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

  const fields = detectFields();
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

  // --- Messaging (popup <-> content script) -----------------------------

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return;

    if (message.type === "GET_SCHEMA") {
      sendResponse({ fields });
      return;
    }

    if (message.type === "FILL_FIELDS") {
      const result = fillFields(message.values || {});
      sendResponse(result);
      return;
    }
  });
})();
