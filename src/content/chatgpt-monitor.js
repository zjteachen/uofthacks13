import OpenAI from 'openai';

// OpenAI API Configuration
const openai = new OpenAI({
  apiKey: 'API-KEY',
  dangerouslyAllowBrowser: true
});

// Store the current textarea being monitored
let currentTextarea = null;
let approvedMessages = new Set();
let currentSendButton = null;
let currentForm = null;

// Detect personal information using AI
async function detectPersonalInfoWithAI(text) {
  try {
    console.log('Privacy Guard: Starting AI detection for text:', text.substring(0, 50) + '...');
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a highly sensitive privacy protection assistant. Your job is to catch ALL information that could reveal someone's identity or location, including subtle hints and contextual clues.

IMPORTANT: Be extremely cautious. If something MIGHT reveal private information, flag it.

Categories to detect:

1. Direct identifiers: names, emails, phone numbers, addresses, SSN, credit cards, government IDs
2. Location clues (BE VERY SENSITIVE):
   - Specific cities, states, countries
   - Universities, schools, workplaces
   - Neighborhoods, landmarks, buildings
   - Colloquial references like "land of spices" (India), "Big Apple" (NYC), "Down Under" (Australia)
   - Cultural references that reveal location (e.g., "where I study" + "UofT" = Toronto)
3. Personal details: age, job titles, company names, family member names, medical conditions, ethnicity
4. Identifying patterns: specific routines, unique events with dates, combinations of facts
5. Digital identifiers: usernames, IP addresses, account numbers, device IDs, social media handles
6. Temporal information: specific dates of personal events, birthdays, anniversaries
7. Financial information: salary, account balances, transactions, financial institutions
8. Relationships: names of friends, family, colleagues, romantic partners
9. Cultural/contextual clues: phrases that imply location, background, or identity

Return a JSON array. Each item must have:
- "text": the exact phrase/word that reveals information
- "type": "location", "personal_detail", "identifier", "contact_info", etc.
- "reason": clear explanation of what this reveals and why it's sensitive
- "severity": "high" (direct identifiers), "medium" (strong contextual clues), "low" (weak clues)

CRITICAL: If you're unsure whether something is sensitive, FLAG IT ANYWAY. Better safe than sorry.

Return ONLY the JSON array, nothing else. If truly nothing sensitive, return []`
      }, {
        role: 'user',
        content: text
      }],
      temperature: 0.2,
      max_tokens: 1500
    });

    const content = completion.choices[0].message.content.trim();
    
    console.log('Privacy Guard: AI response:', content);
    
    // Parse the JSON response
    let detected = [];
    try {
      // Remove markdown code blocks if present
      const jsonContent = content.replace(/```json\n?|\n?```/g, '').trim();
      detected = JSON.parse(jsonContent);
      console.log('Privacy Guard: AI detected', detected.length, 'items');
    } catch (e) {
      console.error('Privacy Guard: Failed to parse AI response:', e);
      detected = [];
    }

    return detected;
  } catch (error) {
    console.error('Privacy Guard: AI detection error:', error);
    return [];
  }
}

// Rewrite message to remove sensitive information
async function rewriteMessage(originalText, itemsToRemove) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a privacy protection assistant. Rewrite the user's message to remove or anonymize the specified sensitive information while maintaining the core meaning and intent of the message. 

CRITICAL RULES:
1. NEVER use placeholders like [name], [location], [redacted], etc.
2. Either omit the sensitive information entirely or replace it with natural, generic terms
3. Make the message flow naturally without obvious gaps
4. Replace specific locations with general terms (e.g., "from India" → "from South Asia" or just remove it)
5. Remove or generalize personal identifiers completely
6. Keep the message natural and conversational
7. Maintain the original tone and style
8. If removing something makes the sentence awkward, rephrase the entire sentence naturally

Examples:
- "Hi, I'm John from Toronto" → "Hi, I'm someone from Canada" or "Hi there"
- "My name is Sarah" → "I'm a person" or just start the message differently
- "I live in the land of spices" → "I live in a warm country" or just remove

Return ONLY the rewritten message text, nothing else.`
      }, {
        role: 'user',
        content: `Original message: "${originalText}"\n\nRemove these sensitive items:\n${itemsToRemove.map((item, idx) => `${idx + 1}. "${item.text}" (${item.reason})`).join('\n')}`
      }],
      temperature: 0.5,
      max_tokens: 1000
    });

    let rewrittenText = completion.choices[0].message.content.trim();
    
    // Remove surrounding quotes if present
    if ((rewrittenText.startsWith('"') && rewrittenText.endsWith('"')) ||
        (rewrittenText.startsWith("'") && rewrittenText.endsWith("'"))) {
      rewrittenText = rewrittenText.slice(1, -1);
    }
    
    return rewrittenText;
  } catch (error) {
    console.error('Rewrite error:', error);
    return originalText;
  }
}

// Create warning modal with AI-detected items
function createWarningModal(originalText, textarea) {
  // Remove existing modal if present
  const existingModal = document.getElementById('privacy-warning-modal');
  if (existingModal) {
    existingModal.remove();
  }

  const modal = document.createElement('div');
  modal.id = 'privacy-warning-modal';
  
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
  const style = document.createElement('style');
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

  console.log('Privacy Guard: Modal created and shown immediately');

  // Return promise that will be resolved based on user action
  return new Promise(async (resolve) => {
    const cancelBtn = modal.querySelector('#privacy-cancel-btn');
    const proceedOriginalBtn = modal.querySelector('#privacy-proceed-original-btn');
    const rewriteBtn = modal.querySelector('#privacy-rewrite-btn');

    // Set up cancel button (works in loading state)
    cancelBtn.addEventListener('click', () => {
      console.log('Privacy Guard: User clicked Cancel');
      modal.remove();
      resolve({ action: 'cancel' });
    });

    // Start AI detection in background
    const detectedInfo = await detectPersonalInfoWithAI(originalText);
    
    console.log('Privacy Guard: Detection complete, found', detectedInfo.length, 'items');

    // If nothing detected, automatically proceed
    if (detectedInfo.length === 0) {
      console.log('Privacy Guard: No sensitive info detected, auto-proceeding');
      modal.remove();
      resolve({ action: 'proceed', text: originalText });
      return;
    }

    // Update modal with results
    const severityEmoji = {
      high: '🔴',
      medium: '🟡',
      low: '🟢'
    };

    const detectedListHtml = detectedInfo.map((info, idx) => `
      <div class="info-item" data-index="${idx}">
        <div class="info-checkbox">
          <input type="checkbox" id="item-${idx}" checked>
          <label for="item-${idx}">
            <div class="info-header">
              <span class="severity-badge">${severityEmoji[info.severity] || '🟡'} ${info.severity?.toUpperCase() || 'MEDIUM'}</span>
              <span class="info-type">${info.type || 'Sensitive Info'}</span>
            </div>
            <div class="info-text">"${info.text}"</div>
            <div class="info-reason">${info.reason}</div>
          </label>
        </div>
      </div>
    `).join('');

    modal.querySelector('.detected-info-list').innerHTML = detectedListHtml;
    modal.querySelector('.privacy-modal-header h2').textContent = '⚠️ Personal Information Detected';
    modal.querySelector('.loading-state').style.display = 'none';
    modal.querySelector('.results-state').style.display = 'block';
    proceedOriginalBtn.style.display = 'inline-block';
    rewriteBtn.style.display = 'inline-block';

    proceedOriginalBtn.addEventListener('click', () => {
      console.log('Privacy Guard: User clicked Send Original');
      modal.remove();
      resolve({ action: 'proceed', text: originalText });
    });

    rewriteBtn.addEventListener('click', async () => {
      // Get ONLY checked items
      const checkedItems = [];
      detectedInfo.forEach((info, idx) => {
        const checkbox = modal.querySelector(`#item-${idx}`);
        if (checkbox && checkbox.checked) {
          checkedItems.push(info);
        }
      });

      console.log('Privacy Guard: User wants to rewrite', checkedItems.length, 'out of', detectedInfo.length, 'items');

      if (checkedItems.length === 0) {
        // Nothing to rewrite, just send original
        modal.remove();
        resolve({ action: 'proceed', text: originalText });
        return;
      }

      // Show loading state
      rewriteBtn.disabled = true;
      rewriteBtn.textContent = 'Rewriting...';

      try {
        const rewrittenText = await rewriteMessage(originalText, checkedItems);
        modal.remove();
        resolve({ action: 'rewrite', text: rewrittenText });
      } catch (error) {
        alert('Failed to rewrite message. Please try again.');
        rewriteBtn.disabled = false;
        rewriteBtn.textContent = 'Rewrite & Send';
      }
    });
  });
}

// Simple hash function for strings
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// Check if the submit button was clicked
async function interceptSubmission(textarea, shouldAutoSubmit = false) {
  const text = textarea.value || textarea.textContent || textarea.innerText || '';
  const textHash = hashString(text);
  
  console.log('Privacy Guard: interceptSubmission called, text length:', text.length);
  
  // If already approved, allow through
  if (approvedMessages.has(textHash)) {
    console.log('Privacy Guard: Message already approved');
    return { proceed: true, text };
  }
  
  // Show modal immediately, detection happens inside
  const result = await createWarningModal(text, textarea);
  
  console.log('Privacy Guard: User decision:', result.action);
  console.log('Privacy Guard: User decision:', result.action);
  
  if (result.action === 'cancel') {
    return { proceed: false };
  } else if (result.action === 'proceed') {
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
  } else if (result.action === 'rewrite') {
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
    const inputEvent = new Event('input', { bubbles: true });
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

// Monitor the ChatGPT input
function monitorChatGPTInput() {
  console.log('Privacy Guard: Initializing...');
  
  // Find the textarea - ChatGPT uses a contenteditable div or textarea
  const findInput = () => {
    // Try multiple selectors as ChatGPT's DOM structure may vary
    const selectors = [
      'textarea[data-id]',
      '#prompt-textarea',
      'textarea',
      '[contenteditable="true"]',
      'div[contenteditable="true"]'
    ];
    
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) {
        console.log('Privacy Guard: Found input with selector:', selector);
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
    console.log('Privacy Guard: Setting up event listeners on input');

    // Method 1: Intercept Enter key
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        console.log('Privacy Guard: Enter key pressed');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const result = await interceptSubmission(input, true);
        
        if (!result.proceed) {
          return false;
        }
      }
    }, true);

    // Method 2: Monitor form submission
    const form = input.closest('form');
    if (form) {
      currentForm = form;
      console.log('Privacy Guard: Found form, adding listener');
      form.addEventListener('submit', async (e) => {
        console.log('Privacy Guard: Form submit detected');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const result = await interceptSubmission(input, true);
        
        if (!result.proceed) {
          return false;
        }
      }, true);
    }

    // Method 3: Monitor the send button
    const findSendButton = () => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const hasDataTestId = btn.getAttribute('data-testid') === 'send-button';
        const hasSvg = btn.querySelector('svg');
        const isAriaLabel = btn.getAttribute('aria-label')?.toLowerCase().includes('send');
        
        if (hasDataTestId || (hasSvg && btn.textContent.trim() === '') || isAriaLabel) {
          return btn;
        }
      }
      return null;
    };

    const sendButton = findSendButton();
    if (sendButton) {
      currentSendButton = sendButton;
      console.log('Privacy Guard: Found send button, adding listener');
      sendButton.addEventListener('click', async (e) => {
        console.log('Privacy Guard: Send button clicked');
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const result = await interceptSubmission(input, true);
        
        if (!result.proceed) {
          return false;
        }
      }, true);
    }
  };

  setupMonitoring();

  // Re-check periodically as ChatGPT might dynamically create new textareas
  setInterval(setupMonitoring, 2000);

  // Also observe DOM changes
  const observer = new MutationObserver(() => {
    setupMonitoring();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', monitorChatGPTInput);
} else {
  monitorChatGPTInput();
}

console.log('Privacy Guard: Content script loaded for ChatGPT');
