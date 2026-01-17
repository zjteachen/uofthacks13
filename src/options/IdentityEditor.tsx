import { useState, useEffect } from 'react';
import { Identity } from '../types/identity';
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
  const [saveStatus, setSaveStatus] = useState('');

  // Update state when identity prop changes
  useEffect(() => {
    if (identity) {
      setTempName(identity.name);
      setProfilePicture(identity.profilePicture);
      setPrompt(identity.prompt);
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
      prompt
    };

    onSave(updatedIdentity);
    onNameChange(tempName || 'Unnamed');
    setSaveStatus('Saved!');
    setTimeout(() => setSaveStatus(''), 2000);
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
          <label htmlFor="prompt">Prompt</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Enter prompt..."
            className="textarea"
            rows={6}
          />
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
