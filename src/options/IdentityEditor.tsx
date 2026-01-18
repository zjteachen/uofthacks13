import { useState, useEffect, useRef } from 'react';
import { Identity, Characteristic } from '../types/identity';
import './IdentityEditor.css';

interface IdentityEditorProps {
  identity: Identity | null;
  onSave: (identity: Identity) => void;
}

function IdentityEditor({ identity, onSave }: IdentityEditorProps) {
  const [tempName, setTempName] = useState(identity?.name || '');
  const [profilePicture, setProfilePicture] = useState(identity?.profilePicture || '');
  const [prompt, setPrompt] = useState(identity?.prompt || '');
  const [characteristics, setCharacteristics] = useState<Characteristic[]>(identity?.characteristics || []);
  const [summary, setSummary] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Track previous identity to auto-save when switching
  const previousIdentityRef = useRef<Identity | null>(null);

  // Auto-save when switching identities (before loading new one)
  useEffect(() => {
    const previousIdentity = previousIdentityRef.current;

    // If we had a previous identity and there are unsaved changes, save them
    if (previousIdentity && hasUnsavedChanges && previousIdentity.id !== identity?.id) {
      const updatedIdentity: Identity = {
        ...previousIdentity,
        name: tempName || previousIdentity.name,
        profilePicture,
        prompt,
        summary,
        characteristics
      };
      onSave(updatedIdentity);
      setHasUnsavedChanges(false);
    }

    // Update ref and load new identity
    previousIdentityRef.current = identity;

    if (identity) {
      setTempName(identity.name);
      setProfilePicture(identity.profilePicture);
      setPrompt(identity.prompt);
      setCharacteristics(identity.characteristics || []);
      setSummary(identity.summary || '');
      setHasUnsavedChanges(false);
    }
  }, [identity?.id]);

  const handleProfilePictureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        // Compress the image
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          // Limit max dimension to 200px
          const maxDim = 200;
          if (width > height) {
            if (width > maxDim) {
              height = (height * maxDim) / width;
              width = maxDim;
            }
          } else {
            if (height > maxDim) {
              width = (width * maxDim) / height;
              height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.7);
            setProfilePicture(compressed);
            setHasUnsavedChanges(true);
          }
        };
        img.src = base64;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleNameInputChange = (value: string) => {
    setTempName(value);
    setHasUnsavedChanges(true);
  };

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    setHasUnsavedChanges(true);
  };

  const handleSave = async () => {
    if (!identity) return;

    if (!prompt.trim()) {
      alert('Please enter a prompt description');
      return;
    }

    setIsExtracting(true);
    setSaveStatus('Extracting characteristics...');

    try {
      // Extract characteristics from prompt
      const result = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'extractCharacteristics',
            prompt: prompt,
            identityName: tempName || 'Unnamed',
            existingCharacteristics: characteristics
          },
          (response) => {
            if (response.success) {
              resolve(response.data);
            } else {
              reject(new Error(response.error));
            }
          }
        );
      });
      
      // Merge new characteristics with existing ones (additive)
      const existingChars = characteristics;
      const newChars = result.characteristics || [];
      
      // Create a map of existing characteristics by name for easy lookup
      const charMap = new Map(existingChars.map(c => [c.name.toLowerCase(), c]));
      
      // Add or update characteristics
      newChars.forEach((newChar: Characteristic) => {
        charMap.set(newChar.name.toLowerCase(), newChar);
      });
      
      const mergedCharacteristics = Array.from(charMap.values());
      setCharacteristics(mergedCharacteristics);

      // Generate summary from ALL characteristics
      setSaveStatus('Generating summary...');
      const summaryResult = await new Promise<any>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'generateSummary',
            characteristics: mergedCharacteristics,
            identityName: tempName || 'Unnamed'
          },
          (response) => {
            if (response.success) {
              resolve(response.data);
            } else {
              reject(new Error(response.error));
            }
          }
        );
      });

      setSummary(summaryResult.summary || '');

      const updatedIdentity: Identity = {
        ...identity,
        name: tempName || 'Unnamed',
        profilePicture,
        prompt: '', // Clear prompt after save
        summary: summaryResult.summary || '',
        characteristics: mergedCharacteristics
      };

      onSave(updatedIdentity);
      setPrompt(''); // Clear the prompt field
      setHasUnsavedChanges(false);
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      alert(`Failed to extract characteristics: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setSaveStatus('');
    } finally {
      setIsExtracting(false);
    }
  };

  const handleDeleteCharacteristic = (id: string) => {
    const updatedChars = characteristics.filter(char => char.id !== id);
    setCharacteristics(updatedChars);
    setHasUnsavedChanges(true);
    // Note: Summary will be regenerated when user clicks Save
  };

  if (!identity) {
    return (
      <div className="identity-editor empty">
        <p>Select an identity to edit</p>
      </div>
    );
  }
  return (
    <div className="identity-editor">
      <div className="editor-header">
        <h2>Edit Identity</h2>
      </div>

      <div className="editor-content">
        {/* Profile Picture Section */}
        <div className="form-section">
          <label>Profile Picture</label>
          <div className="profile-pic-preview">
            <img
              src={profilePicture || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Ccircle cx="50" cy="50" r="50" fill="%23ccc"/%3E%3C/svg%3E'}
              alt="Profile preview"
            />
          </div>
          <input
            type="file"
            accept="image/*"
            onChange={handleProfilePictureChange}
            className="file-input"
          />
        </div>

        {/* Name Section */}
        <div className="form-section">
          <label htmlFor="identity-name">Identity Name</label>
          <input
            id="identity-name"
            type="text"
            value={tempName}
            onChange={(e) => handleNameInputChange(e.target.value)}
            placeholder="Enter identity name"
            className="text-input"
          />
        </div>

        {/* Prompt Section */}
        <div className="form-section">
          <label htmlFor="prompt">Identity Description</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            placeholder="Describe this identity in detail. For example: 'I am a Quokka, I like to eat leaves. I am 2 years old and my hobby is eating leaves.'"
            className="textarea"
            rows={8}
          />
        </div>

        {/* Summary Section - Read Only */}
        <div className="form-section">
          <label>Identity Summary</label>
          <div className="summary-box">
            {summary || 'No summary yet. Add information above and click Save to generate a summary.'}
          </div>
        </div>

        {/* Characteristics Section - Read Only */}
        {characteristics.length > 0 && (
          <div className="form-section">
            <label>Extracted Characteristics</label>
            <div className="characteristics-display">
              {characteristics.map((char) => (
                <div key={char.id} className="characteristic-display-item">
                  <button
                    className="delete-characteristic-btn"
                    onClick={() => handleDeleteCharacteristic(char.id)}
                    title="Remove characteristic"
                    type="button"
                  >
                    ✕
                  </button>
                  <span className="char-display-name">{char.name}:</span>
                  <span className="char-display-value">{char.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Save Button */}
        <div className="form-actions">
          <button onClick={handleSave} className="save-btn" disabled={isExtracting}>
            {isExtracting ? 'Extracting & Saving...' : 'Save Changes'}
          </button>
          {saveStatus && <span className="save-status">{saveStatus}</span>}
          {hasUnsavedChanges && !saveStatus && <span className="unsaved-indicator">Unsaved changes</span>}
        </div>
      </div>
    </div>
  );
}

export default IdentityEditor;
