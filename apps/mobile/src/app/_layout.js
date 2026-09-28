import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { AuthProvider, useAuth } from '../auth';
import { useTheme } from '../ui';

// A deep link straight to an event still gets the tabs underneath, so "back" has somewhere to go.
export const unstable_settings = { initialRouteName: '(tabs)' };

function RootStack() {
  const { colors, dark } = useTheme();
  const { ready } = useAuth();
  if (!ready) {
    return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.brand} /></View>;
  }
  return (
    <>
    <StatusBar style={dark ? 'light' : 'dark'} />
    <Stack screenOptions={{
      headerTintColor: colors.brand,
      headerTitleStyle: { color: colors.text },
      headerStyle: { backgroundColor: colors.surface },
      headerShadowVisible: false, // the default hairline is always light-theme grey
      contentStyle: { backgroundColor: colors.bg },
    }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ title: 'Create account' }} />
      <Stack.Screen name="event/[id]" options={{ title: 'Event details' }} />
      <Stack.Screen name="registration/[id]" options={{ title: 'Booking' }} />
      <Stack.Screen name="ticket/[id]" options={{ title: 'Ticket', presentation: 'modal' }} />
    </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootStack />
    </AuthProvider>
  );
}
