package com.baci.transitiontest;

import android.app.Instrumentation;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

/** Exercises actual native traversal, RecyclerView scrolling, and retained pages. */
public final class TransitionRegression extends Instrumentation {
  @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      Throwable[] mainFailure = new Throwable[1];
      runOnMainSync(() -> {
        try {
          testScrollingAndRetainedPage();
          testOrdinaryTransitions();
          testCancellationAndDetachedRecycler();
          testPreviouslySuppressedRecycler();
        } catch (Throwable error) { mainFailure[0] = error; }
      });
      if (mainFailure[0] != null) throw mainFailure[0];
      result.putString("tests", "4 native regression cases passed");
      finish(-1, result);
    } catch (Throwable error) {
      result.putString("failure", error.toString());
      finish(0, result);
    }
  }
  private void testScrollingAndRetainedPage() {
    Fixture f = new Fixture();
    View page = f.layout.getChildAt(0);
    f.screen.startRemovalTransition();
    // Same scroll/fill/remove/recycle path as a ViewFlinger tick. Before the
    // fix this throws isScrap:false isAttached:true during the exit animation.
    f.recycler.scrollBy(100, 0);
    if (!f.recycler.isLayoutSuppressed()) throw new AssertionError("Recycler layout still runs during exit");
    if (f.layout.getChildAt(0) != page) throw new AssertionError("Exit animation changed the visible page");
    // Fabric removes descendants while the screen is still drawing its exit.
    f.layout.removeView(page);
    if (page.getParent() != f.recycler) throw new AssertionError("Exit page disappeared before animation end");
    Bitmap frame = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888);
    f.recycler.draw(new Canvas(frame));
    if (frame.getPixel(50, 50) != Color.RED) throw new AssertionError("Exit page stopped drawing before animation end");
    frame.recycle();
    f.screen.endRemovalTransition();
    if (page.getParent() != null) throw new AssertionError("Removed page transition did not finish");
    if (f.recycler.isLayoutSuppressed()) throw new AssertionError("Recycler did not resume");
    f.layout.recycler.recycleView(page);
    f.recycler.requestLayout(); f.recycler.layout(0, 0, 100, 100);
    f.recycler.scrollBy(100, 0);
  }
  private void testOrdinaryTransitions() {
    ScreenTransition screen = new ScreenTransition(getTargetContext());
    FrameLayout wrapper = new FrameLayout(getTargetContext());
    View child = new View(getTargetContext());
    screen.addView(wrapper); wrapper.addView(child);
    screen.startRemovalTransition(); wrapper.removeView(child);
    if (child.getParent() != wrapper) throw new AssertionError("Ordinary exit child disappeared");
    screen.endRemovalTransition();
    if (child.getParent() != null) throw new AssertionError("Detached descendant transition leaked");
    wrapper.addView(child);
    screen.startRemovalTransition(); screen.endRemovalTransition();
    wrapper.removeView(child);
    if (child.getParent() != null) throw new AssertionError("Later transition leaked");
  }
  private void testCancellationAndDetachedRecycler() {
    Fixture f = new Fixture();
    f.screen.startRemovalTransition();
    if (!f.recycler.isLayoutSuppressed()) throw new AssertionError("Suppression not acquired");
    f.screen.removeView(f.recycler);
    // Exercise the actual Screen.onDetachedFromWindow cancellation fallback.
    f.screen.cancel();
    if (f.recycler.isLayoutSuppressed()) throw new AssertionError("Detached recycler stayed suppressed after cancellation");
    if (f.recycler.getParent() != null) throw new AssertionError("Detached recycler transition leaked");
    f.screen.endRemovalTransition(); // Completion after cancellation is safe.
    f.screen.addView(f.recycler);
    f.screen.startRemovalTransition(); f.screen.endRemovalTransition();
    if (f.recycler.isLayoutSuppressed()) throw new AssertionError("Revisited screen stayed suppressed");
  }
  private void testPreviouslySuppressedRecycler() {
    Fixture f = new Fixture();
    f.recycler.suppressLayout(true);
    f.screen.startRemovalTransition(); f.screen.cancel();
    if (!f.recycler.isLayoutSuppressed()) throw new AssertionError("Cleared another owner suppression");
    f.recycler.suppressLayout(false);
  }
  private final class Fixture {
    final ScreenTransition screen = new ScreenTransition(getTargetContext());
    final RecyclerView recycler = new RecyclerView(getTargetContext());
    final CapturingLayout layout = new CapturingLayout();
    Fixture() {
      recycler.setLayoutManager(layout); recycler.setItemAnimator(null);
      recycler.setAdapter(new RecyclerView.Adapter<Holder>() {
        @Override public Holder onCreateViewHolder(ViewGroup parent, int type) {
          FrameLayout page = new FrameLayout(parent.getContext());
          page.setBackgroundColor(Color.RED);
          page.setLayoutParams(new RecyclerView.LayoutParams(100, 100));
          return new Holder(page);
        }
        @Override public void onBindViewHolder(Holder holder, int position) {}
        @Override public int getItemCount() { return 6; }
      });
      screen.addView(recycler);
      recycler.measure(View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY));
      recycler.layout(0, 0, 100, 100);
      if (layout.getChildCount() == 0 || layout.recycler == null) throw new AssertionError("No page laid out");
    }
  }
  private final class CapturingLayout extends LinearLayoutManager {
    RecyclerView.Recycler recycler;
    CapturingLayout() { super(getTargetContext(), HORIZONTAL, false); }
    @Override public void onLayoutChildren(RecyclerView.Recycler value, RecyclerView.State state) {
      recycler = value; super.onLayoutChildren(value, state);
    }
  }
  private static final class Holder extends RecyclerView.ViewHolder {
    Holder(View view) { super(view); }
  }
}
