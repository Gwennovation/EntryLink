import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../auth';
import { colors } from '../../ui';

const icon = (name) => ({ color, size }) => <Ionicons name={name} size={size} color={color} />;

export default function TabLayout() {
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.brand, headerTitleStyle: { color: colors.text }, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: 'Events', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="registrations" options={{ title: 'My registrations', tabBarLabel: 'Bookings', tabBarIcon: icon('document-text-outline') }} />
      <Tabs.Screen name="tickets" options={{ title: 'Ticket wallet', tabBarLabel: 'Tickets', tabBarIcon: icon('qr-code-outline') }} />
      <Tabs.Screen name="inbox" options={{ title: 'Notifications', tabBarLabel: 'Inbox', tabBarIcon: icon('notifications-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
