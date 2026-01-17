# 🛡️ Privacy Guard for ChatGPT

A Chrome extension that protects your personal information by detecting and warning you before you share sensitive data on ChatGPT.

## Features

The extension automatically detects and warns you about:

- 📧 **Email addresses**
- 📱 **Phone numbers** 
- 🏠 **Street addresses**
- 💳 **Credit card numbers**
- 🆔 **Social Security Numbers**
- 📮 **ZIP codes**
- 🌐 **IP addresses**

## How It Works

1. **Automatic Detection**: When you type a message in ChatGPT, the extension scans for personal information patterns
2. **Warning Modal**: If personal info is detected, you'll see a warning modal showing what was detected
3. **Your Choice**: You can either:
   - **Cancel** to edit your message and remove the personal info
   - **Proceed Anyway** to send the message with your consent

## Installation

1. Install dependencies:
```bash
npm install
```

2. Build the extension:
```bash
npm run build
```

3. Load the extension in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `dist` folder from this project

4. Visit [chatgpt.com](https://chatgpt.com) and start chatting - you're now protected!

## Project Structure

```
├── src/
│   ├── popup/          # Popup component
│   ├── options/        # Options page component
│   ├── content/        # Content scripts
│   │   └── chatgpt-monitor.js  # ChatGPT monitoring & detection
├── popup.html          # Popup HTML entry point
├── options.html        # Options HTML entry point
├── manifest.json       # Chrome extension manifest
├── vite.config.js      # Vite configuration
└── package.json
```

## Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build

## Privacy

This extension runs entirely locally in your browser. No data is sent to any external servers. All detection happens on your device.

## Supported Sites

- chatgpt.com
- chat.openai.com

## License

MIT
