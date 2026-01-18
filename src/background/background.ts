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
      request.existingCharacteristics || []
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
      request.identityName
    )
      .then((result) => {
        console.log("Background: Summary generation complete, sending response");
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
  } else if (request.type === "generateFakeIdentity") {
    console.log("Background: Generating fake identity");
    generateFakeIdentity(request.characteristics)
      .then((result) => {
        console.log("Background: Fake identity generation complete, sending response");
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
    const characteristicsList = identity.characteristics
      .map((c: any) => `- ${c.name}: ${c.value}`)
      .join("\n");

    // Include fake characteristics as allowed information
    const fakeCharacteristicsList = (identity.fakeCharacteristics || [])
      .map((c: any) => `- ${c.name}: ${c.value}`)
      .join("\n");

    console.log("responseText", responseText);
    console.log("identity", identity);

    const allowedInfo = fakeCharacteristicsList
      ? `${characteristicsList}\n\nFAKE/OBFUSCATED INFORMATION (also allowed):\n${fakeCharacteristicsList}`
      : characteristicsList;

    const prompt = `You are a privacy auditor. Analyze the AI assistant's response to detect if it reveals that it KNOWS information about the user that goes BEYOND their allowed privacy profile.

PRIVACY PROFILE: "${identity.name}"
Information the user has chosen to share:
${allowedInfo}

AI RESPONSE TO ANALYZE:
${responseText}

Your task: Identify any statements where the AI demonstrates knowledge of user information that is:
1. MORE SPECIFIC than what's in the profile (e.g., profile says "Canada" but AI mentions "Toronto")
2. NOT COVERED by any characteristic in the profile (e.g., AI mentions user's email but no email in profile)
3. INFERRED beyond what was explicitly shared (e.g., AI assumes user's age from context)

IMPORTANT: If the AI mentions information that matches the FAKE/OBFUSCATED information, DO NOT flag it as a violation. This is expected and allowed.

Return a JSON array of violations. Each item must have:
- "knownInfo": what the AI claims to know (exact quote or paraphrase)
- "category": "location", "personal_detail", "interest", "behavior", "relationship", etc.
- "reason": why this exceeds the allowed profile
- "severity": "high" (specific identifiers), "medium" (detailed inference), "low" (vague assumption)

Return [] if the AI only references information within the allowed profile bounds.
Return ONLY the JSON array, nothing else.`;
    console.log("Prompt for information flagging: ", prompt);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: responseText },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "[]";
    console.log("Background: Violation detection response received");

    const jsonContent = content.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(jsonContent);
  } catch (error) {
    console.error("Background: Violation detection error:", error);
    throw error;
  }
}

async function rewriteMessage(
  originalText: string,
  itemsToRemove: any[],
) {
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

async function addNoiseToContext(
  denials: any[],
  pollutives: any[],
): Promise<any> {
  try {
    console.log("Denials", denials);
    console.log("Pollutives", pollutives);

    // Build the input array with knownInfo and strategy
    const inputItems = [
      ...denials.map((d) => ({ knownInfo: d.knownInfo, strategy: "denial" })),
      ...pollutives.map((p) => ({
        knownInfo: p.knownInfo,
        strategy: "pollution",
      })),
    ];

    console.log("Input items for pollution:", inputItems);

    const prompt = `
Role: You are a Privacy Obfuscation Engine. Your goal is to generate a natural-sounding message to send to a third-party AI to "clean" or "pollute" the current conversation context based on specific privacy triggers.

Input: A list of objects containing {knownInfo, strategy}, where knownInfo is the sensitive information that the third-party is aware of to be scrubbed/denied, and the strategy is one of "denial", "pollution":

    denial: Firmly state that knownInfo is incorrect or irrelevant and should be disregarded.

    pollution: Contradict knownInfo by asserting a false preference or alternative fact to create "noise" in the user profile and replace the knownInfo in the third-party LLM's context.

Task: Combine the results from all provided objects into a single, cohesive paragraph. The tone should be polite but firm, as if the user is correcting a misunderstanding or clarifying their current needs. Do not mention that you are an AI or that this is a "strategy."

Output: (A single message ready to be sent to the host LLM).`;
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: JSON.stringify(inputItems),
        },
      ],
      temperature: 0.2,
      max_tokens: 1500,
    });

    const content = completion.choices[0].message.content?.trim() || "[]";
    console.log("Background: Noise generation response received");

    return content;
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
