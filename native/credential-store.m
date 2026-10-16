#import <Cocoa/Cocoa.h>
#import <Security/Security.h>
#import <LocalAuthentication/LocalAuthentication.h>
#include <sys/stat.h>
#include <unistd.h>
#include <mach/mach.h>

static void fail(void) {
    fputs("Secure credential operation unavailable.\n", stderr);
    exit(1);
}
static void store(NSDictionary *query, NSData *data) {
    if (!data.length || data.length > 4096) fail();
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query,
        (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: data});
    if (status == errSecItemNotFound) {
        NSMutableDictionary *entry = [query mutableCopy];
        entry[(__bridge id)kSecValueData] = data;
        entry[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
        entry[(__bridge id)kSecAttrLabel] = @"Pi dual OpenAI project credential";
        status = SecItemAdd((__bridge CFDictionaryRef)entry, NULL);
    }
    if (status != errSecSuccess) fail();
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) fail();
    NSString *mode = @(argv[1]);
    NSString *account = @(argv[2]);
    if ([mode isEqual:@"probe-process"]) {
        mach_port_t task = MACH_PORT_NULL;
        kern_return_t result = task_for_pid(mach_task_self(), (pid_t)account.intValue, &task);
        puts(result == KERN_SUCCESS ? "PROCESS_ACCESS_GRANTED" : "PROCESS_ACCESS_DENIED");
        if (task != MACH_PORT_NULL) mach_port_deallocate(mach_task_self(), task);
        return 0;
    }
    if ([account rangeOfString:@"^[a-f0-9]{64}$" options:NSRegularExpressionSearch].location == NSNotFound) fail();
    NSMutableDictionary *query = [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: @"com.pi-dual.openai.v1", (__bridge id)kSecAttrAccount: account} mutableCopy];
    if ([mode isEqual:@"enter"] || [mode isEqual:@"verify-entry"]) {
        BOOL fixture = [mode isEqual:@"verify-entry"];
        NSString *dummy = fixture ? [[NSString alloc] initWithData:[NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile] encoding:NSUTF8StringEncoding] : nil;
        if (fixture && ![dummy hasPrefix:@"dummy-"]) fail();
        if (!fixture && (!isatty(STDIN_FILENO) || !isatty(STDOUT_FILENO))) fail();
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        NSAlert *alert = [NSAlert new];
        alert.messageText = @"Store an OpenAI project API key";
        alert.informativeText = @"Enter the key privately. It goes directly to macOS Keychain. Close screen sharing and recording before continuing.";
        [alert addButtonWithTitle:@"Store in Keychain"];
        [alert addButtonWithTitle:@"Cancel"];
        NSSecureTextField *field = [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 420, 24)];
        alert.accessoryView = field;
        alert.window.initialFirstResponder = field;
        if (fixture) {
            if (![field isKindOfClass:NSSecureTextField.class]) fail();
            field.stringValue = dummy;
            NSTimer *timer = [NSTimer timerWithTimeInterval:0.2 repeats:NO block:^(NSTimer *timer) {
                [NSApp stopModalWithCode:NSAlertFirstButtonReturn];
                [alert.window orderOut:nil];
            }];
            [NSRunLoop.mainRunLoop addTimer:timer forMode:NSModalPanelRunLoopMode];
        }
        if (!fixture) [NSApp activateIgnoringOtherApps:YES];
        if ([alert runModal] != NSAlertFirstButtonReturn) fail();
        NSString *key = [field.stringValue stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if ((!fixture && ![key hasPrefix:@"sk-"]) || key.length < 16) fail();
        store(query, [key dataUsingEncoding:NSUTF8StringEncoding]);
        field.stringValue = @"";
        puts("Credential stored in Keychain.");
    } else if ([mode isEqual:@"load"] || [mode isEqual:@"status"]) {
        query[(__bridge id)kSecReturnData] = @YES;
        LAContext *context = [LAContext new];
        context.interactionNotAllowed = YES;
        query[(__bridge id)kSecUseAuthenticationContext] = context;
        CFTypeRef result = NULL;
        if (SecItemCopyMatching((__bridge CFDictionaryRef)query, &result) != errSecSuccess) fail();
        NSData *data = CFBridgingRelease(result);
        if (!data.length) fail();
        if ([mode isEqual:@"status"]) puts("available");
        else {
            // Internal anonymous IPC only. stdout/stderr never carry a credential.
            struct stat info;
            if (fstat(3, &info) || (!S_ISFIFO(info.st_mode) && !S_ISSOCK(info.st_mode))) fail();
            NSFileHandle *pipe = [[NSFileHandle alloc] initWithFileDescriptor:3 closeOnDealloc:YES];
            [pipe writeData:data];
        }
    } else if ([mode isEqual:@"store-fixture"]) {
        NSData *data = [NSFileHandle.fileHandleWithStandardInput readDataToEndOfFile];
        NSString *dummy = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if (![dummy hasPrefix:@"dummy-"]) fail();
        store(query, data);
        puts("stored");
    } else if ([mode isEqual:@"delete-fixture"]) {
        if (SecItemDelete((__bridge CFDictionaryRef)query) != errSecSuccess) fail();
        puts("deleted");
    } else fail();
  }
  return 0;
}
