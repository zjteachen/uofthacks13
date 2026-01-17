import { Characteristic } from '../types/identity';

export async function generateDescriptionFromCharacteristics(
  apiKey: string,
  characteristics: Characteristic[],
  identityName: string
): Promise<string> {
  const characteristicsText = characteristics
    .map(char => `${char.name}: ${char.value}`)
    .join('\n');

  const prompt = `Create a concise, description of a person with the following characteristics:

Identity Name: ${identityName}

Characteristics:
${characteristicsText}

Write a description that naturally incorporates these attributes. The description should sound like it's describing a real person, not a list, but don't be too poetic`;

  try {
    console.log('API Key being used:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Gemini API error');
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text.trim();
  } catch (error) {
    console.error('Error generating description:', error);
    throw error;
  }
}
