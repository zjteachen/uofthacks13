// ==========================================
// FEATURE TOGGLES (for testing/debugging)
// ==========================================
const ENABLE_INPUT_MONITORING = true; // Monitor outgoing messages for personal info
const ENABLE_RESPONSE_MONITORING = true; // Monitor AI responses for privacy violations
const ENABLE_CONTEXT_AUGMENTATION = true; // Auto-add identity context to prompts when needed
const ENABLE_VERBOSE_LOGGING = false; // Reduce console spam when false

// Store the current textarea being monitored
let currentTextarea = null;
let approvedMessages = new Set();
let contextAugmentedMessages = new Set(); // Track messages we've already augmented
let currentSendButton = null;
let currentForm = null;
let extensionContextValid = true;
let isProgrammaticSubmit = false; // Flag to track programmatic submits

// Helper to check if extension context is still valid
function isExtensionValid() {
  try {
    // This will throw if context is invalidated
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    extensionContextValid = false;
    return false;
  }
}

console.log(
  "Privacy Guard: Content script loaded on",
  window.location.hostname,
);

// Listen for messages from the popup
try {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!isExtensionValid()) return;

    if (request.type === "injectIdentityWithPollution") {
      console.log(
        "Privacy Guard: Identity switch with pollution requested:",
        request.previousIdentity?.name,
        "→",
        request.newIdentity?.name,
      );
      handleIdentitySwitchWithPollution(request.previousIdentity, request.newIdentity);
      sendResponse({ success: true });
    }
  });
} catch (e) {
  console.log("Privacy Guard: Could not add message listener:", e.message);
}

// Response monitoring state
let lastProcessedMessageId = null;
let processingResponse = false;
let responseObserver = null; // Track the observer to prevent duplicates
let currentChatUrl = window.location.href; // Track current chat to detect navigation

// Fetch the selected identity from chrome storage
async function getSelectedIdentity() {
  return new Promise((resolve) => {
    try {
      if (!isExtensionValid()) {
        resolve(null);
        return;
      }
      
      chrome.storage.sync.get(["identities", "selectedId"], (result) => {
        if (!isExtensionValid()) {
          resolve(null);
          return;
        }
        
        if (chrome.runtime.lastError) {
          console.log("Privacy Guard: Storage error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        
        if (result.selectedId && result.identities) {
          const identity = result.identities.find(
            (i) => i.id === result.selectedId,
          );
          resolve(identity || null);
        } else {
          resolve(null);
        }
      });
    } catch (error) {
      console.log("Privacy Guard: Error getting identity:", error);
      resolve(null);
    }
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

// Show toast notification
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "privacy-toast";
  toast.textContent = message;
  
  // Add inline styles
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    backgroundColor: "#10a37f",
    color: "white",
    padding: "12px 20px",
    borderRadius: "8px",
    fontSize: "14px",
    fontWeight: "500",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
    zIndex: "10001",
    animation: "slideIn 0.3s ease-out",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  });
  
  // Add animation keyframes if not already added
  if (!document.getElementById("privacy-toast-styles")) {
    const style = document.createElement("style");
    style.id = "privacy-toast-styles";
    style.textContent = `
      @keyframes slideIn {
        from {
          transform: translateX(400px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      @keyframes slideOut {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(400px);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }
  
  document.body.appendChild(toast);
  
  // Remove after 3 seconds with animation
  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease-in";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    if (!isExtensionValid()) {
      reject(new Error("Extension context invalidated"));
      return;
    }
    
    chrome.runtime.sendMessage(
      {
        type: "rewriteMessage",
        text: originalText,
        itemsToRemove,
        identity,
      },
      (response) => {
        if (!isExtensionValid()) {
          reject(new Error("Extension context invalidated"));
          return;
        }
        
        if (response && response.success) {
          resolve(response.data);
        } else {
          console.error("Privacy Guard: Rewrite error:", response?.error);
          reject(new Error(response?.error || "Unknown error"));
        }
      },
    );
  });
}

// Check if prompt needs context and get augmented version
async function checkAndAugmentContext(text, identity) {
  return new Promise((resolve) => {
    // Timeout after 10 seconds to prevent hanging
    const timeout = setTimeout(() => {
      console.log("Privacy Guard: Context check timed out, proceeding without context");
      resolve({ needsContext: false, augmentedPrompt: text });
    }, 10000);
    
    try {
      if (!isExtensionValid()) {
        clearTimeout(timeout);
        resolve({ needsContext: false, augmentedPrompt: text });
        return;
      }
      
      chrome.runtime.sendMessage(
        {
          type: "checkContextNeeded",
          prompt: text,
          identity,
        },
        (response) => {
          clearTimeout(timeout);
          
          // Check for runtime errors (extension reloaded, etc.)
          if (!isExtensionValid() || chrome.runtime.lastError) {
            console.log("Privacy Guard: Runtime error in context check:", chrome.runtime.lastError?.message);
            resolve({ needsContext: false, augmentedPrompt: text });
            return;
          }
          
          if (response && response.success) {
            console.log("Privacy Guard: Context check complete:", response.data?.needsContext);
            resolve(response.data);
          } else {
            console.log("Privacy Guard: Context check returned no data, proceeding without context");
            resolve({ needsContext: false, augmentedPrompt: text });
          }
        },
      );
    } catch (error) {
      clearTimeout(timeout);
      console.log("Privacy Guard: Error in checkAndAugmentContext:", error);
      resolve({ needsContext: false, augmentedPrompt: text });
    }
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

    // If nothing detected, show toast and automatically proceed
    if (detectedInfo.length === 0) {
      console.log("Privacy Guard: No sensitive info detected, auto-proceeding");
      modal.remove();
      showToast("✓ No sensitive information detected");
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
  // If extension context is invalid, just let the message through
  if (!isExtensionValid()) {
    return { proceed: true, text: textarea.value || textarea.textContent || "" };
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
    // Still need to trigger submit since we prevented the default event
    if (shouldAutoSubmit) {
      isProgrammaticSubmit = true;
      setTimeout(() => {
        // Find button fresh each time to avoid stale references
        const sendBtn = document.querySelector('button[aria-label="Send prompt"]') ||
                        document.querySelector('button.send-button') ||
                        document.querySelector('button[data-testid="send-button"]');
        if (sendBtn) {
          sendBtn.click();
        } else if (currentForm) {
          currentForm.requestSubmit();
        }
        isProgrammaticSubmit = false;
      }, 50);
    }
    return { proceed: true, text };
  }

  // Check for context augmentation (runs even if input monitoring is disabled)
  if (ENABLE_CONTEXT_AUGMENTATION && !contextAugmentedMessages.has(textHash)) {
    const identity = await getSelectedIdentity();
    
    if (identity && identity.characteristics && identity.characteristics.length > 0) {
      console.log("Privacy Guard: Checking if prompt needs context...");
      
      const contextResult = await checkAndAugmentContext(text, identity);
      
      if (contextResult.needsContext && contextResult.augmentedPrompt !== text) {
        console.log("Privacy Guard: Adding context to prompt");
        console.log("Privacy Guard: Reason:", contextResult.reason);
        console.log("Privacy Guard: Added context:", contextResult.addedContext);
        
        // Update textarea with augmented text
        if (textarea.value !== undefined) {
          textarea.value = contextResult.augmentedPrompt;
        } else {
          textarea.textContent = contextResult.augmentedPrompt;
          textarea.innerText = contextResult.augmentedPrompt;
        }

        // Trigger input event to update the app's internal state
        const inputEvent = new Event("input", { bubbles: true });
        textarea.dispatchEvent(inputEvent);

        // Mark as augmented so we don't augment again
        const augmentedHash = hashString(contextResult.augmentedPrompt);
        contextAugmentedMessages.add(augmentedHash);
        approvedMessages.add(augmentedHash);

        // Auto-submit the augmented message
        if (shouldAutoSubmit) {
          isProgrammaticSubmit = true;
          setTimeout(() => {
            // Find button fresh each time
            const sendBtn = document.querySelector('button[aria-label="Send prompt"]') ||
                            document.querySelector('button.send-button') ||
                            document.querySelector('button[data-testid="send-button"]');
            if (sendBtn) {
              sendBtn.click();
            } else if (currentForm) {
              currentForm.requestSubmit();
            }
            isProgrammaticSubmit = false;
          }, 100);
        }

        return { proceed: true, text: contextResult.augmentedPrompt };
      }
    }
  }

  // Skip privacy monitoring if input monitoring is disabled
  if (!ENABLE_INPUT_MONITORING) {
    // Mark as approved so we don't check again when we click submit
    approvedMessages.add(textHash);
    
    // Auto-submit since we already prevented the default event
    if (shouldAutoSubmit) {
      isProgrammaticSubmit = true;
      setTimeout(() => {
        // Find button fresh each time
        const sendBtn = document.querySelector('button[aria-label="Send prompt"]') ||
                        document.querySelector('button.send-button') ||
                        document.querySelector('button[data-testid="send-button"]');
        if (sendBtn) {
          sendBtn.click();
        } else if (currentForm) {
          currentForm.requestSubmit();
        }
        isProgrammaticSubmit = false;
      }, 50);
    }
    return {
      proceed: true,
      text: textarea.value || textarea.textContent || "",
    };
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

// Show context pollution modal as a selection form
// Each violation can be marked as Ignore/Deny/Pollute, then Submit generates one combined message
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

  // Track selected action for each violation: null, 'ignore', 'deny', 'pollute'
  const selections = violations.map(() => "ignore");

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
          <p class="selection-instruction">Select an action for each item, then click Submit to send a correction message.</p>
          <div class="detected-info-list">
            ${violations
              .map(
                (v, idx) => `
              <div class="info-item violation-item" data-index="${idx}">
                <div class="violation-content">
                  <div class="info-header">
                    <span class="severity-badge">${severityEmoji[v.severity] || "🟡"} ${(v.severity || "medium").toUpperCase()}</span>
                    <span class="info-type">${v.category || "Unknown"}</span>
                  </div>
                  <div class="info-text">"${v.knownInfo}"</div>
                  <div class="info-reason">${v.reason}</div>
                </div>
                <div class="violation-actions">
                  <button class="violation-action-btn btn-ignore" data-idx="${idx}" data-action="ignore">Ignore</button>
                  <button class="violation-action-btn btn-deny" data-idx="${idx}" data-action="deny">Deny</button>
                  <button class="violation-action-btn btn-pollute" data-idx="${idx}" data-action="pollute">Pollute</button>
                </div>
              </div>
            `,
              )
              .join("")}
          </div>
          <div class="apply-all-section">
            <div class="apply-all-label">Apply to all items:</div>
            <div class="apply-all-buttons">
              <button id="apply-all-ignore" class="violation-action-btn btn-ignore">Ignore All</button>
              <button id="apply-all-deny" class="violation-action-btn btn-deny">Deny All</button>
              <button id="apply-all-pollute" class="violation-action-btn btn-pollute">Pollute All</button>
            </div>
          </div>
        </div>
        <div class="privacy-modal-footer">
          <button id="pollution-cancel-btn" class="privacy-btn privacy-btn-cancel">Cancel</button>
          <button id="pollution-submit-btn" class="privacy-btn privacy-btn-rewrite" disabled>Submit</button>
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

  // Helper to update button states for an item
  function updateItemState(idx, action) {
    selections[idx] = action;
    const item = modal.querySelector(`.violation-item[data-index="${idx}"]`);
    if (!item) return;

    // Remove all selected states
    item.querySelectorAll(".violation-action-btn").forEach((btn) => {
      btn.classList.remove("selected");
    });

    // Add selected state to the chosen action
    if (action) {
      const selectedBtn = item.querySelector(`[data-action="${action}"]`);
      if (selectedBtn) {
        selectedBtn.classList.add("selected");
      }
    }

    // Update submit button state
    updateSubmitButton();
  }

  // Helper to update submit button enabled state
  function updateSubmitButton() {
    const submitBtn = modal.querySelector("#pollution-submit-btn");
    const hasAnySelection = selections.some((s) => s !== null);
    const hasActionableSelection = selections.some(
      (s) => s === "deny" || s === "pollute",
    );

    submitBtn.disabled = !hasAnySelection;

    // Update button text based on selections
    if (hasActionableSelection) {
      submitBtn.textContent = "Submit Correction";
    } else if (hasAnySelection) {
      submitBtn.textContent = "Dismiss";
    } else {
      submitBtn.textContent = "Submit";
    }
  }

  // Add click handlers for per-item action buttons
  modal.querySelectorAll(".violation-action-btn[data-idx]").forEach((btn) => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.idx);
      const action = btn.dataset.action;
      updateItemState(idx, action);
    };
  });

  // Add click handlers for "Apply to All" buttons
  modal.querySelector("#apply-all-ignore").onclick = () => {
    violations.forEach((_, idx) => updateItemState(idx, "ignore"));
  };

  modal.querySelector("#apply-all-deny").onclick = () => {
    violations.forEach((_, idx) => updateItemState(idx, "deny"));
  };

  modal.querySelector("#apply-all-pollute").onclick = () => {
    violations.forEach((_, idx) => updateItemState(idx, "pollute"));
  };

  return new Promise((resolve) => {
    modal.querySelector("#pollution-cancel-btn").onclick = () => {
      console.log("Privacy Guard: User cancelled pollution modal");
      modal.remove();
      resolve({ action: "cancel" });
    };

    modal.querySelector("#pollution-submit-btn").onclick = () => {
      // Collect all selections
      const toDeny = [];
      const toPollute = [];

      violations.forEach((v, idx) => {
        const action = selections[idx];
        if (action === "deny") {
          toDeny.push(v);
        } else if (action === "pollute") {
          toPollute.push(v);
        }
        // 'ignore' and null are skipped
      });

      console.log(
        "Privacy Guard: User submitted -",
        toDeny.length,
        "to deny,",
        toPollute.length,
        "to pollute",
      );

      modal.remove();

      // If nothing actionable, just resolve as ignore
      if (toDeny.length === 0 && toPollute.length === 0) {
        resolve({ action: "ignore" });
      } else {
        resolve({
          action: "submit",
          toDeny,
          toPollute,
        });
      }
    };
  });
}

// ==========================================
// CHAT MESSAGE SENDING
// ==========================================

// Send a message to the chat application (ChatGPT, Gemini, etc.)
// This is a general-purpose function for programmatically sending messages
async function sendMessageToChatApp(message, options = {}) {
  const { skipPrivacyCheck = true } = options;

  if (!currentTextarea || !message) {
    console.error(
      "Privacy Guard: Cannot send message - no textarea found or empty message",
    );
    return { success: false, error: "No textarea or message" };
  }

  console.log(
    "Privacy Guard: Sending message to chat app:",
    message.substring(0, 50) + "...",
  );

  // Set textarea content
  if (currentTextarea.value !== undefined) {
    currentTextarea.value = message;
  } else {
    currentTextarea.textContent = message;
    currentTextarea.innerText = message;
  }

  // Trigger input event to update the UI state
  currentTextarea.dispatchEvent(new Event("input", { bubbles: true }));

  // Mark as approved to skip privacy check if requested
  if (skipPrivacyCheck) {
    approvedMessages.add(hashString(message));
  }

  // Small delay to let the UI update
  await new Promise((r) => setTimeout(r, 100));

  // Submit the message
  if (currentSendButton) {
    currentSendButton.click();
    return { success: true };
  } else if (currentForm) {
    currentForm.requestSubmit();
    return { success: true };
  }

  return { success: false, error: "No send button or form found" };
}

// ==========================================
// POLLUTION CONFIRMATION
// ==========================================

// Show confirmation modal with the generated pollution message
function showPollutionConfirmationModal(generatedMessage) {
  return new Promise((resolve) => {
    // Remove existing modal if present
    const existingModal = document.getElementById(
      "pollution-confirmation-modal",
    );
    if (existingModal) {
      existingModal.remove();
    }

    const modal = document.createElement("div");
    modal.id = "pollution-confirmation-modal";

    modal.innerHTML = `
      <div class="privacy-modal-overlay">
        <div class="privacy-modal-content">
          <div class="privacy-modal-header">
            <h2>📤 Review Correction Message</h2>
          </div>
          <div class="privacy-modal-body">
            <p>The following message will be sent to correct the AI's assumptions:</p>
            <textarea id="pollution-message-text" class="pollution-message-textarea">${generatedMessage}</textarea>
            <p class="warning-message">⚠️ You can edit the message above before sending.</p>
          </div>
          <div class="privacy-modal-footer">
            <button id="pollution-confirm-cancel" class="privacy-btn privacy-btn-cancel">Cancel</button>
            <button id="pollution-confirm-send" class="privacy-btn privacy-btn-rewrite">Send Message</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const textarea = modal.querySelector("#pollution-message-text");

    modal.querySelector("#pollution-confirm-cancel").onclick = () => {
      console.log("Privacy Guard: User cancelled sending pollution message");
      modal.remove();
      resolve({ action: "cancel" });
    };

    modal.querySelector("#pollution-confirm-send").onclick = () => {
      const finalMessage = textarea.value.trim();
      console.log("Privacy Guard: User confirmed sending pollution message");
      modal.remove();
      resolve({ action: "send", message: finalMessage });
    };
  });
}

// Generate combined pollution message via background script
async function generatePollutionMessage(toDeny, toPollute) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "generateCombinedPollutionMessage",
        toDeny,
        toPollute,
      },
      (response) => {
        if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || "Failed to generate message"));
        }
      },
    );
  });
}

// Update fake identity characteristics from pollution data
async function updateFakeIdentityFromPollution(identityId, toPollute) {
  try {
    console.log("Privacy Guard: Updating fake identity from pollution data");
    
    // Get current identities
    const result = await chrome.storage.sync.get(["identities"]);
    const identities = result.identities || [];
    
    // Find the identity
    const identityIndex = identities.findIndex(i => i.id === identityId);
    if (identityIndex === -1) {
      console.error("Privacy Guard: Identity not found");
      return;
    }
    
    const identity = identities[identityIndex];
    const existingFakes = identity.fakeCharacteristics || [];
    
    // Create map of existing fake characteristics
    const fakeMap = new Map(existingFakes.map(c => [c.name.toLowerCase(), c]));
    
    // Extract characteristics from polluted information
    toPollute.forEach((violation, idx) => {
      const charName = violation.category || "Info";
      const charValue = violation.knownInfo || "";
      
      // Add or update fake characteristic
      const key = charName.toLowerCase();
      if (!fakeMap.has(key)) {
        fakeMap.set(key, {
          id: `fake-pollute-${Date.now()}-${idx}`,
          name: charName.charAt(0).toUpperCase() + charName.slice(1),
          value: charValue
        });
      }
    });
    
    // Update identity with new fake characteristics
    identity.fakeCharacteristics = Array.from(fakeMap.values());
    identities[identityIndex] = identity;
    
    // Save back to storage
    await chrome.storage.sync.set({ identities });
    console.log("Privacy Guard: Fake identity updated successfully");
  } catch (error) {
    console.error("Privacy Guard: Error updating fake identity:", error);
  }
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
  console.log("Identity Details:", identity);

  const violations = await detectPrivacyViolationsInResponse(
    responseText,
    identity,
  );

  console.log("Privacy Guard: Found Violations", violations);

  if (violations.length > 0) {
    const result = await showContextPollutionModal(violations, identity);
    console.log("Privacy Guard: User action:", result.action);

    if (result.action === "submit") {
      const { toDeny, toPollute } = result;

      // Skip if nothing to process
      if (toDeny.length === 0 && toPollute.length === 0) {
        console.log("Privacy Guard: No items to deny or pollute");
        return;
      }

      try {
        // Generate the pollution message
        console.log("Privacy Guard: Generating pollution message...");
        const generatedMessage = await generatePollutionMessage(
          toDeny,
          toPollute,
        );
        console.log("Privacy Guard: Generated message:", generatedMessage);

        // Show confirmation modal
        const confirmResult =
          await showPollutionConfirmationModal(generatedMessage);

        if (confirmResult.action === "send") {
          // Update fake identity with polluted information
          if (toPollute.length > 0 && identity) {
            await updateFakeIdentityFromPollution(identity.id, toPollute);
          }

          // Send the message to the chat
          const sendResult = await sendMessageToChatApp(confirmResult.message);
          if (sendResult.success) {
            console.log("Privacy Guard: Pollution message sent successfully");
          } else {
            console.error(
              "Privacy Guard: Failed to send message:",
              sendResult.error,
            );
          }
        }
      } catch (error) {
        console.error("Privacy Guard: Error in pollution flow:", error);
      }
    }
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

    // Check if URL changed (user navigated to different chat)
    const newUrl = window.location.href;
    if (newUrl !== currentChatUrl) {
      console.log("Privacy Guard: Chat changed, resetting state");
      currentChatUrl = newUrl;
      lastProcessedMessageId = null;
      return; // Don't process - this is just a chat switch
    }

    // Check if any mutation is actually adding/changing content (not just navigation)
    const hasRelevantMutation = mutations.some((mutation) => {
      // Check for added nodes that are or contain assistant messages
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node;
            if (
              el.matches?.("[data-message-author-role='assistant']") ||
              el.querySelector?.("[data-message-author-role='assistant']")
            ) {
              return true;
            }
          }
        }
      }
      // Check for character data changes (streaming text)
      if (mutation.type === "characterData") {
        return true;
      }
      return false;
    });

    if (!hasRelevantMutation) {
      return;
    }

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

    // Capture initial content to verify it's actually streaming (new response)
    const initialContent = latestMessage.textContent || "";

    // Wait a bit and check if content is changing (streaming)
    await new Promise((r) => setTimeout(r, 300));
    const contentAfterWait = latestMessage.textContent || "";

    // If content hasn't changed and message was already complete, skip (likely a chat switch)
    if (initialContent === contentAfterWait && initialContent.length > 100) {
      // Content is static and substantial - likely an old message from chat switch
      if (ENABLE_VERBOSE_LOGGING) {
        console.log(
          "Privacy Guard: Skipping static message (likely chat switch)",
        );
      }
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
        await analyzeAssistantResponse(responseText);
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
      // ChatGPT: Look for button with exact aria-label="Send prompt" first
      const chatGptSendBtn = document.querySelector('button[aria-label="Send prompt"]');
      if (chatGptSendBtn && chatGptSendBtn.offsetParent !== null) {
        console.log("Privacy Guard: Found ChatGPT send button with aria-label='Send prompt'");
        return chatGptSendBtn;
      }
      
      // Gemini uses .send-button class
      const geminiSendBtn = document.querySelector("button.send-button");
      if (geminiSendBtn && geminiSendBtn.offsetParent !== null) {
        console.log(
          "Privacy Guard: Found Gemini send button with .send-button class",
        );
        return geminiSendBtn;
      }

      // Fallback: Look for data-testid="send-button"
      const testIdBtn = document.querySelector('button[data-testid="send-button"]');
      if (testIdBtn && testIdBtn.offsetParent !== null) {
        console.log("Privacy Guard: Found send button with data-testid='send-button'");
        return testIdBtn;
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
          // If this is a programmatic submit, let it through
          if (isProgrammaticSubmit) {
            console.log("Privacy Guard: Programmatic submit, allowing through");
            return;
          }
          
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

// ==========================================
// IDENTITY SWITCH WITH POLLUTION
// ==========================================

// Handle identity switch with pollution message generation
async function handleIdentitySwitchWithPollution(previousIdentity, newIdentity) {
  // If no previous identity, nothing to pollute - just log and return
  if (!previousIdentity) {
    console.log("Privacy Guard: No previous identity, nothing to pollute");
    return;
  }

  // Show the modal immediately in loading state
  showSwitchPollutionModal(previousIdentity, newIdentity);
}

// Show the switch pollution modal
function showSwitchPollutionModal(previousIdentity, newIdentity) {
  // Remove existing modal if present
  const existingModal = document.getElementById("switch-pollution-modal");
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement("div");
  modal.id = "switch-pollution-modal";

  const prevName = previousIdentity?.name || "Unknown";
  const newName = newIdentity?.name || "Unknown";

  modal.innerHTML = `
    <div class="privacy-modal-overlay">
      <div class="privacy-modal-content">
        <div class="privacy-modal-header">
          <h2>🔄 Switching Identity: ${prevName} → ${newName}</h2>
        </div>
        <div class="privacy-modal-body">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Analyzing characteristics and generating pollution message...</p>
          </div>
          <div class="results-state" style="display: none;">
            <div class="characteristics-comparison"></div>
            <div class="pollution-message-section">
              <label for="switch-pollution-text">Edit the pollution message:</label>
              <textarea id="switch-pollution-text" class="pollution-message-textarea" placeholder="Pollution message will appear here..."></textarea>
            </div>
          </div>
          <div class="no-pollution-state" style="display: none;">
            <p>No overlapping or conflicting characteristics found between these identities. No pollution message is needed.</p>
          </div>
        </div>
        <div class="privacy-modal-footer">
          <button id="switch-cancel-btn" class="privacy-btn privacy-btn-cancel">Cancel</button>
          <button id="switch-copy-btn" class="privacy-btn privacy-btn-proceed-original" style="display: none;">Copy</button>
          <button id="switch-send-btn" class="privacy-btn privacy-btn-rewrite" style="display: none;">Send</button>
          <button id="switch-inject-only-btn" class="privacy-btn privacy-btn-rewrite" style="display: none;">Close</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  console.log("Privacy Guard: Switch pollution modal shown");

  // Set up cancel button (works in loading state)
  modal.querySelector("#switch-cancel-btn").addEventListener("click", () => {
    console.log("Privacy Guard: User cancelled identity switch");
    modal.remove();
  });

  // Request pollution message from background
  chrome.runtime.sendMessage(
    {
      type: "generateSwitchPollutionMessage",
      previousIdentity,
      newIdentity,
    },
    (response) => {
      if (!response || !response.success) {
        console.error("Privacy Guard: Failed to generate pollution message:", response?.error);
        // Show error state
        modal.querySelector(".loading-state").innerHTML = `
          <p style="color: #ff6b6b;">Failed to generate pollution message. Please try again.</p>
        `;
        return;
      }

      const { hasPollution, message, overlaps, denialsOnly } = response.data;

      // Hide loading state
      modal.querySelector(".loading-state").style.display = "none";

      if (!hasPollution) {
        // No overlaps or denials - show no-pollution state and just close
        modal.querySelector(".no-pollution-state").style.display = "block";
        modal.querySelector("#switch-inject-only-btn").style.display = "inline-block";
        modal.querySelector("#switch-inject-only-btn").textContent = "Close";

        // Set up close button - just closes modal, no identity injection
        modal.querySelector("#switch-inject-only-btn").addEventListener("click", () => {
          console.log("Privacy Guard: No pollution needed, closing modal");
          modal.remove();
        });
        return;
      }

      // Show results state
      modal.querySelector(".results-state").style.display = "block";
      modal.querySelector("#switch-copy-btn").style.display = "inline-block";
      modal.querySelector("#switch-send-btn").style.display = "inline-block";

      // Build characteristics comparison HTML
      let comparisonHtml = "";

      if (overlaps.length > 0) {
        comparisonHtml += `
          <div class="comparison-section">
            <h4>Overlapping Characteristics (will be contradicted):</h4>
            <div class="comparison-list">
              ${overlaps.map(o => `
                <div class="comparison-item overlap-item">
                  <span class="char-name">${o.name}:</span>
                  <span class="char-old">${o.oldValue}</span>
                  <span class="char-arrow">→</span>
                  <span class="char-new">${o.newValue}</span>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }

      if (denialsOnly.length > 0) {
        comparisonHtml += `
          <div class="comparison-section">
            <h4>Characteristics to Deny (no replacement in new identity):</h4>
            <div class="comparison-list">
              ${denialsOnly.map(d => `
                <div class="comparison-item denial-item">
                  <span class="char-name">${d.name}:</span>
                  <span class="char-old">${d.value}</span>
                  <span class="char-arrow">→</span>
                  <span class="char-denied">(denied)</span>
                </div>
              `).join("")}
            </div>
          </div>
        `;
      }

      modal.querySelector(".characteristics-comparison").innerHTML = comparisonHtml;

      // Set the generated message in the textarea
      const textarea = modal.querySelector("#switch-pollution-text");
      textarea.value = message;

      // Set up copy button
      modal.querySelector("#switch-copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(textarea.value).then(() => {
          const btn = modal.querySelector("#switch-copy-btn");
          btn.textContent = "Copied!";
          setTimeout(() => {
            btn.textContent = "Copy";
          }, 2000);
        });
      });

      // Set up send button - just sends the message, no identity injection
      modal.querySelector("#switch-send-btn").addEventListener("click", async () => {
        const finalMessage = textarea.value.trim();
        if (!finalMessage) {
          alert("Please enter a pollution message or cancel.");
          return;
        }

        console.log("Privacy Guard: Sending pollution message");

        // Disable buttons during sending
        modal.querySelector("#switch-send-btn").disabled = true;
        modal.querySelector("#switch-send-btn").textContent = "Sending...";

        // Send the pollution message
        const sendResult = await sendMessageToChatApp(finalMessage);

        if (sendResult.success) {
          console.log("Privacy Guard: Pollution message sent successfully");
          modal.remove();
        } else {
          console.error("Privacy Guard: Failed to send pollution message:", sendResult.error);
          modal.querySelector("#switch-send-btn").disabled = false;
          modal.querySelector("#switch-send-btn").textContent = "Send";
          alert("Failed to send message. Please try again.");
        }
      });
    }
  );
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
