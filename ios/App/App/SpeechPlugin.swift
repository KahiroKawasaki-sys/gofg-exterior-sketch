import AVFoundation
import Capacitor
import Speech

/// 打ち合わせの会話を文字にする（iPhone／iPad本体の音声認識。WKWebViewではWeb Speech APIが安定しないため）。
/// 止めるまで聞き続け、区切りごとに認識をつなぎ直す。音声は保存しない。
@objc(SpeechPlugin)
final class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "SpeechPlugin"
    let jsName = "GofgSpeech"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var active = false
    private var lastPartial = ""

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": recognizer?.isAvailable ?? false])
    }

    @objc func start(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                return call.reject("音声認識が許可されていません。設定アプリで「音声認識」を許可してください", "denied")
            }
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        return call.reject("マイクの使用が許可されていません。設定アプリでマイクを許可してください", "denied")
                    }
                    do {
                        try self.begin()
                        call.resolve()
                    } catch {
                        self.finish()
                        call.reject("音声認識を始められませんでした", "failed", error)
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish()
            call.resolve()
        }
    }

    private func begin() throws {
        guard let recognizer, recognizer.isAvailable else {
            throw NSError(domain: "GofgSpeech", code: 1)
        }
        if active { return }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        try engine.start()
        active = true
        nextTask()
    }

    /// 1回の認識は区切り（長い無音・約1分）で終わるので、聞いている間はつなぎ直す
    private func nextTask() {
        guard active, let recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        lastPartial = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(req, result, error) }
        }
    }

    private func handle(_ req: SFSpeechAudioBufferRecognitionRequest, _ result: SFSpeechRecognitionResult?, _ error: Error?) {
        guard req === request else { return }
        if let result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                emitFinal(text)
            } else {
                lastPartial = text
                notifyListeners("partial", data: ["text": text])
            }
        }
        if error != nil || result?.isFinal == true {
            // 途中で切れたときも、聞き取れた分は残す
            if error != nil { emitFinal(lastPartial) }
            request?.endAudio()
            task = nil
            if active {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in self?.nextTask() }
            }
        }
    }

    private func emitFinal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        lastPartial = ""
        notifyListeners("partial", data: ["text": ""])
        if !trimmed.isEmpty { notifyListeners("final", data: ["text": trimmed]) }
    }

    private func finish() {
        let wasActive = active
        active = false
        if engine.isRunning { engine.stop() }
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.finish()
        if wasActive { emitFinal(lastPartial) }
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
