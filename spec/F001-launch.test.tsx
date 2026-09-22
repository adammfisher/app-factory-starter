import { render } from '@testing-library/react-native';

import HomeScreen from '../app/index';
import { strings } from '../src/strings';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 11, right: 22, bottom: 33, left: 44 }),
}));

describe('F001 the app launches to a home screen', () => {
  it('shows the app title as a header', () => {
    const { getByText } = render(<HomeScreen />);
    expect(getByText(strings.title).props.accessibilityRole).toBe('header');
  });

  it('keeps every text element reachable by a screen reader', () => {
    const { getByTestId, getByText } = render(<HomeScreen />);
    expect(getByTestId('app-root').props.accessible).not.toBe(true);
    expect(getByText(strings.subtitle)).toBeTruthy();
  });

  it('keeps content clear of the system bars on every edge', () => {
    const { getByTestId } = render(<HomeScreen />);
    expect(getByTestId('app-root').props.style).toMatchObject({ paddingTop: 11, paddingBottom: 33, paddingLeft: 68, paddingRight: 46 });
  });
});
