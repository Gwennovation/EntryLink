import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { api, formWith } from '../../api';
import { useAuth } from '../../auth';
import PaymentInstructions from '../../PaymentInstructions';
import ProofPicker from '../../ProofPicker';
import { Badge, Button, Card, dateTime, ErrorText, Field, humanize, peso, useFocusLoad, useTheme } from '../../ui';

const EXPLAIN = {
  pending: 'A coordinator is reviewing your payment. You’ll be notified as soon as it’s approved.',
  revision_requested: 'The coordinator needs something changed before they can approve this. See their note below.',
  approved: 'You’re in! Your QR ticket is in your ticket wallet.',
  rejected: 'This registration was not approved. You can register again from the event page.',
  cancelled: 'You cancelled this registration.',
};

export default function RegistrationScreen() {
  const { colors, s } = useTheme();
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const detail = useFocusLoad(() => api.get(`/registrations/${id}`), [id]);
  const thread = useFocusLoad(() => api.get(`/registrations/${id}/comments`), [id]);
  const [comment, setComment] = useState('');
  const [reference, setReference] = useState('');
  const [proof, setProof] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const r = detail.data?.registration;
  const ticket = detail.data?.ticket;

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try { await fn(); } catch (err) { setError(err); } finally { setBusy(null); }
  };

  const resubmit = () => run('resubmit', async () => {
    await api.put(`/registrations/${id}/resubmit`, formWith({ payment_reference: reference.trim() }, proof));
    setProof(null);
    setReference('');
    detail.reload();
  });

  const send = () => run('comment', async () => {
    await api.post(`/registrations/${id}/comments`, { body: comment.trim() });
    setComment('');
    thread.reload();
  });

  const cancel = () => {
    const doCancel = () => run('cancel', async () => { await api.post(`/registrations/${id}/cancel`); detail.reload(); });
    if (Platform.OS === 'web') { if (window.confirm('Cancel this registration?')) doCancel(); return; }
    Alert.alert('Cancel registration?', r.status === 'approved' ? 'Your ticket will stop working. This can’t be undone.' : 'This can’t be undone.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel registration', style: 'destructive', onPress: doCancel },
    ]);
  };

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <ErrorText error={detail.error} />
        {r && (
          <>
            <Card>
              <Badge status={r.status} />
              <Text style={s.h2}>{r.event_title}</Text>
              <Text style={s.muted}>{r.ticket_type} · {peso(r.amount_cents)}</Text>
              <Text style={s.body}>{EXPLAIN[r.status]}</Text>
              {r.review_note && r.status !== 'approved' ? (
                <View style={{ backgroundColor: colors.infoSoft, padding: 12, borderRadius: 10 }}>
                  <Text style={{ color: colors.info, fontWeight: '600' }}>Coordinator’s note</Text>
                  <Text style={s.body}>{r.review_note}</Text>
                </View>
              ) : null}
              {ticket && <Button title="View QR ticket" onPress={() => router.push(`/ticket/${ticket.id}`)} />}
            </Card>

            {r.status === 'revision_requested' && (
              <Card style={{ gap: 12 }}>
                <Text style={s.h2}>Update your registration</Text>
                {r.amount_cents > 0 && <PaymentInstructions amountCents={r.amount_cents} instructions={r.payment_instructions} />}
                <Field label="Payment reference" hint="leave blank to keep" value={reference} onChangeText={setReference} autoCapitalize="characters" placeholder={r.payment_reference ?? ''} />
                <ProofPicker value={proof} onChange={setProof} onError={setError} />
                <Button title="Resubmit for review" onPress={resubmit} busy={busy === 'resubmit'} disabled={!proof && !reference.trim()} />
              </Card>
            )}

            <ErrorText error={error} />

            <Card>
              <Text style={s.h2}>Messages</Text>
              {thread.data?.comments.length === 0 && <Text style={s.muted}>Questions about your registration? Send the coordinator a message.</Text>}
              {thread.data?.comments.map((c) => {
                const mine = c.author_id === user.id;
                return (
                  <View key={c.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? colors.brandSoft : colors.mutedSoft, padding: 10, borderRadius: 12 }}>
                    <Text style={s.small}>{mine ? 'You' : `${c.author_name} (coordinator)`} · {dateTime(c.created_at)}</Text>
                    <Text style={s.body}>{c.body}</Text>
                  </View>
                );
              })}
              {['pending', 'revision_requested', 'approved'].includes(r.status) && (
                <View style={{ gap: 8, marginTop: 4 }}>
                  <Field label="" placeholder="Write a message…" value={comment} onChangeText={setComment} multiline />
                  <Button title="Send" variant="secondary" onPress={send} busy={busy === 'comment'} disabled={!comment.trim()} />
                </View>
              )}
            </Card>

            <Card>
              <Text style={s.h2}>History</Text>
              {detail.data.history.map((h, i) => (
                <View key={i} style={{ borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 10 }}>
                  <Text style={{ fontWeight: '600', color: colors.text }}>{humanize(h.to_status)}</Text>
                  <Text style={s.small}>{dateTime(h.created_at)}{h.actor_role !== 'attendee' && h.actor_name ? ` · ${h.actor_name}` : ''}</Text>
                </View>
              ))}
            </Card>

            {['pending', 'revision_requested'].includes(r.status) || (r.status === 'approved' && ticket?.status === 'issued') ? (
              <Button title="Cancel registration" variant="danger" onPress={cancel} busy={busy === 'cancel'} />
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
