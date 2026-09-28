import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { api, formWith } from '../../api';
import { useAuth } from '../../auth';
import PaymentInstructions from '../../PaymentInstructions';
import ProofPicker from '../../ProofPicker';
import { Badge, Button, Card, dateTime, ErrorText, Field, peso, useFocusLoad, useTheme } from '../../ui';

// Also the target of poster links (entrylink://event/<id>), so it may open before sign-in.
export default function EventScreen() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  if (!user) return <Redirect href={{ pathname: '/login', params: { next: `/event/${id}` } }} />;
  return <EventDetails id={id} />;
}

function EventDetails({ id }) {
  const { colors, s } = useTheme();
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
      {/* The event name is the big heading below; repeating it in the header bar is noise. */}
      <Stack.Screen options={{ title: 'Event details' }} />
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

            {e.my_registration ? <AlreadyRegistered mine={e.my_registration} /> : (
            <>
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
                    <PaymentInstructions amountCents={type.price_cents} instructions={e.payment_instructions} />
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
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const REGISTERED_NOTE = {
  pending: 'A coordinator is checking your payment. We’ll notify you when your ticket is ready.',
  revision_requested: 'The coordinator needs something from you before approving. Open your booking to see what.',
  approved: 'Your QR ticket is ready. Show it at the gate.',
};

/** Shown instead of the ticket picker when the attendee already has a live booking for this event. */
function AlreadyRegistered({ mine }) {
  const { s } = useTheme();
  const hasTicket = mine.ticket_id && mine.status === 'approved';
  return (
    <Card style={{ marginTop: 8, gap: 10 }}>
      <Text style={s.h2}>You’re registered</Text>
      <Badge status={mine.status} />
      <Text style={s.body}>{REGISTERED_NOTE[mine.status]}</Text>
      {hasTicket && <Button title="View ticket" onPress={() => router.push(`/ticket/${mine.ticket_id}`)} />}
      <Button title="View booking" variant={hasTicket ? 'secondary' : 'primary'} onPress={() => router.push(`/registration/${mine.id}`)} />
    </Card>
  );
}
