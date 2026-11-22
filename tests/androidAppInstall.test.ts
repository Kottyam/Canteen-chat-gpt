import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAY_STORE_URL, PREFER_PLAY_STORE, APK_DOWNLOAD_HREF, androidAppInstallOffer } from '../utils/androidAppInstall.ts';

test('website currently offers the APK; Play Store URL is kept for a later switch', () => {
  assert.equal(PLAY_STORE_URL, 'https://play.google.com/store/apps/details?id=com.gocanteen.app');
  assert.equal(PREFER_PLAY_STORE, false);
  assert.equal(APK_DOWNLOAD_HREF, '/GoCanteen.apk');
  assert.equal(androidAppInstallOffer.href, APK_DOWNLOAD_HREF);
  assert.equal(androidAppInstallOffer.label, 'Download Android app');
  assert.equal(androidAppInstallOffer.download, 'GoCanteen.apk');
  assert.equal(androidAppInstallOffer.newTab, false);
});
