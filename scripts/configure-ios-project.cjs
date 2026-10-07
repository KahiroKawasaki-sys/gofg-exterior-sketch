// One-time registration of app-owned source/resources in the generated Xcode project.
const xcode = require('xcode');
const fs = require('node:fs');
const file = 'ios/App/App.xcodeproj/project.pbxproj';
const project = xcode.project(file); project.parseSync();
const app = project.getFirstTarget().uuid;
const group = project.findPBXGroupKey({ path: 'App' });
project.addSourceFile('SketchViewController.swift', { target: app }, group);
const resources = project.addPbxGroup([], 'Resources');
project.hash.project.objects.PBXGroup[project.getFirstProject().firstProject.mainGroup].children.push({ value: resources.uuid, comment: 'Resources' });
project.addResourceFile('App/PrivacyInfo.xcprivacy', { target: app }, resources.uuid);
fs.writeFileSync(file, project.writeSync(), 'utf8');

