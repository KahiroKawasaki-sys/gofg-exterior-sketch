import {readFile,writeFile,copyFile} from 'node:fs/promises';
const id=process.argv[2];if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||''))throw Error('作成したD1のdatabase_idを指定してください。秘密情報は入力しません。');
const file=new URL('../.wrangler/deploy.wrangler.jsonc',import.meta.url),config=JSON.parse(await readFile(file,'utf8'));
if(config.name!=='gofg-exterior-sketch')throw Error('対象のアプリではありません');
const previous=config.d1_databases?.find(d=>d.binding==='DB');if(previous&&previous.database_id!==id)throw Error('異なる保存先へ切り替える操作はこのスクリプトでは行いません');
await copyFile(file,new URL('../.wrangler/deploy.before-storage.jsonc',import.meta.url));
config.d1_databases=[...(config.d1_databases||[]).filter(d=>d.binding!=='DB'),{binding:'DB',database_name:'gofg-exterior-sketch',database_id:id,migrations_dir:'../migrations'}];
await writeFile(file,JSON.stringify(config,null,2)+'\n','utf8');console.log('本人専用の配信設定に保存先を追加しました。次に移行SQLを適用し、配信してください。');
