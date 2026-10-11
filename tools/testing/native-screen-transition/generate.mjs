import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const root = dirname(require.resolve('react-native-screens/package.json'));
const source = readFileSync(
  resolve(root, 'android/src/main/java/com/swmansion/rnscreens/Screen.kt'),
  'utf8'
);
function method(name) {
  const start = source.indexOf(`    private fun ${name}(`);
  if (start < 0) throw new Error(`Missing native method: ${name}`);
  const opening = source.indexOf('{', start);
  let depth = 1;
  let end = opening + 1;
  while (depth && end < source.length) {
    if (source[end] === '{') depth++;
    if (source[end] === '}') depth--;
    end++;
  }
  if (depth) throw new Error(`Incomplete native method: ${name}`);
  return source.slice(start, end);
}
// Compile the installed library's actual traversal, not a JS reimplementation.
const output = `package com.baci.transitiontest
import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.core.view.children
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
// Unrelated header type is stubbed; the tests exercise ordinary views/recyclers.
class ScreenStackHeaderConfig(context: Context): FrameLayout(context) {
    val toolbar = FrameLayout(context)
}
class ScreenTransition(private val context: Context) {
    fun begin(parent: ViewGroup) = startTransitionRecursive(parent)
    fun end(parent: ViewGroup) = endTransitionRecursive(parent)
${method('startTransitionRecursive')}
${method('endTransitionRecursive')}
}
`;
writeFileSync(
  resolve(
    here,
    'app/src/main/java/com/baci/transitiontest/ScreenTransition.kt'
  ),
  output
);
console.log('Generated native traversal from installed react-native-screens');
