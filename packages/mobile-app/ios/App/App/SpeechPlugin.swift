import AVFoundation
import Capacitor
import Network
import Speech

/**
 Reconnaissance vocale pour la répétition (issue #40), côté natif.

 Plugin LOCAL au target de l'app, et non paquet npm : `cap sync` régénère
 `Package.swift` et `public/` mais ne touche jamais `project.pbxproj`, donc un
 fichier Swift ajouté au target y survit. Il est enregistré à la main dans
 `MainViewController.capacitorDidLoad()` — c'est la seule façon d'exposer un
 plugin local depuis Capacitor 6.

 Ce fichier ne décide de RIEN : quand écouter, comment juger une réplique, quand
 rejouer le modèle sont des questions tranchées en TypeScript
 (@theatre/audio-player, @theatre/voice-match). Il ouvre le micro, pousse ce qu'il
 entend, et rend la route audio telle qu'il l'a trouvée.
 */
@objc(SpeechPlugin)
public class SpeechPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SpeechPlugin"
    // DOIT correspondre à `registerPlugin('TheatreSpeech')` côté TypeScript
    // (src/voice/native.ts) : c'est tout ce qui relie les deux moitiés.
    public let jsName = "TheatreSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise)
    ]

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    /// Connectivité observée en continu : c'est elle qui décide de la bascule vers
    /// la reconnaissance embarquée. Interroger le réseau au moment du démarrage
    /// coûterait une attente pile là où l'utilisateur va parler.
    private let monitor = NWPathMonitor()
    private var online = true

    override public func load() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.online = path.status == .satisfied
        }
        monitor.start(queue: DispatchQueue(label: "fr.avolo.theatrereader.net"))
    }

    // MARK: - Permissions

    /**
     Demande les deux permissions et rend un simple oui/non.

     Nommée `authorize` et non `requestPermissions` : ce dernier nom appartient à
     `CAPPlugin`, qui promet en retour un dictionnaire d'états par alias. Le
     surcharger pour rendre un booléen serait mentir sur un contrat que d'autres
     outils lisent.
     */
    @objc func authorize(_ call: CAPPluginCall) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                call.resolve(["granted": false])
                return
            }
            self.requestMicrophone { granted in
                call.resolve(["granted": granted])
            }
        }
    }

    private func requestMicrophone(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: done)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(done)
        }
    }

    // MARK: - Écoute

    @objc func start(_ call: CAPPluginCall) {
        let locale = call.getString("locale") ?? "fr-FR"
        DispatchQueue.main.async {
            self.teardown(cancel: true) // un démarrage annule toujours l'écoute précédente
            do {
                try self.beginListening(locale: locale)
                call.resolve()
            } catch {
                self.restorePlaybackSession()
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Fin propre : le moteur a encore le droit d'émettre son dernier résultat.
    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown(cancel: false)
            call.resolve()
        }
    }

    /// Coupure immédiate : plus rien ne doit remonter (le lecteur va jouer un clip).
    @objc func abort(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown(cancel: true)
            call.resolve()
        }
    }

    private func beginListening(locale: String) throws {
        guard let engineRecognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)),
              engineRecognizer.isAvailable else {
            throw NSError(
                domain: "TheatreSpeech", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Reconnaissance vocale indisponible."]
            )
        }
        recognizer = engineRecognizer

        // Session AVANT de toucher `inputNode` : son format dépend de la route
        // active, et l'interroger trop tôt donne celui d'avant le basculement.
        try configureListeningSession()

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        // Hors ligne, la reconnaissance serveur échoue sans rien transcrire ; la
        // version embarquée est moins fine mais elle répond. En ligne, on garde la
        // serveur, nettement meilleure sur du texte de théâtre.
        req.requiresOnDeviceRecognition = !online && engineRecognizer.supportsOnDeviceRecognition
        request = req

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0) // idempotent : un tap resté en place ferait planter installTap
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            req.append(buffer)
        }

        task = engineRecognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let text = result.bestTranscription.formattedString
                // `isFinal` ne vient qu'après `endAudio()` ou un silence détecté par
                // le moteur : le TypeScript ne l'attend pas pour trancher, mais il
                // s'en sert quand il arrive avant son propre minuteur.
                self.emit(result.isFinal ? "final" : "partial", ["text": text])
            }
            if let error {
                // Une annulation volontaire (`abort`) remonte ici comme une erreur :
                // la signaler afficherait « micro indisponible » à chaque clip de
                // référence, alors que tout va bien.
                if self.task == nil { return }
                self.emit("error", ["message": error.localizedDescription])
                self.teardown(cancel: true)
            }
        }

        engine.prepare()
        try engine.start()
    }

    private func teardown(cancel: Bool) {
        if engine.isRunning {
            engine.stop()
            engine.inputNode.removeTap(onBus: 0)
        }
        // `task = nil` AVANT d'annuler : le callback de la tâche s'en sert pour
        // distinguer une vraie panne d'un arrêt demandé.
        let running = task
        task = nil
        if cancel {
            running?.cancel()
            request?.endAudio()
        } else {
            // Laisse le moteur rendre son dernier résultat, puis se terminer seul.
            request?.endAudio()
        }
        request = nil
        restorePlaybackSession()
    }

    // MARK: - Route audio

    /**
     `.playAndRecord` avec `.allowBluetooth` : c'est cette option, et elle seule, qui
     donne accès au micro des AirPods ou d'un casque — sans elle, iOS enregistre par
     le micro du téléphone même quand tout le son sort du casque.

     La contrepartie est connue : le Bluetooth passe alors en HFP, mono et sourd.
     Sans conséquence ici, puisque la lecture des clips ne tourne jamais pendant
     l'écoute, et que `restorePlaybackSession` rend la route pleine qualité.

     Le compilateur signale `.allowBluetooth` comme renommé en `.allowBluetoothHFP`.
     L'ancien nom est gardé volontairement : le nouveau n'existe que dans les SDK
     récents, et le projet ne compilerait plus avec un Xcode antérieur pour un
     symbole strictement équivalent à l'exécution.
     */
    private func configureListeningSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP]
        )
        try session.setActive(true)
    }

    /// Rend la session à la lecture. Sans ce retour, les clips joués par la WebView
    /// resteraient sur la route d'enregistrement : volume écrasé, et Bluetooth mono.
    private func restorePlaybackSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }

    private func emit(_ event: String, _ data: [String: Any]) {
        // Les callbacks de SFSpeechRecognitionTask arrivent sur une file interne ;
        // le pont, lui, parle à la WebView.
        DispatchQueue.main.async {
            self.notifyListeners(event, data: data)
        }
    }
}
