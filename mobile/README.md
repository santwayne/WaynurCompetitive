# Waynur Competitive — Android app (students)

A Capacitor shell that opens https://competitive.waynur.com/app. All screens
come from the live website, so a website deploy updates the app too; a new
APK is only needed when this folder changes (name, icon, permissions).

Full steps (build, sign, share, Play Store, App Links) are in the handover doc.
Short version, on a computer with Android Studio:

```bash
cd mobile
npm install
npx cap sync android
cd android && ./gradlew assembleDebug        # test APK: app/build/outputs/apk/debug/app-debug.apk
cp keystore.properties.example keystore.properties   # fill it in first
./gradlew assembleRelease                    # signed APK: app/build/outputs/apk/release/app-release.apk
./gradlew bundleRelease                      # Play Store bundle: app/build/outputs/bundle/release/app-release.aab
```
