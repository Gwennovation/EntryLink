import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native';

// Same palettes as the web dashboard's CSS tokens; every text/background pair meets WCAG AA
// (4.5:1 for text, 3:1 for input borders). The app follows the phone's light/dark setting.
const palettes = {
  light: {
    bg: '#f5f6f8', surface: '#ffffff', border: '#e2e5ea',
    inputBorder: '#7d8596', placeholder: '#6b7280',
    text: '#16181d', muted: '#5d6573', mutedSoft: '#eef0f3',
    brand: '#5c5fc4', brandSoft: '#ecedfd', onBrand: '#ffffff', // logo purple, deep enough for 4.5:1
    ok: '#117a45', okSoft: '#e3f5ea', warn: '#9a5b00', warnSoft: '#fdf1dc',
    bad: '#b42318', badSoft: '#fde8e6', info: '#175cd3', infoSoft: '#e4eefc',
  },
  dark: {
    bg: '#0f1115', surface: '#171a21', border: '#2b303b',
    inputBorder: '#626b7b', placeholder: '#8b93a1',
    text: '#e8eaef', muted: '#9aa3b2', mutedSoft: '#252a33',
    brand: '#a5a7ff', brandSoft: '#23264a', onBrand: '#0f1115', // the logo's dark-mode purple
    ok: '#4ad38b', okSoft: '#143323', warn: '#f2b653', warnSoft: '#3a2b12',
    bad: '#ff7b6e', badSoft: '#3d1a17', info: '#7cb0ff', infoSoft: '#172a47',
  },
};

function makeStyles(c) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: 16, gap: 12 },
    h1: { fontSize: 24, fontWeight: '700', color: c.text, letterSpacing: -0.3 },
    h2: { fontSize: 17, fontWeight: '700', color: c.text },
    body: { fontSize: 15, color: c.text, lineHeight: 21 },
    muted: { fontSize: 14, color: c.muted },
    small: { fontSize: 12.5, color: c.muted },
    card: { backgroundColor: c.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, gap: 8 },
    badge: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 99 },
    badgeText: { fontSize: 12, fontWeight: '700' },
    button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    buttonText: { fontSize: 16, fontWeight: '600' },
    label: { fontSize: 13.5, fontWeight: '600', color: c.text },
    hint: { fontWeight: '400', color: c.muted },
    input: { borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16, color: c.text },
    error: { backgroundColor: c.badSoft, padding: 12, borderRadius: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
}

const themes = {
  light: { dark: false, colors: palettes.light, s: makeStyles(palettes.light) },
  dark: { dark: true, colors: palettes.dark, s: makeStyles(palettes.dark) },
};

/** { dark, colors, s } for the phone's current light/dark setting. */
export function useTheme() {
  return themes[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

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

export function Badge({ status }) {
  const { colors, s } = useTheme();
  const [label, tone] = STATUS[status] ?? [humanize(status), 'muted'];
  return (
    <View style={[s.badge, { backgroundColor: colors[`${tone}Soft`] }]}>
      <Text style={[s.badgeText, { color: colors[tone] }]}>{label}</Text>
    </View>
  );
}

export function Button({ title, onPress, variant = 'primary', disabled, busy, style }) {
  const { colors, s } = useTheme();
  const v = {
    primary: { box: { backgroundColor: colors.brand }, text: { color: colors.onBrand } },
    secondary: { box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder }, text: { color: colors.text } },
    danger: { box: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder }, text: { color: colors.bad } },
  }[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || busy), busy: Boolean(busy) }}
      style={({ pressed }) => [s.button, v.box, (disabled || busy) && { opacity: 0.5 }, pressed && { opacity: 0.8 }, style]}
    >
      {busy ? <ActivityIndicator color={v.text.color} /> : <Text style={[s.buttonText, v.text]}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, ...props }) {
  const { colors, s } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      {label ? <Text style={s.label}>{label}{hint ? <Text style={s.hint}>{`  ${hint}`}</Text> : null}</Text> : null}
      <TextInput placeholderTextColor={colors.placeholder} style={s.input} accessibilityLabel={label || props.placeholder} {...props} />
    </View>
  );
}

export function Card({ children, style }) {
  const { s } = useTheme();
  return <View style={[s.card, style]}>{children}</View>;
}

export function ErrorText({ error }) {
  const { colors, s } = useTheme();
  if (!error) return null;
  return (
    <View style={s.error} accessibilityRole="alert">
      <Text style={{ color: colors.bad, fontWeight: '500' }}>{error.message || String(error)}</Text>
    </View>
  );
}

export function Empty({ title, body }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: 32, alignItems: 'center', gap: 6 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{title}</Text>
      {body ? <Text style={{ color: colors.muted, textAlign: 'center' }}>{body}</Text> : null}
    </View>
  );
}

const LIVE_REFRESH_MS = 3000;
const isForeground = () => Platform.OS === 'web'
  ? document.visibilityState !== 'hidden'
  : AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

/** Refresh a focused screen while the app is foregrounded; preserve data if a refresh fails. */
export function useFocusLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const requestId = useRef(0);
  const polling = useRef(false);
  const active = useRef(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(fn, deps);
  const reload = useCallback(async (background = false) => {
    const id = ++requestId.current;
    if (!background) setState((x) => ({ ...x, loading: true }));
    try {
      const data = await load();
      if (active.current && id === requestId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (active.current && id === requestId.current) setState((x) => ({ ...x, error, loading: false }));
    }
  }, [load]);
  useFocusEffect(useCallback(() => {
    active.current = true;
    if (isForeground()) reload();
    const refresh = () => {
      if (!isForeground() || polling.current) return;
      polling.current = true;
      reload(true).finally(() => { polling.current = false; });
    };
    const timer = setInterval(refresh, LIVE_REFRESH_MS);
    const appState = Platform.OS === 'web' ? null : AppState.addEventListener('change', (next) => { if (next === 'active') reload(); });
    const onVisibility = () => { if (isForeground()) reload(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active.current = false;
      requestId.current++;
      clearInterval(timer);
      appState?.remove();
      if (Platform.OS === 'web') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reload]));
  return { ...state, reload };
}
