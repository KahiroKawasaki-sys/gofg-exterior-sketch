"""Wait for an uploaded build and add it to every internal TestFlight group."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from distribute import BUNDLE, REQUIRED, normalize_private_key, require

API = 'https://api.appstoreconnect.apple.com/v1'

def b64url(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def der_to_raw(der):
    # openssl returns an ECDSA DER sequence; JWT ES256 needs fixed-width r||s.
    require(der[0] == 0x30, 'Unexpected signature format')
    pos = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7f)
    parts = []
    for _ in range(2):
        require(der[pos] == 0x02, 'Unexpected signature format')
        size = der[pos + 1]
        parts.append(der[pos + 2:pos + 2 + size].lstrip(b'\x00').rjust(32, b'\x00'))
        pos += 2 + size
    return b''.join(parts)

def make_token(key_path, key_id, issuer):
    now = int(time.time())
    header = b64url(json.dumps({'alg': 'ES256', 'kid': key_id, 'typ': 'JWT'}).encode())
    payload = b64url(json.dumps({'iss': issuer, 'iat': now, 'exp': now + 1100,
                                 'aud': 'appstoreconnect-v1'}).encode())
    signing_input = f'{header}.{payload}'.encode()
    der = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(key_path)], input=signing_input,
                         stdout=subprocess.PIPE, check=True).stdout
    return f'{header}.{payload}.{b64url(der_to_raw(der))}'

class Client:
    def __init__(self, key_path, key_id, issuer):
        self.args = (key_path, key_id, issuer)
        self.token, self.issued = None, 0

    def call(self, method, path, query=None, body=None):
        if time.time() - self.issued > 900:
            self.token, self.issued = make_token(*self.args), time.time()
        url = API + path + ('?' + urllib.parse.urlencode(query) if query else '')
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                text = res.read()
        except urllib.error.HTTPError as error:
            raise ValueError(f'App Store Connect API {method} {path} failed: HTTP {error.code} '
                             f'{error.read().decode(errors="replace")[:500]}') from None
        return json.loads(text) if text else {}

def main():
    missing = [name for name in REQUIRED[:3] if not os.environ.get(name)]
    require(not missing, 'Missing secrets: ' + ', '.join(missing))
    build = os.environ.get('GOFG_BUILD', '').strip()
    require(build != '', 'GOFG_BUILD is required')
    key_text = normalize_private_key(os.environ.pop('ASC_PRIVATE_KEY'))
    key_id, issuer = os.environ['ASC_KEY_ID'].strip(), os.environ['ASC_ISSUER_ID'].strip()
    with tempfile.TemporaryDirectory(prefix='gofg-asc-', dir=os.environ.get('RUNNER_TEMP')) as folder:
        key = Path(folder)/'key.p8'
        with key.open('x', encoding='utf-8', newline='\n') as f:
            f.write(key_text)
        key.chmod(0o600)
        del key_text
        api = Client(key, key_id, issuer)
        apps = api.call('GET', '/apps', {'filter[bundleId]': BUNDLE})['data']
        require(len(apps) == 1, 'App not found in App Store Connect')
        app_id = apps[0]['id']
        deadline = time.time() + 45 * 60
        while True:
            found = api.call('GET', '/builds', {'filter[app]': app_id, 'filter[version]': build,
                                                'fields[builds]': 'version,processingState'})['data']
            state = found[0]['attributes']['processingState'] if found else 'NOT_YET_VISIBLE'
            print(f'Build {build}: {state}', flush=True)
            if state == 'VALID':
                break
            require(state in ('NOT_YET_VISIBLE', 'PROCESSING'), f'Build processing ended as {state}')
            require(time.time() < deadline, 'Timed out waiting for Apple processing')
            time.sleep(60)
        build_id = found[0]['id']
        groups = api.call('GET', f'/apps/{app_id}/betaGroups', {'fields[betaGroups]': 'name,isInternalGroup'})['data']
        internal = [g for g in groups if g['attributes'].get('isInternalGroup')]
        require(internal, 'No internal TestFlight group found')
        for group in internal:
            api.call('POST', f'/betaGroups/{group["id"]}/relationships/builds',
                     body={'data': [{'type': 'builds', 'id': build_id}]})
            print(f'Added build {build} to TestFlight group: {group["attributes"]["name"]}', flush=True)
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'外構スケッチ build {build}: added to {len(internal)} internal TestFlight group(s).\n')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(str(error) if isinstance(error, ValueError) else 'openssl signing failed.', file=sys.stderr)
        sys.exit(1)
