#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(SavingsLiveActivity, NSObject)
RCT_EXTERN_METHOD(sync:(NSString *)goalId title:(NSString *)title saved:(double)saved target:(double)target)
RCT_EXTERN_METHOD(track:(NSString *)goalId title:(NSString *)title saved:(double)saved target:(double)target phase:(NSString *)phase)
RCT_EXTERN_METHOD(clear)
@end
