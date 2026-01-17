function Popup() {
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="container">
      <h1>🛡️ Privacy Guard</h1>
      <p>Protecting your personal information on ChatGPT.</p>
      
      <div className="feature-info">
        <h3>What we detect:</h3>
        <ul>
          <li>📧 Email addresses</li>
          <li>📱 Phone numbers</li>
          <li>🏠 Street addresses</li>
          <li>💳 Credit card numbers</li>
          <li>🆔 Social Security Numbers</li>
          <li>📮 ZIP codes</li>
          <li>🌐 IP addresses</li>
        </ul>
      </div>
      
      <p className="info-text">
        When you try to send a message on ChatGPT containing personal information, 
        we'll show you a warning and ask for confirmation before proceeding.
      </p>
      
      <button onClick={handleOpenOptions}>Open Settings</button>
    </div>
  );
}

export default Popup;
