# Native screen transition regression

This small Android harness compiles the actual removal-transition methods, ownership fields, detachment cleanup, and the actual coordinator `clearAnimation()` method extracted from the installed `react-native-screens/Screen.kt`. Only the unrelated screen-header type is stubbed. It tests Android drawing, attachment, and **real RecyclerView scrolling and recycling**.

The RecyclerView case starts removal of a horizontal six-page recycler, then scrolls it. Unpatched screens 4.26.2 throws `IllegalArgumentException: Scrapped or attached views may not be recycled` with `isScrap:false isAttached:true`. The patch pauses scroll/layout, retains a Fabric-removed page until animation completion, and verifies its red pixels still draw to an Android Canvas. Cleanup detaches the page and permits recycling again. Other cases cover removed ordinary descendants, animation cancellation while the screen remains attached, terminal detachment with a removed recycler, repeated transitions, and preserving another owner's existing layout suppression.

Prerequisites: repository pnpm install, Java 17+, Gradle 9.4.1, Android SDK 36 and the repository Android 16 QA emulator. The debug harness is a separate app and contains no production configuration or credentials.

From the repository root:

```sh
export ANDROID_HOME=/path/to/android-sdk
node tools/testing/native-screen-transition/generate.mjs
gradle -p tools/testing/native-screen-transition :app:assembleDebug --no-daemon --console=plain
pnpm --filter baci-mobile-admin android:emulator
BACI_ANDROID_APK_PATH="$PWD/tools/testing/native-screen-transition/app/build/outputs/apk/debug/app-debug.apk" pnpm --filter @baci/mobile-storefront android:install
"$ANDROID_HOME/platform-tools/adb" -s emulator-5554 shell am instrument -w com.baci.transitiontest/com.baci.transitiontest.TransitionRegression
```

Success requires `tests=5 native regression cases passed` and `INSTRUMENTATION_CODE: -1`; adb exit status alone does not prove success. Source generation fails if the installed native methods cannot be found. An optional source-file argument lets the generator compile an inspected unpatched Screen.kt for the failing baseline. Generated Kotlin and build outputs are ignored. The harness tests the extracted transition code and RecyclerView lifecycle, not the complete React Native screen stack, device gestures, or a signed storefront release.

The pnpm patch follows [react-native-screens PR 4755](https://github.com/software-mansion/react-native-screens/pull/4755), preserving visible pages while pausing layout. It additionally records affected views so Fabric removal cannot hide them from cleanup, restores only suppression acquired by this transition, ends removal when the coordinator clears an interrupted animation, and cleans up on terminal screen detachment. It applies to both Expo apps consuming screens 4.26.2.
