// 詳細モードの解説動画（python scripts/record-guide.py --only f-... で撮り直す）
import { type GuideVideo } from './Simple';
import screenMp4 from './guide/f-screen.mp4';
import screenJpg from './guide/f-screen.jpg';
import penMp4 from './guide/f-pen.mp4';
import penJpg from './guide/f-pen.jpg';
import dimMp4 from './guide/f-dim.mp4';
import dimJpg from './guide/f-dim.jpg';
import selectMp4 from './guide/f-select.mp4';
import selectJpg from './guide/f-select.jpg';
import objectsMp4 from './guide/f-objects.mp4';
import objectsJpg from './guide/f-objects.jpg';
import layersMp4 from './guide/f-layers.mp4';
import layersJpg from './guide/f-layers.jpg';
import guidesMp4 from './guide/f-guides.mp4';
import guidesJpg from './guide/f-guides.jpg';
import paintMp4 from './guide/f-paint.mp4';
import paintJpg from './guide/f-paint.jpg';
import underlayMp4 from './guide/f-underlay.mp4';
import underlayJpg from './guide/f-underlay.jpg';
import saveMp4 from './guide/f-save.mp4';
import saveJpg from './guide/f-save.jpg';

export const GUIDE_FULL: GuideVideo[] = [
  { id: 'f-screen', title: '画面の見方', text: '2段の道具・左のボタン・右のパネル', video: screenMp4, poster: screenJpg },
  { id: 'f-pen', title: 'ペン・線・図形', text: 'ペンの種類、太さ・色、矢印・楕円・円・曲線、破線', video: penMp4, poster: penJpg },
  { id: 'f-dim', title: '寸法・文字', text: '寸法線と単位、文字の背景・枠、あとから直す', video: dimMp4, poster: dimJpg },
  { id: 'f-select', title: '選択・コピー・回転', text: '移動・拡大・回転、複製、連続コピー、まとめて選択', video: selectMp4, poster: selectJpg },
  { id: 'f-objects', title: '部品（車・植栽など）', text: '押して置く・大きさ調整・ランダム配置・手描きを登録', video: objectsMp4, poster: objectsJpg },
  { id: 'f-layers', title: 'レイヤー', text: '下描き→清書、透明度・非表示・ロック', video: layersMp4, poster: layersJpg },
  { id: 'f-guides', title: 'ガイド線', text: '向きを合わせて平行に描く、勾配・円ガイド', video: guidesMp4, poster: guidesJpg },
  { id: 'f-paint', title: '塗る（砂利・芝・ウッド）', text: '囲まれた所をタップして素材を選ぶ、大きさ・向きの調整', video: paintMp4, poster: paintJpg },
  { id: 'f-underlay', title: '下絵と縮尺合わせ', text: 'PDFを敷く、濃さ、2点で実寸に合わせる', video: underlayMp4, poster: underlayJpg },
  { id: 'f-save', title: '保存・書き出し・履歴', text: '別名保存、PDF・編集データ、履歴で戻す', video: saveMp4, poster: saveJpg },
];
