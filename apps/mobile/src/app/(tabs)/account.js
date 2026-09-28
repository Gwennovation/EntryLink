import { ScrollView, Text } from 'react-native';
import { API_URL } from '../../api';
import { useAuth } from '../../auth';
import { Button, Card, useTheme } from '../../ui';

export default function Account() {
  const { s } = useTheme();
  const { user, signOut } = useAuth();
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Card>
        <Text style={s.h2}>{user.full_name}</Text>
        <Text style={s.muted}>{user.email}</Text>
        {user.phone ? <Text style={s.muted}>{user.phone}</Text> : null}
      </Card>
      <Button title="Sign out" variant="danger" onPress={signOut} />
      {__DEV__ && <Text style={[s.small, { textAlign: 'center' }]}>API: {API_URL}</Text>}
    </ScrollView>
  );
}
