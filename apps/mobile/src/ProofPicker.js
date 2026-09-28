import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image, Text, View } from 'react-native';
import { Button, useTheme } from './ui';

const MAX_BYTES = 4 * 1024 * 1024; // matches the API limit (Vercel caps request bodies at 4.5 MB)

/** Lets the attendee attach a receipt screenshot/photo or a PDF. `value` is { uri, name, mimeType, file? }. */
export default function ProofPicker({ value, onChange, onError }) {
  const { colors, s } = useTheme();
  const accept = (asset, fallbackName) => {
    if (asset.fileSize > MAX_BYTES || asset.size > MAX_BYTES) {
      onError(new Error('That file is larger than 4 MB. Try a screenshot instead of a full-resolution photo.'));
      return;
    }
    onError(null);
    onChange({
      uri: asset.uri,
      name: asset.fileName || asset.name || fallbackName,
      mimeType: asset.mimeType || 'image/jpeg',
      file: asset.file, // web only
    });
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) accept(res.assets[0], 'receipt.jpg');
  };

  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (!res.canceled) accept(res.assets[0], 'receipt.pdf');
  };

  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>Proof of payment</Text>
      {value ? (
        <View style={[s.row, { gap: 12 }]}>
          {value.mimeType.startsWith('image/')
            ? <Image source={{ uri: value.uri }} style={{ width: 64, height: 64, borderRadius: 8 }} />
            : <Text style={{ fontSize: 32 }}>📄</Text>}
          <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>{value.name}</Text>
          <Text style={{ color: colors.bad, fontWeight: '600' }} onPress={() => onChange(null)} accessibilityRole="button">Remove</Text>
        </View>
      ) : (
        <View style={s.row}>
          <Button title="Choose photo" variant="secondary" onPress={pickImage} style={{ flex: 1 }} />
          <Button title="Choose PDF" variant="secondary" onPress={pickPdf} style={{ flex: 1 }} />
        </View>
      )}
      <Text style={s.small}>A screenshot of your bank or e-wallet receipt showing the reference number. Max 4 MB.</Text>
    </View>
  );
}
