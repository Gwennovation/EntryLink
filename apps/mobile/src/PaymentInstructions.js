import { Text, View } from 'react-native';
import { peso, useTheme } from './ui';

/** "How to pay" box: the organizer's payment details (long-press to copy) and the amount due. */
export default function PaymentInstructions({ amountCents, instructions }) {
  const { colors, s } = useTheme();
  return (
    <View style={{ backgroundColor: colors.brandSoft, borderRadius: 12, padding: 14, gap: 6 }}>
      <Text style={[s.label, { color: colors.brand }]}>1. Send {peso(amountCents)} to</Text>
      {instructions ? (
        <Text selectable style={[s.body, { fontWeight: '600' }]}>{instructions}</Text>
      ) : (
        <Text style={s.body}>The organizer hasn’t added payment details yet. Message the event team before paying.</Text>
      )}
      {instructions ? <Text style={s.small}>Long-press to copy.</Text> : null}
      <Text style={[s.label, { color: colors.brand, marginTop: 4 }]}>2. Enter the reference number and upload your receipt below</Text>
      <Text style={s.small}>A coordinator checks it, then your QR ticket appears in your wallet.</Text>
    </View>
  );
}
