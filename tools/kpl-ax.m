// kpl-ax — read the 开盘啦 "涨停表现" table through macOS Accessibility.
// Atomic commands only; the TypeScript CLI owns the day-by-day loop.
// Build: clang -fobjc-arc -framework Foundation -framework AppKit \
//          -framework ApplicationServices -framework CoreGraphics \
//          tools/kpl-ax.m -o bin/kpl-ax
//
//   kpl-ax date              -> {"date":"2026-11-06"}
//   kpl-ax dump              -> {"date":...,"limitUp":...,"limitDown":...,"headers":[...],"rows":[...]}
//   kpl-ax press <substring> -> press the first AXButton whose desc contains <substring>
//   kpl-ax prev              -> press the "previous trading day" button
//   kpl-ax scroll            -> scroll the table down one page
//
// All output is a single JSON object on stdout; diagnostics go to stderr.
// AXPress never activates/raises the window, so the user's focus is untouched.

#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreGraphics/CoreGraphics.h>

static NSString *const kBundleId = @"com.kaipanla.www";

static id Attr(AXUIElementRef e, CFStringRef key) {
  CFTypeRef v = NULL;
  if (AXUIElementCopyAttributeValue(e, key, &v) != kAXErrorSuccess) return nil;
  return (__bridge_transfer id)v;
}

static NSString *Str(id v) {
  if ([v isKindOfClass:[NSString class]]) return v;
  return v ? [NSString stringWithFormat:@"%@", v] : @"";
}

static CGPoint PointOf(id v) {
  CGPoint p = CGPointZero;
  if (v && CFGetTypeID((__bridge CFTypeRef)v) == AXValueGetTypeID())
    AXValueGetValue((__bridge AXValueRef)v, kAXValueCGPointType, &p);
  return p;
}

static CGSize SizeOf(id v) {
  CGSize s = CGSizeZero;
  if (v && CFGetTypeID((__bridge CFTypeRef)v) == AXValueGetTypeID())
    AXValueGetValue((__bridge AXValueRef)v, kAXValueCGSizeType, &s);
  return s;
}

static void Walk(AXUIElementRef e, int depth, NSMutableArray *out) {
  if (depth > 24) return;
  NSString *role = Str(Attr(e, kAXRoleAttribute));
  NSString *desc = Str(Attr(e, kAXDescriptionAttribute));
  NSString *title = Str(Attr(e, kAXTitleAttribute));
  CGPoint p = PointOf(Attr(e, kAXPositionAttribute));
  CGSize s = SizeOf(Attr(e, kAXSizeAttribute));
  NSMutableDictionary *m = [NSMutableDictionary dictionary];
  m[@"role"] = role;
  m[@"desc"] = desc;
  m[@"title"] = title;
  m[@"x"] = @(p.x);
  m[@"y"] = @(p.y);
  m[@"w"] = @(s.width);
  m[@"h"] = @(s.height);
  m[@"__el"] = (__bridge id)e;
  [out addObject:m];
  id children = Attr(e, kAXChildrenAttribute);
  if ([children isKindOfClass:[NSArray class]]) {
    for (id c in (NSArray *)children) Walk((__bridge AXUIElementRef)c, depth + 1, out);
  }
}

static NSArray *Elements(pid_t pid) {
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  id wins = Attr(app, kAXWindowsAttribute);
  NSMutableArray *out = [NSMutableArray array];
  if ([wins isKindOfClass:[NSArray class]]) {
    for (id w in (NSArray *)wins) Walk((__bridge AXUIElementRef)w, 0, out);
  }
  return out;
}

static pid_t FindPid(void) {
  NSArray *apps = [NSRunningApplication runningApplicationsWithBundleIdentifier:kBundleId];
  return apps.count ? [apps[0] processIdentifier] : 0;
}

static void Print(id obj) {
  NSError *err = nil;
  NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:&err];
  if (!d) {
    fprintf(stderr, "json error: %s\n", [[err description] UTF8String]);
    printf("{}\n");
    return;
  }
  fwrite(d.bytes, 1, d.length, stdout);
  printf("\n");
}

static BOOL Matches(NSString *s, NSString *pattern) {
  NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:nil];
  return re && [re numberOfMatchesInString:s options:0 range:NSMakeRange(0, s.length)] > 0;
}

static NSString *CurrentDate(NSArray *els) {
  for (NSDictionary *e in els) {
    if ([e[@"role"] isEqualToString:@"AXButton"] && Matches(e[@"desc"], @"^20[0-9]{2}-[0-9]{2}-[0-9]{2}$"))
      return e[@"desc"];
  }
  return @"";
}

static NSDictionary *HeaderInfo(NSArray *els) {
  NSMutableDictionary *r = [NSMutableDictionary dictionary];
  for (NSDictionary *e in els) {
    NSString *d = e[@"desc"];
    if (Matches(d, @"^涨停 [0-9]+$")) r[@"limitUp"] = @([[d substringFromIndex:3] integerValue]);
    if (Matches(d, @"^跌停 [0-9]+$")) r[@"limitDown"] = @([[d substringFromIndex:3] integerValue]);
  }
  return r;
}

static NSArray *ColumnHeaders(NSArray *els) {
  NSArray *known = @[@"股票名称", @"涨停时间", @"涨停原因", @"封单", @"最大封单", @"主力净额",
                     @"价格", @"涨幅", @"主力买入", @"主力卖出", @"成交额", @"板块",
                     @"振幅", @"实际流通", @"实际换手"];
  NSMutableArray *found = [NSMutableArray array];
  for (NSDictionary *e in els) {
    if ([e[@"role"] isEqualToString:@"AXButton"] && [known containsObject:e[@"desc"]]
        && ![found containsObject:e[@"desc"]]) [found addObject:e[@"desc"]];
  }
  return found;
}

// Split the data-column text into the 14 values. The time field may carry a
// board label on a second line, e.g. "09:36\n3天2板".
static NSArray *SplitValues(NSString *desc) {
  NSString *flat = [desc stringByReplacingOccurrencesOfString:@"\n" withString:@" "];
  NSArray *parts = [flat componentsSeparatedByString:@", "];
  if (parts.count < 5) parts = [flat componentsSeparatedByString:@","];
  NSMutableArray *v = [NSMutableArray array];
  for (NSString *p in parts) {
    NSString *t = [p stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    [v addObject:t];
  }
  return v;
}

static NSDictionary *ParseRow(NSString *nameDesc, NSString *dataDesc, NSString *reasonDesc, CGFloat y) {
  NSMutableDictionary *r = [NSMutableDictionary dictionary];
  NSArray *nameParts = [nameDesc componentsSeparatedByString:@", "];
  if (nameParts.count < 2) nameParts = [nameDesc componentsSeparatedByString:@","];
  r[@"name"] = [nameParts[0] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
  NSMutableArray *tags = [NSMutableArray array];
  NSString *code = @"";
  for (NSUInteger i = 1; i < nameParts.count; i++) {
    NSString *p = [nameParts[i] stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if (Matches(p, @"^[0-9]{6}$")) code = p;
    else if (p.length) [tags addObject:p];
  }
  r[@"code"] = code;
  r[@"tags"] = tags;

  NSArray *v = SplitValues(dataDesc);
  r[@"values"] = v;
  for (NSString *k in @[@"time", @"seal", @"maxSeal", @"mainNet", @"price", @"change",
                        @"mainBuy", @"mainSell", @"amount", @"reason", @"amplitude",
                        @"floatCap", @"turnover", @"sector", @"boards"]) r[k] = @"";

  BOOL broken = NO;
  for (NSString *t in tags) if ([t containsString:@"破板"]) broken = YES;
  r[@"kind"] = broken ? @"broken" : @"limit";

  if (broken) {
    // Broken-board rows have no limit-up time / seal order; their layout is
    // price, change, topic, ... Keep raw values and map the unambiguous ones.
    r[@"price"] = v.count > 0 ? v[0] : @"";
    r[@"change"] = v.count > 1 ? v[1] : @"";
    r[@"reason"] = reasonDesc.length ? reasonDesc : (v.count > 2 ? v[2] : @"");
    r[@"sector"] = v.count > 0 ? v[v.count - 1] : @"";
    r[@"reasonCount"] = @0;
    r[@"y"] = @(y);
    return r;
  }

  NSArray *keys = @[@"time", @"seal", @"maxSeal", @"mainNet", @"price", @"change",
                    @"mainBuy", @"mainSell", @"amount", @"reason", @"amplitude",
                    @"floatCap", @"turnover", @"sector"];
  for (NSUInteger i = 0; i < keys.count; i++) r[keys[i]] = i < v.count ? v[i] : @"";

  // time may contain an embedded board label such as "09:36 3天2板"
  NSString *t = r[@"time"] ?: @"";
  NSRegularExpression *bre = [NSRegularExpression regularExpressionWithPattern:@"([0-9]+天[0-9]+板|[0-9]+连板)" options:0 error:nil];
  NSTextCheckingResult *bm = [bre firstMatchInString:t options:0 range:NSMakeRange(0, t.length)];
  if (bm) {
    r[@"boards"] = [t substringWithRange:bm.range];
    NSRegularExpression *tre = [NSRegularExpression regularExpressionWithPattern:@"[0-9]{1,2}:[0-9]{2}" options:0 error:nil];
    NSTextCheckingResult *tm = [tre firstMatchInString:t options:0 range:NSMakeRange(0, t.length)];
    r[@"time"] = tm ? [t substringWithRange:tm.range] : t;
  } else r[@"boards"] = @"";

  // Reason button carries the topic with its home count, e.g. "AI应用(4)"
  if (reasonDesc.length) {
    NSRegularExpression *rre = [NSRegularExpression regularExpressionWithPattern:@"^(.*)\\(([0-9]+)\\)$" options:0 error:nil];
    NSTextCheckingResult *rm = [rre firstMatchInString:reasonDesc options:0 range:NSMakeRange(0, reasonDesc.length)];
    if (rm) {
      r[@"reason"] = [reasonDesc substringWithRange:[rm rangeAtIndex:1]];
      r[@"reasonCount"] = @([[reasonDesc substringWithRange:[rm rangeAtIndex:2]] integerValue]);
    } else {
      r[@"reason"] = reasonDesc;
      r[@"reasonCount"] = @0;
    }
  } else r[@"reasonCount"] = @0;

  r[@"y"] = @(y);
  return r;
}

static NSArray *CollectRows(NSArray *els) {
  NSMutableArray *nameCells = [NSMutableArray array];
  NSMutableArray *dataCells = [NSMutableArray array];
  NSMutableArray *reasonCells = [NSMutableArray array];
  for (NSDictionary *e in els) {
    if (![e[@"role"] isEqualToString:@"AXStaticText"]) continue;
    NSString *d = e[@"desc"];
    CGFloat w = [e[@"w"] doubleValue];
    if (w > 0 && w < 120 && Matches(d, @"[0-9]{6}")) [nameCells addObject:e];
    // Limit-up rows start with a time; broken-board rows start with a price.
    // Both are the wide data column, so match on width + comma, not on content.
    else if (w >= 500 && [d containsString:@","]) [dataCells addObject:e];
  }
  for (NSDictionary *e in els) {
    if ([e[@"role"] isEqualToString:@"AXButton"] && Matches(e[@"desc"], @"\\([0-9]+\\)$")) [reasonCells addObject:e];
  }

  NSMutableArray *rows = [NSMutableArray array];
  for (NSDictionary *nc in nameCells) {
    CGFloat ny = [nc[@"y"] doubleValue];
    NSDictionary *best = nil;
    CGFloat bestDx = 1000;
    for (NSDictionary *dc in dataCells) {
      CGFloat dx = fabs([dc[@"y"] doubleValue] - ny);
      if (dx < 5 && dx < bestDx) { bestDx = dx; best = dc; }
    }
    NSString *reason = @"";
    for (NSDictionary *rc in reasonCells) {
      if (fabs([rc[@"y"] doubleValue] - ny) < 5) { reason = rc[@"desc"]; break; }
    }
    [rows addObject:ParseRow(nc[@"desc"], best ? best[@"desc"] : @"", reason, ny)];
  }
  [rows sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
    return [a[@"y"] compare:b[@"y"]];
  }];
  return rows;
}

static AXUIElementRef ScrollContainer(NSArray *els) {
  for (NSDictionary *e in els) {
    if (![e[@"role"] isEqualToString:@"AXGroup"]) continue;
    CGFloat w = [e[@"w"] doubleValue], h = [e[@"h"] doubleValue];
    if (w >= 600 && w <= 660 && h >= 650 && h <= 720) return (__bridge AXUIElementRef)e[@"__el"];
  }
  return NULL;
}

static AXUIElementRef ContainerOf(NSArray *els) { return ScrollContainer(els); }

static void ScrollToTop(pid_t pid, NSArray *els) {
  AXUIElementRef cont = ContainerOf(els);
  if (!cont) return;
  for (int i = 0; i < 14; i++) {
    if (AXUIElementPerformAction(cont, CFSTR("AXScrollUpByPage")) != kAXErrorSuccess) break;
    usleep(90000);
  }
}

static NSDictionary *DoDump(pid_t pid, BOOL autoScroll) {
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  if (autoScroll) ScrollToTop(pid, Elements(pid));
  NSArray *els = Elements(pid);
  result[@"date"] = CurrentDate(els);
  [result addEntriesFromDictionary:HeaderInfo(els)];
  result[@"headers"] = ColumnHeaders(els);

  NSInteger expected = [result[@"limitUp"] integerValue];
  NSMutableDictionary *byCode = [NSMutableDictionary dictionary];
  NSMutableArray *order = [NSMutableArray array];

  // Two passes: the second one backfills data cells that render one frame late.
  for (int pass = 0; pass < (autoScroll ? 2 : 1); pass++) {
    if (pass > 0) { ScrollToTop(pid, Elements(pid)); els = Elements(pid); }
    NSInteger stalls = 0;
    for (int page = 0; page < 40; page++) {
      NSInteger added = 0;
      for (NSDictionary *r in CollectRows(els)) {
        NSString *key = [r[@"code"] length] ? r[@"code"]
          : [NSString stringWithFormat:@"%@|%.0f", r[@"name"], [r[@"y"] doubleValue]];
        NSDictionary *prev = byCode[key];
        if (!prev) { byCode[key] = r; [order addObject:key]; added++; }
        else if ([prev[@"values"] count] == 0 && [r[@"values"] count] > 0) { byCode[key] = r; added++; }
      }
      BOOL allHaveData = YES;
      NSInteger empty = 0;
      for (NSString *k in order) if ([byCode[k][@"values"] count] == 0) { allHaveData = NO; empty++; }
      if (expected > 0 && (NSInteger)byCode.count >= expected && allHaveData) break;
      if (added == 0 && empty == 0) { stalls++; if (stalls >= 3) break; } else stalls = 0;
      if (!autoScroll) break;
      AXUIElementRef cont = ContainerOf(els);
      if (!cont) break;
      if (AXUIElementPerformAction(cont, CFSTR("AXScrollDownByPage")) != kAXErrorSuccess) break;
      usleep(320000);
      els = Elements(pid);
    }
    BOOL done = expected > 0 && (NSInteger)byCode.count >= expected;
    if (done) {
      done = YES;
      for (NSString *k in order) if ([byCode[k][@"values"] count] == 0) { done = NO; break; }
    }
    if (done) break;
  }

  NSMutableArray *all = [NSMutableArray array];
  for (NSString *k in order) [all addObject:byCode[k]];
  result[@"rows"] = all;
  result[@"rowCount"] = @(all.count);
  result[@"expected"] = @(expected);
  NSInteger empty = 0;
  for (NSDictionary *r in all) if ([r[@"values"] count] == 0) empty++;
  result[@"incomplete"] = @(empty);
  return result;
}

static NSDictionary *DoPress(pid_t pid, NSString *needle) {
  NSArray *els = Elements(pid);
  for (NSDictionary *e in els) {
    if (![e[@"role"] isEqualToString:@"AXButton"]) continue;
    if (![e[@"desc"] containsString:needle]) continue;
    AXError ae = AXUIElementPerformAction((__bridge AXUIElementRef)e[@"__el"], kAXPressAction);
    return @{@"pressed": e[@"desc"], @"pos": @[e[@"x"], e[@"y"]], @"error": @(ae), @"date": CurrentDate(els)};
  }
  return @{@"error": @(-1), @"reason": @"button not found", @"needle": needle};
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (!AXIsProcessTrusted()) Print(@{@"error": @"AXIsProcessTrusted=false"});
    pid_t pid = FindPid();
    if (!pid) { Print(@{@"error": @"app not running", @"bundle": kBundleId}); return 1; }
    NSString *cmd = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : @"date";

    if ([cmd isEqualToString:@"date"]) {
      Print(@{@"date": CurrentDate(Elements(pid)), @"pid": @(pid)});
    } else if ([cmd isEqualToString:@"dump"] || [cmd isEqualToString:@"dump-noscroll"]) {
      Print(DoDump(pid, ![cmd isEqualToString:@"dump-noscroll"]));
    } else if ([cmd isEqualToString:@"press"]) {
      if (argc < 3) { Print(@{@"error": @"usage: kpl-ax press <desc-substring>"}); return 1; }
      Print(DoPress(pid, [NSString stringWithUTF8String:argv[2]]));
    } else if ([cmd isEqualToString:@"prev"]) {
      Print(DoPress(pid, @"date last"));
    } else if ([cmd isEqualToString:@"scroll"]) {
      NSArray *els = Elements(pid);
      AXUIElementRef cont = ScrollContainer(els);
      AXError ae = cont ? AXUIElementPerformAction(cont, CFSTR("AXScrollDownByPage")) : -1;
      Print(@{@"error": @(ae), @"rows": @(CollectRows(els).count)});
    } else if ([cmd isEqualToString:@"info"]) {
      NSArray *els = Elements(pid);
      Print(@{@"pid": @(pid), @"elements": @(els.count), @"date": CurrentDate(els),
              @"header": HeaderInfo(els), @"columns": ColumnHeaders(els),
              @"rows": @(CollectRows(Elements(pid)).count)});
    } else {
      Print(@{@"error": @"unknown command", @"cmd": cmd});
      return 1;
    }
  }
  return 0;
}
