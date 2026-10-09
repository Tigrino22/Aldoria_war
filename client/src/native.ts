// Intégration à l'application mobile : barre d'état, écran de démarrage, bouton retour Android, vibrations.
// Sans effet dans un navigateur.
import { App } from '@capacitor/app';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { IS_NATIVE } from './config';

export async function initNative() {
  if (!IS_NATIVE) return;
  document.documentElement.classList.add('native');
  await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
  // Bouton retour Android : revient à l'écran précédent, ou met l'app en arrière-plan.
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) history.back();
    else App.minimizeApp();
  });
  await SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => undefined);
}

/** Vibration d'alerte (attaque entrante). */
export function alertHaptic() {
  if (IS_NATIVE) Haptics.notification({ type: NotificationType.Warning }).catch(() => undefined);
}
