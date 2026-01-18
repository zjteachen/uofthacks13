import { useState, useEffect } from 'react';
import { Identity } from '../types/identity';
import { getIdentitiesStorage, setSelectedIdentity, getProfilePicture } from '../utils/storage';

function Popup() {
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [currentIdentity, setCurrentIdentity] = useState<Identity | null>(null);
  const [selectedDropdownId, setSelectedDropdownId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadIdentities();
  }, []);

  const loadIdentities = async () => {
    const storage = await getIdentitiesStorage();
    console.log('Loaded storage:', storage);

    // Load profile pictures from local storage (matching Options.tsx pattern)
    const identitiesWithImages = await Promise.all(
      storage.identities.map(async (identity) => {
        const profilePicture = await getProfilePicture(identity.id);
        return { ...identity, profilePicture };
      })
    );

    console.log('Loaded identities:', identitiesWithImages);
    setIdentities(identitiesWithImages);

    if (storage.selectedId) {
      const selected = identitiesWithImages.find(i => i.id === storage.selectedId);
      setCurrentIdentity(selected || null);
      setSelectedDropdownId(storage.selectedId);
    } else if (identitiesWithImages.length > 0) {
      setSelectedDropdownId(identitiesWithImages[0].id);
    }

    setLoading(false);
  };

  const handleSwitch = async () => {
    console.log('Switch button clicked!');
    console.log('selectedDropdownId:', selectedDropdownId);

    if (!selectedDropdownId) {
      alert('Please select an identity first');
      return;
    }

    const newIdentity = identities.find(i => i.id === selectedDropdownId);
    console.log('Found identity:', newIdentity);

    if (!newIdentity) return;

    // Capture the previous identity before updating state
    const previousIdentity = currentIdentity;

    setCurrentIdentity(newIdentity);
    await setSelectedIdentity(selectedDropdownId);

    // Inject the identity into the active tab with pollution support
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      console.log('Tabs query result:', tabs);

      if (!tabs[0]) {
        console.log('No active tab');
        alert('No active tab found');
        return;
      }

      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url;
      console.log('Active tab URL:', tabUrl);

      if (!tabId) {
        console.log('No tab ID');
        alert('No tab ID found');
        return;
      }

      console.log('Sending message to tab:', tabId, 'URL:', tabUrl);
      console.log('Previous identity:', previousIdentity?.name, '→ New identity:', newIdentity.name);

      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'injectIdentityWithPollution',
          previousIdentity,
          newIdentity
        },
        (response) => {
          if (chrome.runtime.lastError) {
            console.error('Error sending message:', chrome.runtime.lastError);
            console.error('This usually means the content script is not loaded on this page.');
            console.error('Make sure you\'re on ChatGPT, Gemini, or Claude.');
          } else {
            console.log('Message sent successfully, response:', response);
          }
        }
      );
    });
  };

  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  if (loading) {
    return (
      <div className="popup-container">
        <div className="popup-header">
          <img src="/icons/icon.svg" alt="Janus" className="header-icon" />
          <h1>Janus</h1>
        </div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading identities...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="popup-container">
      <div className="popup-header">
        <img src="/icons/icon.svg" alt="Janus" className="header-icon" />
        <h1>Janus</h1>
      </div>
      
      <div className="popup-content">
        <div className="current-identity-section">
          <h3 className="section-label">Current Identity</h3>
        {currentIdentity ? (
          <div className="identity-card">
            {currentIdentity.profilePicture && (
              <img
                src={currentIdentity.profilePicture}
                alt={currentIdentity.name}
                className="identity-avatar"
              />
            )}
            <div className="identity-info">
              <span className="identity-name">{currentIdentity.name}</span>
            </div>
          </div>
        ) : (
          <div className="no-identity">
            <span>No identity selected</span>
          </div>
        )}
      </div>

      {identities.length > 0 ? (
        <div className="switch-section">
          <h3 className="section-label">Switch Identity</h3>
          <div className="switch-controls">
            <select
              value={selectedDropdownId}
              onChange={(e) => setSelectedDropdownId(e.target.value)}
              className="identity-dropdown"
            >
              {identities.map(identity => (
                <option key={identity.id} value={identity.id}>
                  {identity.name}
                </option>
              ))}
            </select>
            <button
              onClick={handleSwitch}
              disabled={selectedDropdownId === currentIdentity?.id}
              className="switch-btn"
            >
              Switch
            </button>
          </div>
        </div>
      ) : (
        <div className="no-identities-message">
          <p>No identities created yet. Open settings to create your first identity.</p>
        </div>
      )}

      <button onClick={handleOpenOptions} className="settings-btn">
        ⚙️ Open Settings
      </button>
      </div>
    </div>
  );
}

export default Popup;
