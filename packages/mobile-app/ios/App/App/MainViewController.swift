import Capacitor
import UIKit

/**
 Contrôleur de la WebView, sous-classé pour une seule raison : enregistrer les
 plugins LOCAUX à l'app.

 Depuis Capacitor 6, les plugins découverts automatiquement sont ceux des paquets
 npm ; un plugin vivant dans le target (ici `SpeechPlugin`) doit être donné au pont
 à la main, et `capacitorDidLoad()` est le seul moment où le pont existe déjà et où
 la WebView n'a pas encore chargé la page.

 `Main.storyboard` pointe sur cette classe : sans ça, c'est `CAPBridgeViewController`
 qui est instancié, `capacitorDidLoad()` n'est jamais appelé, et l'appel JS au
 plugin reste sans réponse — sans la moindre erreur pour l'expliquer.
 */
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(SpeechPlugin())
    }
}
