import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { afterSignIn, useAuth } from '../auth';
import { Button, ErrorText, Field, useTheme } from '../ui';

export default function Login() {
  const { colors, s } = useTheme();
  const { user, signIn } = useAuth();
  const { next } = useLocalSearchParams(); // set when a poster link opened the app before sign-in
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (user) return <Redirect href={afterSignIn(next)} />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try { await signIn(email.trim(), password); } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.content, { flexGrow: 1, justifyContent: 'center', paddingTop: 64 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors.onBrand, fontWeight: '800', fontSize: 22 }}>EL</Text>
          </View>
          <Text style={s.h1}>EntryLink</Text>
          <Text style={s.muted}>Register for events and keep your tickets in one place.</Text>
        </View>
        <ErrorText error={error} />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={submit} />
        <Button title="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        <Link href={{ pathname: '/signup', params: next ? { next } : {} }} asChild>
          <Button title="Create an account" variant="secondary" />
        </Link>
        {__DEV__ && (
          <Text style={[s.small, { textAlign: 'center', marginTop: 8 }]} onPress={() => { setEmail('attendee@entrylink.test'); setPassword('EntryLink123!'); }}>
            Demo: tap to fill attendee@entrylink.test
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
