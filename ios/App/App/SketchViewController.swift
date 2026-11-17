import Capacitor
import Security
import UIKit
import WebKit

/// ライセンスの端末ID（src/v3/license.ts の GofgDevice）。初回に UUID を作り、キーチェーンに保存する。
/// キーチェーンはアプリを入れ直しても残るので、入れ直しで「別の端末」扱いにならない。iCloud には同期しない（この端末だけ）。
/// Xcode プロジェクトにファイルを足さずに済むよう、このファイルに同居させている。
@objc(DevicePlugin)
final class DevicePlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "DevicePlugin"
    let jsName = "GofgDevice"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getId", returnType: CAPPluginReturnPromise),
    ]
    private let service = "com.kawakahi.gofgsketch.license"
    private let account = "device-id"

    @objc func getId(_ call: CAPPluginCall) {
        guard let id = stored() ?? create() else {
            return call.reject("端末IDを保存できませんでした", "keychain")
        }
        DispatchQueue.main.async {
            let device = UIDevice.current
            call.resolve(["id": id, "name": device.name, "model": device.model])
        }
    }

    private func stored() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data, let id = String(data: data, encoding: .utf8), !id.isEmpty else { return nil }
        return id
    }

    private func create() -> String? {
        let id = UUID().uuidString.lowercased()
        let attributes: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(id.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess { return id }
        // 同時に呼ばれて先に保存されていたら、そちらを使う
        return status == errSecDuplicateItem ? stored() : nil
    }
}

final class SketchViewController: CAPBridgeViewController, UIScribbleInteractionDelegate {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(SpeechPlugin())
        bridge?.registerPluginInstance(RecorderPlugin())
        bridge?.registerPluginInstance(DevicePlugin())
        configureDrawingSurface()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureDrawingSurface()
    }

    private func configureDrawingSurface() {
        guard let webView else { return }
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        let scroll = webView.scrollView
        scroll.isScrollEnabled = false
        scroll.bounces = false
        scroll.alwaysBounceHorizontal = false
        scroll.alwaysBounceVertical = false
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.pinchGestureRecognizer?.isEnabled = false
        // DOM PointerEvents still deliver both fingers to the canvas.
        disableScribble(in: webView)
    }

    private func disableScribble(in view: UIView) {
        // UIIndirectScribbleInteraction is imported as a generic class by recent SDKs.
        // Identify the public Objective-C class without depending on its delegate type.
        let indirect: AnyClass? = NSClassFromString("UIIndirectScribbleInteraction")
        for interaction in view.interactions {
            let isIndirect = indirect.map { (interaction as? NSObject)?.isKind(of: $0) == true } ?? false
            guard interaction is UIScribbleInteraction || isIndirect else { continue }
            view.removeInteraction(interaction)
        }
        if view is UITextInput || view === webView {
            view.addInteraction(UIScribbleInteraction(delegate: self))
        }
        view.subviews.forEach { disableScribble(in: $0) }
    }

    func scribbleInteraction(_ interaction: UIScribbleInteraction, shouldBeginAt location: CGPoint) -> Bool {
        false
    }
}
