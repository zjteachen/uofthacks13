import { Identity, IdentitiesStorage } from '../types/identity';

export function getIdentitiesStorage(): Promise<IdentitiesStorage> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['identities', 'selectedId'], (result) => {
      resolve({
        identities: result.identities || [],
        selectedId: result.selectedId
      });
    });
  });
}

export function setSelectedIdentity(identityId: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ selectedId: identityId }, () => {
      resolve();
    });
  });
}

export function getProfilePicture(identityId: string): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get([`image_${identityId}`], (result) => {
      resolve(result[`image_${identityId}`] || '');
    });
  });
}

export function getSelectedIdentity(): Promise<Identity | null> {
  return new Promise(async (resolve) => {
    const storage = await getIdentitiesStorage();
    if (storage.selectedId) {
      const identity = storage.identities.find(i => i.id === storage.selectedId);
      resolve(identity || null);
    } else {
      resolve(null);
    }
  });
}

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
