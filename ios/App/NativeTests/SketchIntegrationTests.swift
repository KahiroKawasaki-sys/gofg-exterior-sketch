import XCTest
import UIKit
import WebKit
@testable import App

// Real WKWebView, IndexedDB, PDF renderer and Capacitor plugins in the installed app.
// Synthetic PointerEvents exercise pressure handling; actual Pencil hardware is a separate check.
@MainActor
final class SketchIntegrationTests: XCTestCase {
    var controller: SketchViewController!
    var web: WKWebView!

    override func setUpWithError() throws {
        continueAfterFailure = false
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        controller = try XCTUnwrap(windows.first(where: { $0.isKeyWindow })?.rootViewController as? SketchViewController)
        web = try XCTUnwrap(controller.webView)
        try waitJS("!!document.querySelector('.v3-home') || !!document.querySelector('.v3-stage')")
    }

    @discardableResult
    func js(_ code: String) throws -> Any? {
        let done = expectation(description: "WKWebView JavaScript")
        var result: Any?, failure: Error?
        web.evaluateJavaScript(code) { value, error in result = value; failure = error; done.fulfill() }
        wait(for: [done], timeout: 15)
        if let failure { throw failure }
        return result
    }

    func waitJS(_ expression: String, seconds: TimeInterval = 30) throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if (try js(expression) as? Bool) == true { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        snapshot("timeout")
        let visibleState = (try? js("document.body.innerText.slice(-2400)")) as? String ?? "unavailable"
        XCTFail("Timed out waiting for: \(expression); visible state: \(visibleState)")
    }

    func click(_ label: String) throws {
        let labelJSON = String(data: try JSONSerialization.data(withJSONObject: label, options: .fragmentsAllowed), encoding: .utf8)!
        try js("(() => { const label = \(labelJSON); const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim().startsWith(label)); if (!b) throw Error('Button missing: '+label); b.click(); return true; })()")
    }

    func fileInput(_ index: Int, data: Data, name: String, mime: String) throws {
        try js("(() => { const bytes = Uint8Array.from(atob('\(data.base64EncodedString())'), c => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([bytes], '\(name)', {type:'\(mime)'})); const input = document.querySelectorAll('input[type=file]')[\(index)]; input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles:true})); return true; })()")
    }

    func snapshot(_ name: String) {
        // DOM changes precede WKWebView's rendered frame; preserve the resulting screen.
        RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        guard let window = controller.view.window else { return }
        let format = UIGraphicsImageRendererFormat(); format.scale = window.screen.scale
        let image = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let attachment = XCTAttachment(image: image); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func shareFile(_ label: String, extension ext: String) throws -> Data {
        try click(label)
        let deadline = Date().addingTimeInterval(30)
        while !(controller.presentedViewController is UIActivityViewController), Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        let activity = try XCTUnwrap(controller.presentedViewController as? UIActivityViewController)
        RunLoop.current.run(until: Date().addingTimeInterval(0.6))
        snapshot("share-\(ext)")
        let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("exports")
        let iterator = try XCTUnwrap(FileManager.default.enumerator(at: directory, includingPropertiesForKeys: nil))
        let url = try XCTUnwrap(iterator.allObjects.compactMap { $0 as? URL }.first { $0.pathExtension == ext })
        let data = try Data(contentsOf: url)
        let dismissed = expectation(description: "Share sheet dismissed")
        activity.dismiss(animated: false) { dismissed.fulfill() }
        wait(for: [dismissed], timeout: 10)
        activity.completionWithItemsHandler?(nil, false, nil, nil)
        // Await this share's cleanup, rather than a toast left by the previous share.
        let cleanupDeadline = Date().addingTimeInterval(10)
        while Date() < cleanupDeadline {
            if (try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)).isEmpty { break }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        XCTAssertTrue(try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).isEmpty)
        XCTAssertNil(controller.presentedViewController)
        return data
    }


    func syntheticPenStroke() throws {
        try js("""
        (() => {
          const svg = document.querySelector('.v3-svg'); const r = svg.getBoundingClientRect();
          const original = svg.setPointerCapture; svg.setPointerCapture = () => {};
          const send = (type,x,y,p) => { const e = new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:77,pointerType:'pen',clientX:r.left+x,clientY:r.top+y,button:0,pressure:p}); e.getCoalescedEvents = () => [e]; svg.dispatchEvent(e); };
          send('pointerdown',80,100,0.1); send('pointermove',120,140,0.3); send('pointermove',180,180,0.9); send('pointerup',220,220,0.5);
          svg.setPointerCapture = original; return true;
        })()
        """)
    }

    func selectPhotoArea() throws {
        // Fill starts a fresh selection. Brush then extends that selected area.
        try click("塗りつぶし追加")
        try waitJS("[...document.querySelectorAll('.v3-pbtn.on')].some(b => b.textContent === '塗りつぶし追加')")
        try js("""
        (() => {
          const svg = document.querySelector('.v3-svg'), image = document.querySelector('.v3-stage image').getBoundingClientRect();
          const original = svg.setPointerCapture; svg.setPointerCapture = () => {};
          for (const type of ['pointerdown','pointerup']) svg.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:78,pointerType:'pen',clientX:image.left+image.width*0.3,clientY:image.top+image.height*0.5,button:0,pressure:0.5}));
          svg.setPointerCapture = original; return true;
        })()
        """)
        try waitJS("document.querySelector('.v3-toast')?.textContent.includes('選択範囲を追加') === true || document.querySelector('.v3-toast')?.textContent.includes('輪郭の内側') === true")
        try click("選択ブラシ")
        try waitJS("[...document.querySelectorAll('.v3-pbtn.on')].some(b => b.textContent === '選択ブラシ')")
        try syntheticPenStroke()
        try waitJS("document.querySelector('.v3-badge')?.textContent.startsWith('選択中') === true")
    }

    func testPersistenceAfterRelaunch() throws {
        try waitJS("!!document.querySelector('.v3-doc')")
        snapshot("home-after-process-relaunch")
        try js("(() => { const doc = [...document.querySelectorAll('.v3-doc')].find(d => d.textContent.includes('site-plan')); if (!doc) throw Error('Persisted drawing missing'); doc.click(); return true; })()")
        try waitJS("!!document.querySelector('.v3-stage')")
        let json = try shareFile("編集データを書き出す", extension: "json")
        let doc = try XCTUnwrap(JSONSerialization.jsonObject(with: json) as? [String: Any])
        let layers = try XCTUnwrap(doc["layers"] as? [[String: Any]])
        XCTAssertTrue(layers.flatMap { $0["items"] as? [[String: Any]] ?? [] }.contains { $0["type"] as? String == "stroke" })
        XCTAssertNotNil(doc["underlay"])
        snapshot("drawing-after-process-relaunch")
    }

    func testOfflineDrawingAndRoundTrip() throws {
        XCTAssertEqual(web.url?.scheme, "capacitor")
        XCTAssertEqual(web.url?.host, "localhost")
        XCTAssertFalse(web.scrollView.isScrollEnabled)
        XCTAssertFalse(web.scrollView.bounces)
        // A missing recognizer also means page pinch is disabled.
        XCTAssertFalse(web.scrollView.pinchGestureRecognizer?.isEnabled ?? false)
        XCTAssertFalse(web.allowsBackForwardNavigationGestures)
        XCTAssertFalse(controller.scribbleInteraction(UIScribbleInteraction(delegate: controller), shouldBeginAt: .zero))
        snapshot("home")

        let pdf = try Data(contentsOf: XCTUnwrap(Bundle(for: Self.self).url(forResource: "site-plan", withExtension: "pdf")))
        try fileInput(0, data: pdf, name: "site-plan.pdf", mime: "application/pdf")
        try waitJS("!!document.querySelector('.v3-stage image[href^=\"data:image\"]')")
        try click("パネル") // Close the initial object panel for a full canvas snapshot.
        try waitJS("!document.querySelector('.v3-side')")
        try click("表示を全体に合わせる")
        try waitJS("(() => { const svg = document.querySelector('.v3-svg').getBoundingClientRect(); const image = document.querySelector('.v3-stage image').getBoundingClientRect(); return image.left >= svg.left && image.right <= svg.right && image.top >= svg.top && image.bottom <= svg.bottom; })()")
        snapshot("pdf-underlay")

        let offset = web.scrollView.contentOffset
        try syntheticPenStroke()
        XCTAssertEqual(web.scrollView.contentOffset, offset)
        RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        snapshot("drawing")

        // Exercise all four editor inputs in addition to both home inputs.
        try fileInput(0, data: pdf, name: "site-plan-replaced.pdf", mime: "application/pdf")
        // The fixture has two pages; use the same page chooser as a person.
        try waitJS("!!document.querySelector('[role=dialog][aria-label=\"ページを選ぶ\"]')")
        snapshot("pdf-page-chooser")
        try click("読み込む")
        try waitJS("document.querySelector('.v3-toast')?.textContent.includes('下絵を読み込みました') === true")
        let sampleImage = UIGraphicsImageRenderer(size: CGSize(width: 64, height: 64)).image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
        }
        let photo = try XCTUnwrap(sampleImage.pngData())
        try click("AIツール")
        try waitJS("document.querySelector('.v3-phead')?.textContent.includes('AIツール') === true")
        try selectPhotoArea()
        try fileInput(1, data: photo, name: "site-photo.png", mime: "image/png")
        try waitJS("document.querySelector('.v3-side')?.textContent.includes('site-photo') === true")
        try selectPhotoArea()
        try fileInput(2, data: photo, name: "camera-shot.png", mime: "image/png")
        try waitJS("document.querySelector('.v3-side')?.textContent.includes('camera-shot') === true")
        snapshot("photo-and-camera-inputs")
        try click("設定")
        try waitJS("document.querySelector('.v3-phead')?.textContent.includes('設定') === true")
        XCTAssertTrue((try js("!document.querySelector('a[href=\"?v=2\"]')") as? Bool) == true)
        let png = try shareFile("PNG", extension: "png")
        XCTAssertEqual(Array(png.prefix(8)), [137,80,78,71,13,10,26,10])
        let exportedPDF = try shareFile("PDF A4", extension: "pdf")
        XCTAssertTrue(String(data: exportedPDF.prefix(5), encoding: .ascii) == "%PDF-")
        let json = try shareFile("編集データを書き出す", extension: "json")
        let doc = try XCTUnwrap(JSONSerialization.jsonObject(with: json) as? [String: Any])
        XCTAssertEqual(doc["schema"] as? Int, 3)
        XCTAssertEqual((doc["underlay"] as? [String: Any])?["name"] as? String, "site-plan-replaced.pdf")
        let layers = try XCTUnwrap(doc["layers"] as? [[String: Any]])
        let strokes = layers.flatMap { $0["items"] as? [[String: Any]] ?? [] }.filter { $0["type"] as? String == "stroke" }
        XCTAssertFalse(strokes.isEmpty)
        let textures = layers.flatMap { $0["items"] as? [[String: Any]] ?? [] }.filter { $0["type"] as? String == "texture" }
        XCTAssertEqual(textures.count, 2)
        let pressures = (strokes.last?["pts"] as? [[String: Any]] ?? []).compactMap { $0["p"] as? Double }
        XCTAssertTrue(pressures.contains(where: { $0 > 0.8 }))
        XCTAssertTrue(pressures.contains(where: { $0 < 0.2 }))

        // Editor has four inputs: underlay, photos, camera, JSON.
        try fileInput(3, data: json, name: "site-plan.garden3.json", mime: "application/json")
        try waitJS("document.querySelector('.v3-toast')?.textContent.includes('編集データを読み込みました') === true")
        try click("案件一覧"); try waitJS("!!document.querySelector('.v3-home')")
        // Reload the actual app entry and reconnect to the same IndexedDB.
        try js("window.__gofgReloadToken = 'before-reload'")
        controller.loadWebView()
        // The old home also has .v3-doc; wait for a fresh page before importing.
        try waitJS("!window.__gofgReloadToken && !!document.querySelector('.v3-doc')")
        snapshot("saved-after-reload")
        try fileInput(1, data: json, name: "site-plan.garden3.json", mime: "application/json")
        try waitJS("!!document.querySelector('.v3-stage')")
        try click("設定"); try waitJS("!!document.querySelector('.v3-phead')")
        snapshot("restored-json")

        // Toolbar, left rail and side panel must all remain inside the safe-area rectangle.
        let safe = controller.view.safeAreaInsets
        let ok = try js("(() => { const r = document.querySelector('.v3-top').getBoundingClientRect(); const body = document.querySelector('.v3-body').getBoundingClientRect(); return r.bottom <= innerHeight - \(safe.bottom) && body.left >= \(safe.left) - 1 && body.right <= innerWidth - \(safe.right) + 1 && body.bottom <= innerHeight - \(safe.bottom) + 1; })()")
        XCTAssertTrue(ok as? Bool == true)
    }
}
