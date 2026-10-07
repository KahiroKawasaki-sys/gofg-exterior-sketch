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
        for interaction in view.interactions where interaction is UIScribbleInteraction || interaction is UIIndirectScribbleInteraction {
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
