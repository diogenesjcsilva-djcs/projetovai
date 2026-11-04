import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import { createRide, estimateRide, getRide, logout, requestOtp, verifyOtp, type Ride } from './src/api';
import { readSession, type Session } from './src/session';

const INDIGO = '#4F46E5';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('+55');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [ride, setRide] = useState<Ride | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    readSession().then(setSession).finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!session || !ride || ['completed', 'cancelled', 'no_driver_found'].includes(ride.status)) return;
    const timer = setInterval(() => {
      getRide(ride.id).then(setRide).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [session, ride?.id, ride?.status]);

  async function handleRequestCode() {
    if (!/^\\+[1-9][0-9]{7,14}$/.test(phone.trim())) {
      Alert.alert('Telefone inválido', 'Informe o telefone com código do país, por exemplo +5581999999999.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await requestOtp(phone.trim());
      setCodeRequested(true);
      setDevelopmentCode(result.developmentCode ?? null);
      setNotice(result.message);
    } catch (error) {
      Alert.alert('Não foi possível solicitar o código', error instanceof Error ? error.message : 'Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyCode() {
    if (!/^[0-9]{6}$/.test(code)) {
      Alert.alert('Código inválido', 'Informe os seis números recebidos.');
      return;
    }
    setBusy(true);
    try {
      const nextSession = await verifyOtp(phone.trim(), code);
      setSession(nextSession);
      setCode('');
      setNotice('');
    } catch (error) {
      Alert.alert('Falha na autenticação', error instanceof Error ? error.message : 'Verifique o código e tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  async function resolveAddress(address: string): Promise<Location.LocationGeocodedLocation> {
    const scopedAddress = /paulista/i.test(address) ? address : address + ', Paulista, PE, Brasil';
    const matches = await Location.geocodeAsync(scopedAddress);
    if (!matches.length) throw new Error('Não encontramos o endereço: ' + address);
    return matches[0];
  }

  async function handleUseCurrentLocation() {
    setBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        throw new Error('Permita o acesso à localização para usar sua posição como embarque.');
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync(position.coords);
      const place = places[0];
      if (!place) throw new Error('Não foi possível identificar seu endereço atual.');
      const label = [
        place.street,
        place.streetNumber,
        place.district,
        place.city,
        place.region,
      ].filter(Boolean).join(', ');
      if (!label) throw new Error('Não foi possível identificar seu endereço atual.');
      setPickupAddress(label);
    } catch (error) {
      Alert.alert('Localização indisponível', error instanceof Error ? error.message : 'Tente informar o endereço manualmente.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestRide() {
    if (!pickupAddress.trim() || !destinationAddress.trim()) {
      Alert.alert('Preencha os endereços', 'Informe o local de embarque e o destino.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const [pickup, destination] = await Promise.all([
        resolveAddress(pickupAddress.trim()),
        resolveAddress(destinationAddress.trim()),
      ]);
      const pickupCoordinate = { latitude: pickup.latitude, longitude: pickup.longitude };
      const destinationCoordinate = { latitude: destination.latitude, longitude: destination.longitude };
      const estimate = await estimateRide(pickupCoordinate, destinationCoordinate);
      if (!estimate.fareAvailable || !estimate.fare) {
        setNotice(estimate.message ?? 'A estimativa de tarifa ainda não está disponível nesta cidade. A solicitação permanece bloqueada para evitar uma corrida sem preço informado.');
        return;
      }
      const created = await createRide(
        pickupCoordinate,
        destinationCoordinate,
        pickupAddress.trim(),
        destinationAddress.trim(),
      );
      setRide(created);
      setNotice('Solicitação enviada. Estamos aguardando um motorista.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Não foi possível solicitar a corrida.');
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    setBusy(true);
    try {
      await logout();
    } catch {
      // Local credentials are cleared even when the API is temporarily unavailable.
    } finally {
      setSession(null);
      setRide(null);
      setCodeRequested(false);
      setDevelopmentCode(null);
      setBusy(false);
    }
  }

  if (booting) {
    return <View style={styles.center}><ActivityIndicator size="large" color={INDIGO} /></View>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <View style={styles.logo}><Text style={styles.logoText}>V</Text></View>
            <View>
              <Text style={styles.brand}>ProjetoVai</Text>
              <Text style={styles.brandSub}>Sua viagem começa aqui</Text>
            </View>
          </View>

          {!session ? (
            <View style={styles.card}>
              <Text style={styles.heading}>Entrar como passageiro</Text>
              <Text style={styles.description}>Use seu telefone para acessar o ProjetoVai.</Text>
              <Text style={styles.label}>Telefone com DDI</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder="+5581999999999"
              />
              {codeRequested && (
                <>
                  <Text style={styles.label}>Código de acesso</Text>
                  <TextInput
                    style={styles.input}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="000000"
                  />
                  {developmentCode && (
                    <Text style={styles.devCode}>Código de homologação: {developmentCode}</Text>
                  )}
                </>
              )}
              {!!notice && <Text style={styles.notice}>{notice}</Text>}
              <ActionButton
                title={codeRequested ? 'Validar código' : 'Enviar código'}
                onPress={codeRequested ? handleVerifyCode : handleRequestCode}
                disabled={busy}
              />
              {codeRequested && (
                <Pressable onPress={handleRequestCode} style={styles.linkButton}>
                  <Text style={styles.link}>Enviar outro código</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.welcomeRow}>
                <View style={styles.flex}>
                  <Text style={styles.heading}>Olá{session.user.displayName ? ', ' + session.user.displayName : ''}!</Text>
                  <Text style={styles.description}>Para onde vamos hoje?</Text>
                </View>
                <Pressable onPress={handleLogout}><Text style={styles.link}>Sair</Text></Pressable>
              </View>
              <Text style={styles.label}>Local de embarque</Text>
              <TextInput
                style={styles.input}
                value={pickupAddress}
                onChangeText={setPickupAddress}
                placeholder="Rua, número, bairro, Paulista - PE"
              />
              <Pressable onPress={handleUseCurrentLocation} disabled={busy} style={styles.locationButton}>
                <Text style={styles.link}>Usar minha localização atual</Text>
              </Pressable>
              <Text style={styles.label}>Destino</Text>
              <TextInput
                style={styles.input}
                value={destinationAddress}
                onChangeText={setDestinationAddress}
                placeholder="Para onde deseja ir?"
              />
              {!!notice && <Text style={styles.notice}>{notice}</Text>}
              <ActionButton title="Solicitar corrida" onPress={handleRequestRide} disabled={busy} />
              {ride && (
                <View style={styles.ridePanel}>
                  <Text style={styles.rideTitle}>Corrida {ride.id.slice(0, 8)}</Text>
                  <Text style={styles.rideStatus}>Status: {ride.status}</Text>
                  <Text style={styles.small}>Atualização automática a cada 5 segundos.</Text>
                </View>
              )}
              <Text style={styles.disclaimer}>A solicitação só será enviada quando a API fornecer uma estimativa de tarifa válida. Não exibimos nem inventamos preços.</Text>
            </View>
          )}
          <Text style={styles.footer}>Paulista • Pernambuco</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ActionButton({ title, onPress, disabled }: { title: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.buttonDisabled]}>
      {disabled ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F5F6FF' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F6FF' },
  content: { flexGrow: 1, padding: 24, justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 },
  logo: { width: 48, height: 48, borderRadius: 16, backgroundColor: INDIGO, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#FFFFFF', fontSize: 27, fontWeight: '800' },
  brand: { color: '#171A35', fontSize: 24, fontWeight: '800' },
  brandSub: { color: '#777B95', fontSize: 13, marginTop: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 22, shadowColor: '#1B1E40', shadowOpacity: 0.07, shadowRadius: 18, elevation: 3 },
  heading: { color: '#171A35', fontSize: 22, fontWeight: '800', marginBottom: 7 },
  description: { color: '#777B95', fontSize: 14, marginBottom: 22 },
  label: { color: '#343854', fontWeight: '700', fontSize: 13, marginBottom: 8, marginTop: 12 },
  input: { minHeight: 52, borderWidth: 1, borderColor: '#E3E5F2', borderRadius: 14, paddingHorizontal: 14, color: '#171A35', backgroundColor: '#FCFCFF' },
  button: { minHeight: 54, borderRadius: 15, backgroundColor: INDIGO, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonDisabled: { opacity: 0.65 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  notice: { color: '#555B7A', backgroundColor: '#F0F1FF', borderRadius: 12, padding: 12, lineHeight: 20, marginTop: 14 },
  devCode: { color: '#2E7D55', fontWeight: '700', marginTop: 10 },
  linkButton: { alignItems: 'center', padding: 14 },
  locationButton: { alignSelf: 'flex-start', paddingVertical: 10 },
  link: { color: INDIGO, fontWeight: '700' },
  welcomeRow: { flexDirection: 'row', alignItems: 'flex-start' },
  ridePanel: { marginTop: 20, borderRadius: 14, padding: 16, backgroundColor: '#F0F1FF' },
  rideTitle: { color: '#171A35', fontWeight: '800', fontSize: 15 },
  rideStatus: { color: INDIGO, fontWeight: '700', marginTop: 8 },
  small: { color: '#777B95', fontSize: 12, marginTop: 6 },
  disclaimer: { color: '#8A8DA2', fontSize: 11, lineHeight: 16, marginTop: 18 },
  footer: { color: '#999CB0', textAlign: 'center', marginTop: 22, fontSize: 12 },
});
