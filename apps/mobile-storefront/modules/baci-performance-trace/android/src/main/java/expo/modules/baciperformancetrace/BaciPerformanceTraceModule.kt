package expo.modules.baciperformancetrace

import android.os.Build
import android.os.Trace
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger

class BaciPerformanceTraceModule : Module() {
  private val nextCookie = AtomicInteger(1)

  override fun definition() = ModuleDefinition {
    Name("BaciPerformanceTrace")

    Function("beginAsyncSection") { name: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !Trace.isEnabled()) {
        return@Function null
      }

      val cookie = nextCookie.getAndIncrement()
      Trace.beginAsyncSection(name, cookie)
      cookie
    }

    Function("endAsyncSection") { name: String, cookie: Int ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        Trace.endAsyncSection(name, cookie)
      }
    }
  }
}
