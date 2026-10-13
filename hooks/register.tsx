import type { Register } from 'claude-code'

import { registerCleanView } from './clean-view'

// One entry point; add more mods beside Clean View here.
export const register: Register = on => {
  registerCleanView(on)
}
