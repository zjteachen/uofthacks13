# Chrome Extension with React

A Chrome extension built with React and Vite.

## Development

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
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

## Project Structure

```
├── src/
│   ├── popup/          # Popup component
│   ├── options/        # Options page component
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
