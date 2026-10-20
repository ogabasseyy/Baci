#import <UIKit/UIKit.h>
#import <objc/runtime.h>

// The runner inserts the installed RN methods, not a reimplementation.
@interface UIView (ComponentViewProtocol)
- (void)updateClippedSubviewsWithClipRect:(CGRect)rect relativeToView:(UIView *)view;
@end

@interface IndependentScrollView : UIView
@end
@implementation IndependentScrollView
// INSERT_SCROLL_METHOD
@end
@implementation UIView (ComponentViewProtocol)
// INSERT_FORWARDING_METHOD
@end

@interface ClippingView : UIView {
  BOOL _removeClippedSubviews;
  NSMutableArray<UIView *> *_reactSubviews;
}
@property(nonatomic, readonly) UIView *currentContainerView;
- (void)track:(UIView *)view;
@end
@implementation ClippingView
- (instancetype)initWithFrame:(CGRect)frame {
  if ((self = [super initWithFrame:frame])) {
    _removeClippedSubviews = YES;
    _reactSubviews = [NSMutableArray new];
  }
  return self;
}
- (UIView *)currentContainerView { return self; }
- (void)track:(UIView *)view { [_reactSubviews addObject:view]; [self addSubview:view]; }
// INSERT_CLIPPING_METHOD
@end

static NSUInteger conversions = 0;
static IMP originalConversion;
static CGRect countConversion(UIView *view, SEL selector, CGRect rect, UIView *target) {
  conversions++;
  return ((CGRect (*)(id, SEL, CGRect, UIView *))originalConversion)(view, selector, rect, target);
}
static NSUInteger failures = 0;
static void check(BOOL condition, const char *name) {
  printf("%s %s\n", condition ? "PASS" : "FAIL", name);
  if (!condition) failures++;
}

int main() {
  @autoreleasepool {
    Method method = class_getInstanceMethod(UIView.class, @selector(convertRect:toView:));
    originalConversion = method_setImplementation(method, (IMP)countConversion);
    UIView *root = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 200, 200)];
    UIView *parent = root;
    for (NSUInteger depth = 0; depth < 40; depth++) {
      UIView *next = [[UIView alloc] initWithFrame:CGRectMake(1, 1, 200, 200)];
      [parent addSubview:next];
      for (NSUInteger leaf = 0; leaf < 25; leaf++) {
        [next addSubview:[[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 10)]];
      }
      parent = next;
    }
    conversions = 0;
    CFTimeInterval start = CACurrentMediaTime();
    for (NSUInteger update = 0; update < 20; update++) {
      [root updateClippedSubviewsWithClipRect:root.bounds relativeToView:root];
    }
    printf("plain-tree conversions=%lu elapsed-ms=%.3f\n", (unsigned long)conversions,
           (CACurrentMediaTime() - start) * 1000);
    check(conversions == 0, "ordinary native descendants do not convert a clipping rectangle");
    check(parent.subviews.count == 25, "forwarding never removes ordinary native descendants");

    UIView *viewport = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 200, 200)];
    UIView *wrapper = [[UIView alloc] initWithFrame:CGRectMake(20, 30, 100, 100)];
    [viewport addSubview:wrapper];
    ClippingView *clipper = [[ClippingView alloc] initWithFrame:CGRectMake(10, 10, 80, 80)];
    [wrapper addSubview:clipper];
    UIView *first = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 10, 10)];
    UIView *second = [[UIView alloc] initWithFrame:CGRectMake(80, 80, 10, 10)];
    [clipper track:first]; [clipper track:second];
    conversions = 0;
    [viewport updateClippedSubviewsWithClipRect:CGRectMake(0, 0, 100, 100) relativeToView:viewport];
    check(first.superview == clipper && second.superview == nil, "translated clipping removes only offscreen children");
    check(conversions == 1, "only the clipping view converts coordinates");
    [viewport updateClippedSubviewsWithClipRect:CGRectMake(110, 110, 100, 100) relativeToView:viewport];
    check(first.superview == nil && second.superview == clipper, "scrolling remounts the newly visible child");
    [viewport updateClippedSubviewsWithClipRect:CGRectMake(0, 0, 100, 100) relativeToView:viewport];
    check(first.superview == clipper && second.superview == nil, "scrolling back restores original visibility");

    // An ordinary transformed wrapper must not lose the viewport coordinate space.
    wrapper.transform = CGAffineTransformMakeScale(2, 2);
    wrapper.center = CGPointMake(100, 100);
    first.frame = CGRectMake(0, 0, 10, 10);
    second.frame = CGRectMake(90, 90, 10, 10);
    [viewport updateClippedSubviewsWithClipRect:CGRectMake(0, 0, 200, 200) relativeToView:viewport];
    check(first.superview == clipper && second.superview == nil, "scaled wrapper preserves clipping geometry");

    // Nested clippers still receive coordinates relative to their actual parent.
    ClippingView *nested = [[ClippingView alloc] initWithFrame:CGRectMake(0, 0, 20, 20)];
    UIView *nestedVisible = [[UIView alloc] initWithFrame:CGRectMake(0, 0, 5, 5)];
    UIView *nestedHidden = [[UIView alloc] initWithFrame:CGRectMake(300, 300, 5, 5)];
    [nested track:nestedVisible]; [nested track:nestedHidden]; [clipper track:nested];
    [viewport updateClippedSubviewsWithClipRect:viewport.bounds relativeToView:viewport];
    check(nestedVisible.superview == nested && nestedHidden.superview == nil, "nested clipping remains functional");

    IndependentScrollView *scroll = [[IndependentScrollView alloc] initWithFrame:viewport.bounds];
    ClippingView *independentContent = [[ClippingView alloc] initWithFrame:viewport.bounds];
    UIView *independentChild = [[UIView alloc] initWithFrame:CGRectMake(300, 300, 5, 5)];
    [independentContent track:independentChild]; [scroll addSubview:independentContent];
    [viewport addSubview:scroll];
    [viewport updateClippedSubviewsWithClipRect:viewport.bounds relativeToView:viewport];
    check(independentChild.superview == independentContent, "nested scroll views retain control of their own viewport");

    ClippingView *unlaidOut = [[ClippingView alloc] initWithFrame:CGRectZero];
    UIView *pendingLayout = [[UIView alloc] initWithFrame:CGRectMake(300, 300, 5, 5)];
    [unlaidOut track:pendingLayout]; [viewport addSubview:unlaidOut];
    [viewport updateClippedSubviewsWithClipRect:viewport.bounds relativeToView:viewport];
    check(pendingLayout.superview == unlaidOut, "unlaid-out content is not prematurely removed");
    method_setImplementation(method, originalConversion);
  }
  return failures == 0 ? 0 : 1;
}
