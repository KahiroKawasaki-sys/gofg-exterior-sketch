import { describe, it, expect } from 'vitest';
import { nearestAspect, renderFileName, newRender } from '../src/v3/render';

describe('AIパース（端末側）', () => {
  it('3D画面の縦横から画像AIの縦横比を選ぶ', () => {
    expect(nearestAspect(1920, 1080)).toBe('16:9');
    expect(nearestAspect(1180, 820)).toBe('3:2');
    expect(nearestAspect(1024, 768)).toBe('4:3');
    expect(nearestAspect(800, 800)).toBe('1:1');
    expect(nearestAspect(820, 1180)).toBe('2:3');
    expect(nearestAspect(2520, 1080)).toBe('21:9');
  });
  it('保存名は図面名＋パース＋時間帯＋日時で、使えない文字は置き換える', () => {
    expect(renderFileName('山田様邸 A/B案', 'dusk', '2026-11-09T18:30:00.000Z')).toBe('山田様邸 A_B案_パース_夕方_2611091830.jpg');
    expect(renderFileName('', 'day')).toBe('gaikou_パース_昼.jpg');
  });
  it('newRender は図面IDと日時つき', () => {
    const r = newRender('doc1', 'eye', 'night', '塀は黒', 'data:image/jpeg;base64,xx', 1234);
    expect(r.docId).toBe('doc1'); expect(r.view).toBe('eye'); expect(r.style).toBe('night'); expect(r.ms).toBe(1234);
    expect(r.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
