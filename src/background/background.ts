import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: import.meta.env.VITE_OPENAI_API_KEY,
  dangerouslyAllowBrowser: true,
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  console.log("Background: Received message:", request.type);
  if (request.type === "detectPersonalInfo") {
    detectPersonalInfoWithAI(
      request.text,
      request.identity,
      request.chatHistory,
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
    rewriteMessage(request.text, request.itemsToRemove)
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
  } else if (request.type === "detectPrivacyViolations") {
    console.log("Background: Detecting privacy violations in response");
    detectPrivacyViolationsInResponse(request.responseText, request.identity)
      .then((result) => {
        console.log(
          "Background: Violation detection complete, sending response",
        );
        console.log("Violations:", result);
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Violation detection error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "checkContextNeeded") {
    console.log("Background: Checking if prompt needs context");
    checkContextNeededHandler(request.prompt, request.identity)
      .then((result) => {
        console.log("Background: Context check complete, sending response");
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Context check error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "generateCombinedPollutionMessage") {
    console.log("Background: Generating combined pollution message");
    console.log("toDeny:", request.toDeny);
    console.log("toPollute:", request.toPollute);
    addNoiseToContext(request.toDeny, request.toPollute)
      .then((result) => {
        console.log("Resulting adversarial message:", result);
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Noise generation error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "extractCharacteristics") {
    console.log("Background: Extracting characteristics from prompt");
    extractCharacteristicsFromPrompt(
      request.prompt,
      request.identityName,
      request.existingCharacteristics || [],
    )
      .then((result) => {
        console.log("Background: Extraction complete, sending response");
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Extraction error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "generateSummary") {
    console.log("Background: Generating summary from characteristics");
    generateSummaryFromCharacteristics(
      request.characteristics,
      request.identityName,
    )
      .then((result) => {
        console.log(
          "Background: Summary generation complete, sending response",
        );
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Summary generation error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "generateSwitchPollutionMessage") {
    console.log("Background: Generating switch pollution message");
    generateSwitchPollutionMessage(
      request.previousIdentity,
      request.newIdentity,
    )
      .then((result) => {
        console.log("Background: Switch pollution message generation complete");
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Switch pollution message error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  } else if (request.type === "generateFakeIdentity") {
    console.log("Background: Generating fake identity");
    generateFakeIdentity(request.characteristics)
      .then((result) => {
        console.log(
          "Background: Fake identity generation complete, sending response",
        );
        sendResponse({ success: true, data: result });
      })
      .catch((error) => {
        console.error("Background: Fake identity generation error:", error);
        sendResponse({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      });
    return true;
  }
});

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
                }`,
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
  chatHistory: any[] = [],
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

async function detectPrivacyViolationsInResponse(
  responseText: string,
  identity: any,
) {
  try {
    // Combine all characteristics into one allowed list (no distinction between real/fake)
    const allCharacteristics = [
      ...(identity.characteristics || []),
      ...(identity.fakeCharacteristics || []),
    ];

    const allowedInfoList = allCharacteristics
      .map((c: any) => `- ${c.name}: ${c.value}`)
      .join("\n");

    console.log("responseText", responseText);
    console.log("identity", identity);

    const prompt = `You are a privacy auditor. Analyze the AI assistant's response to detect personal information it knows about the user that is NOT part of their approved privacy profile.

PRIVACY PROFILE: "${identity.name}"
ALLOWED information (DO NOT flag if the AI mentions these):
${allowedInfoList}

YOUR TASK: Flag ONLY information that goes BEYOND or is NOT COVERED by the allowed profile above.

DO NOT FLAG if the information matches something in the allowed profile (even approximately).
DO NOT FLAG generic responses or hypotheticals.

ONLY FLAG these categories of violations:

1. IDENTIFIERS NOT IN PROFILE:
   - Names, usernames, phone numbers, emails, addresses NOT listed above
   - Account names or handles NOT listed above

2. INFORMATION MORE SPECIFIC THAN PROFILE:
   - Profile says "Canada" but AI mentions "Toronto" (more specific)
   - Profile says "software engineer" but AI mentions specific company name

3. INFORMATION NOT COVERED BY ANY PROFILE ITEM:
   - AI mentions user's age but no age in profile
   - AI mentions user's relationship status but not in profile

4. INFERRED BEHAVIORAL DATA:
   - Patterns the AI claims to have noticed about the user
   - Historical information from past conversations

Return a JSON array of violations. Each item must have:
- "knownInfo": what the AI claims to know (exact quote or paraphrase)
- "category": "identifier", "contact_info", "location", "personal_detail", "behavior", "relationship", etc.
- "reason": why this is NOT covered by the allowed profile
- "severity": "high" (direct identifiers), "medium" (specific personal details), "low" (vague inferences)

If EVERYTHING the AI mentions is covered by the allowed profile, return [].
Return ONLY the JSON array, nothing else.`;
    console.log("Prompt for information flagging: ", prompt);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: `Here is the assistant response:\n\n${responseText}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "[]";
    console.log("Background: Violation detection response received", content);

    const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonContent);
  } catch (error) {
    console.error("Background: Violation detection error:", error);
    throw error;
  }
}

async function rewriteMessage(originalText: string, itemsToRemove: any[]) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a privacy protection assistant. Rewrite the user's message to remove or anonymize ONLY the specific sensitive items listed below. Do NOT remove or modify any other information.

CRITICAL RULES:
1. ONLY rewrite/remove the EXACT items listed in "Remove these sensitive items" section
2. Keep ALL other parts of the message EXACTLY as they are
3. If an item is NOT in the list, do NOT modify it - even if it seems sensitive
4. NEVER use placeholders like [name], [location], [redacted], etc.
5. Either omit the sensitive information entirely or replace it with natural, generic terms
6. Make the message flow naturally without obvious gaps
7. Keep the message natural and conversational
8. Maintain the original tone and style
9. If removing something makes the sentence awkward, rephrase only that sentence naturally

BE STRICT: If the user selected 2 items to remove, rewrite ONLY those 2 items. Leave everything else untouched.

Return ONLY the rewritten message text, nothing else.`,
        },
        {
          role: "user",
          content: `Original message: "${originalText}"\n\nRemove these sensitive items:\n${itemsToRemove
            .map((item, idx) => `${idx + 1}. "${item.text}" (${item.reason})`)
            .join("\n")}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 1000,
    });

    let rewrittenText =
      completion.choices[0].message.content?.trim() || originalText;

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

// Check if a prompt needs context from the identity and return augmented prompt if needed
// Called via chrome.runtime.onMessage from content script
async function checkContextNeededHandler(prompt: string, identity: any) {
  try {
    if (
      !identity ||
      !identity.characteristics ||
      identity.characteristics.length === 0
    ) {
      console.log(
        "Background: No identity characteristics, skipping context check",
      );
      return { needsContext: false, augmentedPrompt: prompt };
    }

    // Get Gemini API key - try storage first, then env variable
    let geminiApiKey = await new Promise<string | null>((resolve) => {
      chrome.storage.local.get(["geminiApiKey"], (result) => {
        resolve(result.geminiApiKey || null);
      });
    });

    // Fall back to env variable if not in storage
    if (!geminiApiKey) {
      geminiApiKey =
        import.meta.env.VITE_GEMINI_API ||
        import.meta.env.VITE_GEMINI_API_KEY ||
        null;
    }

    if (!geminiApiKey) {
      console.log(
        "Background: No Gemini API key found (checked storage and env), skipping context check",
      );
      return { needsContext: false, augmentedPrompt: prompt };
    }

    console.log("Background: Gemini API key found, checking context need...");

    // Build the characteristics list
    const characteristicsList = identity.characteristics
      .map((c: any) => `- ${c.name}: ${c.value}`)
      .join("\n");

    const summaryText = identity.summary || "";

    const analysisPrompt = `You are an AI assistant helping maintain consistent identity context in conversations.

USER'S IDENTITY PROFILE: "${identity.name}"
${summaryText ? `Summary: ${summaryText}` : ""}

Identity Characteristics:
${characteristicsList}

USER'S PROMPT:
"${prompt}"

TASK: Analyze if this prompt would benefit from having identity context added. The goal is to ensure the AI responds in a way that's consistent with who the user is presenting as.

Consider adding context if:
1. The prompt asks for personalized advice, recommendations, or opinions
2. The prompt involves activities, preferences, or decisions that should reflect the identity
3. The prompt asks about "me", "my", "I" without establishing who that is
4. The response quality would improve by knowing relevant identity details

Do NOT add context if:
1. The prompt is purely factual/informational (e.g., "What is the capital of France?")
2. The prompt is about coding, math, or technical topics that don't need personal context
3. The prompt already contains sufficient context
4. Adding identity would be irrelevant or awkward

If context IS needed, select ONLY the relevant characteristics that apply to this specific prompt. Don't include everything - be selective.

Return a JSON object with:
{
  "needsContext": true/false,
  "reason": "brief explanation",
  "relevantCharacteristics": ["characteristic1", "characteristic2"] // only if needsContext is true
}

Return ONLY the JSON object, nothing else.`;

    console.log("Background: Calling Gemini to check context need...");

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: analysisPrompt }] }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.3,
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      console.error("Background: Gemini API error:", error);
      return { needsContext: false, augmentedPrompt: prompt };
    }

    const data = await response.json();
    const responseText =
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    console.log("Background: Gemini response:", responseText);

    // Parse the JSON response
    let analysis;
    try {
      const jsonContent = responseText.replace(/```json\n?|\n?```/g, "").trim();
      analysis = JSON.parse(jsonContent);
    } catch (e) {
      console.error("Background: Failed to parse Gemini response:", e);
      return { needsContext: false, augmentedPrompt: prompt };
    }

    if (!analysis.needsContext) {
      return { needsContext: false, augmentedPrompt: prompt };
    }

    // Build the context prefix with only relevant characteristics
    const relevantChars = analysis.relevantCharacteristics || [];
    let selectedCharacteristics = identity.characteristics.filter((c: any) =>
      relevantChars.some(
        (r: string) =>
          c.name.toLowerCase().includes(r.toLowerCase()) ||
          r.toLowerCase().includes(c.name.toLowerCase()) ||
          c.value.toLowerCase().includes(r.toLowerCase()),
      ),
    );

    // If no matches found but Gemini said context is needed, use all characteristics
    if (selectedCharacteristics.length === 0) {
      console.log("Background: No exact matches, using all characteristics");
      selectedCharacteristics = identity.characteristics;
    }

    const contextPrefix = `(For context about me: ${selectedCharacteristics
      .map((c: any) => `${c.name} is ${c.value}`)
      .join(", ")}.) `;

    const augmentedPrompt = contextPrefix + prompt;

    console.log("Background: Augmented prompt with context");
    return {
      needsContext: true,
      augmentedPrompt,
      reason: analysis.reason,
      addedContext: contextPrefix,
    };
  } catch (error) {
    console.error("Background: Context check error:", error);
    return { needsContext: false, augmentedPrompt: prompt };
  }
}

async function addNoiseToContext(
  denials: any[],
  pollutives: any[],
): Promise<any> {
  try {
    console.log("Denials", denials);
    console.log("Pollutives", pollutives);

    // Build the input array with knownInfo, category, and strategy
    const inputItems = [
      ...denials.map((d) => ({
        knownInfo: d.knownInfo,
        category: d.category || "Unknown",
        strategy: "denial",
      })),
      ...pollutives.map((p) => ({
        knownInfo: p.knownInfo,
        category: p.category || "Unknown",
        strategy: "pollution",
      })),
    ];

    console.log("Input items for pollution:", inputItems);

    const prompt = `
Role: You are a Privacy Obfuscation Engine. Your goal is to generate a natural-sounding message to send to a third-party AI to "clean" or "pollute" the current conversation context based on specific privacy triggers.

Input: A list of objects containing {knownInfo, category, strategy}, where:
- knownInfo: the sensitive information that the third-party is aware of
- category: the type of information (e.g., "Name", "Location", "Age")
- strategy: one of "denial" or "pollution"

Strategies:
- denial: Firmly state that knownInfo is incorrect or irrelevant and should be disregarded.
- pollution: Contradict knownInfo by asserting a FALSE, MADE-UP alternative fact to create "noise" in the user profile.

Task:
1. For each "pollution" item, generate a realistic but FAKE replacement value
2. Combine everything into a single, cohesive paragraph
3. The tone should be polite but firm, as if the user is correcting a misunderstanding

Output JSON format:
{
  "message": "The natural-sounding message to send to the AI",
  "fakeValues": [
    {"category": "Name", "originalValue": "John", "fakeValue": "Michael"},
    {"category": "Location", "originalValue": "New York", "fakeValue": "Chicago"}
  ]
}

The fakeValues array should ONLY contain entries for "pollution" strategy items, with the fake value you used in the message.
Return ONLY the JSON object, no other text.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify(inputItems),
        },
      ],
      temperature: 0.4,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "{}";
    console.log("Background: Noise generation response received:", content);

    // Parse the JSON response
    try {
      const parsed = JSON.parse(content);
      return {
        message: parsed.message || content,
        fakeValues: parsed.fakeValues || [],
      };
    } catch {
      // If parsing fails, return the content as the message with no fake values
      console.warn("Background: Could not parse noise response as JSON");
      return {
        message: content,
        fakeValues: [],
      };
    }
  } catch (error) {
    console.error("Background: Noise generation error:", error);
    throw error;
  }
}

async function extractCharacteristicsFromPrompt(
  prompt: string,
  identityName: string,
  existingCharacteristics: any[] = [],
) {
  try {
    console.log("Background: Extracting characteristics from prompt");

    const existingCharsText =
      existingCharacteristics.length > 0
        ? `\n\nEXISTING CHARACTERISTICS (already extracted):\n${existingCharacteristics.map((c) => `- ${c.name}: ${c.value}`).join("\n")}`
        : "";

    const systemPrompt = `You are a privacy assistant that extracts key characteristics from identity descriptions.

Your task: Analyze the provided identity description and extract structured characteristics that define what information this person is comfortable sharing.

Return a JSON object with one field:
- "characteristics": An array of ONLY NEW key-value pairs from the current prompt (do not repeat existing characteristics)

Each characteristic should have:
- "name": The attribute name (e.g., "Name", "Age", "Location", "Occupation", "Interests", "Education", etc.)
- "value": The specific value for this identity

Guidelines:
- Only extract concrete, factual information explicitly stated or strongly implied
- Keep characteristic names generic and reusable (Name, Age, Location, etc.)
- Keep values concise but specific
- Extract 5-15 characteristics depending on the detail provided
- Common categories: Name, Age, Gender, Location, Occupation, Education, Interests, Hobbies, Skills, Personality traits

Return ONLY the JSON object, nothing else.

Example format:
{
  "characteristics": [
    {"name": "Favorite Food", "value": "Eucalyptus leaves"},
    {"name": "Age", "value": "2 years old"}
  ]
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Identity Name: "${identityName}"${existingCharsText}\n\nNew Description to Extract From:\n${prompt}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "{}";
    console.log("Background: Extraction response received");

    const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const result = JSON.parse(jsonContent);

    // Ensure characteristics have IDs
    if (result.characteristics) {
      result.characteristics = result.characteristics.map(
        (char: any, idx: number) => ({
          id: `char-${Date.now()}-${idx}`,
          name: char.name,
          value: char.value,
        }),
      );
    }

    return result;
  } catch (error) {
    console.error("Background: Characteristic extraction error:", error);
    throw error;
  }
}

// Analyze characteristics between two identities for pollution generation
// Returns overlaps (characteristics in both with different values) and denialsOnly (I1 characteristics with no I2 match)
function analyzeCharacteristicsForPollution(
  prevIdentity: any,
  newIdentity: any,
): {
  overlaps: { name: string; oldValue: string; newValue: string }[];
  denialsOnly: { name: string; value: string }[];
} {
  const prevChars = prevIdentity?.characteristics || [];
  const newChars = newIdentity?.characteristics || [];

  // Create a map of new identity characteristics by normalized name
  const newCharsMap = new Map<string, string>();
  for (const char of newChars) {
    const normalizedName = char.name.toLowerCase().trim();
    newCharsMap.set(normalizedName, char.value);
  }

  const overlaps: { name: string; oldValue: string; newValue: string }[] = [];
  const denialsOnly: { name: string; value: string }[] = [];

  for (const prevChar of prevChars) {
    const normalizedName = prevChar.name.toLowerCase().trim();
    const newValue = newCharsMap.get(normalizedName);

    if (newValue !== undefined) {
      // Both identities have this characteristic - it's an overlap
      // Only add if values are different (otherwise no contradiction needed)
      if (newValue !== prevChar.value) {
        overlaps.push({
          name: prevChar.name,
          oldValue: prevChar.value,
          newValue: newValue,
        });
      }
    } else {
      // Only I1 has this characteristic - denial only
      denialsOnly.push({
        name: prevChar.name,
        value: prevChar.value,
      });
    }
  }

  return { overlaps, denialsOnly };
}

// Generate pollution message for identity switch
async function generateSwitchPollutionMessage(
  prevIdentity: any,
  newIdentity: any,
): Promise<{
  hasPollution: boolean;
  message: string;
  overlaps: { name: string; oldValue: string; newValue: string }[];
  denialsOnly: { name: string; value: string }[];
}> {
  const { overlaps, denialsOnly } = analyzeCharacteristicsForPollution(
    prevIdentity,
    newIdentity,
  );

  console.log("Background: Analyzed characteristics for pollution");
  console.log("Overlaps:", overlaps);
  console.log("Denials only:", denialsOnly);

  if (overlaps.length === 0 && denialsOnly.length === 0) {
    return { hasPollution: false, message: "", overlaps, denialsOnly };
  }

  // Build input items for the AI
  const inputItems = [
    // For overlaps: use I2 value to contradict I1
    ...overlaps.map((o) => ({
      knownInfo: `${o.name}: ${o.oldValue}`,
      newValue: o.newValue,
      strategy: "pollution",
    })),
    // For denials only: just negate I1 with no replacement
    ...denialsOnly.map((d) => ({
      knownInfo: `${d.name}: ${d.value}`,
      strategy: "denial",
    })),
  ];

  const prompt = `Role: You are a Privacy Obfuscation Engine. Your goal is to generate a standalone, self-contained message that clarifies personal information. This message will be sent to an AI assistant that has NO prior context - treat it as a fresh conversation.

Input: A list of objects containing {knownInfo, strategy, newValue?}:
- knownInfo: The sensitive information that needs to be contradicted/corrected
- strategy: Either "pollution" (replace with new value) or "denial" (just negate without replacement)
- newValue: (only for pollution) The new value to assert instead

Task: Generate a SELF-CONTAINED message that explicitly states all the corrections. Since the recipient has NO context, you must:
1. For "pollution" items: Explicitly state the NEW correct value AND deny the old value
   Example: "I'm from Vancouver, not Toronto."
2. For "denial" items: Explicitly state what is NOT true
   Example: "I'm not really into reading."

CRITICAL Guidelines:
- This message will be sent to a BLANK conversation with NO prior context
- You MUST explicitly mention ALL items - do not skip anything assuming it was already said
- Start with something like "I just wanted to clarify a few things about myself:" or "Quick note about me:"
- Combine all items into one cohesive, conversational paragraph
- Be clear and direct - every piece of information must be explicitly stated
- Do NOT mention AI, strategies, or context switching
- Keep it natural and casual

Output: A single, self-contained message that can be understood without any prior context.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(inputItems) },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    const message = completion.choices[0].message.content?.trim() || "";
    console.log("Background: Generated switch pollution message:", message);

    return { hasPollution: true, message, overlaps, denialsOnly };
  } catch (error) {
    console.error(
      "Background: Error generating switch pollution message:",
      error,
    );
    throw error;
  }
}

async function generateSummaryFromCharacteristics(
  characteristics: any[],
  identityName: string,
) {
  try {
    console.log("Background: Generating summary from characteristics");

    if (!characteristics || characteristics.length === 0) {
      return { summary: "No characteristics defined yet." };
    }

    const characteristicsList = characteristics
      .map((c) => `- ${c.name}: ${c.value}`)
      .join("\n");

    const systemPrompt = `You are a privacy assistant that creates concise identity summaries.

Your task: Given a list of characteristics about a person, create a natural, concise 2-3 sentence summary that captures the essence of who they are.

Guidelines:
- Write in third person
- Be concise but comprehensive
- Highlight the most defining characteristics
- Make it flow naturally as a paragraph
- Focus on what makes this identity unique

Return ONLY the summary text, nothing else. No JSON, no quotes, just the summary paragraph.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Identity Name: "${identityName}"\n\nCharacteristics:\n${characteristicsList}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
    });

    const summary = completion.choices[0].message.content?.trim() || "";
    console.log("Background: Summary generation response received");

    return { summary };
  } catch (error) {
    console.error("Background: Summary generation error:", error);
    throw error;
  }
}

async function generateFakeIdentity(characteristics: any[]) {
  try {
    console.log("Background: Generating fake identity from characteristics");

    if (!characteristics || characteristics.length === 0) {
      return { fakeCharacteristics: [] };
    }

    const characteristicsList = characteristics
      .map((c) => `- ${c.name}: ${c.value}`)
      .join("\n");

    const systemPrompt = `You are a privacy protection assistant that generates fake identities for data obfuscation.

Your task: Given a list of real characteristics, generate plausible fake values for each characteristic. The fake values should:
- Be realistic and believable
- Match the type/format of the original (e.g., if age is "25", generate another age like "32")
- Be completely different from the original values
- Maintain consistency across related characteristics

Return a JSON object with one field:
- "fakeCharacteristics": An array of characteristics with the same names but fake values

Each fake characteristic should have:
- "name": The same name as the original characteristic
- "value": A plausible fake value

Guidelines:
- For names: Generate completely different names (different gender is OK)
- For ages: Generate different ages within a reasonable range (+/- 10 years)
- For locations: Generate different cities/countries
- For occupations: Generate different but plausible occupations
- For interests/hobbies: Generate different but realistic interests
- Keep the fake identity internally consistent (e.g., if location is France, use French-sounding names)

Return ONLY the JSON object, nothing else.

Example:
Real: Name: John, Age: 25, Location: Toronto
Fake: Name: Emma, Age: 32, Location: Vancouver`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Real Characteristics:\n${characteristicsList}`,
        },
      ],
      temperature: 0.8,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "{}";
    console.log("Background: Fake identity generation response received");

    const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
    const result = JSON.parse(jsonContent);

    // Ensure fake characteristics have IDs
    if (result.fakeCharacteristics) {
      result.fakeCharacteristics = result.fakeCharacteristics.map(
        (char: any, idx: number) => ({
          id: `fake-char-${Date.now()}-${idx}`,
          name: char.name,
          value: char.value,
        }),
      );
    }

    return result;
  } catch (error) {
    console.error("Background: Fake identity generation error:", error);
    throw error;
  }
}
