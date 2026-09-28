import { Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { afterSignIn, useAuth } from '../auth';
import { Button, ErrorText, Field, useTheme } from '../ui';

export default function Signup() {
  const { s } = useTheme();
  const { user, signUp } = useAuth();
  const { next } = useLocalSearchParams();
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF({ ...f, [k]: v });

  if (user) return <Redirect href={afterSignIn(next)} />;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUp({ ...f, email: f.email.trim(), phone: f.phone.trim() || undefined });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.muted}>Create an attendee account to register for events.</Text>
        <ErrorText error={error} />
        <Field label="Full name" value={f.full_name} onChangeText={set('full_name')} autoComplete="name" textContentType="name" />
        <Field label="Email" value={f.email} onChangeText={set('email')} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <Field label="Mobile number" hint="optional" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
        <Field label="Password" hint="at least 8 characters" value={f.password} onChangeText={set('password')} secureTextEntry textContentType="newPassword" />
        <Button title="Create account" onPress={submit} busy={busy} disabled={!f.full_name || !f.email || f.password.length < 8} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
