import { Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { strings } from '../src/strings';
import { theme } from '../src/theme';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColorScheme() === 'dark' ? theme.dark : theme.light;

  return (
    <View
      testID="app-root"
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left + 24,
        paddingRight: insets.right + 24,
        backgroundColor: colors.background,
      }}
    >
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '600', color: colors.text }}>
        {strings.title}
      </Text>
      <Text style={{ fontSize: 15, color: colors.text, textAlign: 'center' }}>{strings.subtitle}</Text>
    </View>
  );
}
