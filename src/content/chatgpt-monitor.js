// ==========================================
// FEATURE TOGGLES (for testing/debugging)
// ==========================================
const ENABLE_INPUT_MONITORING = true; // Monitor outgoing messages for personal info
const ENABLE_RESPONSE_MONITORING = true; // Monitor AI responses for privacy violations
const ENABLE_VERBOSE_LOGGING = false; // Reduce console spam when false

// Store the current textarea being monitored
let currentTextarea = null;
let approvedMessages = new Set();
let currentSendButton = null;
let currentForm = null;

console.log(
  "Privacy Guard: Content script loaded on",
  window.location.hostname,
);
// Response monitoring state
let lastProcessedMessageId = null;
let processingResponse = false;
let responseObserver = null; // Track the observer to prevent duplicates

// Fetch the selected identity from chrome storage
async function getSelectedIdentity() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["identities", "selectedId"], (result) => {
      if (result.selectedId && result.identities) {
        const identity = result.identities.find(
          (i) => i.id === result.selectedId,
        );
        resolve(identity || null);
      } else {
        resolve(null);
      }
    });
  });
}

// Extract chat history from ChatGPT's DOM
function extractChatHistory() {
  const messages = [];
  // ChatGPT uses article elements or divs with data-message attributes
  const messageElements = document.querySelectorAll(
    "[data-message-author-role]",
  );

  messageElements.forEach((el) => {
    const role = el.getAttribute("data-message-author-role");
    const textContent = el.textContent?.trim() || "";
    if (textContent) {
      messages.push({ role, content: textContent });
    }
  });

  return messages;
}

// Detect personal information using AI (via background service worker)
async function detectPersonalInfoWithAI(
  text,
  identity = null,
  chatHistory = [],
) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "detectPersonalInfo",
        text,
        identity,
        chatHistory,
      },
      (response) => {
        if (response.success) {
          resolve(response.data);
        } else {
          console.error("Privacy Guard: AI detection error:", response.error);
          resolve([]);
        }
      },
    );
  });
}

// Rewrite message to remove sensitive information (via background service worker)
async function rewriteMessage(originalText, itemsToRemove, identity = null) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "rewriteMessage",
        text: originalText,
        itemsToRemove,
        identity,
      },
      (response) => {
        if (response.success) {
          resolve(response.data);
        } else {
          console.error("Privacy Guard: Rewrite error:", response.error);
          reject(new Error(response.error));
        }
      },
    );
  });
}

// Create warning modal with AI-detected items
function createWarningModal(
  originalText,
  textarea,
  identity = null,
  chatHistory = [],
) {
  // Remove existing modal if present
  const existingModal = document.getElementById("privacy-warning-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "privacy-warning-modal";

  modal.innerHTML = `
    <div class="privacy-modal-overlay">
      <div class="privacy-modal-content">
        <div class="privacy-modal-header">
          <h2>⚠️ Scanning for Personal Information...</h2>
        </div>
        <div class="privacy-modal-body">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Analyzing your message for sensitive information...</p>
          </div>
          <div class="results-state" style="display: none;">
            <p>We detected the following sensitive information in your message:</p>
            <div class="detected-info-list"></div>
            <p class="warning-message">⚠️ Checked items will be removed/anonymized from your message.</p>
          </div>
        </div>
        <div class="privacy-modal-footer">
          <button id="privacy-cancel-btn" class="privacy-btn privacy-btn-cancel">Cancel</button>
          <button id="privacy-proceed-original-btn" class="privacy-btn privacy-btn-proceed-original" style="display: none;">Send Original</button>
          <button id="privacy-rewrite-btn" class="privacy-btn privacy-btn-rewrite" style="display: none;">Rewrite & Send</button>
        </div>
      </div>
    </div>
  `;

  // Add styles
  const style = document.createElement("style");
  style.textContent = `
    .privacy-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.75);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 999999;
      animation: fadeIn 0.2s ease-in;
      backdrop-filter: blur(4px);
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .privacy-modal-content {
      background: #2f2f2f;
      border: 1px solid #565869;
      border-radius: 16px;
      padding: 0;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .privacy-modal-header {
      padding: 20px 24px 16px 24px;
      border-bottom: 1px solid #565869;
      flex-shrink: 0;
    }

    .privacy-modal-header h2 {
      margin: 0;
      font-size: 18px;
      color: #ececec;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .privacy-modal-body {
      padding: 20px 24px;
      color: #c5c5d2;
      line-height: 1.6;
      font-size: 14px;
      overflow-y: auto;
      flex: 1;
    }

    .loading-state {
      text-align: center;
      padding: 40px 20px;
    }

    .spinner {
      width: 40px;
      height: 40px;
      margin: 0 auto 20px;
      border: 4px solid #565869;
      border-top: 4px solid #19c37d;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .loading-state p {
      color: #a0a0a8;
      margin: 0;
    }

    .privacy-modal-body > p:first-child {
      margin: 0 0 16px 0;
    }

    .detected-info-list {
      margin: 0 0 16px 0;
    }

    .info-item {
      background: #3e3e3e;
      border-radius: 8px;
      margin-bottom: 12px;
      padding: 14px;
      border: 2px solid transparent;
      transition: all 0.2s;
    }

    .info-item:hover {
      background: #454545;
      border-color: #565869;
    }

    .info-checkbox {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .info-checkbox input[type="checkbox"] {
      margin-top: 4px;
      width: 18px;
      height: 18px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .info-checkbox label {
      flex: 1;
      cursor: pointer;
      user-select: none;
    }

    .info-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .severity-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      background: #2a2a2a;
      color: #f5d06c;
    }

    .info-type {
      font-size: 12px;
      color: #a0a0a8;
      text-transform: uppercase;
      font-weight: 500;
    }

    .info-text {
      color: #ff6b6b;
      font-weight: 500;
      margin-bottom: 6px;
      font-size: 14px;
      background: #2a2a2a;
      padding: 6px 10px;
      border-radius: 6px;
      border-left: 3px solid #ef4444;
      font-family: 'Söhne Mono', Monaco, 'Andale Mono', monospace;
    }

    .info-reason {
      font-size: 13px;
      color: #c5c5d2;
      line-height: 1.4;
    }

    .warning-message {
      background: #3e3020;
      border: 1px solid #806020;
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      color: #f5d06c;
      margin: 16px 0 0 0 !important;
    }

    .privacy-modal-footer {
      padding: 16px 24px;
      border-top: 1px solid #565869;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      flex-shrink: 0;
    }

    .privacy-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      font-family: inherit;
    }

    .privacy-btn-cancel {
      background: transparent;
      color: #ececec;
      border: 1px solid #565869;
    }

    .privacy-btn-cancel:hover {
      background: #40414f;
    }

    .privacy-btn-proceed-original {
      background: #806020;
      color: #ffffff;
      border: 1px solid #806020;
    }

    .privacy-btn-proceed-original:hover {
      background: #6b5018;
      border-color: #6b5018;
    }

    .privacy-btn-rewrite {
      background: #19c37d;
      color: #ffffff;
      border: 1px solid #19c37d;
    }

    .privacy-btn-rewrite:hover {
      background: #17b574;
      border-color: #17b574;
    }

    .privacy-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(modal);

  console.log("Privacy Guard: Modal created and shown immediately");

  // Return promise that will be resolved based on user action
  return new Promise(async (resolve) => {
    const cancelBtn = modal.querySelector("#privacy-cancel-btn");
    const proceedOriginalBtn = modal.querySelector(
      "#privacy-proceed-original-btn",
    );
    const rewriteBtn = modal.querySelector("#privacy-rewrite-btn");

    // Set up cancel button (works in loading state)
    cancelBtn.addEventListener("click", () => {
      console.log("Privacy Guard: User clicked Cancel");
      modal.remove();
      resolve({ action: "cancel" });
    });

    // Start AI detection in background with identity and chat history context
    const detectedInfo = await detectPersonalInfoWithAI(
      originalText,
      identity,
      chatHistory,
    );

    console.log(
      "Privacy Guard: Detection complete, found",
      detectedInfo.length,
      "items",
    );

    // If nothing detected, automatically proceed
    if (detectedInfo.length === 0) {
      console.log("Privacy Guard: No sensitive info detected, auto-proceeding");
      modal.remove();
      resolve({ action: "proceed", text: originalText });
      return;
    }

    // Update modal with results
    const severityEmoji = {
      high: "🔴",
      medium: "🟡",
      low: "🟢",
    };

    const detectedListHtml = detectedInfo
      .map(
        (info, idx) => `
      <div class="info-item" data-index="${idx}">
        <div class="info-checkbox">
          <input type="checkbox" id="item-${idx}" checked>
          <label for="item-${idx}">
            <div class="info-header">
              <span class="severity-badge">${severityEmoji[info.severity] || "🟡"} ${info.severity?.toUpperCase() || "MEDIUM"}</span>
              <span class="info-type">${info.type || "Sensitive Info"}</span>
            </div>
            <div class="info-text">"${info.text}"</div>
            <div class="info-reason">${info.reason}</div>
          </label>
        </div>
      </div>
    `,
      )
      .join("");

    modal.querySelector(".detected-info-list").innerHTML = detectedListHtml;
    modal.querySelector(".privacy-modal-header h2").textContent =
      "⚠️ Personal Information Detected";
    modal.querySelector(".loading-state").style.display = "none";
    modal.querySelector(".results-state").style.display = "block";
    proceedOriginalBtn.style.display = "inline-block";
    rewriteBtn.style.display = "inline-block";

    proceedOriginalBtn.addEventListener("click", () => {
      console.log("Privacy Guard: User clicked Send Original");
      modal.remove();
      resolve({ action: "proceed", text: originalText });
    });

    rewriteBtn.addEventListener("click", async () => {
      // Get ONLY checked items
      const checkedItems = [];
      detectedInfo.forEach((info, idx) => {
        const checkbox = modal.querySelector(`#item-${idx}`);
        if (checkbox && checkbox.checked) {
          checkedItems.push(info);
        }
      });

      console.log(
        "Privacy Guard: User wants to rewrite",
        checkedItems.length,
        "out of",
        detectedInfo.length,
        "items",
      );

      if (checkedItems.length === 0) {
        // Nothing to rewrite, just send original
        modal.remove();
        resolve({ action: "proceed", text: originalText });
        return;
      }

      // Show loading state
      rewriteBtn.disabled = true;
      rewriteBtn.textContent = "Rewriting...";

      try {
        const rewrittenText = await rewriteMessage(
          originalText,
          checkedItems,
          identity,
        );
        modal.remove();
        resolve({ action: "rewrite", text: rewrittenText });
      } catch (error) {
        alert("Failed to rewrite message. Please try again.");
        rewriteBtn.disabled = false;
        rewriteBtn.textContent = "Rewrite & Send";
      }
    });
  });
}

// Simple hash function for strings
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// Check if the submit button was clicked
async function interceptSubmission(textarea, shouldAutoSubmit = false) {
  // Skip if input monitoring is disabled
  if (!ENABLE_INPUT_MONITORING) {
    return {
      proceed: true,
      text: textarea.value || textarea.textContent || "",
    };
  }

  const text =
    textarea.value || textarea.textContent || textarea.innerText || "";
  const textHash = hashString(text);

  console.log(
    "Privacy Guard: interceptSubmission called, text length:",
    text.length,
  );

  // If already approved, allow through
  if (approvedMessages.has(textHash)) {
    console.log("Privacy Guard: Message already approved");
    return { proceed: true, text };
  }

  // Gather context: selected identity and chat history
  const identity = await getSelectedIdentity();
  const chatHistory = extractChatHistory();

  console.log(
    "Privacy Guard: Context gathered - identity:",
    identity ? identity.name : "none",
    ", chat history:",
    chatHistory.length,
    "messages",
  );

  // Show modal immediately, detection happens inside with context
  const result = await createWarningModal(
    text,
    textarea,
    identity,
    chatHistory,
  );

  console.log("Privacy Guard: User decision:", result.action);
  console.log("Privacy Guard: User decision:", result.action);

  if (result.action === "cancel") {
    return { proceed: false };
  } else if (result.action === "proceed") {
    // User wants to send original message
    approvedMessages.add(textHash);

    if (shouldAutoSubmit) {
      setTimeout(() => {
        if (currentSendButton) {
          currentSendButton.click();
        } else if (currentForm) {
          currentForm.requestSubmit();
        }
      }, 50);
    }

    return { proceed: true, text: result.text };
  } else if (result.action === "rewrite") {
    // Mark rewritten message as approved to skip re-checking
    const rewrittenHash = hashString(result.text);
    approvedMessages.add(rewrittenHash);

    // Update textarea with rewritten text
    if (textarea.value !== undefined) {
      textarea.value = result.text;
    } else {
      textarea.textContent = result.text;
      textarea.innerText = result.text;
    }

    // Trigger input event to update ChatGPT's internal state
    const inputEvent = new Event("input", { bubbles: true });
    textarea.dispatchEvent(inputEvent);

    // Auto-submit the rewritten message
    if (shouldAutoSubmit) {
      setTimeout(() => {
        if (currentSendButton) {
          currentSendButton.click();
        } else if (currentForm) {
          currentForm.requestSubmit();
        }
      }, 100);
    }

    return { proceed: true, text: result.text };
  }
}

// ==========================================
// RESPONSE MONITORING & CONTEXT POLLUTION
// ==========================================

// Wait for ChatGPT response to finish streaming
async function waitForMessageComplete(element) {
  let previousContent = "";
  let stableCount = 0;

  while (stableCount < 3) {
    await new Promise((r) => setTimeout(r, 500));
    const currentContent = element.textContent || "";

    if (currentContent === previousContent) {
      stableCount++;
    } else {
      stableCount = 0;
      previousContent = currentContent;
    }
  }
}

// Detect privacy violations in AI response (via background service worker)
async function detectPrivacyViolationsInResponse(responseText, identity) {
  return new Promise((resolve) => {
    console.log(
      "Privacy Guard: Sending violation detection request to background...",
    );
    chrome.runtime.sendMessage(
      {
        type: "detectPrivacyViolations",
        responseText,
        identity,
      },
      (response) => {
        if (response && response.success) {
          console.log(
            "Privacy Guard: Violation detection complete, found",
            response.data.length,
            "violations",
          );
          resolve(response.data);
        } else {
          console.error(
            "Privacy Guard: Violation detection error:",
            response?.error,
          );
          resolve([]);
        }
      },
    );
  });
}

// Show context pollution modal (display only for now)
function showContextPollutionModal(violations, identity) {
  // Remove existing modal if present
  const existingModal = document.getElementById("context-pollution-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const severityEmoji = {
    high: "🔴",
    medium: "🟡",
    low: "🟢",
  };

  const modal = document.createElement("div");
  modal.id = "context-pollution-modal";

  modal.innerHTML = `
    <div class="privacy-modal-overlay">
      <div class="privacy-modal-content">
        <div class="privacy-modal-header">
          <h2>⚠️ AI Knows More Than Expected</h2>
        </div>
        <div class="privacy-modal-body">
          <p>The AI's response indicates it knows information beyond your privacy profile "${identity.name}":</p>
          <div class="detected-info-list">
            ${violations
              .map(
                (v, idx) => `
              <div class="info-item" data-index="${idx}">
                <div class="info-checkbox">
                  <input type="checkbox" id="pollute-${idx}" checked>
                  <label for="pollute-${idx}">
                    <div class="info-header">
                      <span class="severity-badge">${severityEmoji[v.severity] || "🟡"} ${(v.severity || "medium").toUpperCase()}</span>
                      <span class="info-type">${v.category || "Unknown"}</span>
                    </div>
                    <div class="info-text">"${v.knownInfo}"</div>
                    <div class="info-reason">${v.reason}</div>
                  </label>
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
          <p class="warning-message">⚠️ Select items to "pollute" - we can send a message to mislead the AI about this information.</p>
        </div>
        <div class="privacy-modal-footer">
          <button id="pollution-ignore-btn" class="privacy-btn privacy-btn-cancel">Ignore</button>
          <button id="pollution-deny-btn" class="privacy-btn privacy-btn-proceed-original">Deny Knowledge</button>
          <button id="pollution-mislead-btn" class="privacy-btn privacy-btn-rewrite">Mislead with Fake Data</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  console.log(
    "Privacy Guard: Context pollution modal shown with",
    violations.length,
    "violations",
  );

  return new Promise((resolve) => {
    modal.querySelector("#pollution-ignore-btn").onclick = () => {
      console.log("Privacy Guard: User chose to ignore violations");
      modal.remove();
      resolve({ action: "ignore" });
    };

    modal.querySelector("#pollution-deny-btn").onclick = () => {
      const selected = [];
      violations.forEach((v, idx) => {
        const checkbox = modal.querySelector(`#pollute-${idx}`);
        if (checkbox && checkbox.checked) {
          selected.push(v);
        }
      });
      console.log(
        "Privacy Guard: User chose to deny",
        selected.length,
        "items",
      );
      console.log("Privacy Guard: Selected violations:", selected);
      modal.remove();
      resolve({ action: "deny", violations: selected });
    };

    modal.querySelector("#pollution-mislead-btn").onclick = () => {
      const selected = [];
      violations.forEach((v, idx) => {
        const checkbox = modal.querySelector(`#pollute-${idx}`);
        if (checkbox && checkbox.checked) {
          selected.push(v);
        }
      });
      console.log(
        "Privacy Guard: User chose to mislead about",
        selected.length,
        "items",
      );
      console.log("Privacy Guard: Selected violations:", selected);
      modal.remove();
      resolve({ action: "mislead", violations: selected });
    };
  });
}

// Analyze assistant response for privacy violations
async function analyzeAssistantResponse(responseText) {
  const identity = await getSelectedIdentity();
  if (!identity) {
    console.log(
      "Privacy Guard: No identity selected, skipping response analysis",
    );
    return;
  }

  console.log(
    "Privacy Guard: Analyzing assistant response against identity:",
    identity.name,
  );

  const violations = await detectPrivacyViolationsInResponse(
    responseText,
    identity,
  );

  console.log(
    "Privacy Guard: Found",
    violations.length,
    "privacy violations in response",
  );

  if (violations.length > 0) {
    const result = await showContextPollutionModal(violations, identity);
    console.log("Privacy Guard: User action:", result.action);
    // TODO: Implement actual pollution message sending in next phase
  }
}

// Set up monitoring for assistant responses
function setupResponseMonitoring() {
  // Skip setup if response monitoring is disabled
  if (!ENABLE_RESPONSE_MONITORING) {
    console.log("Privacy Guard: Response monitoring disabled");
    return;
  }

  // Disconnect existing observer if one exists (prevent duplicates)
  if (responseObserver) {
    console.log("Privacy Guard: Disconnecting existing response observer");
    responseObserver.disconnect();
    responseObserver = null;
  }

  const chatContainer = document.querySelector("main") || document.body;

  console.log("Privacy Guard: Setting up response monitoring...");

  responseObserver = new MutationObserver(async (mutations) => {
    if (processingResponse) return;
    processingResponse = true;

    // Find all assistant messages
    const assistantMessages = document.querySelectorAll(
      "[data-message-author-role='assistant']",
    );

    if (assistantMessages.length === 0) {
      processingResponse = false;
      return;
    }

    const latestMessage = assistantMessages[assistantMessages.length - 1];
    const messageId =
      latestMessage.getAttribute("data-message-id") ||
      latestMessage.textContent?.substring(0, 50);

    // Skip if already processed
    if (messageId === lastProcessedMessageId) {
      processingResponse = false;
      return;
    }

    // Wait for message to finish streaming
    if (ENABLE_VERBOSE_LOGGING) {
      console.log(
        "Privacy Guard: New assistant message detected, waiting for completion...",
      );
    }
    await waitForMessageComplete(latestMessage);

    lastProcessedMessageId = messageId;

    try {
      const responseText = latestMessage.textContent?.trim() || "";
      if (responseText) {
        // await analyzeAssistantResponse(responseText);
        console.log("Would trigger response analysis here");
      }
    } finally {
      processingResponse = false;
    }
  });

  responseObserver.observe(chatContainer, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log("Privacy Guard: Response monitoring initialized");
}

// Monitor the ChatGPT input
function monitorChatGPTInput() {
  console.log("Privacy Guard: Initializing...");

  // Find the textarea - ChatGPT uses a contenteditable div or textarea
  const findInput = () => {
    // Try multiple selectors as ChatGPT and Gemini have different DOM structures
    const selectors = [
      // ChatGPT selectors (priority)
      "textarea[data-id]",
      "#prompt-textarea",

      // Gemini selectors (priority)
      "div[contenteditable='true'][data-testid*='message']",
      "div[data-inner-editor-container]",

      // Generic selectors (works for both)
      'textarea[aria-label*="message"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="message"]',
      "textarea[contenteditable='true']",
      "textarea",
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      'div[contenteditable="true"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.offsetParent !== null) {
        // Also check if visible
        if (ENABLE_VERBOSE_LOGGING) {
          console.log("Privacy Guard: Found input with selector:", selector);
        }
        return el;
      }
    }
    return null;
  };

  const setupMonitoring = () => {
    const input = findInput();

    if (!input) {
      return;
    }

    if (input === currentTextarea) {
      return; // Already monitoring this input
    }

    currentTextarea = input;
    console.log("Privacy Guard: Setting up event listeners on input");

    // Method 1: Intercept Enter key
    input.addEventListener(
      "keydown",
      async (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          console.log("Privacy Guard: Enter key pressed");
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const result = await interceptSubmission(input, true);

          if (!result.proceed) {
            return false;
          }
        }
      },
      true,
    );

    // Method 2: Monitor form submission
    const form = input.closest("form");
    if (form) {
      currentForm = form;
      console.log("Privacy Guard: Found form, adding listener");
      form.addEventListener(
        "submit",
        async (e) => {
          console.log("Privacy Guard: Form submit detected");
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const result = await interceptSubmission(input, true);

          if (!result.proceed) {
            return false;
          }
        },
        true,
      );
    }

    // Method 3: Monitor the send button
    const findSendButton = () => {
      // Gemini uses .send-button class - try this first
      const geminiSendBtn = document.querySelector("button.send-button");
      if (geminiSendBtn && geminiSendBtn.offsetParent !== null) {
        console.log(
          "Privacy Guard: Found Gemini send button with .send-button class",
        );
        return geminiSendBtn;
      }

      const buttons = document.querySelectorAll("button");
      for (const btn of buttons) {
        const hasDataTestId = btn.getAttribute("data-testid") === "send-button";
        const hasSvg = btn.querySelector("svg");
        const hasMatIcon = btn.querySelector("mat-icon");
        const ariaLabel = btn.getAttribute("aria-label") || "";
        const title = btn.getAttribute("title") || "";

        // Check various send button indicators
        const isAriaLabel = ariaLabel.toLowerCase().includes("send");
        const isTitle = title.toLowerCase().includes("send");
        const isVisible = btn.offsetParent !== null; // Not hidden
        const hasIcon = (hasSvg || hasMatIcon) && btn.textContent.trim() === "";

        // Gemini: Look for button with icon near textarea
        const nearTextarea = input && input.parentElement?.contains(btn);

        if (
          hasDataTestId ||
          (hasIcon && isVisible) ||
          isAriaLabel ||
          isTitle ||
          (nearTextarea && isVisible && (hasSvg || hasMatIcon))
        ) {
          console.log(
            "Privacy Guard: Send button candidate found with aria-label:",
            ariaLabel,
            "title:",
            title,
            "hasIcon:",
            hasIcon,
          );
          return btn;
        }
      }
      return null;
    };

    const sendButton = findSendButton();
    if (sendButton) {
      currentSendButton = sendButton;
      console.log("Privacy Guard: Found send button, adding listener");
      sendButton.addEventListener(
        "click",
        async (e) => {
          console.log("Privacy Guard: Send button clicked");

          // Check if message is already approved (from rewrite)
          const text =
            currentTextarea.value || currentTextarea.textContent || "";
          const textHash = hashString(text);

          if (approvedMessages.has(textHash)) {
            console.log(
              "Privacy Guard: Message already approved, allowing click to proceed",
            );
            return; // Let the original click happen
          }

          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();

          const result = await interceptSubmission(currentTextarea, true);

          if (!result.proceed) {
            console.log("Privacy Guard: User cancelled, not submitting");
            return false;
          }

          console.log("Privacy Guard: User approved, now actually submitting");
          // The message text may have been rewritten, but we still need to click the button
          // Actually click the send button for real this time
          setTimeout(() => {
            sendButton.click();
          }, 100);
        },
        true,
      );
    } else {
      console.log("Privacy Guard: Send button not found");
    }
  };

  setupMonitoring();

  // Re-check periodically as ChatGPT might dynamically create new textareas
  // setInterval(setupMonitoring, 2000);

  // Also observe DOM changes
  const observer = new MutationObserver(() => {
    setupMonitoring();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    monitorChatGPTInput();
    setupResponseMonitoring();
  });
} else {
  monitorChatGPTInput();
  setupResponseMonitoring();
}

console.log("Privacy Guard: Content script loaded for ChatGPT");
