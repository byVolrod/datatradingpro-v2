/* ═══ DataTradingPro — coquille native ═══════════════════════════════════════════════════════
   Le desk n'est PAS réécrit : cette app l'affiche. C'est un choix mesuré — le desk fait 56 000
   lignes de JS et 21 000 de CSS, avec 934 appels DOM directs et 131 appels amCharts, dont RIEN ne
   s'exécute en React Native. Le réécrire serait fabriquer un second produit à maintenir en double.

   ⚠️ ET C'EST CE QUI REND LA MISE À JOUR SIMULTANÉE GRATUITE. Chaque déploiement du desk est en
   ligne sur les deux apps INSTANTANÉMENT — pas d'OTA à déclencher, pas de revue de store, pas de
   version à faire adopter. EAS Update ne sert plus qu'à ce fichier-ci, qui bouge rarement.

   ⚠️ LE VRAI RISQUE EST LA RÈGLE 4.2 D'APPLE : une app qui n'est qu'un site emballé se fait
   refuser. Ce qui la fait passer, ce ne sont pas des artifices de présentation, ce sont des
   capacités que le web n'a pas sur iPhone. Les trois d'en dessous sont là POUR ÇA, et les retirer
   pour « simplifier » remettrait le refus :
     · les notifications push — une alerte de marché écran verrouillé, la raison d'être de l'app ;
     · le déverrouillage biométrique, avec la session gardée dans le trousseau du système ;
     · le mode hors-ligne, qui montre l'état du desk au lieu d'un écran blanc.  */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Linking, Platform, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import NetInfo from '@react-native-community/netinfo';

const DESK = (Constants.expoConfig?.extra?.deskUrl) || 'https://desk.datatradingpro.com';
const OR = '#e3b23a';
const FOND = '#0c0c0e';
const CLE_VERROU = 'dtp_verrou_biometrique';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/* Le jeton de notification est remis AU DESK, pas gardé ici : c'est le serveur qui décide quelles
   alertes partent à qui. On ne demande la permission qu'une fois le desk chargé — la demander à
   l'ouverture, avant que l'utilisateur ait vu quoi que ce soit, la fait refuser une fois sur deux. */
async function jetonPush() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('alertes', {
        name: 'Alertes de marché', importance: Notifications.AndroidImportance.HIGH,
        lightColor: OR, vibrationPattern: [0, 250, 250, 250],
      });
    }
    const { status: actuel } = await Notifications.getPermissionsAsync();
    let statut = actuel;
    if (actuel !== 'granted') statut = (await Notifications.requestPermissionsAsync()).status;
    if (statut !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const t = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return t?.data || null;
  } catch { return null; }
}

export default function App() {
  const web = useRef(null);
  const [pret, setPret] = useState(false);
  const [enLigne, setEnLigne] = useState(true);
  const [deverrouille, setDeverrouille] = useState(true);
  const [essai, setEssai] = useState(0);          // change l'URL de rechargement, force un vrai retry
  const peutReculer = useRef(false);

  /* Le bouton RETOUR d'Android doit reculer DANS le desk, pas fermer l'app : sans ça, un client qui
     ouvre un rapport et fait « retour » se retrouve hors de l'application. */
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (peutReculer.current && web.current) { web.current.goBack(); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => NetInfo.addEventListener(s => setEnLigne(!!s.isConnected)), []);

  /* VERROU BIOMÉTRIQUE : posé seulement si le client l'a activé ET si l'appareil sait le faire.
     Il se redemande quand l'app revient au premier plan — un desk laissé ouvert dans le
     sélecteur d'applications ne doit pas être lisible par qui prend le téléphone. */
  const demanderVerrou = useCallback(async () => {
    try {
      if ((await SecureStore.getItemAsync(CLE_VERROU)) !== '1') return;
      if (!(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) return;
      setDeverrouille(false);
      const r = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Déverrouiller DataTradingPro', cancelLabel: 'Annuler', disableDeviceFallback: false,
      });
      setDeverrouille(!!r.success);
    } catch { setDeverrouille(true); }
  }, []);

  useEffect(() => {
    demanderVerrou();
    const sub = AppState.addEventListener('change', e => { if (e === 'active') demanderVerrou(); });
    return () => sub.remove();
  }, [demanderVerrou]);

  /* Le desk parle à la coquille par postMessage. Trois ordres seulement, et tout le reste est
     ignoré : une coquille qui exécute ce que la page lui dit n'est plus une frontière. */
  const surMessage = useCallback(async (e) => {
    let m; try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (!m || typeof m.type !== 'string') return;
    if (m.type === 'dtp:push') {
      const jeton = await jetonPush();
      if (jeton) web.current?.injectJavaScript(
        `window.dispatchEvent(new CustomEvent('dtp:pushtoken',{detail:${JSON.stringify(jeton)}}));true;`);
      return;
    }
    if (m.type === 'dtp:verrou') { await SecureStore.setItemAsync(CLE_VERROU, m.actif ? '1' : '0'); return; }
    if (m.type === 'dtp:ouvrir' && typeof m.url === 'string' && /^https:\/\//.test(m.url)) { Linking.openURL(m.url); }
  }, []);

  /* CE QUI RESTE DANS LA COQUILLE ET CE QUI PART AU NAVIGATEUR. Tout ce qui n'est pas le desk
     s'ouvre DEHORS : un paiement Whop, un lien d'article, une politique de confidentialité. Garder
     un tunnel de paiement tiers dans la WebView est à la fois un risque de refus et une mauvaise
     idée de sécurité. */
  const filtrer = useCallback((req) => {
    const u = req.url || '';
    if (u.startsWith('about:') || u.startsWith('data:')) return true;
    try {
      const h = new URL(u).hostname;
      if (h === new URL(DESK).hostname || h.endsWith('.datatradingpro.com')) return true;
    } catch { return false; }
    Linking.openURL(u).catch(() => {});
    return false;
  }, []);

  if (!deverrouille) {
    return (
      <SafeAreaProvider><StatusBar barStyle="light-content" backgroundColor={FOND} />
        <View style={s.centre}>
          <Text style={s.titre}>DataTradingPro</Text>
          <Text style={s.aide}>Déverrouillage requis</Text>
          <Pressable style={s.bouton} onPress={demanderVerrou}><Text style={s.boutonTxt}>Déverrouiller</Text></Pressable>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={FOND} />
      <SafeAreaView style={s.plein} edges={['top', 'bottom']}>
        {!enLigne && (
          <View style={s.horsligne}>
            <Text style={s.horsligneTxt}>Hors ligne — les dernières données affichées datent de votre dernière connexion.</Text>
          </View>
        )}
        <WebView
          key={essai}
          ref={web}
          source={{ uri: DESK }}
          style={s.plein}
          /* Le desk garde sa session : sans cookies tiers ni stockage partagé, on redemanderait un
             mot de passe à chaque ouverture. */
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          /* Le desk gère lui-même son cache (service worker) : la WebView ne doit pas en poser un
             second par-dessus, sinon deux caches se contredisent et le plus vieux gagne. */
          cacheEnabled
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          decelerationRate="normal"
          /* La page est notre produit, pas un contenu tiers : on ne laisse pas le système
             redimensionner le texte, la densité du HUD en dépend. */
          textZoom={100}
          onShouldStartLoadWithRequest={filtrer}
          onNavigationStateChange={n => { peutReculer.current = !!n.canGoBack; }}
          onMessage={surMessage}
          onLoadEnd={() => setPret(true)}
          renderError={() => (
            <View style={s.centre}>
              <Text style={s.titre}>Desk injoignable</Text>
              <Text style={s.aide}>Vérifiez votre connexion, puis réessayez.</Text>
              <Pressable style={s.bouton} onPress={() => { setPret(false); setEssai(n => n + 1); }}>
                <Text style={s.boutonTxt}>Réessayer</Text>
              </Pressable>
            </View>
          )}
        />
        {!pret && (
          <View style={s.chargement} pointerEvents="none">
            <ActivityIndicator size="large" color={OR} />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  plein: { flex: 1, backgroundColor: FOND },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: FOND, padding: 28 },
  chargement: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: FOND },
  titre: { color: OR, fontSize: 20, fontWeight: '700', marginBottom: 8 },
  aide: { color: '#9aa0aa', fontSize: 14, textAlign: 'center', marginBottom: 22, lineHeight: 20 },
  /* 48 dp : le seuil tactile d'Android, et au-dessus des 44 pt d'Apple. Ici rien ne l'empêche —
     contrairement à la barre du desk, où les icônes ne sont espacées que de 36 pt. */
  bouton: { minHeight: 48, minWidth: 180, paddingHorizontal: 26, alignItems: 'center', justifyContent: 'center', borderRadius: 6, backgroundColor: OR },
  boutonTxt: { color: '#141414', fontSize: 15, fontWeight: '700' },
  horsligne: { backgroundColor: '#2a2419', borderBottomWidth: 1, borderBottomColor: '#3d3421', paddingVertical: 8, paddingHorizontal: 14 },
  horsligneTxt: { color: OR, fontSize: 12, textAlign: 'center' },
});
