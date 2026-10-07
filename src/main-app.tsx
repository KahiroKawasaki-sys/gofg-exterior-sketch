import { createRoot } from 'react-dom/client';
import App3 from './v3/App3';
import { initializeNativePlatform } from './v3/platform';
import './v3/style3.css';
import './v3/native.css';

// The v2 query has no effect in the bundled application.
void initializeNativePlatform();
createRoot(document.getElementById('root')!).render(<App3 />);
