import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kawakahi.gofgsketch',
  appName: '外構スケッチ',
  webDir: 'dist-app',
  backgroundColor: '#f5f5f3',
  ios: {
    scrollEnabled: false,
    contentInset: 'never',
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
    backgroundColor: '#f5f5f3',
  },
  plugins: { Keyboard: { resize: 'none' } },
};
export default config;
