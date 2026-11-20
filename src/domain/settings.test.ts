import { describe, expect, expectTypeOf, it } from 'vitest';
import { isPortableSetting, SETTING_DEFINITIONS, type SettingKey } from './settings';

describe('settings registry', () => {
  it('has defaults that satisfy their own schema', () => {
    for (const [key, definition] of Object.entries(SETTING_DEFINITIONS)) {
      expect(definition.schema.safeParse(definition.default).success, key).toBe(true);
    }
  });

  it('only exports settings that were explicitly marked portable (secrets stay on the device)', () => {
    expect(isPortableSetting('priceWindowDays')).toBe(true);
    expect(isPortableSetting('geminiApiKey')).toBe(false);
    expect(isPortableSetting('lastExportAt')).toBe(false);
    expect(isPortableSetting('anything-else')).toBe(false);
  });

  it('does not narrow a known key to `never` when it is not portable (checked by tsc)', () => {
    const key = 'priceWindowDays' as SettingKey;
    if (!isPortableSetting(key)) {
      expectTypeOf(key).toEqualTypeOf<SettingKey>();
    }
  });

  it('keeps the price window within a sane range', () => {
    const { schema } = SETTING_DEFINITIONS.priceWindowDays;
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(90).success).toBe(true);
    expect(schema.safeParse(12.5).success).toBe(false);
  });
});
