// KhartoumMap Bubblewrap APK driver — runs TwaGenerator + gradle + apksigner
// without any interactive prompts (inquirer reads keypress, fails over pipe).
//
// Inputs (env): JAVA_HOME, ANDROID_SDK_ROOT, BUBBLEWRAP_SIGN_PASSWORD
// Inputs (argv): --manifest <path-to-twa-manifest.json>
//                --target  <where to build the Android project>
//                --apk-out <where to write the signed APK>

const path = require('path');
const fs = require('fs');
const core = require('@bubblewrap/core');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

(async () => {
  // On darwin, Bubblewrap's JdkHelper.getJavaHome() appends '/Contents/Home/' to jdkPath,
  // so we set jdkPath to the parent (the .jdk bundle directory).
  // On darwin, Bubblewrap's JdkHelper.getJavaHome() appends '/Contents/Home/' to jdkPath,
  // so we set jdkPath to the parent (the .jdk bundle directory).
  const javaHomeParent = '/opt/homebrew/Cellar/openjdk@17/17.0.19/libexec/openjdk.jdk';
  const androidSdk = process.env.ANDROID_SDK_ROOT || '/Users/bashir/Library/Android/sdk';
  const targetDir = arg('--target', path.resolve(process.cwd(), 'android-twa'));
  const manifestPath = arg('--manifest', path.resolve(process.cwd(), 'twa-manifest.json'));
  const apkOut = arg('--apk-out', path.resolve(process.cwd(), 'khartoum-map.apk'));
  const keystorePath = path.join(targetDir, 'android.keystore');
  const keystorePass = process.env.BUBBLEWRAP_SIGN_PASSWORD || 'khartoum2026';

  const config = core.Config.deserialize(
    JSON.stringify({ jdkPath: javaHomeParent, androidSdkPath: androidSdk })
  );

  fs.mkdirSync(targetDir, { recursive: true });
  const twaManifest = await core.TwaManifest.fromFile(manifestPath);

  const jdk = new core.JdkHelper(process, config);
  const keyTool = new core.KeyTool(jdk);

  if (!fs.existsSync(keystorePath)) {
    console.log('[bw-driver] creating keystore at ' + keystorePath);
    await keyTool.createSigningKey({
      fullName: 'Ahmed Hassan',
      organizationalUnit: 'Apps',
      organization: 'Sudan Apps',
      country: 'SD',
      password: keystorePass,
      keypassword: keystorePass,
      alias: twaManifest.signingKey.alias || 'khartoum-map',
      path: keystorePath,
    });
  } else {
    console.log('[bw-driver] keystore already exists at ' + keystorePath);
  }

  console.log('[bw-driver] generating project in ' + targetDir);
  const generator = new core.TwaGenerator();
  await generator.createTwaProject(targetDir, twaManifest, new core.BufferedLog(new core.ConsoleLog('bw-driver')));

  console.log('[bw-driver] chmod +x gradlew');
  await fs.promises.chmod(path.join(targetDir, 'gradlew'), '755');

  console.log('[bw-driver] starting gradle assembleRelease (this can take a while)');
  const gradle = new core.GradleWrapper(process, await core.AndroidSdkTools.create(process, config, jdk));
  await gradle.assembleRelease();

  const unsignedApk = path.join(targetDir, 'app/build/outputs/apk/release/app-release-unsigned.apk');
  const alignedApk = path.join(targetDir, 'app-release-unsigned-aligned.apk');
  fs.copyFileSync(unsignedApk, alignedApk);

  const sdk = new core.AndroidSdkTools(process, config, jdk);
  await sdk.apksigner(keystorePath, keystorePass, twaManifest.signingKey.alias, keystorePass, alignedApk, apkOut);
  console.log('[bw-driver] signed APK written to ' + apkOut + ' (' + fs.statSync(apkOut).size.toLocaleString() + ' bytes)');

  const crypto = require('crypto');
  const hash = crypto.createHash('sha1').update(fs.readFileSync(manifestPath)).digest('hex');
  const checksumFile = path.join(targetDir, 'manifest-checksum.txt');
  fs.writeFileSync(checksumFile, hash);
  console.log('[bw-driver] manifest checksum written (' + hash + ')');
})().catch((err) => {
  console.error('bw-driver failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
