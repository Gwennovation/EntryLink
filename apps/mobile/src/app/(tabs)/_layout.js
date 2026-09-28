import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../auth';
import { useTheme } from '../../ui';

const icon = (name) => ({ color, size }) => <Ionicons name={name} size={size} color={color} />;

export default function TabLayout() {
  const { colors } = useTheme();
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: colors.brand,
      tabBarInactiveTintColor: colors.muted, // ≥4.5:1 in both themes (the library default is too faint)
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      headerStyle: { backgroundColor: colors.surface },
      headerShadowVisible: false, // the default hairline is always light-theme grey
      headerTitleStyle: { color: colors.text },
      sceneStyle: { backgroundColor: colors.bg },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Events', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="registrations" options={{ title: 'My bookings', tabBarLabel: 'Bookings', tabBarIcon: icon('document-text-outline') }} />
      <Tabs.Screen name="tickets" options={{ title: 'Ticket wallet', tabBarLabel: 'Tickets', tabBarIcon: icon('qr-code-outline') }} />
      <Tabs.Screen name="inbox" options={{ title: 'Notifications', tabBarLabel: 'Inbox', tabBarIcon: icon('notifications-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
