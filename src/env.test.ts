import { publicValue } from './env';

describe('env', () => {
  it('reads a missing public value as an empty string', () => {
    expect(process.env.EXPO_PUBLIC_NOT_SET).toBeUndefined();
    expect(publicValue(process.env.EXPO_PUBLIC_NOT_SET)).toBe('');
  });
});
