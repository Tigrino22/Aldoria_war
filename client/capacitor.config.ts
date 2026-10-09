import type { CapacitorConfig } from '@capacitor/cli';

// Application iOS / Android : le client web compilé (dist/) est embarqué dans une coquille native.
// Le serveur de jeu reste en ligne ; son adresse est fixée au build par VITE_API_URL.
const config: CapacitorConfig = {
  appId: 'fr.aldoriawar.app',
  appName: 'Aldoria War',
  webDir: 'dist',
  backgroundColor: '#2b2018',
  ios: { contentInset: 'never', backgroundColor: '#2b2018' },
  android: { backgroundColor: '#2b2018' },
  plugins: {
    SplashScreen: { launchAutoHide: false, backgroundColor: '#2b2018', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#2b2018', overlaysWebView: true },
  },
};

export default config;
