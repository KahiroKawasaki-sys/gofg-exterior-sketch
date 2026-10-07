import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
await mkdir('assets', { recursive: true });
await sharp('public/icon.svg').resize(1024, 1024).flatten({ background: '#245a43' }).png().toFile('assets/icon-only.png');
// Capacitor Assets needs a splash source; the launch storyboard itself is plain.
await sharp({ create: { width: 2732, height: 2732, channels: 3, background: '#f5f5f3' } }).png().toFile('assets/splash.png');
console.log('Icon (1024x1024, opaque) and plain launch background generated.');
