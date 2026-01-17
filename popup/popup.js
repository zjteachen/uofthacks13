document.addEventListener('DOMContentLoaded', () => {
  const openOptionsButton = document.getElementById('openOptions');

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
