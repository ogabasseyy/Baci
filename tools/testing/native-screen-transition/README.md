# Native screen transition regression

This small Android harness compiles the actual `startTransitionRecursive` and `endTransitionRecursive` methods extracted from the installed `react-native-screens/Screen.kt`. Only the unrelated screen-header type is stubbed. It tests Android attachment and **real RecyclerView recycling**, rather than JavaScript mocks or a reimplementation of the fix.

The RecyclerView case nests a horizontal, six-page recycler under a screen wrapper, starts the screen removal traversal, then removes and recycles a page. Unpatched screens 4.26.2 throws `IllegalArgumentException: Scrapped or attached views may not be recycled` with `isScrap:false isAttached:true`. The patched traversal recycles successfully. The ordinary-view case verifies exit drawing retention and symmetric transition cleanup. A third case verifies screen cleanup does not end RecyclerView-owned child transitions.

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

Success requires `tests=3 native regression cases passed` and `INSTRUMENTATION_CODE: -1`; adb exit status alone does not prove success. Source generation fails if the installed native methods cannot be found. Generated Kotlin and build outputs are ignored. The harness tests the extracted transition code and RecyclerView lifecycle, not the complete React Native screen stack, device gestures, or a signed storefront release.

The pnpm patch backports the transition boundary from [react-native-screens PR 4555](https://github.com/software-mansion/react-native-screens/pull/4555). It applies to both Expo apps consuming screens 4.26.2. Treat RecyclerView as one transitioning unit and leave its child attach/detach lifecycle to RecyclerView. Preserve start/end symmetry; do not suppress the exception.
