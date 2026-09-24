import { router } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { colors, dateTime, Empty, ErrorText, peso, s, useFocusLoad } from '../../ui';

export default function Events() {
  const { data, error, loading, reload } = useFocusLoad(() => api.get('/events'));
  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={s.content}
      data={data?.events ?? []}
      keyExtractor={(e) => e.id}
      refreshControl={<RefreshControl refreshing={loading && Boolean(data)} onRefresh={reload} />}
      ListHeaderComponent={<ErrorText error={error} />}
      ListEmptyComponent={!loading && <Empty title="No upcoming events" body="Check back soon — new events will appear here." />}
      renderItem={({ item: e }) => {
        const prices = e.ticket_types.map((t) => t.price_cents);
        const left = e.capacity - e.approved_count;
        return (
          <Pressable onPress={() => router.push(`/event/${e.id}`)} style={({ pressed }) => [s.card, pressed && { opacity: 0.85 }]}>
            <Text style={s.h2}>{e.title}</Text>
            <Text style={s.muted}>{dateTime(e.starts_at)}</Text>
            <Text style={s.muted}>{e.venue}</Text>
            <View style={[s.row, { justifyContent: 'space-between', marginTop: 4 }]}>
              <Text style={{ fontWeight: '600', color: colors.brand }}>
                {prices.length ? (Math.min(...prices) === Math.max(...prices) ? peso(prices[0]) : `From ${peso(Math.min(...prices))}`) : ''}
              </Text>
              <Text style={s.small}>{left <= 0 ? 'Sold out' : left < 50 ? `${left} spots left` : ''}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
