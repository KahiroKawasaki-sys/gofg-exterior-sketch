"""Run real WKWebView integration tests and preserve evidence even on failure."""
import json, os, subprocess
from pathlib import Path

def run(args, capture=False, check=True):
    return subprocess.run(args, check=check, text=True, stdout=subprocess.PIPE if capture else None)

root = Path(__file__).resolve().parent.parent
artifacts = Path(os.environ['RUNNER_TEMP']) / 'gofg-simulator-results'
artifacts.mkdir(exist_ok=True)
devices = json.loads(run(['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], True).stdout)['devices']
available = [d for runtime, entries in devices.items() if 'iOS' in runtime for d in entries if d.get('isAvailable')]
failures = []

def test_device(udid, name, method):
    result = artifacts / f'{name}.xcresult'
    tested = run(['xcodebuild', '-quiet', '-project', str(root / 'ios/App/App.xcodeproj'), '-scheme', 'App',
                  '-configuration', 'Debug', '-destination', f'platform=iOS Simulator,id={udid}',
                  '-derivedDataPath', str(Path(os.environ['RUNNER_TEMP']) / 'gofg-derived'),
                  '-resultBundlePath', str(result), 'CODE_SIGNING_ALLOWED=NO', '-parallel-testing-enabled', 'NO',
                  f'-only-testing:NativeTests/SketchIntegrationTests/{method}', 'test'], check=False)
    if result.exists():
        for report in ('summary', 'tests'):
            exported = run(['xcrun', 'xcresulttool', 'get', 'test-results', report, '--path', str(result)], True, False)
            if exported.returncode == 0:
                (artifacts / f'{name}-{report}.json').write_text(exported.stdout, encoding='utf-8')
                if report == 'summary':
                    print(exported.stdout, flush=True)
        shots = artifacts / f'{name}-screenshots'
        shots.mkdir(exist_ok=True)
        run(['xcrun', 'xcresulttool', 'export', 'attachments', '--path', str(result), '--output-path', str(shots)], check=False)
    if tested.returncode:
        failures.append(name)
    return tested.returncode == 0

for kind in ('iPad', 'iPhone'):
    choices = [d for d in available if d['name'].startswith(kind)]
    if not choices:
        failures.append(f'No available {kind} simulator')
        continue
    device = choices[0]
    udid = device['udid']
    print(f'Testing {device["name"]}', flush=True)
    if device['state'] != 'Booted':
        run(['xcrun', 'simctl', 'boot', udid])
    run(['xcrun', 'simctl', 'bootstatus', udid, '-b'])
    try:
        if test_device(udid, kind, 'testOfflineDrawingAndRoundTrip'):
            run(['xcrun', 'simctl', 'terminate', udid, 'com.kawakahi.gofgsketch'], capture=True, check=False)
            test_device(udid, f'{kind}-relaunch', 'testPersistenceAfterRelaunch')
        run(['xcrun', 'simctl', 'io', udid, 'screenshot', str(artifacts / f'{kind}-final.png')], check=False)
    finally:
        run(['xcrun', 'simctl', 'shutdown', udid], check=False)

if failures:
    raise SystemExit('Simulator checks failed: ' + ', '.join(failures))
