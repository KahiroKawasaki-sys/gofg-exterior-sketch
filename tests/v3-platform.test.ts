// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  native: vi.fn(), write: vi.fn(), remove: vi.fn(), share: vi.fn(),
  resize: vi.fn(), scroll: vi.fn(), listen: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: mocks.write, rmdir: mocks.remove }, Directory: { Cache: 'CACHE' } }));
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { setResizeMode: mocks.resize, setScroll: mocks.scroll, addListener: mocks.listen }, KeyboardResize: { None: 'none' } }));
import { saveFile, initializeNativePlatform } from '../src/v3/platform';

beforeEach(() => {
  vi.clearAllMocks(); mocks.native.mockReturnValue(true);
  mocks.write.mockResolvedValue({ uri: 'file:///cache/export.png' });
  mocks.remove.mockResolvedValue(undefined); mocks.share.mockResolvedValue({ activityType: 'Files' });
  mocks.resize.mockResolvedValue(undefined); mocks.scroll.mockResolvedValue(undefined); mocks.listen.mockResolvedValue({ remove: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.documentElement.className = ''; });

it.each(['png', 'pdf', 'garden3.json'])('native: %sを一時保存して共有し、終了後に片付ける', async ext => {
  const blob = new Blob(['drawing']);
  expect(await saveFile(blob, `図面.${ext}`)).toBe('saved');
  const saved = mocks.write.mock.calls[0][0];
  expect(saved.data).toBe(btoa('drawing')); expect(saved.directory).toBe('CACHE');
  expect(saved.path.endsWith(`図面.${ext}`)).toBe(true);
  expect(mocks.share).toHaveBeenCalledWith(expect.objectContaining({ files: ['file:///cache/export.png'] }));
  expect(mocks.remove).toHaveBeenCalledWith(expect.objectContaining({ recursive: true, directory: 'CACHE' }));
});
it('共有をキャンセルしてもエラーにせず一時ファイルを片付ける', async () => {
  mocks.share.mockRejectedValueOnce(new Error('Share canceled'));
  expect(await saveFile(new Blob(['x']), '図面.pdf')).toBe('cancelled'); expect(mocks.remove).toHaveBeenCalled();
});
it('書込失敗は日本語で通知し、共有を開かない', async () => {
  mocks.write.mockRejectedValueOnce(new Error('disk full'));
  await expect(saveFile(new Blob(['x']), '図面.pdf')).rejects.toThrow('ファイルを保存・共有できませんでした');
  expect(mocks.share).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalled();
});
it('共有失敗でも一時ファイルを片付ける', async () => {
  mocks.share.mockRejectedValueOnce(new Error('another share in progress'));
  await expect(saveFile(new Blob(['x']), '図面.pdf')).rejects.toThrow('ファイルを保存・共有できませんでした');
  expect(mocks.remove).toHaveBeenCalled();
});
it('ファイル名の区切り文字を除き、別の場所に保存しない', async () => {
  await saveFile(new Blob(['x']), '../drawing.pdf');
  expect(mocks.write.mock.calls[0][0].path.split('/')).toHaveLength(3);
});
it('Webは従来のa downloadを使い、ネイティブプラグインを呼ばない', async () => {
  mocks.native.mockReturnValue(false); vi.useFakeTimers();
  const create = vi.fn(() => 'blob:local'), revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  let downloaded = ''; vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloaded = this.download; });
  expect(await saveFile(new Blob(['x']), '図面.pdf')).toBe('saved'); expect(downloaded).toBe('図面.pdf');
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30000); expect(revoke).toHaveBeenCalledWith('blob:local');
});
it('Webでは余白とキーボード設定を変えない', async () => {
  mocks.native.mockReturnValue(false); await initializeNativePlatform();
  expect(document.documentElement.classList.contains('v3-native')).toBe(false); expect(mocks.resize).not.toHaveBeenCalled();
});
it('nativeではキャンバスをresizeせずキーボードの高さをフォームへ渡す', async () => {
  await initializeNativePlatform(); expect(mocks.resize).toHaveBeenCalledWith({ mode: 'none' });
  expect(mocks.scroll).toHaveBeenCalledWith({ isDisabled: true });
  const show = mocks.listen.mock.calls.find(call => call[0] === 'keyboardWillShow')![1];
  const hide = mocks.listen.mock.calls.find(call => call[0] === 'keyboardWillHide')![1];
  show({ keyboardHeight: 300 }); expect(document.documentElement.style.getPropertyValue('--v3-keyboard-height')).toBe('300px');
  hide(); expect(document.documentElement.classList.contains('v3-keyboard')).toBe(false);
});
