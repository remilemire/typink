// Finding and pairing with the Mac.

import SwiftUI
import TypinkPadCore

struct ConnectView: View {
  @Environment(PadModel.self) private var model
  @State private var scanning = false
  @State private var manual = false
  @State private var host = ""
  @State private var port = "47321"

  var body: some View {
    NavigationStack {
      List {
        Section {
          if model.macs.isEmpty {
            HStack(spacing: 12) {
              ProgressView()
              Text("Looking for Macs running Typink on this Wi‑Fi…")
                .foregroundStyle(.secondary)
            }
          }
          ForEach(model.macs) { mac in
            Button {
              model.connect(to: mac)
            } label: {
              HStack {
                Label(mac.name, systemImage: "laptopcomputer")
                Spacer()
                if case let .connecting(name) = model.phase, name == mac.name {
                  ProgressView()
                }
              }
            }
          }
        } header: {
          Text("Macs nearby")
        } footer: {
          Text("Open Typink on your Mac, then pick it here and enter the code shown under the iPad button in its toolbar.")
        }

        if model.localNetworkDenied {
          Section {
            Label {
              Text("Typink can't see your Mac because Local Network access is off. Turn it on in Settings › Privacy & Security › Local Network.")
            } icon: {
              Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
            }
          }
        }

        Section {
          Button {
            scanning = true
          } label: {
            Label("Scan the pairing QR code", systemImage: "qrcode.viewfinder")
          }
          Button {
            manual = true
          } label: {
            Label("Enter the Mac's address", systemImage: "network")
          }
        } footer: {
          if let error = model.lastError {
            Text(error).foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("Connect to your Mac")
      .sheet(isPresented: $scanning) {
        QRScannerSheet { link in
          scanning = false
          model.connect(link: link)
        }
      }
      .alert("Mac address", isPresented: $manual) {
        TextField("MacBook-Air.local or 192.168.1.20", text: $host)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
        TextField("Port", text: $port)
          .keyboardType(.numberPad)
        Button("Connect") {
          if !host.isEmpty { model.connect(host: host, port: Int(port) ?? 47321) }
        }
        Button("Cancel", role: .cancel) {}
      } message: {
        Text("The address and port are shown in the Mac's iPad panel.")
      }
      .sheet(isPresented: pairingBinding) {
        PairingSheet()
          .environment(model)
          .interactiveDismissDisabled()
      }
    }
  }

  private var pairingBinding: Binding<Bool> {
    Binding(
      get: {
        if case .pairing = model.phase { return true }
        return false
      },
      set: { presented in
        // Only a user dismissal while still pairing cancels; connecting also closes the sheet.
        if !presented, case .pairing = model.phase { model.disconnect() }
      }
    )
  }
}

struct PairingSheet: View {
  @Environment(PadModel.self) private var model
  @State private var code = ""
  @FocusState private var focused: Bool

  var body: some View {
    VStack(spacing: 22) {
      Image(systemName: "lock.laptopcomputer")
        .font(.system(size: 44))
        .foregroundStyle(.tint)
      Text(title).font(.title2.bold())
      Text("Enter the 6-digit code shown on your Mac (click the iPad button in Typink's toolbar).")
        .multilineTextAlignment(.center)
        .foregroundStyle(.secondary)
      TextField("000000", text: $code)
        .font(.system(size: 40, weight: .semibold, design: .monospaced))
        .multilineTextAlignment(.center)
        .keyboardType(.numberPad)
        .textContentType(.oneTimeCode)
        .focused($focused)
        .frame(maxWidth: 260)
        .onChange(of: code) { _, value in
          let digits = String(value.filter(\.isNumber).prefix(6))
          if digits != value { code = digits }
          if digits.count == 6 { model.pair(code: digits) }
        }
      if let error = model.pairingError {
        Text(error).foregroundStyle(.red).multilineTextAlignment(.center)
      }
      HStack {
        Button("Cancel", role: .cancel) { model.disconnect() }
        Spacer()
        Button("Pair") { model.pair(code: code) }
          .buttonStyle(.borderedProminent)
          .disabled(code.count != 6)
      }
      .frame(maxWidth: 320)
    }
    .padding(32)
    .onAppear { focused = true }
    .onChange(of: model.pairingError) { _, error in if error != nil { code = "" } }
  }

  private var title: String {
    if case let .pairing(name) = model.phase { return "Pair with \(name)" }
    return "Pair with your Mac"
  }
}
