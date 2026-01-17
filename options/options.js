document.addEventListener('DOMContentLoaded', () => {
  const exampleTextInput = document.getElementById('exampleText');
  const exampleToggleInput = document.getElementById('exampleToggle');
  const saveButton = document.getElementById('saveButton');
  const statusSpan = document.getElementById('status');

  // Load saved settings
  chrome.storage.sync.get(['exampleText', 'exampleToggle'], (result) => {
    exampleTextInput.value = result.exampleText || '';
    exampleToggleInput.checked = result.exampleToggle || false;
  });

  // Save settings
  saveButton.addEventListener('click', () => {
    const settings = {
      exampleText: exampleTextInput.value,
      exampleToggle: exampleToggleInput.checked
    };

    chrome.storage.sync.set(settings, () => {
      statusSpan.textContent = 'Settings saved!';
      setTimeout(() => {
        statusSpan.textContent = '';
      }, 2000);
    });
  });
});
