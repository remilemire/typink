// Unified logging (Console.app, sysdiagnose), since print() goes nowhere in a release build.

import os

enum Log {
  static let hub = Logger(subsystem: "app.typink.pad", category: "hub")
  static let keychain = Logger(subsystem: "app.typink.pad", category: "keychain")
}
