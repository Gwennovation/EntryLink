import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../auth';
import { colors } from '../ui';

// A deep link straight to an event still gets the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

function RootStack() {
  const { ready } = useAuth();
  if (!ready) {
    return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.brand} /></View>;
  }
  return (
    <Stack screenOptions={{ headerTintColor: colors.brand, headerTitleStyle: { color: colors.text }, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ title: 'Create account' }} />
      <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
      <Stack.Screen name="registration/[id]" options={{ title: 'Registration' }} />
      <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootStack />
    </AuthProvider>
  );
}
