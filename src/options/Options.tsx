import { useState, useEffect } from 'react';

interface Settings {
  exampleText: string;
  exampleToggle: boolean;
}

function Options() {
  const [exampleText, setExampleText] = useState<string>('');
  const [exampleToggle, setExampleToggle] = useState<boolean>(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    // Load saved settings
    chrome.storage.sync.get(['exampleText', 'exampleToggle'], (result) => {
      setExampleText(result.exampleText || '');
      setExampleToggle(result.exampleToggle || false);
    });
  }, []);

  const handleSave = () => {
    const settings: Settings = {
      exampleText,
      exampleToggle
    };

    chrome.storage.sync.set(settings, () => {
      setStatus('Settings saved!');
      setTimeout(() => {
        setStatus('');
      }, 2000);
    });
  };

  return (
    <div className="container">
      <h1>Settings</h1>

      <div className="section">
        <h2>General</h2>

        <div className="setting">
          <label htmlFor="exampleText">Example Text Setting</label>
          <input
            type="text"
            id="exampleText"
            placeholder="Enter value..."
            value={exampleText}
            onChange={(e) => setExampleText(e.target.value)}
          />
        </div>

        <div className="setting">
          <label htmlFor="exampleToggle">
            <input
              type="checkbox"
              id="exampleToggle"
              checked={exampleToggle}
              onChange={(e) => setExampleToggle(e.target.checked)}
            />
            Enable feature
          </label>
        </div>
      </div>

      <div className="actions">
        <button onClick={handleSave}>Save Settings</button>
        <span id="status">{status}</span>
      </div>
    </div>
  );
}

export default Options;
