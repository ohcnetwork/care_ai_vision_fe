interface ImportMetaEnv {
  readonly REACT_MEDISPEAK_API_URL: string;
  readonly REACT_LOW_CONFIDENCE_THRESHOLD?: string;
  /** Local-dev-only fallback for the OpenAI direct-vision test branch. */
  readonly REACT_OPENAI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
