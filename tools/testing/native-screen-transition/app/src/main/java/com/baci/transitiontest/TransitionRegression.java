package com.baci.transitiontest;

import android.app.Instrumentation;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

/** Exercises real RecyclerView recycling with the installed screens traversal. */
public final class TransitionRegression extends Instrumentation {
  @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
  @Override public void onStart() {
    Bundle result = new Bundle();
    try {
      Throwable[] mainFailure = new Throwable[1];
      runOnMainSync(() -> {
        try {
          testRecyclerBoundary();
          testOrdinaryTransitions();
          testRecyclerOwnedTransition();
        } catch (Throwable error) {
          mainFailure[0] = error;
        }
      });
      if (mainFailure[0] != null) throw mainFailure[0];
      result.putString("tests", "3 native regression cases passed");
      finish(-1, result);
    } catch (Throwable error) {
      result.putString("failure", error.toString());
      finish(0, result);
    }
  }
  private void testRecyclerBoundary() {
    FrameLayout screen = new FrameLayout(getTargetContext());
    FrameLayout wrapper = new FrameLayout(getTargetContext());
    RecyclerView recycler = new RecyclerView(getTargetContext());
    CapturingLayout layout = new CapturingLayout();
    recycler.setLayoutManager(layout);
    recycler.setItemAnimator(null);
    recycler.setAdapter(new RecyclerView.Adapter<Holder>() {
      @Override public Holder onCreateViewHolder(ViewGroup parent, int type) {
        FrameLayout page = new FrameLayout(parent.getContext());
        page.setLayoutParams(new RecyclerView.LayoutParams(100, 100));
        return new Holder(page);
      }
      @Override public void onBindViewHolder(Holder holder, int position) {}
      @Override public int getItemCount() { return 6; }
    });
    screen.addView(wrapper); wrapper.addView(recycler);
    recycler.measure(View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY));
    recycler.layout(0, 0, 100, 100);
    if (layout.getChildCount() == 0 || layout.recycler == null) throw new AssertionError("No page laid out");
    View page = layout.getChildAt(0);
    ScreenTransition transition = new ScreenTransition(getTargetContext());
    transition.begin(screen);
    // During a fling LinearLayoutManager takes this same remove/recycle path.
    // Without the patch, this throws isScrap:false isAttached:true.
    layout.removeAndRecycleViewAt(0, layout.recycler);
    if (page.getParent() != null) throw new AssertionError("Removed page remains attached");
    transition.end(screen);
    // End traversal must not corrupt subsequent attachment and recycling.
    recycler.requestLayout(); recycler.layout(0, 0, 100, 100);
  }
  private void testOrdinaryTransitions() {
    FrameLayout screen = new FrameLayout(getTargetContext());
    FrameLayout wrapper = new FrameLayout(getTargetContext());
    View child = new View(getTargetContext());
    screen.addView(wrapper); wrapper.addView(child);
    ScreenTransition transition = new ScreenTransition(getTargetContext());
    transition.begin(screen);
    wrapper.removeView(child);
    if (child.getParent() != wrapper) throw new AssertionError("Ordinary exit transition lost drawing child");
    // Removed children are no longer in children iteration: Android's parent
    // finishes their transition, just as ScreenStack finishes retained views.
    wrapper.endViewTransition(child);
    transition.end(screen);
    if (child.getParent() != null) throw new AssertionError("Ordinary transition did not finish");
    wrapper.addView(child);
    transition.begin(screen); transition.end(screen);
    wrapper.removeView(child);
    if (child.getParent() != null) throw new AssertionError("End traversal left a child transitioning");
  }
  private void testRecyclerOwnedTransition() {
    FrameLayout screen = new FrameLayout(getTargetContext());
    RecyclerView recycler = new RecyclerView(getTargetContext());
    recycler.setLayoutManager(new LinearLayoutManager(getTargetContext()));
    View child = new View(getTargetContext());
    screen.addView(recycler); recycler.addView(child);
    ScreenTransition transition = new ScreenTransition(getTargetContext());
    transition.begin(screen);
    recycler.startViewTransition(child);
    transition.end(screen);
    recycler.removeView(child);
    if (child.getParent() != recycler) throw new AssertionError("Screen cleanup ended RecyclerView-owned transition");
    recycler.endViewTransition(child);
    if (child.getParent() != null) throw new AssertionError("RecyclerView-owned cleanup failed");
  }
  private final class CapturingLayout extends LinearLayoutManager {
    RecyclerView.Recycler recycler;
    CapturingLayout() { super(getTargetContext(), HORIZONTAL, false); }
    @Override public void onLayoutChildren(RecyclerView.Recycler value, RecyclerView.State state) {
      recycler = value;
      super.onLayoutChildren(value, state);
    }
  }
  private static final class Holder extends RecyclerView.ViewHolder {
    Holder(View view) { super(view); }
  }
}
