export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// Una versión de modelo elegible: `value` es lo que se envía a /config o /model
export type ModelChoice = { value: string; label: string; family: string; price?: string }

declare module 'claude-code' {
  interface PluginState {
    'selector-modelo': {
      model: string | null
      effort: Effort | null
      isOpen: boolean
      family: string | null
      choices: ModelChoice[]
      chosenEffort: Effort | null
    }
  }
}
