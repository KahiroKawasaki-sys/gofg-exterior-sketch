import AVFoundation
import Capacitor

/// 打ち合わせの録音（iPhone／iPad）。数分ごとに区切ってファイルにし、区切りができるたびに JS へ渡す（base64）。
/// 画面ロック・他アプリへの切り替え中も録音を続ける（Info.plist の UIBackgroundModes: audio）。
/// 文字にし終えた区切りは JS から discard で消す。音声はアプリの外に保存しない。
@objc(RecorderPlugin)
final class RecorderPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioRecorderDelegate {
    let identifier = "RecorderPlugin"
    let jsName = "GofgRecorder"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
    ]

    private var recorder: AVAudioRecorder?
    private var starts: [ObjectIdentifier: (index: Int, start: Date)] = [:]
    private var timer: Timer?
    private var segmentSec: TimeInterval = 180
    private var index = 0
    private var sessionStart = Date()
    private var active = false
    private var stopCall: CAPPluginCall?
    private var observers: [NSObjectProtocol] = []

    private var folder: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("gofg-rec", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    @objc func start(_ call: CAPPluginCall) {
        segmentSec = max(30, min(600, call.getDouble("segmentSec") ?? 180))
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    return call.reject("マイクの使用が許可されていません。設定アプリでマイクを許可してください", "denied")
                }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.record, mode: .default, options: [])
                    try session.setActive(true, options: .notifyOthersOnDeactivation)
                    self.index = 0
                    self.sessionStart = Date()
                    self.active = true
                    self.observe()
                    try self.begin()
                    call.resolve()
                } catch {
                    self.active = false
                    self.unobserve()
                    call.reject("録音を始められませんでした", "failed", error)
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = false
            self.timer?.invalidate(); self.timer = nil
            self.unobserve()
            if let rec = self.recorder {
                // 最後の区切りを渡し終えてから返事する（delegate で resolve）
                self.stopCall = call
                rec.stop()
            } else {
                self.deactivate()
                call.resolve()
            }
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        if let path = call.getString("path"), path.hasPrefix(folder.path) {
            try? FileManager.default.removeItem(atPath: path)
        }
        call.resolve()
    }

    private func begin() throws {
        let url = folder.appendingPathComponent("\(Int(sessionStart.timeIntervalSince1970))-\(index).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 32000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let rec = try AVAudioRecorder(url: url, settings: settings)
        rec.delegate = self
        rec.prepareToRecord()
        guard rec.record() else { throw NSError(domain: "GofgRecorder", code: 1) }
        starts[ObjectIdentifier(rec)] = (index, Date())
        index += 1
        recorder = rec
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: segmentSec, repeats: false) { [weak self] _ in self?.rotate() }
    }

    /// 次の区切りを先に始めてから、今の区切りを閉じる（間が空かないように）
    private func rotate() {
        guard active else { return }
        let old = recorder
        do { try begin() } catch { notifyListeners("state", data: ["state": "error", "message": "録音を続けられませんでした"]); return }
        old?.stop()
    }

    func audioRecorderDidFinishRecording(_ rec: AVAudioRecorder, successfully flag: Bool) {
        emit(rec, ok: flag)
    }

    func audioRecorderEncodeErrorDidOccur(_ rec: AVAudioRecorder, error: Error?) {
        notifyListeners("state", data: ["state": "error", "message": "録音でエラーが起きました"])
        if active { rotate() }
    }

    private func emit(_ rec: AVAudioRecorder, ok: Bool) {
        let info = starts.removeValue(forKey: ObjectIdentifier(rec))
        if recorder === rec { recorder = nil }
        let url = rec.url
        if ok, let info, let data = try? Data(contentsOf: url), data.count > 0 {
            let durMs = Int(Date().timeIntervalSince(info.start) * 1000)
            notifyListeners("segment", data: [
                "i": info.index,
                "startMs": Int(info.start.timeIntervalSince(sessionStart) * 1000),
                "durMs": durMs,
                "base64": data.base64EncodedString(),
                "mime": "audio/mp4",
                "path": url.path,
            ])
        } else {
            try? FileManager.default.removeItem(at: url)
        }
        if !active, recorder == nil, let call = stopCall {
            stopCall = nil
            deactivate()
            call.resolve()
        }
    }

    private func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // 着信・Siri などで中断されたら今の区切りを閉じ、終わったら新しい区切りで再開する
    private func observe() {
        unobserve()
        let nc = NotificationCenter.default
        observers.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, self.active, let raw = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            if type == .began {
                self.timer?.invalidate()
                self.recorder?.stop()
                self.notifyListeners("state", data: ["state": "paused", "message": "着信などで録音を中断しています。終わると自動で再開します"])
            } else {
                do {
                    try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
                    try self.begin()
                    self.notifyListeners("state", data: ["state": "recording"])
                } catch {
                    self.notifyListeners("state", data: ["state": "error", "message": "録音を再開できませんでした。もう一度「録音を始める」を押してください"])
                }
            }
        })
        observers.append(nc.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] n in
            guard let self, self.active, let raw = n.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt, let reason = AVAudioSession.RouteChangeReason(rawValue: raw) else { return }
            // イヤホンの抜き差しなどでマイクが変わったら、区切りを切り替えて新しいマイクで続ける
            if reason == .oldDeviceUnavailable || reason == .newDeviceAvailable { self.rotate() }
        })
    }

    private func unobserve() {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        observers.removeAll()
    }
}
