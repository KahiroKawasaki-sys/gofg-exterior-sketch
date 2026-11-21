"""外構スケッチ Pro を App Store 審査へ出す準備（と、指定したときだけ提出）。

App Store Connect API（testflight_assign.py と同じ鍵・同じ Secrets）で次を行う:
  (a) 1.0.0 の App Store バージョンを作る／取る（リリース方式は手動）
  (b) 日本語のメタデータ（appstore/metadata.ja.md）を入れる
  (c) iPad 13インチのスクリーンショット（appstore/screenshots/ipad13/*.png）を入れ替える
  (d) ビルドを紐付ける
  (e) 審査情報（appstore/review-notes.md のメモ・連絡先・審査用ライセンスキー）
  (f) カテゴリ・年齢区分・価格（無料）・配信地域（日本のみ）
  (g) SUBMIT=true のときだけ審査へ提出

既定は dry run：API は読むだけで、書き込む予定を一覧表示する。
    python scripts/appstore_submit.py --check-only      # 通信なし。字数・画像サイズだけ確かめる

環境変数:
  ASC_PRIVATE_KEY / ASC_KEY_ID / ASC_ISSUER_ID   App Store Connect API の鍵（既存 Secrets）
  APPSTORE_DRY_RUN   true（既定）／false
  APPSTORE_BUILD     紐付けるビルド番号（CFBundleVersion。例 1.27.1）。空なら紐付けしない
  APPSTORE_SUBMIT    true のときだけ審査へ提出（dry run では提出の予定を一覧に出すだけ）
  REVIEW_LICENSE_KEY 審査用ライセンスキー（審査メモとデモ欄に入れる。ログには出さない）
  REVIEW_CONTACT_PHONE / REVIEW_CONTACT_EMAIL / REVIEW_CONTACT_FIRST_NAME / REVIEW_CONTACT_LAST_NAME
  APPSTORE_SUPPORT_URL / APPSTORE_PRIVACY_URL / APPSTORE_MARKETING_URL   metadata の <<...>> を上書き
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
from distribute import EDITIONS, normalize_private_key, require  # noqa: E402
from testflight_assign import make_token  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STORE = ROOT / 'appstore'
SHOTS = STORE / 'screenshots' / 'ipad13'
HOST = 'https://api.appstoreconnect.apple.com'
BUNDLE, DISPLAY = EDITIONS['pro']
VERSION = '1.0.0'
LOCALE = 'ja'
# 13インチ iPad のスクリーンショット枠。Apple の ScreenshotDisplayType の列挙に「13インチ」の名前は無く、
# 12.9/13 インチは APP_IPAD_PRO_3GEN_129 に入る（2064x2752 / 2048x2732 とも可。要確認：初回は dry run で既存の枠名を見る）
DISPLAY_TYPE = 'APP_IPAD_PRO_3GEN_129'
SHOT_SIZES = {(2752, 2064), (2064, 2752), (2732, 2048), (2048, 2732)}
PRIMARY_CATEGORY, SECONDARY_CATEGORY = 'BUSINESS', 'PRODUCTIVITY'
TERRITORIES = ['JPN']
EDITABLE = {'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'}
LIMITS = {'name': 30, 'subtitle': 30, 'promotionalText': 170, 'description': 4000, 'keywords': 100,
          'whatsNew': 4000, 'notes': 4000}
# 年齢区分：すべて「なし／いいえ」（appstore/metadata.ja.md の表と同じ）
AGE_RATING = {
    **{k: 'NONE' for k in ('alcoholTobaccoOrDrugUseOrReferences', 'contests', 'gamblingSimulated', 'gunsOrOtherWeapons',
                           'medicalOrTreatmentInformation', 'profanityOrCrudeHumor', 'sexualContentGraphicAndNudity',
                           'sexualContentOrNudity', 'horrorOrFearThemes', 'matureOrSuggestiveThemes',
                           'violenceCartoonOrFantasy', 'violenceRealisticProlongedGraphicOrSadistic', 'violenceRealistic')},
    **{k: False for k in ('advertising', 'gambling', 'healthOrWellnessTopics', 'lootBox', 'messagingAndChat',
                          'parentalControls', 'ageAssurance', 'socialMedia', 'unrestrictedWebAccess', 'userGeneratedContent')},
}


# ---------- 入力ファイル ----------

def sections(path):
    """「## 見出し」直下の ``` ブロックを {見出し: 本文} にする"""
    text = path.read_text(encoding='utf-8')
    return {h.strip(): body.rstrip('\n') for h, body in re.findall(r'^## ([^\n]+)\n```[a-z]*\n(.*?)```', text, re.S | re.M)}


def load_metadata():
    s = sections(STORE / 'metadata.ja.md')
    env = lambda k, v: os.environ.get(k, '').strip() or v
    meta = {
        'name': s['アプリ名'], 'subtitle': s['サブタイトル'], 'promotionalText': s['プロモーションテキスト'],
        'description': s['説明文'], 'keywords': s['キーワード'], 'copyright': s['著作権'], 'whatsNew': s['このバージョンの新機能'],
        'supportUrl': env('APPSTORE_SUPPORT_URL', s['サポートURL']),
        'privacyPolicyUrl': env('APPSTORE_PRIVACY_URL', s['プライバシーポリシーURL']),
        'marketingUrl': env('APPSTORE_MARKETING_URL', s.get('マーケティングURL（任意・空でよい）', '')),
    }
    notes = sections(STORE / 'review-notes.md')['Notes for App Review']
    return meta, notes


def png_info(path):
    head = path.read_bytes()[:33]
    require(head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR', f'{path.name}: PNG ではありません')
    w, h, _depth, color = struct.unpack('>IIBB', head[16:26])
    return w, h, color


def check(meta, notes, problems, warnings):
    for k, n in LIMITS.items():
        v = notes if k == 'notes' else meta[k]
        if len(v) > n:
            problems.append(f'{k}: {len(v)}字（上限 {n}字）')
    if re.search(r'[¥￥]|\d+\s*円|月額|価格', meta['description'] + meta['promotionalText']):
        problems.append('説明文に価格・月額らしき表記があります（3.1.3(c) の方針で書かない）')
    for k in ('supportUrl', 'privacyPolicyUrl'):
        if not meta[k].startswith('https://'):
            warnings.append(f'{k} が未設定です（{meta[k] or "空"}）。APPSTORE_{"SUPPORT" if k == "supportUrl" else "PRIVACY"}_URL で渡す')
    if '<<REVIEW_KEY>>' not in notes:
        problems.append('review-notes.md の審査メモに <<REVIEW_KEY>> がありません')
    shots = sorted(SHOTS.glob('*.png'))
    if not 1 <= len(shots) <= 10:
        problems.append(f'スクリーンショットは1〜10枚（今 {len(shots)}枚）')
    for p in shots:
        w, h, color = png_info(p)
        if (w, h) not in SHOT_SIZES:
            problems.append(f'{p.name}: {w}x{h} は 13インチ iPad のサイズではありません')
        if color in (4, 6):
            problems.append(f'{p.name}: 透明（アルファ）付きの PNG です')
    return shots


# ---------- API ----------

class Api:
    def __init__(self, key_path, key_id, issuer, dry_run):
        self.args, self.token, self.issued, self.dry_run = (key_path, key_id, issuer), None, 0, dry_run
        self.plan = []

    def _auth(self):
        if time.time() - self.issued > 900:
            self.token, self.issued = make_token(*self.args), time.time()
        return self.token

    def call(self, method, path, query=None, body=None, ok404=False):
        path = path if path.startswith('/v') else '/v1' + path
        url = HOST + path + ('?' + urllib.parse.urlencode(query) if query else '')
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self._auth()}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                text = res.read()
        except urllib.error.HTTPError as error:
            if ok404 and error.code == 404:
                return None
            raise ValueError(f'App Store Connect API {method} {path} failed: HTTP {error.code} '
                             f'{error.read().decode(errors="replace")[:800]}') from None
        return json.loads(text) if text else {}

    def get(self, path, query=None, ok404=False):
        return self.call('GET', path, query, ok404=ok404)

    def write(self, what, method, path, body=None):
        """書き込み。dry run では予定に積むだけ"""
        self.plan.append(f'{method:6} {path:48} {what}')
        if self.dry_run:
            return None
        print(f'-> {what}', flush=True)
        return self.call(method, path, body=body)


def rel(kind, id_):
    return {'data': {'type': kind, 'id': id_}}


def mask(text, secret):
    return text.replace(secret, '****') if secret else text


# ---------- 各手順 ----------

def find_app(api):
    apps = [a for a in api.get('/apps', {'filter[bundleId]': BUNDLE, 'fields[apps]': 'bundleId,name,primaryLocale,contentRightsDeclaration'})['data']
            if a['attributes'].get('bundleId') == BUNDLE]
    require(len(apps) == 1, f'{DISPLAY} ({BUNDLE}) が App Store Connect にありません')
    a = apps[0]
    print(f'App: {a["attributes"].get("name")} id={a["id"]} primaryLocale={a["attributes"].get("primaryLocale")}', flush=True)
    return a


def app_level(api, app):
    if app['attributes'].get('contentRightsDeclaration') != 'DOES_NOT_USE_THIRD_PARTY_CONTENT':
        # 他社の著作物（ライセンスを受けたコンテンツ）を使っていない申告。要確認：依頼主の判断（部品の画像・テクスチャが自作／利用許諾済みか）
        api.write('コンテンツの権利：第三者のコンテンツを使わない', 'PATCH', f'/apps/{app["id"]}',
                  {'data': {'type': 'apps', 'id': app['id'], 'attributes': {'contentRightsDeclaration': 'DOES_NOT_USE_THIRD_PARTY_CONTENT'}}})


def version(api, app, meta):
    vs = api.get(f'/apps/{app["id"]}/appStoreVersions', {'filter[platform]': 'IOS', 'limit': 50,
                 'fields[appStoreVersions]': 'versionString,appStoreState,appVersionState,releaseType,copyright'})['data']
    for v in vs:
        a = v['attributes']
        print(f'Version {a["versionString"]}: {a.get("appVersionState") or a.get("appStoreState")} release={a.get("releaseType")}', flush=True)
    state = lambda v: v['attributes'].get('appStoreState') or v['attributes'].get('appVersionState')
    released = any(state(v) in ('READY_FOR_SALE', 'READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_VERSION') for v in vs)
    same = [v for v in vs if v['attributes']['versionString'] == VERSION]
    editable = [v for v in vs if state(v) in EDITABLE]
    attrs = {'releaseType': 'MANUAL', 'copyright': meta['copyright']}
    if same:
        v = same[0]
        require(state(v) in EDITABLE, f'{VERSION} は {state(v)} で編集できません（審査中・承認済みなど）')
    elif editable:
        # 新しいアプリには「1.0」が自動でできていることがある → 版番号を 1.0.0 に直して使う
        v = editable[0]
        attrs['versionString'] = VERSION
    else:
        res = api.write(f'App Store バージョン {VERSION} を作る（手動リリース）', 'POST', '/appStoreVersions',
                        {'data': {'type': 'appStoreVersions', 'attributes': {'platform': 'IOS', 'versionString': VERSION, **attrs},
                                  'relationships': {'app': rel('apps', app['id'])}}})
        return (res['data']['id'] if res else '<新しいバージョン>'), released
    cur = v['attributes']
    diff = {k: x for k, x in attrs.items() if cur.get(k) != x}
    if diff:
        api.write(f'バージョン {cur["versionString"]} を更新: {diff}', 'PATCH', f'/appStoreVersions/{v["id"]}',
                  {'data': {'type': 'appStoreVersions', 'id': v['id'], 'attributes': diff}})
    return v['id'], released


def version_localization(api, vid, meta, released):
    fields = ['description', 'keywords', 'promotionalText', 'supportUrl', 'marketingUrl'] + (['whatsNew'] if released else [])
    if not released:
        print('初回リリースのため「このバージョンの新機能」は入れません（Apple は初版では受け付けない）', flush=True)
    want = {k: meta[k] for k in fields if meta[k] and not meta[k].startswith('<<')}
    if vid.startswith('<'):
        api.write('日本語ローカライズを作る: ' + ', '.join(want), 'POST', '/appStoreVersionLocalizations')
        return vid
    locs = api.get(f'/appStoreVersions/{vid}/appStoreVersionLocalizations')['data']
    print('Version locales: ' + ', '.join(l['attributes']['locale'] for l in locs), flush=True)
    loc = next((l for l in locs if l['attributes']['locale'] == LOCALE), None)
    if not loc:
        res = api.write('日本語ローカライズを作る: ' + ', '.join(want), 'POST', '/appStoreVersionLocalizations',
                        {'data': {'type': 'appStoreVersionLocalizations', 'attributes': {'locale': LOCALE, **want},
                                  'relationships': {'appStoreVersion': rel('appStoreVersions', vid)}}})
        return res['data']['id'] if res else '<新しいローカライズ>'
    diff = {k: v for k, v in want.items() if loc['attributes'].get(k) != v}
    if diff:
        api.write('日本語の説明文などを更新: ' + ', '.join(diff), 'PATCH', f'/appStoreVersionLocalizations/{loc["id"]}',
                  {'data': {'type': 'appStoreVersionLocalizations', 'id': loc['id'], 'attributes': diff}})
    return loc['id']


def app_info(api, app, meta):
    infos = api.get(f'/apps/{app["id"]}/appInfos', {'include': 'primaryCategory,secondaryCategory'})['data']
    info = next((i for i in infos if (i['attributes'].get('state') or i['attributes'].get('appStoreState')) not in ('READY_FOR_DISTRIBUTION', 'READY_FOR_SALE')), None)
    require(info, '編集できる App 情報がありません')
    cats = {k: (info['relationships'].get(k, {}).get('data') or {}).get('id') for k in ('primaryCategory', 'secondaryCategory')}
    print(f'Categories: {cats}', flush=True)
    if cats != {'primaryCategory': PRIMARY_CATEGORY, 'secondaryCategory': SECONDARY_CATEGORY}:
        api.write(f'カテゴリ: {PRIMARY_CATEGORY} / {SECONDARY_CATEGORY}', 'PATCH', f'/appInfos/{info["id"]}',
                  {'data': {'type': 'appInfos', 'id': info['id'], 'relationships': {
                      'primaryCategory': rel('appCategories', PRIMARY_CATEGORY), 'secondaryCategory': rel('appCategories', SECONDARY_CATEGORY)}}})
    want = {k: meta[k] for k in ('name', 'subtitle', 'privacyPolicyUrl') if meta[k] and not meta[k].startswith('<<')}
    locs = api.get(f'/appInfos/{info["id"]}/appInfoLocalizations')['data']
    loc = next((l for l in locs if l['attributes']['locale'] == LOCALE), None)
    if not loc:
        api.write('App 情報の日本語（名前・サブタイトル・プライバシーポリシーURL）を作る', 'POST', '/appInfoLocalizations',
                  {'data': {'type': 'appInfoLocalizations', 'attributes': {'locale': LOCALE, **want},
                            'relationships': {'appInfo': rel('appInfos', info['id'])}}})
    else:
        diff = {k: v for k, v in want.items() if loc['attributes'].get(k) != v}
        if diff:
            api.write('App 情報の日本語を更新: ' + ', '.join(f'{k}={v}' for k, v in diff.items()), 'PATCH', f'/appInfoLocalizations/{loc["id"]}',
                      {'data': {'type': 'appInfoLocalizations', 'id': loc['id'], 'attributes': diff}})
    rating = api.get(f'/appInfos/{info["id"]}/ageRatingDeclaration', ok404=True)
    if rating and rating.get('data'):
        r = rating['data']
        diff = {k: v for k, v in AGE_RATING.items() if r['attributes'].get(k) != v}
        if diff:
            api.write(f'年齢区分の回答（{len(diff)}項目を なし／いいえ に）', 'PATCH', f'/ageRatingDeclarations/{r["id"]}',
                      {'data': {'type': 'ageRatingDeclarations', 'id': r['id'], 'attributes': diff}})
    else:
        print('要確認: 年齢区分の宣言が取れません（App Store Connect の画面で入力）', flush=True)


def screenshots(api, loc_id, shots):
    if loc_id.startswith('<'):
        api.write(f'スクリーンショット枠 {DISPLAY_TYPE} を作り {len(shots)}枚を上げる', 'POST', '/appScreenshotSets')
        return
    sets = api.get(f'/appStoreVersionLocalizations/{loc_id}/appScreenshotSets', {'include': 'appScreenshots'})
    found = next((s for s in sets['data'] if s['attributes']['screenshotDisplayType'] == DISPLAY_TYPE), None)
    print('Screenshot sets: ' + ', '.join(s['attributes']['screenshotDisplayType'] for s in sets['data']) or '(none)', flush=True)
    if found:
        sid = found['id']
        old = api.get(f'/appScreenshotSets/{sid}/appScreenshots')['data']
        same = [o['attributes'].get('fileName') for o in old] == [p.name for p in shots] and all(
            o['attributes'].get('sourceFileChecksum') == hashlib.md5(p.read_bytes()).hexdigest() for o, p in zip(old, shots))
        if same:
            print('スクリーンショットは同じものが入っています', flush=True)
            return
        for o in old:
            api.write(f'古いスクリーンショットを外す: {o["attributes"].get("fileName")}', 'DELETE', f'/appScreenshots/{o["id"]}')
    else:
        res = api.write(f'スクリーンショット枠 {DISPLAY_TYPE} を作る', 'POST', '/appScreenshotSets',
                        {'data': {'type': 'appScreenshotSets', 'attributes': {'screenshotDisplayType': DISPLAY_TYPE},
                                  'relationships': {'appStoreVersionLocalization': rel('appStoreVersionLocalizations', loc_id)}}})
        sid = res['data']['id'] if res else '<新しい枠>'
    ids = []
    for p in shots:
        data = p.read_bytes()
        res = api.write(f'スクリーンショットを上げる: {p.name}（{len(data) // 1024} KB）', 'POST', '/appScreenshots',
                        {'data': {'type': 'appScreenshots', 'attributes': {'fileName': p.name, 'fileSize': len(data)},
                                  'relationships': {'appScreenshotSet': rel('appScreenshotSets', sid)}}})
        if not res:
            continue
        shot = res['data']
        for op in shot['attributes']['uploadOperations']:
            part = data[op['offset']:op['offset'] + op['length']]
            req = urllib.request.Request(op['url'], data=part, method=op['method'],
                                         headers={h['name']: h['value'] for h in op.get('requestHeaders') or []})
            with urllib.request.urlopen(req, timeout=300):
                pass
        api.call('PATCH', f'/appScreenshots/{shot["id"]}', body={'data': {'type': 'appScreenshots', 'id': shot['id'], 'attributes': {
            'uploaded': True, 'sourceFileChecksum': hashlib.md5(data).hexdigest()}}})
        ids.append(shot['id'])
    if ids:
        api.write('スクリーンショットの並び順', 'PATCH', f'/appScreenshotSets/{sid}/relationships/appScreenshots',
                  {'data': [{'type': 'appScreenshots', 'id': i} for i in ids]})
        deadline = time.time() + 600
        while time.time() < deadline:
            states = [api.get(f'/appScreenshots/{i}')['data']['attributes'].get('assetDeliveryState', {}).get('state') for i in ids]
            print('Screenshot processing: ' + ', '.join(map(str, states)), flush=True)
            require('FAILED' not in states, 'スクリーンショットの処理に失敗しました（App Store Connect の画面で確認）')
            if all(s == 'COMPLETE' for s in states):
                break
            time.sleep(15)


def attach_build(api, app, vid, build):
    if not build:
        print('APPSTORE_BUILD が空なのでビルドは紐付けません', flush=True)
        return
    found = api.get('/builds', {'filter[app]': app['id'], 'filter[version]': build, 'filter[preReleaseVersion.version]': VERSION,
                                'fields[builds]': 'version,processingState,expired,usesNonExemptEncryption'})['data']
    require(found, f'ビルド {build}（版 {VERSION}）が見つかりません')
    a = found[0]['attributes']
    print(f'Build {build}: {a.get("processingState")} expired={a.get("expired")} usesNonExemptEncryption={a.get("usesNonExemptEncryption")}', flush=True)
    require(a.get('processingState') == 'VALID' and not a.get('expired'), f'ビルド {build} は提出に使えません')
    if not vid.startswith('<'):
        cur = (api.get(f'/appStoreVersions/{vid}/relationships/build').get('data') or {}).get('id')
        if cur == found[0]['id']:
            print('ビルドは紐付け済みです', flush=True)
            return
    api.write(f'ビルド {build} を紐付ける', 'PATCH', f'/appStoreVersions/{vid}/relationships/build', rel('builds', found[0]['id']))


def review_detail(api, vid, notes):
    key = os.environ.get('REVIEW_LICENSE_KEY', '').strip()
    attrs = {
        'contactFirstName': os.environ.get('REVIEW_CONTACT_FIRST_NAME', '嘉皓').strip(),
        'contactLastName': os.environ.get('REVIEW_CONTACT_LAST_NAME', '川﨑').strip(),
        'contactPhone': os.environ.get('REVIEW_CONTACT_PHONE', '').strip(),
        'contactEmail': os.environ.get('REVIEW_CONTACT_EMAIL', '').strip(),
        'demoAccountRequired': True, 'demoAccountName': 'license-key', 'demoAccountPassword': key,
        'notes': notes.replace('<<REVIEW_KEY>>', key) if key else notes,
    }
    missing = [k for k in ('contactPhone', 'contactEmail', 'demoAccountPassword') if not attrs[k]]
    if missing:
        msg = '審査情報の Secrets が未設定: ' + ', '.join(missing)
        require(api.dry_run, msg)
        print('要設定: ' + msg, flush=True)
    shown = f'審査情報（連絡先・デモ用キー・メモ {len(attrs["notes"])}字）'
    if vid.startswith('<'):
        api.write(shown + 'を作る', 'POST', '/appStoreReviewDetails')
        return
    cur = api.get(f'/appStoreVersions/{vid}/appStoreReviewDetail', ok404=True)
    if cur and cur.get('data'):
        d = cur['data']
        diff = {k: v for k, v in attrs.items() if d['attributes'].get(k) != v and v != ''}
        if diff:
            api.write(shown + 'を更新: ' + ', '.join(diff), 'PATCH', f'/appStoreReviewDetails/{d["id"]}',
                      {'data': {'type': 'appStoreReviewDetails', 'id': d['id'], 'attributes': diff}})
    else:
        api.write(shown + 'を作る', 'POST', '/appStoreReviewDetails',
                  {'data': {'type': 'appStoreReviewDetails', 'attributes': {k: v for k, v in attrs.items() if v != ''},
                            'relationships': {'appStoreVersion': rel('appStoreVersions', vid)}}})


def pricing(api, app):
    sched = api.get(f'/apps/{app["id"]}/appPriceSchedule', {'include': 'manualPrices,baseTerritory'}, ok404=True)
    if sched and sched.get('data'):
        base = (sched['data'].get('relationships', {}).get('baseTerritory', {}).get('data') or {}).get('id')
        print(f'価格は設定済み（基準の地域 {base}）。変える場合は画面で確認', flush=True)
        return
    points = api.get(f'/apps/{app["id"]}/appPricePoints', {'filter[territory]': 'JPN', 'limit': 200, 'fields[appPricePoints]': 'customerPrice'})['data']
    free = next((p for p in points if float(p['attributes'].get('customerPrice') or 1) == 0), None)
    require(free, '無料の価格ポイントが見つかりません')
    api.write('価格：無料（基準の地域 日本）', 'POST', '/appPriceSchedules', {
        'data': {'type': 'appPriceSchedules', 'relationships': {
            'app': rel('apps', app['id']), 'baseTerritory': rel('territories', 'JPN'),
            'manualPrices': {'data': [{'type': 'appPrices', 'id': '${free}'}]}}},
        'included': [{'type': 'appPrices', 'id': '${free}', 'attributes': {'startDate': None},
                      'relationships': {'appPricePoint': rel('appPricePoints', free['id'])}}]})


def availability(api, app):
    cur = api.get(f'/apps/{app["id"]}/appAvailabilityV2', {'include': 'territoryAvailabilities', 'limit[territoryAvailabilities]': 50}, ok404=True)
    if not cur or not cur.get('data'):
        # Apple は全地域の列挙を求める（省くと 409）。全地域を取り、日本だけ「配信する」にして作る
        every = [t['id'] for t in api.get('/territories', {'limit': 200})['data']]
        api.write(f'配信地域：日本のみ（全{len(every)}地域を列挙）・新しい地域に自動で広げない', 'POST', '/v2/appAvailabilities', {
            'data': {'type': 'appAvailabilities', 'attributes': {'availableInNewTerritories': False},
                     'relationships': {'app': rel('apps', app['id']),
                                       'territoryAvailabilities': {'data': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}'} for t in every]}}},
            'included': [{'type': 'territoryAvailabilities', 'id': f'${{{t}}}', 'attributes': {'available': t in TERRITORIES},
                          'relationships': {'territory': rel('territories', t)}} for t in every]})
        return
    a = cur['data']['attributes']
    url, items = f'/v2/appAvailabilities/{cur["data"]["id"]}/territoryAvailabilities', []
    query = {'include': 'territory', 'limit': 200}
    while url:
        page = api.get(url, query)
        items += page['data']
        url, query = (page.get('links') or {}).get('next', '').replace(HOST, '') or None, None
    on = [t for t in items if t['attributes'].get('available')]
    terr = lambda t: (t['relationships']['territory']['data'] or {}).get('id')
    print(f'配信地域: {len(on)}/{len(items)} 地域で配信中（日本={any(terr(t) == "JPN" for t in on)}） 新地域へ自動={a.get("availableInNewTerritories")}', flush=True)
    for t in items:
        want = terr(t) in TERRITORIES
        if bool(t['attributes'].get('available')) != want:
            api.write(f'配信地域 {terr(t)} を {"配信する" if want else "配信しない"}', 'PATCH', f'/territoryAvailabilities/{t["id"]}',
                      {'data': {'type': 'territoryAvailabilities', 'id': t['id'], 'attributes': {'available': want}}})
    if a.get('availableInNewTerritories'):
        print('要手作業: 「新しい国や地域で自動的に配信」をオフにする（API で変えられない。manual-steps.md 参照）', flush=True)


def submit(api, app, vid):
    open_ = api.get(f'/apps/{app["id"]}/reviewSubmissions', {'filter[platform]': 'IOS', 'filter[state]': 'READY_FOR_REVIEW,WAITING_FOR_REVIEW,IN_REVIEW,UNRESOLVED_ISSUES'})['data']
    if any(s['attributes'].get('state') in ('WAITING_FOR_REVIEW', 'IN_REVIEW') for s in open_):
        print('すでに審査待ち／審査中です。提出しません', flush=True)
        return
    ready = next((s for s in open_ if s['attributes'].get('state') == 'READY_FOR_REVIEW'), None)
    if ready:
        sub_id = ready['id']
    else:
        res = api.write('審査の提出を用意する', 'POST', '/reviewSubmissions',
                        {'data': {'type': 'reviewSubmissions', 'attributes': {'platform': 'IOS'}, 'relationships': {'app': rel('apps', app['id'])}}})
        sub_id = res['data']['id'] if res else '<提出>'
    api.write(f'バージョン {VERSION} を提出物に入れる', 'POST', '/reviewSubmissionItems',
              {'data': {'type': 'reviewSubmissionItems', 'relationships': {
                  'reviewSubmission': rel('reviewSubmissions', sub_id), 'appStoreVersion': rel('appStoreVersions', vid)}}})
    api.write('★ 審査へ提出する', 'PATCH', f'/reviewSubmissions/{sub_id}',
              {'data': {'type': 'reviewSubmissions', 'id': sub_id, 'attributes': {'submitted': True}}})


def prepare(api, app, meta, notes, shots, build, want_submit):
    app_level(api, app)
    vid, released = version(api, app, meta)
    loc = version_localization(api, vid, meta, released)
    app_info(api, app, meta)
    screenshots(api, loc, shots)
    attach_build(api, app, vid, build)
    review_detail(api, vid, notes)
    pricing(api, app)
    availability(api, app)
    if want_submit:
        submit(api, app, vid)
    else:
        print('SUBMIT=false なので審査へは出しません', flush=True)


def release(api, app):
    vs = api.get(f'/apps/{app["id"]}/appStoreVersions', {'filter[platform]': 'IOS', 'filter[versionString]': VERSION,
                 'fields[appStoreVersions]': 'versionString,appStoreState,appVersionState'})['data']
    require(vs, f'{VERSION} が見つかりません')
    v = vs[0]
    st = v['attributes'].get('appVersionState') or v['attributes'].get('appStoreState')
    print(f'Version {VERSION}: {st}', flush=True)
    require(st == 'PENDING_DEVELOPER_RELEASE', f'{VERSION} は {st} なのでリリースできません（承認済み・手動リリース待ちのときだけ）')
    api.write(f'★ バージョン {VERSION} をリリースする', 'POST', '/appStoreVersionReleaseRequests',
              {'data': {'type': 'appStoreVersionReleaseRequests', 'relationships': {'appStoreVersion': rel('appStoreVersions', v['id'])}}})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check-only', action='store_true', help='通信せず、字数と画像だけ確かめる')
    args = ap.parse_args()
    truthy = lambda k, d: os.environ.get(k, d).strip().lower() in ('1', 'true', 'yes')
    dry_run, want_submit = truthy('APPSTORE_DRY_RUN', 'true'), truthy('APPSTORE_SUBMIT', 'false')
    want_release = truthy('APPSTORE_RELEASE', 'false')
    build = os.environ.get('APPSTORE_BUILD', '').strip()
    meta, notes = load_metadata()
    problems, warnings = [], []
    shots = check(meta, notes, problems, warnings)
    print(f'メタデータ: 名前 {len(meta["name"])}字 / サブタイトル {len(meta["subtitle"])}字 / プロモーション {len(meta["promotionalText"])}字 / '
          f'説明 {len(meta["description"])}字 / キーワード {len(meta["keywords"])}字 / 審査メモ {len(notes)}字 / 画像 {len(shots)}枚', flush=True)
    for w in warnings:
        print('注意: ' + w, flush=True)
    require(not problems, '直すところ:\n  ' + '\n  '.join(problems))
    if args.check_only:
        print('チェックのみ: 問題なし', flush=True)
        return
    if not dry_run:
        require(not warnings, '本番の書き込みには URL などの設定が必要です')
    missing = [n for n in ('ASC_PRIVATE_KEY', 'ASC_KEY_ID', 'ASC_ISSUER_ID') if not os.environ.get(n)]
    require(not missing, 'Missing secrets: ' + ', '.join(missing))
    key_text = normalize_private_key(os.environ.pop('ASC_PRIVATE_KEY'))
    secret = os.environ.get('REVIEW_LICENSE_KEY', '').strip()
    with tempfile.TemporaryDirectory(prefix='gofg-asc-', dir=os.environ.get('RUNNER_TEMP')) as folder:
        key = Path(folder) / 'key.p8'
        with key.open('x', encoding='utf-8', newline='\n') as f:
            f.write(key_text)
        key.chmod(0o600)
        del key_text
        api = Api(key, os.environ['ASC_KEY_ID'].strip(), os.environ['ASC_ISSUER_ID'].strip(), dry_run)
        print(f'=== {"DRY RUN（読むだけ）" if dry_run else "本番の書き込み"} / build={build or "なし"} / submit={want_submit} / release={want_release} ===', flush=True)
        app = find_app(api)
        if want_release:
            release(api, app)
        else:
            prepare(api, app, meta, notes, shots, build, want_submit)
    title = '書き込む予定（dry run・まだ何も変えていない）' if dry_run else '書き込んだ内容'
    lines = [mask(p, secret) for p in api.plan] or ['（変更なし）']
    print(f'\n=== {title} ===\n' + '\n'.join(lines), flush=True)
    print('\n手作業が残る項目は appstore/manual-steps.md を参照（App のプライバシー・Unlisted 申請など）', flush=True)
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'### {DISPLAY} {VERSION}: {title}\n\n```\n' + '\n'.join(lines) + '\n```\n')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        msg = str(error) if isinstance(error, ValueError) else (f'metadata の見出しが見つかりません: {error}' if isinstance(error, KeyError) else 'openssl signing failed.')
        print(mask(msg, os.environ.get('REVIEW_LICENSE_KEY', '').strip()), file=sys.stderr)
        sys.exit(1)
