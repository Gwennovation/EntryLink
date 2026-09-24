import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export const colors = {
  bg: '#f5f6f8',
  surface: '#ffffff',
  border: '#e2e5ea',
  text: '#16181d',
  muted: '#5d6573',
  brand: '#3b3fd8',
  brandSoft: '#ecedfd',
  ok: '#117a45',
  okSoft: '#e3f5ea',
  warn: '#9a5b00',
  warnSoft: '#fdf1dc',
  bad: '#b42318',
  badSoft: '#fde8e6',
  info: '#175cd3',
  infoSoft: '#e4eefc',
};

const TZ = 'Asia/Manila';
export const peso = (cents) => (cents ? `₱${(cents / 100).toLocaleString('en-PH', { minimumFractionDigits: cents % 100 ? 2 : 0 })}` : 'Free');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '—');
export const humanize = (s) => (s ? s.replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

const STATUS = {
  pending: ['Pending review', 'warn'],
  revision_requested: ['Action needed', 'info'],
  approved: ['Approved', 'ok'],
  rejected: ['Not approved', 'bad'],
  cancelled: ['Cancelled', 'muted'],
  issued: ['Ready to use', 'ok'],
  checked_in: ['Checked in', 'info'],
  expired: ['Expired', 'muted'],
};
const TONES = {
  ok: [colors.okSoft, colors.ok], warn: [colors.warnSoft, colors.warn], bad: [colors.badSoft, colors.bad],
  info: [colors.infoSoft, colors.info], muted: ['#eef0f3', colors.muted],
};

export function Badge({ status }) {
  const [label, tone] = STATUS[status] ?? [humanize(status), 'muted'];
  const [bg, fg] = TONES[tone];
  return (
    <View style={[s.badge, { backgroundColor: bg }]}>
      <Text style={[s.badgeText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, busy, style }) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => [s.button, v.box, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {busy ? <ActivityIndicator color={v.text.color} /> : <Text style={[s.buttonText, v.text]}>{title}</Text>}
    </Pressable>
  );
}
const VARIANTS = {
  primary: { box: { backgroundColor: colors.brand }, text: { color: '#fff' } },
  secondary: { box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, text: { color: colors.text } },
  danger: { box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, text: { color: colors.bad } },
};

export function Field({ label, hint, ...props }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{label}{hint ? <Text style={s.hint}>{`  ${hint}`}</Text> : null}</Text>
      <TextInput placeholderTextColor="#9aa1ad" style={s.input} {...props} />
    </View>
  );
}

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function ErrorText({ error }) {
  if (!error) return null;
  return (
    <View style={s.error}>
      <Text style={{ color: colors.bad, fontWeight: '500' }}>{error.message || String(error)}</Text>
    </View>
  );
}

export function Empty({ title, body }) {
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{title}</Text>
      {body ? <Text style={{ color: colors.muted, textAlign: 'center' }}>{body}</Text> : null}
    </View>
  );
}

/** Load data whenever the screen gains focus; returns { data, error, loading, reload }. */
export function useFocusLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setState((x) => ({ ...x, loading: true }));
    try { setState({ data: await fn(), error: null, loading: false }); } catch (error) { setState((x) => ({ ...x, error, loading: false })); }
  }, deps);
  useFocusEffect(useCallback(() => { reload(); }, [reload]));
  return { ...state, reload };
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { fontSize: 14, color: colors.muted },
  small: { fontSize: 12.5, color: colors.muted },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  hint: { fontWeight: '400', color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: colors.text },
  error: { backgroundColor: colors.badSoft, padding: 12, borderRadius: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
