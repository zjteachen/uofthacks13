import { useState, useEffect } from 'react';
import { Identity, Characteristic } from '../types/identity';
import { PREDEFINED_ATTRIBUTES } from '../constants/attributes';
import { generateDescriptionFromCharacteristics } from '../utils/gemini';
import { getOpenAIApiKey, saveOpenAIApiKey } from '../utils/storage';
import './IdentityEditor.css';

interface IdentityEditorProps {
  identity: Identity | null;
  onSave: (identity: Identity) => void;
  onNameChange: (name: string) => void;
}

function IdentityEditor({ identity, onSave, onNameChange }: IdentityEditorProps) {
  const [tempName, setTempName] = useState(identity?.name || '');
  const [profilePicture, setProfilePicture] = useState(identity?.profilePicture || '');
  const [prompt, setPrompt] = useState(identity?.prompt || '');
  const [characteristics, setCharacteristics] = useState<Characteristic[]>(identity?.characteristics || []);
  const [selectedAttribute, setSelectedAttribute] = useState('');
  const [customAttributeName, setCustomAttributeName] = useState('');
  const [attributeValue, setAttributeValue] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // Update state when identity prop changes
  useEffect(() => {
    if (identity) {
      setTempName(identity.name);
      setProfilePicture(identity.profilePicture);
      setPrompt(identity.prompt);
      setCharacteristics(identity.characteristics || []);
      setSelectedAttribute('');
      setCustomAttributeName('');
      setAttributeValue('');
    }
    // Load API key on mount
    getOpenAIApiKey().then(key => {
      if (key) setApiKey(key);
    });
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
          }
        };
        img.src = base64;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    if (!identity) return;

    const updatedIdentity: Identity = {
      ...identity,
      name: tempName || 'Unnamed',
      profilePicture,
      prompt,
      characteristics
    };

    onSave(updatedIdentity);
    onNameChange(tempName || 'Unnamed');
    setSaveStatus('Saved!');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleAddCharacteristic = () => {
    let charName = '';
    
    if (selectedAttribute === 'Custom Attribute') {
      if (!customAttributeName.trim() || !attributeValue.trim()) {
        alert('Please enter both attribute name and value');
        return;
      }
      charName = customAttributeName;
    } else if (selectedAttribute) {
      if (!attributeValue.trim()) {
        alert('Please enter a value');
        return;
      }
      charName = selectedAttribute;
    } else {
      alert('Please select an attribute');
      return;
    }

    const newChar: Characteristic = {
      id: Date.now().toString(),
      name: charName,
      value: attributeValue
    };

    setCharacteristics([...characteristics, newChar]);
    setSelectedAttribute('');
    setCustomAttributeName('');
    setAttributeValue('');
  };

  const handleUpdateCharacteristic = (id: string, name: string, value: string) => {
    setCharacteristics(
      characteristics.map(char =>
        char.id === id ? { ...char, name, value } : char
      )
    );
  };

  const handleGenerateDescription = async () => {
    if (!apiKey.trim()) {
      alert('API key not found. Please enter your Blackboard AI API key.');
      setShowApiKeyInput(true);
      return;
    }

    if (characteristics.length === 0) {
      alert('Please add some characteristics first');
      return;
    }

    setIsGenerating(true);
    try {
      const generated = await generateDescriptionFromCharacteristics(
        apiKey,
        characteristics,
        tempName
      );
      setPrompt(generated);
      setSaveStatus('Generated!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (error) {
      alert(`Error generating description: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      alert('Please enter an API key');
      return;
    }
    await saveOpenAIApiKey(apiKey);
    setShowApiKeyInput(false);
    setSaveStatus('API key saved!');
    setTimeout(() => setSaveStatus(''), 2000);
  };

  const handleDeleteCharacteristic = (id: string) => {
    setCharacteristics(characteristics.filter(char => char.id !== id));
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
            onChange={(e) => setTempName(e.target.value)}
            placeholder="Enter identity name"
            className="text-input"
          />
        </div>

        {/* Prompt Section */}
        <div className="form-section">
          <div className="prompt-header">
            <label htmlFor="prompt">Prompt</label>
            <button
              className="generate-btn"
              onClick={handleGenerateDescription}
              type="button"
              disabled={isGenerating || characteristics.length === 0}
              title={characteristics.length === 0 ? 'Add characteristics first' : 'Generate with AI'}
            >
              {isGenerating ? 'Generating...' : '✨ Generate'}
            </button>
          </div>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter prompt..."
            className="textarea"
            rows={6}
          />
          {showApiKeyInput && (
            <div className="api-key-input-section">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your Blackboard AI API key"
                className="api-key-input"
                onKeyPress={(e) => e.key === 'Enter' && handleSaveApiKey()}
              />
              <button
                className="save-api-key-btn"
                onClick={handleSaveApiKey}
                type="button"
              >
                Save Key
              </button>
              <button
                className="cancel-api-key-btn"
                onClick={() => setShowApiKeyInput(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Characteristics Section */}
        <div className="form-section">
          <label>Identity Characteristics</label>
          <div className="characteristics-list">
            {characteristics.map((char) => (
              <div key={char.id} className="characteristic-item">
                <span className="char-name">{char.name}:</span>
                <input
                  type="text"
                  value={char.value}
                  onChange={(e) => handleUpdateCharacteristic(char.id, char.name, e.target.value)}
                  placeholder="Enter value"
                  className="char-value-input"
                />
                <button
                  className="delete-char-btn"
                  onClick={() => handleDeleteCharacteristic(char.id)}
                  type="button"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="add-characteristic">
            <select
              value={selectedAttribute}
              onChange={(e) => {
                setSelectedAttribute(e.target.value);
                if (e.target.value !== 'Custom Attribute') {
                  setCustomAttributeName('');
                }
              }}
              className="attribute-select"
            >
              <option value="">Select an attribute...</option>
              {PREDEFINED_ATTRIBUTES.map((attr) => (
                <option key={attr} value={attr}>
                  {attr}
                </option>
              ))}
            </select>

            {selectedAttribute === 'Custom Attribute' && (
              <input
                type="text"
                value={customAttributeName}
                onChange={(e) => setCustomAttributeName(e.target.value)}
                placeholder="Custom attribute name"
                className="custom-attr-input"
                onKeyPress={(e) => e.key === 'Enter' && handleAddCharacteristic()}
              />
            )}

            <input
              type="text"
              value={attributeValue}
              onChange={(e) => setAttributeValue(e.target.value)}
              placeholder="Value"
              className="attr-value-input"
              onKeyPress={(e) => e.key === 'Enter' && handleAddCharacteristic()}
            />
            <button
              className="add-char-btn"
              onClick={handleAddCharacteristic}
              type="button"
            >
              Add
            </button>
          </div>
        </div>

        {/* Save Button */}
        <div className="form-actions">
          <button onClick={handleSave} className="save-btn">
            Save Changes
          </button>
          {saveStatus && <span className="save-status">{saveStatus}</span>}
        </div>
      </div>
    </div>
  );
}

export default IdentityEditor;
