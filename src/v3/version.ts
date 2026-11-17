// 利用者に見せる版。ビルド時に package.json の version（VITE_APP_VERSION があればそちら）が入る（vite.config.ts）
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || '1.0.0';
export const VERSION_LABEL = `バージョン ${APP_VERSION}`;
