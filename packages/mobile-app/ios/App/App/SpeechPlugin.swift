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
        CAPPluginMethod(name: "abort", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
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

    /// La session est-elle déjà passée en `.playAndRecord` ? Cf. `configureListeningSession`.
    private var sessionOwned = false

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

    /**
     Prend la route audio d'enregistrement, sans ouvrir le micro.

     À appeler quand RIEN ne joue — au démarrage de la lecture, ou en cochant le
     réglage. Cette bascule coupe le son en cours ; la provoquer d'avance, à un
     moment où il n'y en a pas, est le seul moyen de ne jamais l'entendre.
     */
    @objc func prepare(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            do {
                try self.configureListeningSession()
                call.resolve()
            } catch {
                call.reject(error.localizedDescription)
            }
        }
    }

    /// Rend la route audio à la lecture pleine qualité. Appelée quand le mode s'arrête.
    @objc func release(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.teardown(cancel: true)
            self.restorePlaybackSession()
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
        // La session N'EST PAS rendue ici : entre deux tirades elle doit rester en
        // `.playAndRecord`, sans quoi la reprendre à l'ouverture suivante couperait
        // le clip en cours. Seul `release` la rend.
    }

    // MARK: - Route audio

    /**
     `.playAndRecord` avec `.allowBluetooth` : c'est cette option, et elle seule, qui
     donne accès au micro des AirPods ou d'un casque — sans elle, iOS enregistre par
     le micro du téléphone même quand tout le son sort du casque.

     La contrepartie est connue : le Bluetooth passe alors en HFP, mono et sourd.

     **Basculée UNE SEULE FOIS, et gardée.** Changer de catégorie coupe net ce que la
     WebView est en train de jouer : mesuré en répétition, la réplique du camarade
     s'arrêtait en plein milieu dès qu'on ouvrait le micro à l'avance. Tant que la
     bascule tombait entre deux clips, elle ne s'entendait pas ; anticiper l'ouverture
     l'a mise en plein dans le son. La session est donc prise au premier besoin et
     rendue seulement quand le mode s'arrête (`release`), jamais entre deux tirades.

     Le SDK iOS 26 a renommé l'option en `.allowBluetoothHFP` et déprécié l'ancien
     nom. Les deux valent 0x4 : le choix ci-dessous ne change rien à l'exécution, il
     évite seulement un avertissement à chaque compilation — et garde le projet
     compilable avec un Xcode antérieur, où le nouveau symbole n'existe pas.
     La version du compilateur sert de repère à celle du SDK : Xcode les livre
     ensemble, et Swift n'expose pas la seconde.
     */
    private func configureListeningSession() throws {
        if sessionOwned { return }
        let session = AVAudioSession.sharedInstance()
        #if compiler(>=6.2)
        let bluetoothInput: AVAudioSession.CategoryOptions = .allowBluetoothHFP
        #else
        let bluetoothInput: AVAudioSession.CategoryOptions = .allowBluetooth
        #endif
        try session.setCategory(
            .playAndRecord,
            mode: .default,
            options: [.defaultToSpeaker, bluetoothInput, .allowBluetoothA2DP]
        )
        try session.setActive(true)
        sessionOwned = true
    }

    /**
     Rend la session à la lecture. Sans ce retour, les clips resteraient sur la route
     d'enregistrement : volume écrasé, et Bluetooth mono.

     Appelée quand le mode vocal s'arrête, JAMAIS entre deux tirades — c'est le
     pendant de `configureListeningSession`, et la re-bascule est précisément ce qui
     coupait la lecture.
     */
    private func restorePlaybackSession() {
        guard sessionOwned else { return }
        sessionOwned = false
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
