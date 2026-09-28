import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { Badge, Button, dateTime, Empty, ErrorText, peso, useFocusLoad, useTheme } from '../../ui';

export default function Registrations() {
  const { colors, s } = useTheme();
  const { data, error, loading, reload } = useFocusLoad(() => api.get('/registrations/mine'));
  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={s.content}
      data={data?.registrations ?? []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={loading && Boolean(data)} onRefresh={reload} />}
      ListHeaderComponent={<ErrorText error={error} />}
      ListEmptyComponent={!loading && <Empty title="No registrations yet" body="Find an event in the Events tab to register." />}
      renderItem={({ item: r }) => (
        <Pressable onPress={() => router.push(`/registration/${r.id}`)} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Badge status={r.status} />
            <Text style={s.small}>{dateTime(r.starts_at)}</Text>
          </View>
          <Text style={s.h2}>{r.event_title}</Text>
          <Text style={s.muted}>{r.ticket_type} · {peso(r.amount_cents)}</Text>
          <Text style={s.small}>{r.venue}</Text>
          {r.status === 'revision_requested' && (
            <Text style={{ color: colors.info, fontWeight: '600' }}>Tap to see what the coordinator needs →</Text>
          )}
          {r.status === 'approved' && r.ticket_id && (
            <Button title="View ticket" onPress={() => router.push(`/ticket/${r.ticket_id}`)} style={{ marginTop: 4 }} />
          )}
        </Pressable>
      )}
    />
  );
}
