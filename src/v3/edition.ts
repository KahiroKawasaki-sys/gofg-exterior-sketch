// アプリは2本に作り分ける。sketch＝2Dの図面描きだけ（外構スケッチ）、pro＝3D・DXF・集計・見積・打ち合わせAIまで（外構スケッチ Pro）。
// Web版は指定がなければ全部入り。
export type Edition = 'sketch' | 'pro';
export const EDITION: Edition = import.meta.env.VITE_EDITION === 'sketch' ? 'sketch' : 'pro';
export const PRO = EDITION === 'pro';
