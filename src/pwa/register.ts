// The one place that imports the registration hook of vite-plugin-pwa. That module is virtual: it exists
// only in a real build, so tests replace this file (`vi.mock('./register', ...)`) instead of resolving it.
export { useRegisterSW } from 'virtual:pwa-register/react';
