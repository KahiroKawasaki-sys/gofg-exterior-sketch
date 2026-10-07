import {createRoot} from 'react-dom/client';import App from './App';import App3 from './v3/App3';
// v0.3（参考事例と同じ画面）を標準にし、?v=2 で従来版を開く。CSSは混ざらないよう版ごとに読み込む
const legacy=new URLSearchParams(location.search).get('v')==='2';
(legacy?import('./style.css'):import('./v3/style3.css')).then(()=>createRoot(document.getElementById('root')!).render(legacy?<App/>:<App3/>));
