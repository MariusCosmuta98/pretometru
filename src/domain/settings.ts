import { z } from 'zod';

interface SettingDefinition<S extends z.ZodType> {
  schema: S;
  default: z.infer<S>;
  /**
   * Included in backups and sync. Defaults to nothing: a key that is not listed here (a token, an
   * API key, any device-specific value) never leaves the device.
   */
  portable: boolean;
}

function define<S extends z.ZodType>(definition: SettingDefinition<S>): SettingDefinition<S> {
  return definition;
}

/** Known `settings` keys. Unknown keys can still be stored, but are never exported. */
export const SETTING_DEFINITIONS = {
  /** Plan §7.4: "cheapest" looks at the last N days. */
  priceWindowDays: define({ schema: z.int().min(1).max(3650), default: 90, portable: true }),
  /** Plan §7.4: discounted prices are marked and can be left out of comparisons. */
  excludeDiscountedPrices: define({ schema: z.boolean(), default: false, portable: true }),
};

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_DEFINITIONS)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export function isPortableSetting(key: string): boolean {
  return isSettingKey(key) && SETTING_DEFINITIONS[key].portable;
}
