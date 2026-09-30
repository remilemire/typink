// Pairing tokens, one per Mac, in the Keychain.

import Foundation
import Security

enum Keychain {
  private static let service = "app.typink.pad.pairing"

  static func token(for mac: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: mac,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func setToken(_ token: String, for mac: String) {
    removeToken(for: mac)
    let item: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: mac,
      kSecValueData as String: Data(token.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    let status = SecItemAdd(item as CFDictionary, nil)
    if status != errSecSuccess {
      // e.g. -34018 when the app isn't code-signed (unsigned Simulator builds).
      Log.keychain.error("Could not store the pairing token: \(status)")
    }
  }

  static func removeToken(for mac: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: mac,
    ]
    SecItemDelete(query as CFDictionary)
  }
}
