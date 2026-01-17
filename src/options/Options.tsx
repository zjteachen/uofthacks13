import { useState, useEffect } from 'react';
import { Identity } from '../types/identity';
import IdentityMenu from './IdentityMenu';
import IdentityEditor from './IdentityEditor';
import './Options.css';

function Options() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();

  useEffect(() => {
    // Load identities from Chrome storage
    chrome.storage.sync.get(['identities', 'selectedId'], async (result: any) => {
      if (result.identities && Array.isArray(result.identities)) {
        // Load profile pictures from local storage
        const identitiesWithImages = await Promise.all(
          result.identities.map(async (identity: any) => {
            const imageData = await chrome.storage.local.get(`image_${identity.id}`);
            return {
              ...identity,
              profilePicture: imageData[`image_${identity.id}`] || '',
              textSetting: identity.textSetting || '',
              prompt: identity.prompt || ''
            };
          })
        );
        setIdentities(identitiesWithImages);
        setSelectedId(result.selectedId);
      }
    });
  }, []);

  const handleAddIdentity = () => {
    const newIdentity: Identity = {
      id: Date.now().toString(),
      name: 'New Identity',
      profilePicture: '',
      textSetting: '',
      prompt: '',
      createdAt: Date.now()
    };

    const updatedIdentities = [...identities, newIdentity];
    setIdentities(updatedIdentities);
    setSelectedId(newIdentity.id);
    saveToStorage(updatedIdentities, newIdentity.id);
  };

  const handleSelectIdentity = (id: string) => {
    setSelectedId(id);
    chrome.storage.sync.set({ selectedId: id });
  };

  const handleDeleteIdentity = (id: string) => {
    const updatedIdentities = identities.filter(i => i.id !== id);
    setIdentities(updatedIdentities);

    if (selectedId === id) {
      const newSelectedId = updatedIdentities[0]?.id;
      setSelectedId(newSelectedId);
      saveToStorage(updatedIdentities, newSelectedId);
    } else {
      saveToStorage(updatedIdentities, selectedId);
    }
  };

  const handleSaveIdentity = (updatedIdentity: Identity) => {
    const updatedIdentities = identities.map(i =>
      i.id === updatedIdentity.id ? updatedIdentity : i
    );
    setIdentities(updatedIdentities);

    // Save image separately to local storage
    if (updatedIdentity.profilePicture) {
      chrome.storage.local.set({
        [`image_${updatedIdentity.id}`]: updatedIdentity.profilePicture
      });
    }

    // Save metadata to sync storage (without large image data)
    const identitiesForSync = updatedIdentities.map(({ profilePicture, ...rest }) => ({
      ...rest,
      profilePicture: '' // Empty string to match Identity interface
    }));
    
    chrome.storage.sync.set({
      identities: identitiesForSync,
      selectedId: selectedId
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save identity:', chrome.runtime.lastError);
      }
    });
  };

  const handleNameChange = (name: string) => {
    if (selectedId) {
      const updatedIdentities = identities.map(i =>
        i.id === selectedId ? { ...i, name } : i
      );
      setIdentities(updatedIdentities);
    }
  };

  const saveToStorage = (ids: Identity[], selected?: string) => {
    chrome.storage.sync.set({
      identities: ids,
      selectedId: selected
    }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save to storage:', chrome.runtime.lastError);
      }
    });
  };

  const selectedIdentity = identities.find(i => i.id === selectedId) || null;

  return (
    <div className="options-container">
      <IdentityMenu
        identities={identities}
        selectedId={selectedId}
        onSelectIdentity={handleSelectIdentity}
        onAddIdentity={handleAddIdentity}
        onDeleteIdentity={handleDeleteIdentity}
      />
      <IdentityEditor
        identity={selectedIdentity}
        onSave={handleSaveIdentity}
        onNameChange={handleNameChange}
      />
    </div>
  );
}

export default Options;
