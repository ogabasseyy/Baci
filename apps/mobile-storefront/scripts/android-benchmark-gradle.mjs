export function createAndroidBenchmarkGradleInit(identity) {
  return `gradle.beforeProject { project ->
  if (project.name == 'app') {
    project.pluginManager.withPlugin('com.android.application') {
      project.extensions.getByName('androidComponents').finalizeDsl { androidDsl ->
        def release = androidDsl.buildTypes.getByName('release')
        ${identity.suffix ? "release.applicationIdSuffix = '.benchmark'" : ''}
        release.signingConfig = androidDsl.signingConfigs.getByName('debug')
      }
    }
    project.pluginManager.withPlugin('com.facebook.react') {
      project.extensions.getByName('react').extraPackagerArgs.addAll(['--max-workers', '2', '--reset-cache'])
    }
  }
  project.tasks.configureEach { task ->
    // Environment-only client configuration changes are not RN task inputs.
    // Rebundle benchmark JS, retaining the native compilation cache.
    if (task.name == 'createBundleReleaseJsAndAssets') task.outputs.upToDateWhen { false }
    // The SDK sets enabled=true after task registration. An onlyIf predicate
    // stays false even when that later configuration re-enables the task.
    if (task.name.toLowerCase().contains('posthog') && task.name.toLowerCase().contains('upload')) task.onlyIf { false }
  }
}
`;
}
