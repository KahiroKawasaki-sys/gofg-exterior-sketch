import Capacitor
import UIKit
import WebKit

final class SketchViewController: CAPBridgeViewController, UIScribbleInteractionDelegate {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
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
        let indirect = NSClassFromString("UIIndirectScribbleInteraction")
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
