import { useLocalSearchParams } from 'expo-router';
import { Image, Platform, ScrollView, Text, View } from 'react-native';
import { api } from '../../api';
import { Badge, colors, dateTime, ErrorText, s, useFocusLoad } from '../../ui';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const NOTE = {
  issued: 'Show this QR code at the gate. Turn your screen brightness up for faster scanning.',
  checked_in: 'This ticket has already been used to enter.',
  cancelled: 'This ticket was cancelled and will not be accepted at the gate.',
  expired: 'This event has ended.',
};

export default function TicketScreen() {
  const { id } = useLocalSearchParams();
  const { data, error } = useFocusLoad(() => api.get(`/tickets/${id}`), [id]);
  const t = data?.ticket;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.content, { alignItems: 'center' }]}>
      <ErrorText error={error} />
      {t && (
        <>
          <View style={{ backgroundColor: '#fff', padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border }}>
            <Image source={{ uri: t.qr_image }} style={{ width: 280, height: 280, opacity: t.status === 'issued' ? 1 : 0.25 }} accessibilityLabel="QR ticket" />
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 22, fontWeight: '700', letterSpacing: 2, color: colors.text }}>{t.short_code}</Text>
          <Badge status={t.status} />
          <Text style={[s.muted, { textAlign: 'center', paddingHorizontal: 16 }]}>{NOTE[t.status]}</Text>
          <View style={[s.card, { alignSelf: 'stretch' }]}>
            <Text style={s.h2}>{t.event_title}</Text>
            <Text style={s.body}>{t.attendee_name} · {t.ticket_type}</Text>
            <Text style={s.muted}>{dateTime(t.starts_at)}</Text>
            <Text style={s.muted}>{t.venue}</Text>
            {t.checked_in_at && <Text style={s.small}>Checked in {dateTime(t.checked_in_at)}</Text>}
          </View>
        </>
      )}
    </ScrollView>
  );
}
