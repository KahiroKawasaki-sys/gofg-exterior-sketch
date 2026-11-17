// 詳細モードの解説動画（python scripts/record-guide.py --only f-... で撮り直す）
import { type GuideVideo } from './Simple';
import { PRO } from './edition';
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
import meetingMp4 from './guide/f-meeting.mp4';
import meetingJpg from './guide/f-meeting.jpg';
import view3dMp4 from './guide/f-3d.mp4';
import view3dJpg from './guide/f-3d.jpg';
import renderMp4 from './guide/f-render.mp4';
import renderJpg from './guide/f-render.jpg';

export { meetingMp4, meetingJpg, view3dMp4, view3dJpg, renderMp4, renderJpg };

// Pro だけの機能（2D版 sketch には画面が無い）の動画
export const PRO_ONLY = ['f-meeting', 'f-3d', 'f-render'];

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
  // Pro だけ：打ち合わせ（録音→文字→議事録）。動画は旧版（要望カード・反映）のまま。撮り直しは別途
  { id: 'f-meeting', title: '打ち合わせ（録音→議事録）', text: '録音して止めると全部が文字になり、AIが議事録にまとめる。全文と議事録はコピー・保存できる', video: meetingMp4, poster: meetingJpg },
  // Pro だけ：3D・AIパース
  { id: 'f-3d', title: '3Dで見る', text: '回す・寄る・視点の切り替え、線の種類と高さ。立面図を読み込むと家が立つ', video: view3dMp4, poster: view3dJpg },
  { id: 'f-render', title: 'AIパース', text: '3Dを写真のような絵に。時間帯と希望を選んで作り、元の3Dと見比べて保存', video: renderMp4, poster: renderJpg },
].filter(v => PRO || !PRO_ONLY.includes(v.id));
