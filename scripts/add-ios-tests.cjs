const xcode = require('xcode'), fs = require('node:fs');
const file = 'ios/App/App.xcodeproj/project.pbxproj';
const p = xcode.project(file); p.parseSync();
const app = p.getFirstTarget().uuid;
const previousDependencies = [...p.hash.project.objects.PBXNativeTarget[app].dependencies];
const target = p.addTarget('NativeTests', 'unit_test_bundle', 'NativeTests', 'com.kawakahi.gofgsketch.NativeTests');
// A hosted test depends on the app; the app must not depend on its tests.
p.hash.project.objects.PBXNativeTarget[app].dependencies = previousDependencies;
p.addTargetDependency(target.uuid, [app]);
p.addBuildPhase(['NativeTests/SketchIntegrationTests.swift'], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
p.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
p.addBuildPhase(['NativeTests/site-plan.pdf'], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
const objects = p.hash.project.objects;
const configList = objects.XCConfigurationList[target.pbxNativeTarget.buildConfigurationList];
for (const ref of configList.buildConfigurations) {
  const cfg = objects.XCBuildConfiguration[ref.value].buildSettings;
  delete cfg.INFOPLIST_FILE;
  Object.assign(cfg, { GENERATE_INFOPLIST_FILE: 'YES', SWIFT_VERSION: '5.0', IPHONEOS_DEPLOYMENT_TARGET: '17.0',
    TARGETED_DEVICE_FAMILY: '"1,2"', CODE_SIGN_STYLE: 'Automatic',
    TEST_HOST: '"$(BUILT_PRODUCTS_DIR)/App.app/$(BUNDLE_EXECUTABLE_FOLDER_PATH)/App"',
    BUNDLE_LOADER: '"$(TEST_HOST)"', PRODUCT_MODULE_NAME: 'NativeTests',
    FRAMEWORK_SEARCH_PATHS: '"$(inherited) $(BUILT_PRODUCTS_DIR)/PackageFrameworks"',
  });
}
fs.writeFileSync(file, p.writeSync(), 'utf8');
const dir='ios/App/App.xcodeproj/xcshareddata/xcschemes'; fs.mkdirSync(dir,{recursive:true});
const ref = (id, name, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${product}" BlueprintName="${name}" ReferencedContainer="container:App.xcodeproj"/>`;
fs.writeFileSync(`${dir}/App.xcscheme`, `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${ref(app,'App','App.app')}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="NO">${ref(target.uuid,'NativeTests','NativeTests.xctest')}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${ref(target.uuid,'NativeTests','NativeTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref(app,'App','App.app')}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref(app,'App','App.app')}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>`, 'utf8');
