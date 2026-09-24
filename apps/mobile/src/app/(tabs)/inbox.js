import { router, useNavigation } from 'expo-router';
import { useLayoutEffect } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../../api';
import { colors, dateTime, Empty, ErrorText, s, useFocusLoad } from '../../ui';

export default function Inbox() {
  const navigation = useNavigation();
  const { data, error, loading, reload } = useFocusLoad(() => api.get('/notifications/mine'));

  useLayoutEffect(() => {
    navigation.setOptions({
      tabBarBadge: data?.unread || undefined,
      headerRight: () => (data?.unread ? (
        <Text style={{ color: colors.brand, fontWeight: '600', marginRight: 16 }} onPress={async () => { await api.post('/notifications/read-all'); reload(); }}>
          Mark all read
        </Text>
      ) : null),
    });
  }, [navigation, data, reload]);

  const open = async (n) => {
    if (!n.read_at) api.post(`/notifications/${n.id}/read`).catch(() => {});
    if (n.data?.ticket_id) router.push(`/ticket/${n.data.ticket_id}`);
    else if (n.data?.registration_id) router.push(`/registration/${n.data.registration_id}`);
  };

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={s.content}
      data={data?.notifications ?? []}
      keyExtractor={(n) => n.id}
      refreshControl={<RefreshControl refreshing={loading && Boolean(data)} onRefresh={reload} />}
      ListHeaderComponent={<ErrorText error={error} />}
      ListEmptyComponent={!loading && <Empty title="You're all caught up" body="Updates about your registrations and tickets will show up here." />}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => open(n)} style={({ pressed }) => [s.card, !n.read_at && { borderColor: colors.brand, backgroundColor: colors.brandSoft }, pressed && { opacity: 0.85 }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={[s.h2, { flex: 1 }]}>{n.title}</Text>
            {!n.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand }} />}
          </View>
          <Text style={s.body}>{n.body}</Text>
          <Text style={s.small}>{dateTime(n.created_at)}</Text>
        </Pressable>
      )}
    />
  );
}
