import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener(
  (request, _sender, sendResponse) => {
    console.log("Background: Received message:", request.type);
    if (request.type === "detectPersonalInfo") {
      detectPersonalInfoWithAI(
        request.text,
        request.identity,
        request.chatHistory
      )
        .then((result) => {
          console.log("Background: Detection complete, sending response");
          sendResponse({ success: true, data: result });
        })
        .catch((error) => {
          console.error("Background: Detection error:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        });
      return true; // Keep channel open for async response
    } else if (request.type === "rewriteMessage") {
      console.log("Background: Rewriting message");
      rewriteMessage(request.text, request.itemsToRemove, request.identity)
        .then((result) => {
          console.log("Background: Rewrite complete, sending response");
          sendResponse({ success: true, data: result });
        })
        .catch((error) => {
          console.error("Background: Rewrite error:", error);
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        });
      return true;
    }
  }
);

function buildDetectionPrompt(identity: any, chatHistory: any[]) {
  if (
    identity &&
    identity.characteristics &&
    identity.characteristics.length > 0
  ) {
    const characteristicsList = identity.characteristics
      .map((c: any) => `- ${c.name}: ${c.value}`)
      .join("\n");

    const chatHistorySummary =
      chatHistory.length > 0
        ? chatHistory
            .map(
              (m: any) =>
                `${m.role}: ${m.content.substring(0, 200)}${
                  m.content.length > 200 ? "..." : ""
                }`
            )
            .join("\n")
        : "No previous messages in this conversation.";

    return `You are a privacy protection assistant. The user has a privacy profile that defines what personal information they're comfortable sharing in this context.

PRIVACY PROFILE: "${identity.name}"
Allowed information to share:
${characteristicsList}

CHAT HISTORY (what's already been shared in this conversation):
${chatHistorySummary}

Your task: Flag ONLY information that reveals MORE about the user than what's defined in their allowed characteristics OR what they've already shared in this conversation.

Rules:
1. Information matching the profile's characteristics is ALLOWED (e.g., if "Name: Alex" is in characteristics, mentioning "Alex" is fine)
2. More specific information than what's in the profile should be flagged (e.g., if profile has "Location: Canada", mentioning "Toronto" should be flagged as more specific)
3. If something was already shared in the chat history, don't flag it again
4. Focus on information ESCALATION - what's new and more revealing than the profile allows
5. Information not covered by any characteristic should be flagged (e.g., if no email in profile, any email should be flagged)

Return a JSON array. Each item must have:
- "text": the exact phrase/word that reveals information
- "type": "location", "personal_detail", "identifier", "contact_info", etc.
- "reason": clear explanation of what this reveals beyond the allowed profile
- "severity": "high" (direct identifiers not in profile), "medium" (more specific than profile), "low" (weak clues)

Return ONLY the JSON array, nothing else. Return [] if the message stays within the bounds of the allowed characteristics.`;
  }

  return `You are a highly sensitive privacy protection assistant. Your job is to catch ALL information that could reveal someone's identity or location, including subtle hints and contextual clues.

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

Return ONLY the JSON array, nothing else. If truly nothing sensitive, return []`;
}

async function detectPersonalInfoWithAI(
  text: string,
  identity: any = null,
  chatHistory: any[] = []
) {
  try {
    console.log("Background: Starting AI detection");
    const systemPrompt = buildDetectionPrompt(identity, chatHistory);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: text,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "[]";
    console.log("Background: AI response received");

    let detected = [];
    try {
      const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
      detected = JSON.parse(jsonContent);
      console.log("Background: Parsed", detected.length, "items");
    } catch (e) {
      console.error("Background: Failed to parse AI response:", e);
      detected = [];
    }

    return detected;
  } catch (error) {
    console.error("Background: AI detection error:", error);
    throw error;
  }
}

async function rewriteMessage(
  originalText: string,
  itemsToRemove: any[],
  identity: any = null
) {
  try {
    let identityContext = "";
    if (
      identity &&
      identity.characteristics &&
      identity.characteristics.length > 0
    ) {
      const allowedInfo = identity.characteristics
        .map((c: any) => `${c.name}: ${c.value}`)
        .join(", ");
      identityContext = `\n\nIMPORTANT: The user has a privacy profile allowing these details: ${allowedInfo}. When rewriting, you may keep information that matches these allowed characteristics, but remove or generalize the flagged items that go beyond what's allowed.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
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
${identityContext}
Return ONLY the rewritten message text, nothing else.`,
        },
        {
          role: "user",
          content: `Original message: "${originalText}"\n\nRemove these sensitive items:\n${itemsToRemove
            .map(
              (item, idx) =>
                `${idx + 1}. "${item.text}" (${item.reason})`
            )
            .join("\n")}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 1000,
    });

    let rewrittenText = completion.choices[0].message.content?.trim() || originalText;

    if (
      (rewrittenText.startsWith('"') && rewrittenText.endsWith('"')) ||
      (rewrittenText.startsWith("'") && rewrittenText.endsWith("'"))
    ) {
      rewrittenText = rewrittenText.slice(1, -1);
    }

    return rewrittenText;
  } catch (error) {
    console.error("Rewrite error:", error);
    throw error;
  }
}
