export function getOpenAIApiKey(): Promise<string | null> {
  return new Promise((resolve) => {
    // First check for stored key in chrome storage
    chrome.storage.local.get(['openaiApiKey'], (result) => {
      if (result.openaiApiKey) {
        console.log('API key found in chrome storage');
        resolve(result.openaiApiKey);
      } else {
        // Fall back to env variable if available
        const apiKey = import.meta.env.VITE_GEMINI_API || null;
        console.log('API key from env:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT FOUND');
        resolve(apiKey);
      }
    });
  });
}

export function saveOpenAIApiKey(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ openaiApiKey: apiKey }, () => {
      resolve();
    });
  });
}
