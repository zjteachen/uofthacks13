import React from 'react';

function Popup() {
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="container">
      <h1>My Extension</h1>
      <p>Welcome to your extension popup.</p>
      <button onClick={handleOpenOptions}>Open Settings</button>
    </div>
  );
}

export default Popup;
