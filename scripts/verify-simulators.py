"""Choose installed iPad/iPhone simulators and run real WKWebView integration tests."""
import json, os, subprocess
from pathlib import Path

def run(args, capture=False):
    return subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE if capture else None)

root=Path(__file__).resolve().parent.parent
artifacts=Path(os.environ['RUNNER_TEMP'])/'gofg-simulator-results'
artifacts.mkdir(exist_ok=True)
devices=json.loads(run(['xcrun','simctl','list','devices','available','--json'],True).stdout)['devices']
available=[d for runtime, entries in devices.items() if 'iOS' in runtime for d in entries if d.get('isAvailable')]
for kind in ('iPad','iPhone'):
    choices=[d for d in available if d['name'].startswith(kind)]
    if not choices:
        raise SystemExit(f'No available {kind} simulator')
    device=choices[0]; udid=device['udid']
    print(f'Testing {device["name"]}',flush=True)
    if device['state'] != 'Booted':
        run(['xcrun','simctl','boot',udid])
    run(['xcrun','simctl','bootstatus',udid,'-b'])
    result=artifacts/f'{kind}.xcresult'
    run(['xcodebuild','-quiet','-project',str(root/'ios/App/App.xcodeproj'),'-scheme','App',
         '-configuration','Debug','-destination',f'platform=iOS Simulator,id={udid}',
         '-derivedDataPath',str(Path(os.environ['RUNNER_TEMP'])/'gofg-derived'),
         '-resultBundlePath',str(result),'CODE_SIGNING_ALLOWED=NO','-parallel-testing-enabled','NO','-only-testing:NativeTests/SketchIntegrationTests/testOfflineDrawingAndRoundTrip','test'])
    subprocess.run(['xcrun','simctl','terminate',udid,'com.kawakahi.gofgsketch'],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    relaunch=artifacts/f'{kind}-relaunch.xcresult'
    run(['xcodebuild','-quiet','-project',str(root/'ios/App/App.xcodeproj'),'-scheme','App',
         '-configuration','Debug','-destination',f'platform=iOS Simulator,id={udid}',
         '-derivedDataPath',str(Path(os.environ['RUNNER_TEMP'])/'gofg-derived'),
         '-resultBundlePath',str(relaunch),'CODE_SIGNING_ALLOWED=NO','-parallel-testing-enabled','NO',
         '-only-testing:NativeTests/SketchIntegrationTests/testPersistenceAfterRelaunch','test'])
    # XCTest attachments retain full-resolution home/canvas/share-sheet screenshots.
    shots=artifacts/f'{kind}-screenshots';shots.mkdir(exist_ok=True)
    run(['xcrun','xcresulttool','export','attachments','--path',str(result),'--output-path',str(shots)])
    run(['xcrun','xcresulttool','export','attachments','--path',str(relaunch),'--output-path',str(shots)])
    run(['xcrun','simctl','io',udid,'screenshot',str(artifacts/f'{kind}-final.png')])
    run(['xcrun','simctl','shutdown',udid])
