import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api, formWith } from '../../api';
import { useAuth } from '../../auth';
import ProofPicker from '../../ProofPicker';
import { Button, Card, colors, dateTime, ErrorText, Field, peso, s, useFocusLoad } from '../../ui';

// Also the target of poster links (entrylink://event/<id>), so it may open before sign-in.
export default function EventScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  if (!user) return <Redirect href={{ pathname: '/login', params: { next: `/event/${id}` } }} />;
  return <EventDetails id={id} />;
}

function EventDetails({ id }) {
  const { data, error } = useFocusLoad(() => api.get(`/events/${id}`), [id]);
  const [typeId, setTypeId] = useState(null);
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const e = data?.event;
  const type = e?.ticket_types.find((t) => t.id === typeId);
  const paid = type?.price_cents > 0;

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const form = formWith({ event_id: e.id, ticket_type_id: type.id, payment_reference: reference.trim() }, paid ? proof : null);
      const { registration } = await api.post('/registrations', form);
      router.replace(`/registration/${registration.id}`);
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: e?.title ?? 'Event' }} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <ErrorText error={error} />
        {e && (
          <>
            <Text style={s.h1}>{e.title}</Text>
            <Card>
              <Text style={s.body}>📅  {dateTime(e.starts_at)} – {dateTime(e.ends_at)}</Text>
              <Text style={s.body}>📍  {e.venue}</Text>
              {e.description ? <Text style={[s.body, { marginTop: 4 }]}>{e.description}</Text> : null}
            </Card>

            <Text style={[s.h2, { marginTop: 8 }]}>Choose a ticket</Text>
            {e.ticket_types.map((t) => {
              const soldOut = t.quantity != null && t.sold >= t.quantity;
              const selected = t.id === typeId;
              return (
                <Pressable key={t.id} disabled={soldOut} onPress={() => setTypeId(t.id)}
                  style={[s.card, { flexDirection: 'row', alignItems: 'center' }, selected && { borderColor: colors.brand, borderWidth: 2 }, soldOut && { opacity: 0.5 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h2}>{t.name}</Text>
                    {t.description ? <Text style={s.small}>{t.description}</Text> : null}
                    {soldOut && <Text style={s.small}>Sold out</Text>}
                  </View>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.brand }}>{peso(t.price_cents)}</Text>
                </Pressable>
              );
            })}

            {type && (
              <Card style={{ marginTop: 4, gap: 14 }}>
                {paid ? (
                  <>
                    <Text style={s.body}>
                      Pay <Text style={{ fontWeight: '700' }}>{peso(type.price_cents)}</Text> using the payment instructions from the organizer, then enter the reference number and upload your receipt. A coordinator will verify it and your QR ticket will appear in your wallet.
                    </Text>
                    <Field label="Payment reference number" value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder="e.g. GCASH-1234-5678" />
                    <ProofPicker value={proof} onChange={setProof} onError={setSubmitError} />
                  </>
                ) : (
                  <Text style={s.body}>This ticket is free. Submit your registration and a coordinator will confirm it.</Text>
                )}
                <ErrorText error={submitError} />
                <Button title="Submit registration" onPress={submit} busy={busy} disabled={paid && (!proof || !reference.trim())} />
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
