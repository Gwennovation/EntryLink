import { router } from 'expo-router';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { Badge, dateTime, Empty, ErrorText, useFocusLoad, useTheme } from '../../ui';

export default function Tickets() {
  const { s } = useTheme();
  const { data, error, loading, reload } = useFocusLoad(() => api.get('/tickets/mine'));
  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={s.content}
      data={data?.tickets ?? []}
      keyExtractor={(t) => t.id}
      refreshControl={<RefreshControl refreshing={loading && Boolean(data)} onRefresh={reload} />}
      ListHeaderComponent={<ErrorText error={error} />}
      ListEmptyComponent={!loading && (
        <Empty title="No tickets yet" body="Your QR ticket appears here automatically once a coordinator approves your registration." />
      )}
      renderItem={({ item: t }) => (
        <Pressable onPress={() => router.push(`/ticket/${t.id}`)} style={({ pressed }) => [s.card, { flexDirection: 'row', gap: 14 }, pressed && { opacity: 0.85 }]}>
          <Image source={{ uri: t.qr_image }} style={{ width: 84, height: 84, opacity: t.status === 'issued' ? 1 : 0.35 }} />
          <View style={{ flex: 1, gap: 4 }}>
            <Badge status={t.status} />
            <Text style={s.h2} numberOfLines={2}>{t.event_title}</Text>
            <Text style={s.small}>{dateTime(t.starts_at)} · {t.ticket_type}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}
