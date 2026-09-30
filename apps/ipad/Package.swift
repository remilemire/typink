// swift-tools-version: 6.0
// The iPad app's platform-independent logic (protocol, ink conversion, clustering).
// The app itself is an Xcode project generated from project.yml.
import PackageDescription

let package = Package(
  name: "TypinkPadCore",
  platforms: [.iOS(.v18), .macOS(.v14)],
  products: [
    .library(name: "TypinkPadCore", targets: ["TypinkPadCore"]),
    .executable(name: "core-checks", targets: ["CoreChecks"]),
  ],
  targets: [
    .target(name: "TypinkPadCore"),
    // `swift run core-checks` runs the core checks without XCTest (Command Line Tools only).
    .executableTarget(name: "CoreChecks", dependencies: ["TypinkPadCore"]),
    .testTarget(name: "TypinkPadCoreTests", dependencies: ["TypinkPadCore"]),
  ]
)
