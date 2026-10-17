import datetime as dt
import unittest
from distribute import BUNDLE, EDITIONS, check_distribution, normalize_private_key

class DistributionTests(unittest.TestCase):
    def fixture(self):
        team = 'TESTTEAM01'
        ent = {'application-identifier': f'{team}.{BUNDLE}', 'com.apple.developer.team-identifier': team, 'get-task-allow': False}
        info = {'CFBundleIdentifier': BUNDLE, 'CFBundleVersion': '1.2.1', 'DTPlatformName': 'iphoneos',
                'UIDeviceFamily': [1, 2], 'MinimumOSVersion': '17.0', 'CFBundleDisplayName': '外構スケッチ'}
        for name in ('NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription',
                     'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription'):
            info[name] = '利用目的'
        profile = {'Entitlements': dict(ent), 'TeamIdentifier': [team], 'ExpirationDate': dt.datetime(2099, 1, 1)}
        return info, ent, profile, team, '1.2.1', dt.datetime(2026, 10, 7)

    def test_valid_app_store_ipa(self):
        check_distribution(*self.fixture())

    def test_reject_wrong_app(self):
        args = list(self.fixture()); args[0]['CFBundleIdentifier'] = 'com.other.app'
        with self.assertRaisesRegex(ValueError, 'bundle ID'):
            check_distribution(*args)

    def test_pro_edition_is_a_separate_app(self):
        bundle, display = EDITIONS['pro']
        info, ent, profile, team, build, now = self.fixture()
        info.update(CFBundleIdentifier=bundle, CFBundleDisplayName=display)
        ent['application-identifier'] = f'{team}.{bundle}'; profile['Entitlements'] = dict(ent)
        check_distribution(info, ent, profile, team, build, now, bundle, display)
        with self.assertRaisesRegex(ValueError, 'bundle ID'):
            check_distribution(*self.fixture()[:6], bundle, display)

    def test_reject_wrong_app_name(self):
        args = list(self.fixture()); args[0]['CFBundleDisplayName'] = '外構スケッチ Pro'
        with self.assertRaisesRegex(ValueError, 'app name'):
            check_distribution(*args)

    def test_reject_development_profile(self):
        args = list(self.fixture()); args[2]['ProvisionedDevices'] = ['test-device']
        with self.assertRaisesRegex(ValueError, 'App Store'):
            check_distribution(*args)

    def test_reject_debug_signature(self):
        args = list(self.fixture()); args[1]['get-task-allow'] = True
        with self.assertRaisesRegex(ValueError, 'Debug'):
            check_distribution(*args)

    def test_reject_expired_profile(self):
        args = list(self.fixture()); args[2]['ExpirationDate'] = dt.datetime(2000, 1, 1)
        with self.assertRaisesRegex(ValueError, 'Expired'):
            check_distribution(*args)

    def test_reject_missing_permissions_and_non_universal(self):
        for field in ('NSCameraUsageDescription', 'UIDeviceFamily'):
            args = list(self.fixture()); args[0].pop(field)
            with self.assertRaises(ValueError):
                check_distribution(*args)

    def test_reject_invalid_private_key_without_logging_contents(self):
        with self.assertRaisesRegex(ValueError, 'No contents logged'):
            normalize_private_key('not-key-data')

if __name__ == '__main__':
    unittest.main()
