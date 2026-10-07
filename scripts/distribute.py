"""Manual distribution on a disposable GitHub-hosted macOS runner."""
import base64
import binascii
import datetime as dt
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import textwrap

BUNDLE = 'com.kawakahi.gofgsketch'
REQUIRED = ('ASC_PRIVATE_KEY', 'ASC_KEY_ID', 'ASC_ISSUER_ID', 'APPLE_TEAM_ID')

def require(condition, message):
    if not condition:
        raise ValueError(message)

def normalize_private_key(text):
    # Reconstruct only transport formatting; OpenSSL validates the actual private key before Apple access.
    text = text.strip().lstrip("\ufeff").strip().replace("\r\n", "\n")
    begin, end = "-----BEGIN PRIVATE KEY-----", "-----END PRIVATE KEY-----"
    if text.startswith(begin) and text.endswith(end):
        body = text[len(begin):-len(end)]
    else:
        body = text
    compact = "".join(body.split())
    try:
        der = base64.b64decode(compact, validate=True)
    except (binascii.Error, ValueError):
        raise ValueError("ASC_PRIVATE_KEY is neither a PEM private key nor a base64 key body. "
                         "No contents logged. Copy the downloaded .p8 file text, not setup instructions.") from None
    require(der.startswith(b"\x30") and len(der) > 2, "ASC_PRIVATE_KEY is not DER key data; no contents logged.")
    return begin + "\n" + textwrap.fill(compact, 64) + "\n" + end + "\n"



def check_distribution(info, signed, profile, team, build, now):
    require(info.get('CFBundleIdentifier') == BUNDLE, 'Unexpected bundle ID')
    require(info.get('CFBundleVersion') == build, 'Build number mismatch')
    require(info.get('DTPlatformName') == 'iphoneos', 'Not an iPhone build')
    require(set(info.get('UIDeviceFamily', [])) == {1, 2}, 'Universal iPad/iPhone support missing')
    require(float(info.get('MinimumOSVersion', '0')) >= 17, 'iOS 17 deployment target missing')
    require(info.get('UIRequiresFullScreen') is not True, 'iPad multitasking must stay available')
    for purpose in ('NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription'):
        require(bool(info.get(purpose, '').strip()), 'Permission purpose string missing')
    require(profile.get('ExpirationDate', dt.datetime.min) > now, 'Expired profile')
    require(team in profile.get('TeamIdentifier', []), 'Profile team mismatch')
    require(not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices'), 'Not an App Store profile')
    for ent in (signed, profile.get('Entitlements', {})):
        require(ent.get('application-identifier') == f'{team}.{BUNDLE}', 'Application identifier mismatch')
        require(ent.get('com.apple.developer.team-identifier') == team, 'Signing team mismatch')
        require(ent.get('get-task-allow') is not True, 'Debug entitlement present')

def run(args, *, cwd=None, capture=False):
    return subprocess.run([str(x) for x in args], cwd=cwd, check=True,
                          stdout=subprocess.PIPE if capture else None, stdin=subprocess.DEVNULL)

def check_setup():
    missing = [name for name in REQUIRED if not os.environ.get(name)]
    require(not missing, 'Signing setup incomplete. Register GitHub Actions secrets: ' + ', '.join(missing))
    print('All four signing secrets are present. Values are not displayed.')

def main():
    check_setup()
    if '--check-setup' in sys.argv:
        return
    require(sys.platform == 'darwin' and os.environ.get('GITHUB_ACTIONS') == 'true', 'Use the manual workflow on a disposable GitHub-hosted Mac')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Only main is supported')
    key_text = normalize_private_key(os.environ.pop('ASC_PRIVATE_KEY'))
    key_id, issuer, team = [os.environ[name].strip() for name in REQUIRED[1:]]
    require(re.fullmatch(r'[A-Z0-9]{10}', key_id) is not None, 'Invalid key ID')
    require(re.fullmatch(r'[A-Z0-9]{10}', team) is not None, 'Invalid team ID')
    require(re.fullmatch(r'[0-9a-fA-F-]{36}', issuer) is not None, 'Invalid issuer ID')
    upload = os.environ.get('GOFG_UPLOAD', 'false')
    require(upload in ('true', 'false'), 'Invalid upload selection')
    sequence, attempt = os.environ['GITHUB_RUN_NUMBER'], os.environ['GITHUB_RUN_ATTEMPT']
    require(sequence.isdecimal() and attempt.isdecimal(), 'Invalid build sequence')
    build = f'1.{sequence}.{attempt}'
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='gofg-sign-', dir=os.environ['RUNNER_TEMP']) as folder:
        work = Path(folder)
        keys = work/'private_keys'
        keys.mkdir(mode=0o700)
        key = keys/f'AuthKey_{key_id}.p8'
        with key.open('x', encoding='utf-8', newline='\n') as f:
            f.write(key_text)
        key.chmod(0o600)
        del key_text
        run(['openssl', 'pkey', '-in', key, '-check', '-noout', '-passin', 'pass:'], capture=True)
        auth = ['-allowProvisioningUpdates', '-authenticationKeyPath', key,
                '-authenticationKeyID', key_id, '-authenticationKeyIssuerID', issuer]
        archive, exported = work/'App.xcarchive', work/'export'
        print('Building and signing 外構スケッチ.', flush=True)
        run(['xcodebuild', '-quiet', '-project', root/'ios/App/App.xcodeproj', '-scheme', 'App',
             '-configuration', 'Release', '-destination', 'generic/platform=iOS',
             '-archivePath', archive, '-derivedDataPath', work/'DerivedData',
             f'DEVELOPMENT_TEAM={team}', f'CURRENT_PROJECT_VERSION={build}',
             'CODE_SIGNING_ALLOWED=NO', 'archive'], cwd=root)
        app = archive/'Products/Applications/App.app'
        entitlements = work/'App.entitlements'
        entitlements.write_bytes(plistlib.dumps({'application-identifier': f'{team}.{BUNDLE}',
                                                'com.apple.developer.team-identifier': team, 'get-task-allow': False}))
        # Sign bundled SPM frameworks before the containing app, if any.
        for framework in sorted((app/'Frameworks').glob('*.framework')):
            run(['codesign', '--force', '--sign', '-', framework])
        run(['codesign', '--force', '--sign', '-', '--entitlements', entitlements, app])
        archive_info_path = archive/'Info.plist'
        archive_info = plistlib.loads(archive_info_path.read_bytes())
        archive_info['ApplicationProperties'].update({'Team': team, 'SigningIdentity': '-'})
        archive_info_path.write_bytes(plistlib.dumps(archive_info))
        options = work/'ExportOptions.plist'
        options.write_bytes(plistlib.dumps({'method': 'app-store-connect', 'destination': 'export', 'teamID': team,
            'signingStyle': 'automatic', 'manageAppVersionAndBuildNumber': False,
            'uploadSymbols': True, 'testFlightInternalTestingOnly': True}))
        run(['xcodebuild', '-quiet', '-exportArchive', '-archivePath', archive,
             '-exportOptionsPlist', options, '-exportPath', exported, *auth])
        ipas = list(exported.glob('*.ipa'))
        require(len(ipas) == 1, 'Expected exactly one IPA')
        unpacked = work/'verified'
        run(['ditto', '-x', '-k', ipas[0], unpacked])
        app = unpacked/'Payload/App.app'
        run(['codesign', '--verify', '--deep', '--strict', app])
        info = plistlib.loads((app/'Info.plist').read_bytes())
        signed = plistlib.loads(run(['codesign', '-d', '--entitlements', ':-', app], capture=True).stdout)
        profile = plistlib.loads(run(['security', 'cms', '-D', '-i', app/'embedded.mobileprovision'], capture=True).stdout)
        check_distribution(info, signed, profile, team, build, dt.datetime.now(dt.UTC).replace(tzinfo=None))
        require((app/'PrivacyInfo.xcprivacy').is_file(), 'Privacy manifest missing')
        require((app/'public/index.html').is_file(), 'Bundled app entry missing')
        print('Signature, App Store profile, permissions and Universal support verified.', flush=True)
        if upload == 'true':
            # altool reads its private key from this temporary directory, never from an argument.
            common = ['-f', ipas[0], '-t', 'ios', '--apiKey', key_id, '--apiIssuer', issuer]
            run(['xcrun', 'altool', '--validate-app', *common], cwd=work)
            run(['xcrun', 'altool', '--upload-app', *common], cwd=work)
            print('Upload command succeeded. Apple processing and TestFlight availability need confirmation.')
        else:
            print('Verified only; no upload. IPA and signing credentials are not retained as artifacts.')
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a', encoding='utf-8') as f:
            f.write(f'外構スケッチ build {build}: distribution checks passed. Upload requested: {upload}.\n')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, subprocess.CalledProcessError) as error:
        print(str(error) if isinstance(error, ValueError) else 'Apple tool failed; inspect its preceding diagnostic.', file=sys.stderr)
        sys.exit(1)
